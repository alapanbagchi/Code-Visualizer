// codeviz-ai/backend/src/worker/services/sandboxService.ts
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { CONSTANTS } from "../../common/constants";
import { CodeExecutionResult, TraceEntry } from "../../common/types";

// Helper to get OS-specific temp directory
const getTempDir = () => {
  // On Windows, use a path that Docker Desktop can easily mount
  // On Linux/macOS, use standard /tmp
  return process.platform === "win32" ? "C:\\temp" : "/tmp";
};

// Helper to normalize paths for Docker mounts on Windows
const normalizePathForDocker = (p: string) => {
  if (process.platform === "win32") {
    // Convert C:\temp\path to /c/temp/path for Docker Desktop's WSL2 backend
    // Or ensure it's a path Docker can understand (e.g., if using bind mounts directly)
    // For simplicity, assuming Docker Desktop's default behavior with C: drive mounts
    return p
      .replace(/\\/g, "/")
      .replace(/^([A-Z]):/, (match, drive) => `/${drive.toLowerCase()}`);
  }
  return p;
};

export const executeCodeInSandbox = async (
  jobId: string,
  code: string
): Promise<CodeExecutionResult> => {
  const tempDir = path.join(getTempDir(), `codeviz-${jobId}`);
  const userCodePath = path.join(tempDir, "user_code.py");
  const tracerPath = path.join(__dirname, "../../common/tracer.py"); // Path to the tracer.py in dist

  let executionResult: CodeExecutionResult = {
    output: "",
    error: null,
    execution_trace: [],
    execution_time: 0,
  };

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(userCodePath, code);
    // Ensure tracer.py is copied to the temp directory for consistent mounting
    await fs.copyFile(tracerPath, path.join(tempDir, "tracer.py"));

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
      `${normalizePathForDocker(userCodePath)}:/mnt/user_code.py`, // Mount user code
      "-v",
      `${normalizePathForDocker(
        path.join(tempDir, "tracer.py")
      )}:/mnt/tracer.py`, // Mount tracer
      "-e",
      "PYTHONUNBUFFERED=1", // NEW: Ensure Python output is unbuffered
      CONSTANTS.SANDBOX_IMAGE,
      "python3",
      "/mnt/tracer.py",
    ];

    console.log(
      `Worker: Executing Docker command for job ${jobId}: docker ${dockerArgs.join(
        " "
      )}`
    );

    const child = spawn("docker", dockerArgs, {
      timeout: CONSTANTS.EXECUTION_TIMEOUT_SECONDS * 1000,
    });

    let stdoutData = "";
    let stderrData = "";

    child.stdout.on("data", (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderrData += data.toString();
    });

    await new Promise<void>((resolve, reject) => {
      child.on("close", (code) => {
        if (code !== 0) {
          // Non-zero exit code indicates an error in the Docker command itself or sandbox
          reject(
            new Error(
              `Sandbox process exited with code ${code}. Stderr: ${stderrData}`
            )
          );
        } else {
          resolve();
        }
      });

      child.on("error", (err) => {
        // This catches errors like 'docker' command not found
        reject(new Error(`Failed to spawn docker process: ${err.message}`));
      });

      child.on("timeout", () => {
        child.kill("SIGTERM"); // Terminate the process
        reject(
          new Error(
            `Code execution timed out after ${CONSTANTS.EXECUTION_TIMEOUT_SECONDS} seconds.`
          )
        );
      });
    });
    // Attempt to parse the JSON output from the sandbox
    try {
      const parsedOutput = JSON.parse(stdoutData);
      executionResult.output = parsedOutput.output;
      executionResult.error = parsedOutput.error;
      executionResult.execution_trace = parsedOutput.execution_trace || [];
      executionResult.execution_time = parsedOutput.execution_time || null;
    } catch (jsonError: any) {
      executionResult.error = `Failed to parse JSON output from sandbox: ${jsonError.message}. Raw stdout: ${stdoutData}. Stderr: ${stderrData}`;
      executionResult.output = stdoutData; // Keep raw stdout if JSON parsing fails
    }
  } catch (error: any) {
    console.error(
      `Worker: Error setting up sandbox for job ${jobId}:`,
      error.message
    );
    executionResult.error = `Sandbox setup error: ${error.message}`;
  } finally {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  return executionResult;
};
