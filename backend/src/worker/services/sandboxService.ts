// codeviz-ai/backend/src/worker/services/sandboxService.ts
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os"; // Import the 'os' module for platform detection
import { CONSTANTS } from "../../common/constants";
import { CodeExecutionResult } from "../../common/types";

// Helper function to convert host paths to Docker-compatible paths
// This is crucial for Windows hosts when mounting volumes
const convertHostPathToDockerPath = (hostPath: string): string => {
  if (os.platform() === "win32") {
    // Replace all backslashes with forward slashes
    let dockerPath = hostPath.replace(/\\/g, "/");
    // If the path starts with a drive letter (e.g., C:), convert it to /c/ format
    // Docker Desktop on Windows maps C:\ to /c/, D:\ to /d/, etc.
    if (dockerPath.match(/^[A-Za-z]:\//)) {
      dockerPath = `/${dockerPath
        .charAt(0)
        .toLowerCase()}${dockerPath.substring(2)}`;
    }
    return dockerPath;
  }
  // For Linux/macOS, paths are already compatible, so return as is
  return hostPath;
};

/**
 * Executes Python code in a Docker sandbox.
 * @param {string} jobId - The ID of the job (used for temporary file naming).
 * @param {string} code - The Python code to execute.
 * @returns {Promise<CodeExecutionResult>} A promise that resolves with the execution result (output, error, trace).
 */
export const executeCodeInSandbox = async (
  jobId: string,
  code: string
): Promise<CodeExecutionResult> => {
  // Use os.tmpdir() for a cross-platform temporary directory
  // This will resolve to a system-appropriate temp directory (e.g., /tmp on Linux, C:\Users\...\AppData\Local\Temp on Windows)
  const tempDir = path.join(os.tmpdir(), `codeviz-${jobId}`);
  const userCodePath = path.join(tempDir, "user_code.py");
  const tracerScriptPath = path.join(tempDir, "tracer.py");

  let executionResult: CodeExecutionResult = {
    output: "",
    error: null,
    execution_trace: [],
  };

  try {
    // Create the temporary directory
    await fs.mkdir(tempDir, { recursive: true });
    // Write the user's code to a temporary file
    await fs.writeFile(userCodePath, code);
    // Copy the tracer.py script to the temporary directory
    await fs.writeFile(
      tracerScriptPath,
      await fs.readFile(path.join(__dirname, "../../common/tracer.py"))
    );

    // Convert host paths to Docker-compatible format for volume mounts
    const dockerUserCodePath = convertHostPathToDockerPath(userCodePath);
    const dockerTracerScriptPath =
      convertHostPathToDockerPath(tracerScriptPath);

    const executionContainerName = `sandbox-exec-${jobId}`;
    const dockerArgs = [
      "run",
      "--rm", // Automatically remove container after exit
      "--name",
      executionContainerName,
      "--network",
      "none", // No network access for sandbox
      "--memory",
      "128m", // 128 MB memory limit
      "--cpus",
      "0.5", // 0.5 CPU core limit
      "-v",
      `${dockerUserCodePath}:/mnt/user_code.py`, // Mount user's code using converted path
      "-v",
      `${dockerTracerScriptPath}:/mnt/tracer.py`, // Mount tracer script using converted path
      CONSTANTS.SANDBOX_IMAGE,
      "python3",
      "/mnt/tracer.py", // Command to run tracer inside container
    ];

    console.log(
      `Worker: Executing Docker command for job ${jobId}: docker ${dockerArgs.join(
        " "
      )}`
    );

    const child = spawn("docker", dockerArgs, {
      timeout: CONSTANTS.EXECUTION_TIMEOUT_SECONDS * 1000,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    await new Promise<void>((resolve, reject) => {
      child.on("close", (code: number) => {
        try {
          // Attempt to parse JSON output from the Python tracer script
          executionResult = JSON.parse(stdout) as CodeExecutionResult;
        } catch (e: any) {
          // If parsing fails, it means the Python script likely crashed or printed non-JSON
          executionResult.error = `Failed to parse JSON output from sandbox: ${e.message}. Raw stdout: ${stdout}. Stderr: ${stderr}`;
          executionResult.output = stdout; // Still return whatever output was there
        }

        if (code !== 0) {
          if (!executionResult.error) {
            // If Python script didn't report an error
            executionResult.error = `Sandbox process exited with code ${code}. Stderr: ${stderr}`;
          }
        }
        resolve();
      });
      child.on("error", (err: Error) => {
        // This catches errors like 'docker command not found'
        reject(new Error(`Error spawning docker process: ${err.message}`));
      });
    });

    // Check for timeout explicitly
    if (child.killed && (child as ChildProcess).signalCode === "SIGTERM") {
      executionResult.error = `Code execution timed out after ${CONSTANTS.EXECUTION_TIMEOUT_SECONDS} seconds.`;
    }
  } catch (error: any) {
    console.error(
      `Worker: Error setting up sandbox for job ${jobId}:`,
      error.message
    );
    executionResult.error = `Sandbox setup error: ${error.message}`;
  } finally {
    // Clean up temporary files
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  return executionResult;
};
