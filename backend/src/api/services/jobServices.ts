// codeviz-ai/backend/src/api/services/jobService.ts
import { v4 as uuidv4 } from "uuid";
import db from "../../common/db"; // Import the PostgreSQL connection pool
import {
  CodeExecutionResult,
  JobStatus,
  Job,
  TraceEntry,
  PassFailStatus,
} from "../../common/types";

export const submitJob = async (
  code: string,
  expectedOutput?: string // NEW: Accept optional expectedOutput
): Promise<{ jobId: string; status: JobStatus }> => {
  const jobId = uuidv4(); // Generate UUID here for immediate return
  const initialStatus: JobStatus = "queued";
  const initialPassFailStatus: PassFailStatus = "not_applicable"; // NEW: Initialize pass/fail status

  try {
    const query = `
            INSERT INTO jobs (job_id, code, status, expected_output, pass_fail_status)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING job_id, status;
        `;
    const values = [
      jobId,
      code,
      initialStatus,
      expectedOutput || null, // NEW: Insert expectedOutput (or null if not provided)
      initialPassFailStatus, // NEW: Insert initial pass/fail status
    ];
    const res = await db.query(query, values);

    console.log(`API: Job ${jobId} created in DB.`);
    return { jobId: res.rows[0].job_id, status: res.rows[0].status };
  } catch (error: any) {
    console.error(`API: Failed to submit job ${jobId}:`, error.message);
    // Attempt to update job status to error if initial insert failed or subsequent steps
    try {
      // Note: This update might fail if the initial insert didn't complete
      await db.query(
        `UPDATE jobs SET status = $1, error = $2, pass_fail_status = $3 WHERE job_id = $4;`, // NEW: Update pass_fail_status
        ["error", `Failed to queue job: ${error.message}`, "failed", jobId] // NEW: Set pass_fail_status to 'failed'
      );
    } catch (updateError: any) {
      console.error(
        `API: Failed to update job ${jobId} status to error after initial failure:`,
        updateError.message
      );
    }
    throw error; // Re-throw to be caught by route handler
  }
};
export const updateJobStatus = async (
  jobId: string,
  status: JobStatus,
  output: string | null = null,
  error: string | null = null,
  executionTrace: TraceEntry[] | null = null,
  passFailStatus: PassFailStatus | null = null,
  executionTime: number | null = null
): Promise<boolean> => {
  console.log(
    jobId,
    status,
    output,
    error,
    executionTrace,
    passFailStatus,
    executionTime
  );
  try {
    const query = `
            UPDATE jobs
            SET status = $1,
                output = $2,
                error = $3,
                execution_trace = $4,
                pass_fail_status = $5,
                execution_time = $6
            WHERE job_id = $7
            RETURNING job_id;
        `;
    const values = [
      status,
      output,
      error,
      executionTrace ? JSON.stringify(executionTrace) : null,
      passFailStatus || "not_applicable",
      executionTime,
      jobId,
    ];
    const result = await db.query(query, values);
    if (result.rowCount === 0) {
      console.warn(`API: Job ${jobId} not found for update.`);
      return false;
    }
    return true;
  } catch (dbError: any) {
    console.error(`API: Failed to update job ${jobId} in DB:`, dbError.message);
    return false;
  }
};

export const getJobStatus = async (jobId: string): Promise<Job | null> => {
  try {
    const query = `
            SELECT job_id, code, status, output, error, execution_trace, expected_output, pass_fail_status, execution_time
            FROM jobs
            WHERE job_id = $1;
        `;
    const values = [jobId];
    const res = await db.query(query, values);

    if (res.rowCount === 0) {
      return null;
    }

    const dbJob = res.rows[0];

    // Ensure execution_trace is parsed if it's stored as JSONB and comes as string/object
    const parsedExecutionTrace: TraceEntry[] | null = dbJob.execution_trace
      ? typeof dbJob.execution_trace === "string"
        ? JSON.parse(dbJob.execution_trace)
        : dbJob.execution_trace
      : null;

    const resultObject: CodeExecutionResult | null =
      dbJob.status === "completed" || dbJob.status === "error"
        ? {
            output: dbJob.output || "",
            error: dbJob.error || null,
            execution_trace: parsedExecutionTrace || [],
            passFailStatus: dbJob.pass_fail_status as PassFailStatus,
            execution_time: dbJob.execution_time || null,
          }
        : null;

    return {
      jobId: dbJob.job_id,
      code: dbJob.code,
      status: dbJob.status as JobStatus,
      expectedOutput: dbJob.expected_output || null,
      passFailStatus: dbJob.pass_fail_status as PassFailStatus,
      output: dbJob.output || null,
      error: dbJob.error || null,
      executionTrace: parsedExecutionTrace,
      executionTime: dbJob.execution_time || null,
    };
  } catch (error: any) {
    console.error(
      `API: Failed to retrieve job ${jobId} from DB:`,
      error.message
    );
    throw error;
  }
};
