// codeviz-ai/backend/src/worker/services/sandboxService.ts
import { ChildProcess, spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { CONSTANTS } from "../../common/constants";
import { CodeExecutionResult, TraceEntry } from "../../common/types";
import os from "os"; // Import os module

// Helper to get platform-specific temp directory
const getTempDir = () => {
  // On Windows, use a path that Docker Desktop can easily map
  // For Linux/macOS, os.tmpdir() is fine
  return process.platform === "win32" ? "C:\\temp" : os.tmpdir();
};

// Function to execute code in the sandbox
export const executeCodeInSandbox = async (
  jobId: string,
  code: string
): Promise<CodeExecutionResult> => {
  const tempDir = path.join(getTempDir(), `codeviz-${jobId}`);
  const userCodePath = path.join(tempDir, "user_code.py");
  const tracerPath = path.join(tempDir, "tracer.py"); // Path to copy tracer.py to
  const sandboxTracerPath = "/mnt/tracer.py"; // Path inside the Docker container
  const sandboxUserCodePath = "/mnt/user_code.py"; // Path inside the Docker container

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
      "-v",
      `${userCodePath}:/mnt/user_code.py`, // Mount user code
      "-v",
      `${tracerPath}:/mnt/tracer.py`, // Mount tracer.py
      "-e",
      "PYTHONUNBUFFERED=1", // Ensure Python output is unbuffered
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
        // Use docker kill to stop the container
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

// NEW: Function to process embeddings
export const processEmbeddings = async (
  jobId: string,
  code: string,
  executionTrace: TraceEntry[]
): Promise<{ status: string; message: string }> => {
  const tempDir = path.join(getTempDir(), `codeviz-embed-${jobId}`);
  const embeddingProcessorPath = path.join(tempDir, "embedding_processor.py");
  const sandboxEmbeddingProcessorPath = "/mnt/embedding_processor.py";

  try {
    await fs.mkdir(tempDir, { recursive: true });
    // Copy embedding_processor.py from dist to the temp directory
    await fs.copyFile(
      path.join(__dirname, "../../common/embedding_processor.py"), // Source in dist
      embeddingProcessorPath
    );

    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      `codeviz-embed-${jobId}`,
      // Network mode: crucial for ChromaDB access
      // If ChromaDB is on host, use 'host.docker.internal' and bridge network
      // If ChromaDB is in another Docker container, use a shared Docker network
      // For simplicity, we'll use 'host' network if running on Linux, or rely on host.docker.internal
      // for Windows/Mac Docker Desktop.
      // The Python script itself uses CHROMA_HOST env var.
      "--network",
      "bridge", // Use bridge network to allow reaching host.docker.internal
      "-v",
      `${embeddingProcessorPath}:/mnt/embedding_processor.py`,
      "-e",
      `CHROMA_HOST=${CONSTANTS.CHROMA_HOST}`, // Pass ChromaDB host
      "-e",
      `CHROMA_PORT=${CONSTANTS.CHROMA_PORT}`, // Pass ChromaDB port
      CONSTANTS.SANDBOX_IMAGE,
      "python3",
      sandboxEmbeddingProcessorPath,
      "process", // Mode for the script
      jobId,
      code,
      JSON.stringify(executionTrace), // Pass trace as JSON string
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
                `Worker: Embedding processing reported non-success for job ${jobId}: ${result.message}. Stderr: ${stderr}`
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
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};
