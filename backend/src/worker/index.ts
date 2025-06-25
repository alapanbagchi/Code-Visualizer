// codeviz-ai/backend/src/worker/index.ts
import "dotenv/config";
import { connectAndConsume } from "./utils/rabbitmqClient";
import {
  executeCodeInSandbox,
  processEmbeddings,
} from "./services/sandboxService"; // NEW: Import processEmbeddings
import {
  JobPayload,
  JobStatus,
  CodeExecutionResult,
  PassFailStatus,
  TraceEntry, // NEW: Import TraceEntry for type hinting
} from "../common/types";
import axios from "axios";

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const API_SERVER_URL = process.env.API_SERVER_URL || "http://localhost:8081";

// MODIFIED: Added embeddingsGenerated parameter
const updateJobStatusOnApi = async (
  jobId: string,
  status?: JobStatus, // Made optional as we might only update embeddingsGenerated
  output: string | null = null,
  error: string | null = null,
  executionTrace: TraceEntry[] | null = null, // NEW: Added executionTrace
  passFailStatus: PassFailStatus | null = null,
  executionTime: number | null = null,
  embeddingsGenerated?: boolean // NEW: Added embeddingsGenerated
) => {
  try {
    // MODIFIED: Construct updateData dynamically
    const updateData: { [key: string]: any } = { jobId };

    if (status !== undefined) updateData.status = status;
    if (output !== undefined) updateData.output = output;
    if (error !== undefined) updateData.error = error;
    if (executionTrace !== undefined)
      updateData.executionTrace = executionTrace; // NEW
    if (passFailStatus !== undefined)
      updateData.passFailStatus = passFailStatus;
    if (executionTime !== undefined) updateData.executionTime = executionTime;
    if (embeddingsGenerated !== undefined)
      updateData.embeddingsGenerated = embeddingsGenerated; // NEW

    await axios.post(`${API_SERVER_URL}/code/job-update`, {
      jobId,
      status,
      result: {
        output,
        error,
        execution_trace: executionTrace, // NEW
        passFailStatus,
        execution_time: executionTime,
        embeddingsGenerated, // NEW
      },
    });
    console.log(
      `Worker: Successfully updated status for job ${jobId} to ${
        status || "partial update"
      }`
    );
  } catch (error: any) {
    console.error(
      `Worker: Failed to update status for job ${jobId} on API server:`,
      error.message
    );
  }
};

const compareOutputs = (
  actualOutput: string,
  expectedOutput: string
): PassFailStatus => {
  const normalizedActual = actualOutput.trim().replace(/\r\n/g, "\n");
  const normalizedExpected = expectedOutput.trim().replace(/\r\n/g, "\n");
  if (normalizedActual === normalizedExpected) {
    return "passed";
  } else {
    return "failed";
  }
};

const handleJobMessage = async (msgContent: string) => {
  let jobPayload: JobPayload = {
    jobId: "",
    code: "",
    expectedOutput: "",
  };
  let executionResult: CodeExecutionResult = {
    // Renamed 'result' to 'executionResult' for clarity
    output: "",
    error: null,
    execution_trace: [],
    execution_time: 0,
  };
  let passFailStatus: PassFailStatus = "not_applicable";
  let executionTime: number | null = null;

  try {
    jobPayload = JSON.parse(msgContent);
    const { jobId, code, expectedOutput } = jobPayload;

    console.log(`Worker: Received job ${jobId}`);

    // 1. Update job status to 'running'
    // MODIFIED: No result object passed for 'running' status
    await updateJobStatusOnApi(
      jobId,
      "running",
      null,
      null,
      null,
      "not_applicable",
      null
    );

    // 2. Execute code in sandbox
    try {
      executionResult = await executeCodeInSandbox(jobId, code); // Use executionResult
      console.log("SANDBOX RESULT: ", executionResult); // Log executionResult

      // 3. Extract execution time from sandbox result
      executionTime = executionResult.execution_time || null;

      // 4. Determine Pass/Fail Status
      if (executionResult.error) {
        passFailStatus = "failed";
      } else if (expectedOutput !== undefined && expectedOutput !== null) {
        passFailStatus = compareOutputs(executionResult.output, expectedOutput);
      } else {
        passFailStatus = "not_applicable";
      }

      // 5. Update job status to 'completed' with result, pass/fail status, and execution time
      // MODIFIED: Pass individual fields from executionResult
      await updateJobStatusOnApi(
        jobId,
        executionResult.error ? "error" : "completed",
        executionResult.output,
        executionResult.error,
        executionResult.execution_trace, // NEW: Pass execution_trace
        passFailStatus,
        executionResult.execution_time
      );
      console.log(
        `Worker: Job ${jobId} results updated. Status: ${
          executionResult.error ? "error" : "completed"
        }, Pass/Fail: ${passFailStatus}`
      );

      // NEW: 6. Process Embeddings if execution was successful
      if (!executionResult.error) {
        try {
          console.log(
            `Worker: Starting embedding processing for job ${jobId}...`
          );
          const embedResult = await processEmbeddings(
            jobId,
            code,
            executionResult.execution_trace
          );
          if (embedResult.status === "success") {
            // Update DB to mark embeddings as generated
            // MODIFIED: Call updateJobStatusOnApi with only embeddingsGenerated flag
            await updateJobStatusOnApi(
              jobId,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              true
            );
            console.log(
              `Worker: Embeddings successfully generated and marked for job ${jobId}.`
            );
          } else {
            console.warn(
              `Worker: Embedding processing reported non-success for job ${jobId}: ${embedResult.message}`
            );
          }
        } catch (embedError: any) {
          console.error(
            `Worker: Failed to process embeddings for job ${jobId}:`,
            embedError.message
          );
          // Log the error but don't fail the main job processing
          // Optionally, update job status to indicate embedding failure
        }
      }
    } catch (sandboxError: any) {
      console.error(
        `Worker: Sandbox execution failed for job ${jobId}:`,
        sandboxError.message
      );
      // MODIFIED: Create a new executionResult for error case
      executionResult = {
        output: "",
        error: `Sandbox execution failed: ${sandboxError.message}`,
        execution_trace: [],
        execution_time: 0, // Default for error
      };
      // MODIFIED: Pass individual fields for error status
      await updateJobStatusOnApi(
        jobId,
        "error",
        executionResult.output,
        executionResult.error,
        executionResult.execution_trace,
        "failed",
        executionResult.execution_time
      );
    }
  } catch (error: any) {
    console.error(`Worker: Error processing job:`, error.message);
    if (jobPayload && jobPayload.jobId) {
      // MODIFIED: Pass individual fields for general error
      await updateJobStatusOnApi(
        jobPayload.jobId,
        "error",
        "", // output
        `Worker error: ${error.message}`, // error
        [], // execution_trace
        "failed", // passFailStatus
        0 // execution_time
      );
    }
  }
};

const startWorker = async () => {
  try {
    await connectAndConsume(RABBITMQ_URL, handleJobMessage);
    console.log("Worker process started and listening for jobs.");
  } catch (error: any) {
    console.error("Worker: Failed to start:", error.message);
    process.exit(1);
  }
};

startWorker();
