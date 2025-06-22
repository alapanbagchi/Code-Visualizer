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
    const { code } = req.body as CodeExecutionRequest;
    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    try {
      const { jobId, status } = await jobService.submitJob(code);

      // Publish job to RabbitMQ
      const published = publishMessage({ jobId, code });
      if (!published) {
        console.error(`API: Failed to publish job ${jobId} to RabbitMQ.`);
        await jobService.updateJobStatus(jobId, "error", {
          output: "",
          error: "Failed to queue job",
          execution_trace: [],
        });
        return res
          .status(500)
          .json({ error: "Failed to queue job for execution." });
      }

      console.log(`API: Job ${jobId} published to RabbitMQ.`);
      res.json({ jobId, status });
    } catch (error: any) {
      console.error(`API: Error submitting code:`, error);
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
      const updated = await jobService.updateJobStatus(
        jobId,
        status,
        result || null
      );
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
