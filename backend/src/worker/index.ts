// codeviz-ai/backend/src/worker/index.ts
import "dotenv/config";
import { connectAndConsume } from "./utils/rabbitmqClient";
import { executeCodeInSandbox } from "./services/sandboxService";
import {
  JobPayload,
  JobStatus,
  CodeExecutionResult,
  PassFailStatus,
} from "../common/types";
import axios from "axios";

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const API_SERVER_URL = process.env.API_SERVER_URL || "http://localhost:8081";

const updateJobStatusOnApi = async (
  jobId: string,
  status: JobStatus,
  result: CodeExecutionResult | null = null,
  passFailStatus: PassFailStatus | null = null,
  executionTime: number | null = null
) => {
  try {
    await axios.post(`${API_SERVER_URL}/job-update`, {
      jobId,
      status,
      result,
      passFailStatus,
      executionTime,
    });
    console.log(
      `Worker: Successfully updated status for job ${jobId} to ${status}`
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
  let result: CodeExecutionResult;
  let passFailStatus: PassFailStatus = "not_applicable";
  let executionTime: number | null = null;

  try {
    jobPayload = JSON.parse(msgContent);
    const { jobId, code, expectedOutput } = jobPayload;

    console.log(`Worker: Received job ${jobId}`);

    // 1. Update job status to 'running'
    await updateJobStatusOnApi(jobId, "running");

    // 2. Execute code in sandbox
    try {
      result = await executeCodeInSandbox(jobId, code);

      // 3. Extract execution time from sandbox result
      executionTime = result.executionTime || null; // NEW: Get execution time

      // 4. Compare outputs if expectedOutput is provided
      if (expectedOutput !== undefined && expectedOutput !== null) {
        passFailStatus = compareOutputs(result.output, expectedOutput);
        result.passFailStatus = passFailStatus;
      } else {
        result.passFailStatus = "not_applicable";
      }

      // 5. Update job status to 'completed' with result, pass/fail status, and execution time
      await updateJobStatusOnApi(
        jobId,
        "completed",
        result,
        passFailStatus,
        executionTime
      ); // NEW: Pass executionTime
    } catch (sandboxError: any) {
      console.error(
        `Worker: Sandbox execution failed for job ${jobId}:`,
        sandboxError.message
      );
      result = {
        output: "",
        error: `Sandbox execution failed: ${sandboxError.message}`,
        execution_trace: [],
        passFailStatus: "failed",
        executionTime: 0,
      };
      await updateJobStatusOnApi(jobId, "error", result, "failed", null);
    }
  } catch (error: any) {
    console.error(`Worker: Error processing job:`, error.message);
    if (jobPayload && jobPayload.jobId) {
      await updateJobStatusOnApi(
        jobPayload.jobId,
        "error",
        {
          output: "",
          error: `Worker error: ${error.message}`,
          execution_trace: [],
          passFailStatus: "failed",
        },
        "failed",
        null
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
