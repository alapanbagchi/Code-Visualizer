// codeviz-ai/backend/src/common/types.ts

// Represents the incoming request body for code execution
export interface CodeExecutionRequest {
  code: string;
  expectedOutput?: string; // NEW: Optional expected output for comparison
}

// Represents the job payload sent via RabbitMQ
export interface JobPayload {
  jobId: string;
  code: string;
  expectedOutput?: string;
}

export type JobStatus = "queued" | "running" | "completed" | "error";

export type PassFailStatus = "passed" | "failed" | "not_applicable";

export interface TraceEntry {
  event: "line" | "call" | "return" | "exception" | "variable_change";
  line_no: number;
  filename: string;
  function_name?: string;
  variables?: { [key: string]: any };
  variable_name?: string;
  value?: any;
  old_value?: any;
  frame_id?: string;
  timestamp?: number;
}

export interface CodeExecutionResult {
  output: string;
  error: string | null;
  execution_trace: TraceEntry[];
  passFailStatus?: PassFailStatus;
  execution_time?: number;
}

export interface Job {
  jobId: string;
  code: string;
  status: JobStatus;
  expectedOutput: string | null;
  passFailStatus: PassFailStatus;
  output: string | null;
  error: string | null;
  executionTrace: TraceEntry[] | null;
  executionTime: number | null;
}

export interface Request extends Express.Request {
  body: {
    code?: string;
    jobId?: string;
    status?: JobStatus;
    result?: CodeExecutionResult;
    expectedOutput?: string;
    passFailStatus?: PassFailStatus;
  };
  params: {
    jobId?: string;
  };
}

export interface Response extends Express.Response {
  json: (body?: any) => Response;
  status: (code: number) => Response;
  send: (body?: any) => Response;
  locals?: { [key: string]: string };
}
