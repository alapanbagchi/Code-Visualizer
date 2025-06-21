import "dotenv/config";
import * as rabbitmqClient from "./utils/rabbitmqClient";
import * as sandboxService from "./services/sandboxService";
import axios from "axios";
import { JobPayload, CodeExecutionResult, JobStatus } from "../common/types";

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const API_SERVER_URL = process.env.API_SERVER_URL || "http://localhost:8000";

const updateJobStatusOnApi = async (
  jobId: string,
  status: JobStatus,
  result: CodeExecutionResult | null = null
): Promise<void> => {
  try {
    await axios.post(`${API_SERVER_URL}/code/job-update`, {
      jobId,
      status,
      result,
    });
  } catch (error: any) {
    console.error(
      `Worker: Failed to update status for job ${jobId} on API server:`,
      error
    );
  }
};

/**
 * Handles a single job message from RabbitMQ.
 * @param {string} msgContent - The content of the RabbitMQ message (JSON string).
 */
const handleJobMessage = async (msgContent: string): Promise<void> => {
  const { jobId, code }: JobPayload = JSON.parse(msgContent);
  console.log(`Worker: Received job ${jobId}`);

  await updateJobStatusOnApi(jobId, "running");

  let result: CodeExecutionResult;
  try {
    result = await sandboxService.executeCodeInSandbox(jobId, code);
    await updateJobStatusOnApi(jobId, "completed", result);
  } catch (error: any) {
    console.error(`Worker: Error processing job ${jobId}:`, error.message);
    result = {
      output: "",
      error: `Worker error: ${error.message}`,
      execution_trace: [],
    };
    await updateJobStatusOnApi(jobId, "error", result);
  }
};

// --- Worker Start ---
const startWorker = async () => {
  try {
    await rabbitmqClient.connectAndConsume(RABBITMQ_URL, handleJobMessage);
    console.log(
      `Worker process ${process.pid} started and listening for jobs.`
    );
  } catch (error: any) {
    console.error("Failed to start worker:", error.message);
    process.exit(1); // Exit if RabbitMQ connection fails on startup
  }
};

startWorker();
