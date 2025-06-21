import { CodeExecutionResult } from "./types";

const jobStore = new Map();

const setJob = (
  jobId: string,
  status: string,
  result?: CodeExecutionResult | null
): object => {
  const currentJob = jobStore.get(jobId) || {};
  const updatedJob = { ...currentJob, status, result };
  jobStore.set(jobId, updatedJob);
  return updatedJob;
};

const getJob = (jobId: string): object => {
  return jobStore.get(jobId) || {};
};

const hasJob = (jobId: string): boolean => jobStore.has(jobId);

export { setJob, getJob, hasJob };
