import { Request, Response } from "express";
import {
  CodeExecutionRequest,
  CodeExecutionResult,
  JobStatus,
} from "../../common/types";
import * as jobService from "../services/jobServices";

const CodeExecutionController = {
  executeCode: async (req: Request, res: Response) => {
    const code = req.body.code;
    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }
    try {
      const job = await jobService.submitJob(code);
      res.json(job);
    } catch (error: any) {
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

    const updated = jobService.updateJobStatus(jobId, status, result || null);
    if (updated) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Job not found" });
    }
  },
  jobStatus: async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = jobService.getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json(job);
  },
};

export default CodeExecutionController;
