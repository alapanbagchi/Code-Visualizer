// codeviz-ai/backend/src/api/services/jobService.ts
import { v4 as uuidv4 } from "uuid";
import * as jobStore from "../../common/jobStore";
import * as rabbitmqClient from "../utils/rabbitmqClient";
import { CodeExecutionResult, JobStatus } from "../../common/types";

export const submitJob = async (
  code: string
): Promise<{ jobId: string; status: JobStatus }> => {
  const jobId = uuidv4();
  jobStore.setJob(jobId, "queued"); // Set initial status

  const jobPayload = { jobId, code };

  try {
    const published = rabbitmqClient.publishMessage(jobPayload);
    if (!published) {
      throw new Error("Failed to publish message to RabbitMQ.");
    }
    console.log(`API: Job ${jobId} published to RabbitMQ.`);
    return { jobId, status: "queued" };
  } catch (error: any) {
    console.error(`API: Failed to submit job ${jobId}:`, error.message);
    jobStore.setJob(jobId, "error", {
      error: "Failed to queue job",
      output: "",
      execution_trace: [],
    }); // Ensure result matches CodeExecutionResult
    throw error; // Re-throw to be caught by route handler
  }
};

export const updateJobStatus = (
  jobId: string,
  status: JobStatus,
  result: CodeExecutionResult | null = null
): boolean => {
  if (!jobStore.hasJob(jobId)) {
    console.warn(`API: Attempted to update non-existent job: ${jobId}`);
    return false;
  }
  jobStore.setJob(jobId, status, result);
  console.log(`API: Job ${jobId} updated to status: ${status}`);
  return true;
};

/**
 * Retrieves a job's status and result.
 * @param {string} jobId - The ID of the job.
 * @returns {Job | undefined} The job object or undefined if not found.
 */
export const getJobStatus = (jobId: string) => jobStore.getJob(jobId);
