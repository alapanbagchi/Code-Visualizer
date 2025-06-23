import { Request, Response } from "express";
import {
  CodeExecutionRequest,
  CodeExecutionResult,
  JobStatus,
} from "../../common/types";
import * as jobService from "../services/jobServices";
import { publishMessage } from "../utils/rabbitmqClient";

const CodeExecutionController = {
  executeCode: async (req: Request, res: Response) => {
    const { code, expectedOutput } = req.body as CodeExecutionRequest; // Destructure expectedOutput
    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    let jobId: string | undefined; // Declare jobId outside try block for wider scope

    try {
      // Pass expectedOutput to jobService.submitJob
      const submissionResult = await jobService.submitJob(code, expectedOutput);
      jobId = submissionResult.jobId; // Assign jobId from submission result
      const status = submissionResult.status;

      // Publish job to RabbitMQ, including expectedOutput
      const published = publishMessage({ jobId, code, expectedOutput });
      if (!published) {
        console.error(`API: Failed to publish job ${jobId} to RabbitMQ.`);
        await jobService.updateJobStatus(
          jobId,
          "error",
          null,
          "Failed to queue job for execution.",
          null,
          "failed", // passFailStatus
          null // executionTime
        );
        return res
          .status(500)
          .json({ error: "Failed to queue job for execution." });
      }

      console.log(`API: Job ${jobId} published to RabbitMQ.`);
      res.status(200).json({ jobId, status });
    } catch (error: any) {
      console.error(`API: Error submitting code:`, error);
      // Only attempt to update job status if jobId was successfully assigned
      if (jobId) {
        await jobService.updateJobStatus(
          jobId,
          "error",
          null,
          `Failed to submit job: ${error.message}`,
          null,
          "failed", // passFailStatus
          null // executionTime
        );
      }
      res
        .status(500)
        .json({ error: "Failed to submit job", details: error.message });
    }
  },
  jobUpdate: async (req: Request, res: Response) => {
    const { jobId, status, result } = req.body as {
      jobId: string;
      status: JobStatus;
      result?: CodeExecutionResult;
    };
    if (!jobId || !status) {
      return res.status(400).json({ error: "jobId and status are required" });
    }

    try {
      const updated = await jobService.updateJobStatus(jobId, status);
      if (updated) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Job not found" });
      }
    } catch (error: any) {
      console.error("Error updating job status via API:", error);
      res
        .status(500)
        .json({ error: "Failed to update job status", details: error.message });
    }
  },
  jobStatus: async (req: Request, res: Response) => {
    const { jobId } = req.params;
    try {
      const job = await jobService.getJobStatus(jobId);

      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      res.json(job);
    } catch (error: any) {
      console.error("Error getting job status via API:", error);
      res.status(500).json({
        error: "Failed to retrieve job status",
        details: error.message,
      });
    }
  },
};

export default CodeExecutionController;
