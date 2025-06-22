export interface CodeExecutionRequest {
  code: string;
}

export interface JobPayload {
  jobId: string;
  code: string;
}

export type JobStatus = "queued" | "running" | "completed" | "error";

export interface TraceEntry {
  event: string;
  line_no: number;
  filename: string;
  function_name?: string;
  return_value?: string;
  globals?: { [key: string]: string };
  locals?: { [key: string]: string };
}

export interface CodeExecutionResult {
  output: string;
  error: string | null;
  execution_trace: TraceEntry[];
}

export interface Job {
  jobId: string;
  status: JobStatus;
  result: CodeExecutionResult | null;
}
