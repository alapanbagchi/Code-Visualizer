// codeviz-ai/backend/src/worker/services/sandboxService.ts
import { ChildProcess, spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { CONSTANTS } from "../../common/constants";
import { CodeExecutionResult, TraceEntry } from "../../common/types";
import os from "os";

// Helper to get platform-specific temp directory
const getTempDir = () => {
  return process.platform === "win32" ? "C:\\temp" : os.tmpdir();
};

// Function to execute code in the sandbox (existing)
export const executeCodeInSandbox = async (
  jobId: string,
  code: string
): Promise<CodeExecutionResult> => {
  const tempDir = path.join(getTempDir(), `codeviz-${jobId}`);
  const userCodePath = path.join(tempDir, "user_code.py");
  const tracerPath = path.join(tempDir, "tracer.py"); // Path to copy tracer.py to
  const sandboxTracerPath = "/mnt/tracer.py"; // Path inside the Docker container

  let executionResult: CodeExecutionResult = {
    output: "",
    error: null,
    execution_trace: [],
  };

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(userCodePath, code);
    // Copy tracer.py from dist to the temp directory
    await fs.copyFile(
      path.join(__dirname, "../../common/tracer.py"), // Source in dist
      tracerPath
    );

    const dockerArgs = [
      "run",
      "--rm", // Automatically remove the container when it exits
      "--name",
      `codeviz-exec-${jobId}`,
      "--network",
      "none", // Isolate network
      "--memory",
      "128m", // Limit memory to 128MB
      "--cpus",
      "0.5", // Limit CPU to 0.5 cores
      "-e",
      `PYTHONUNBUFFERED=1`, // Ensure Python output is unbuffered
      // Pass Qdrant environment variables to the sandbox for potential future use
      // (e.g., if tracer.py ever needed to interact with Qdrant directly)
      "-e",
      `QDRANT_URL=${process.env.QDRANT_URL || ""}`,
      "-e",
      `QDRANT_PORT=${process.env.QDRANT_PORT || ""}`,
      "-e",
      `QDRANT_API_KEY=${process.env.QDRANT_API_KEY || ""}`,
      "-v",
      `${userCodePath}:/mnt/user_code.py`, // Mount user code
      "-v",
      `${tracerPath}:/mnt/tracer.py`, // Mount tracer.py
      CONSTANTS.SANDBOX_IMAGE,
      "python3",
      sandboxTracerPath, // Execute tracer.py
    ];

    console.log(
      `Worker: Executing Docker command for job ${jobId}: docker ${dockerArgs.join(
        " "
      )}`
    );

    const child = spawn("docker", dockerArgs, {
      // Detach the child process from the parent's stdio
      detached: false,
    });

    let stdout = "";
    let stderr = "";

    // Capture stdout and stderr
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Set a timeout for the execution
    const timeout = setTimeout(() => {
      if (!child.killed) {
        console.warn(`Worker: Job ${jobId} timed out. Killing container.`);
        spawn("docker", ["kill", `codeviz-exec-${jobId}`], { stdio: "ignore" });
        (child as ChildProcess).kill("SIGTERM"); // Also kill the spawn process
        executionResult.error = `Code execution timed out after ${CONSTANTS.EXECUTION_TIMEOUT_SECONDS} seconds.`;
      }
    }, CONSTANTS.EXECUTION_TIMEOUT_SECONDS * 1000);

    await new Promise<void>((resolve, reject) => {
      child.on("close", (code) => {
        clearTimeout(timeout);
        console.log(
          `Worker: Docker container for job ${jobId} exited with code ${code}`
        );
        if (code !== 0 && !executionResult.error) {
          // If not already timed out
          executionResult.error = `Docker container exited with code ${code}. Stderr: ${stderr}`;
        }
        resolve();
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        console.error(
          `Worker: Failed to spawn docker process for job ${jobId}:`,
          err
        );
        reject(new Error(`Failed to spawn docker process: ${err.message}`));
      });
    });

    // Parse the JSON output from the sandbox
    try {
      const sandboxOutput = JSON.parse(stdout);
      executionResult.output = sandboxOutput.output;
      executionResult.error = sandboxOutput.error;
      executionResult.execution_trace = sandboxOutput.execution_trace;
      (executionResult as any).execution_time = sandboxOutput.execution_time; // Cast to any to assign
    } catch (parseError: any) {
      console.error(
        `Worker: Failed to parse JSON output from sandbox for job ${jobId}:`,
        parseError
      );
      executionResult.error = `Failed to parse JSON output from sandbox: ${parseError.message}. Raw stdout: ${stdout}. Stderr: ${stderr}`;
    }
  } catch (error: any) {
    console.error(`Worker: Error setting up sandbox for job ${jobId}:`, error);
    executionResult.error = `Sandbox setup error: ${error.message}`;
  } finally {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  return executionResult;
};

// Function to process embeddings (existing)
export const processEmbeddings = async (
  jobId: string,
  code: string,
  executionTrace: TraceEntry[]
): Promise<{ status: string; message: string }> => {
  const embeddingProcessorPath = path.join(
    __dirname,
    "../../common/embedding_processor.py"
  );
  const sandboxEmbeddingProcessorPath = "/mnt/embedding_processor.py";

  try {
    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      `codeviz-embed-${jobId}`,
      "--network",
      "bridge", // Use bridge network to allow reaching Qdrant (if Qdrant is on host or another container)
      "-v",
      `${embeddingProcessorPath}:${sandboxEmbeddingProcessorPath}`, // Mount the script directly
      "-e",
      `QDRANT_URL=${process.env.QDRANT_URL || ""}`, // Pass Qdrant URL
      "-e",
      `QDRANT_PORT=${process.env.QDRANT_PORT || ""}`, // Pass Qdrant Port
      "-e",
      `QDRANT_API_KEY=${process.env.QDRANT_API_KEY || ""}`, // Pass Qdrant API Key
      CONSTANTS.SANDBOX_IMAGE,
      "python3",
      sandboxEmbeddingProcessorPath,
      "process",
      jobId,
      code,
      JSON.stringify(executionTrace),
    ];

    console.log(
      `Worker: Executing embedding command for job ${jobId}: docker ${dockerArgs.join(
        " "
      )}`
    );

    const child = spawn("docker", dockerArgs, {
      detached: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    return new Promise((resolve, reject) => {
      child.on("close", (code) => {
        console.log(
          `Worker: Embedding container for job ${jobId} exited with code ${code}`
        );
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            if (result.status === "success") {
              console.log(
                `Worker: Embeddings processed successfully for job ${jobId}.`
              );
              resolve(result);
            } else {
              console.error(
                `Worker: Embedding processing failed for job ${jobId}: ${result.message}. Stderr: ${stderr}`
              );
              reject(
                new Error(
                  `Embedding processing failed: ${result.message}. Stderr: ${stderr}`
                )
              );
            }
          } catch (parseError: any) {
            console.error(
              `Worker: Failed to parse embedding processor output for job ${jobId}:`,
              parseError
            );
            reject(
              new Error(
                `Failed to parse embedding processor output: ${parseError.message}. Raw stdout: ${stdout}. Stderr: ${stderr}`
              )
            );
          }
        } else {
          console.error(
            `Worker: Embedding container exited with non-zero code ${code} for job ${jobId}. Stderr: ${stderr}`
          );
          reject(
            new Error(
              `Embedding container exited with code ${code}. Stderr: ${stderr}`
            )
          );
        }
      });

      child.on("error", (err) => {
        console.error(
          `Worker: Failed to spawn embedding process for job ${jobId}:`,
          err
        );
        reject(new Error(`Failed to spawn embedding process: ${err.message}`));
      });
    });
  } catch (error: any) {
    console.error(
      `Worker: Error setting up embedding process for job ${jobId}:`,
      error
    );
    throw new Error(`Embedding setup error: ${error.message}`);
  }
};

// NEW: Function to query code with RAG
export const queryCodeWithRag = async (
  query: string
): Promise<{ status: string; answer?: string; message?: string }> => {
  const ragProcessorPath = path.join(
    __dirname,
    "../../common/rag_processor.py"
  );
  const sandboxRagProcessorPath = "/mnt/rag_processor.py";
  const queryId = uuidv4(); // Unique ID for this query process

  try {
    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      `codeviz-rag-${queryId}`,
      "--network",
      "bridge", // Needs bridge network to reach Qdrant and LLM API
      "-v",
      `${ragProcessorPath}:${sandboxRagProcessorPath}`, // Mount the RAG script
      // Pass all necessary environment variables for Qdrant and LLM
      "-e",
      `QDRANT_URL=${process.env.QDRANT_URL || ""}`,
      "-e",
      `QDRANT_PORT=${process.env.QDRANT_PORT || ""}`,
      "-e",
      `QDRANT_API_KEY=${process.env.QDRANT_API_KEY || ""}`,
      "-e",
      `LLM_PROVIDER=${"ollama"}`,
      "-e",
      `LLM_API_KEY=${process.env.LLM_API_KEY}`,
      "-e",
      `LLM_MODEL_NAME=${process.env.LLM_MODEL_NAME || "llama2"}`,
      "-e",
      `LLM_BASE_URL=${process.env.LLM_BASE_URL}`,
      CONSTANTS.SANDBOX_IMAGE,
      "python3",
      sandboxRagProcessorPath,
      "query", // Mode for the script
      query, // The natural language query
    ];

    console.log(
      `Worker: Executing RAG command for query ${queryId}: docker ${dockerArgs.join(
        " "
      )}`
    );

    const child = spawn("docker", dockerArgs, {
      detached: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    return new Promise((resolve, reject) => {
      child.on("close", (code) => {
        console.log(
          `Worker: RAG container for query ${queryId} exited with code ${code}`
        );
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            if (result.status === "success") {
              console.log(
                `Worker: RAG query processed successfully for query ${queryId}.`
              );
              resolve(result);
            } else {
              console.error(
                `Worker: RAG query failed for query ${queryId}: ${result.message}. Stderr: ${stderr}`
              );
              reject(
                new Error(
                  `RAG query failed: ${result.message}. Stderr: ${stderr}`
                )
              );
            }
          } catch (parseError: any) {
            console.error(
              `Worker: Failed to parse RAG processor output for query ${queryId}:`,
              parseError
            );
            reject(
              new Error(
                `Failed to parse RAG processor output: ${parseError.message}. Raw stdout: ${stdout}. Stderr: ${stderr}`
              )
            );
          }
        } else {
          console.error(
            `Worker: RAG container exited with non-zero code ${code} for query ${queryId}. Stderr: ${stderr}`
          );
          reject(
            new Error(
              `RAG container exited with code ${code}. Stderr: ${stderr}`
            )
          );
        }
      });

      child.on("error", (err) => {
        console.error(
          `Worker: Failed to spawn RAG process for query ${queryId}:`,
          err
        );
        reject(new Error(`Failed to spawn RAG process: ${err.message}`));
      });
    });
  } catch (error: any) {
    console.error(
      `Worker: Error setting up RAG process for query ${queryId}:`,
      error
    );
    throw new Error(`RAG setup error: ${error.message}`);
  }
};
