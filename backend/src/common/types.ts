// codeviz-ai/backend/src/common/types.ts

// Represents the incoming request body for code execution
export interface CodeExecutionRequest {
  code: string;
}

// Represents the job payload sent via RabbitMQ
export interface JobPayload {
  jobId: string;
  code: string;
}

// Represents the status of a job
export type JobStatus = "queued" | "running" | "completed" | "error";

// Represents a single entry in the execution trace
export interface TraceEntry {
  event: "line" | "call" | "return" | "exception";
  line_no: number;
  filename: string;
  function_name?: string;
  variables?: { [key: string]: any }; // State of variables at this point
  exception_type?: string;
  exception_value?: string;
}

// Represents the result of a code execution from the sandbox
export interface CodeExecutionResult {
  output: string;
  error: string | null;
  execution_trace: TraceEntry[];
}

// Represents the structure of a job stored in the database (mapped from DB fields)
export interface Job {
  jobId: string; // Maps to job_id in DB
  status: JobStatus;
  result: CodeExecutionResult | null;
}
