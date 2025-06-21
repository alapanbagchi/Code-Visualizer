"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeCodeInSandbox = void 0;
// codeviz-ai/backend/src/worker/services/sandboxService.ts
const child_process_1 = require("child_process");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os")); // Import the 'os' module for platform detection
const constants_1 = require("../../common/constants");
// Helper function to convert host paths to Docker-compatible paths
// This is crucial for Windows hosts when mounting volumes
const convertHostPathToDockerPath = (hostPath) => {
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
const executeCodeInSandbox = async (jobId, code) => {
    // Use os.tmpdir() for a cross-platform temporary directory
    // This will resolve to a system-appropriate temp directory (e.g., /tmp on Linux, C:\Users\...\AppData\Local\Temp on Windows)
    const tempDir = path.join(os.tmpdir(), `codeviz-${jobId}`);
    const userCodePath = path.join(tempDir, "user_code.py");
    const tracerScriptPath = path.join(tempDir, "tracer.py");
    let executionResult = {
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
        await fs.writeFile(tracerScriptPath, await fs.readFile(path.join(__dirname, "../../common/tracer.py")));
        // Convert host paths to Docker-compatible format for volume mounts
        const dockerUserCodePath = convertHostPathToDockerPath(userCodePath);
        const dockerTracerScriptPath = convertHostPathToDockerPath(tracerScriptPath);
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
            constants_1.CONSTANTS.SANDBOX_IMAGE,
            "python3",
            "/mnt/tracer.py", // Command to run tracer inside container
        ];
        console.log(`Worker: Executing Docker command for job ${jobId}: docker ${dockerArgs.join(" ")}`);
        const child = (0, child_process_1.spawn)("docker", dockerArgs, {
            timeout: constants_1.CONSTANTS.EXECUTION_TIMEOUT_SECONDS * 1000,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        await new Promise((resolve, reject) => {
            child.on("close", (code) => {
                try {
                    // Attempt to parse JSON output from the Python tracer script
                    executionResult = JSON.parse(stdout);
                }
                catch (e) {
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
            child.on("error", (err) => {
                // This catches errors like 'docker command not found'
                reject(new Error(`Error spawning docker process: ${err.message}`));
            });
        });
        // Check for timeout explicitly
        if (child.killed && child.signalCode === "SIGTERM") {
            executionResult.error = `Code execution timed out after ${constants_1.CONSTANTS.EXECUTION_TIMEOUT_SECONDS} seconds.`;
        }
    }
    catch (error) {
        console.error(`Worker: Error setting up sandbox for job ${jobId}:`, error.message);
        executionResult.error = `Sandbox setup error: ${error.message}`;
    }
    finally {
        // Clean up temporary files
        await fs.rm(tempDir, { recursive: true, force: true });
    }
    return executionResult;
};
exports.executeCodeInSandbox = executeCodeInSandbox;
//# sourceMappingURL=sandboxService.js.map