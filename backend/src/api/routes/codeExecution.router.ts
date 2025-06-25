import { Router, Request, Response } from "express";
import CodeExecutionController from "../controller/codeExecution.controller";

const router = Router();

router.post("/execute-code", async (req: Request, res: Response) => {
  console.log("API: Received code execution request");
  CodeExecutionController.executeCode(req, res);
});

router.post("/job-update", (req: Request, res: Response) => {
  console.log("API: Received job update request");
  CodeExecutionController.jobUpdate(req, res);
});

router.get("/status/:jobId", (req: Request, res: Response) => {
  CodeExecutionController.jobStatus(req, res);
});

export default router;
