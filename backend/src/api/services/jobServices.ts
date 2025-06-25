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
  status: JobStatus | undefined, // Make optional
  output: string | null = null,
  error: string | null = null,
  executionTrace: TraceEntry[] | null = null,
  passFailStatus: PassFailStatus | null = null,
  executionTime: number | null = null,
  embeddingsGenerated: boolean | undefined = undefined // NEW: Add embeddingsGenerated
): Promise<boolean> => {
  try {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (output !== undefined) {
      setClauses.push(`output = $${paramIndex++}`);
      values.push(output);
    }
    if (error !== undefined) {
      setClauses.push(`error = $${paramIndex++}`);
      values.push(error);
    }
    if (executionTrace !== undefined) {
      setClauses.push(`execution_trace = $${paramIndex++}`);
      values.push(executionTrace ? JSON.stringify(executionTrace) : null);
    }
    if (passFailStatus !== undefined) {
      setClauses.push(`pass_fail_status = $${paramIndex++}`);
      values.push(passFailStatus);
    }
    if (executionTime !== undefined) {
      setClauses.push(`execution_time = $${paramIndex++}`);
      values.push(executionTime);
    }
    if (embeddingsGenerated !== undefined) {
      // NEW: Handle embeddingsGenerated
      setClauses.push(`embeddings_generated = $${paramIndex++}`);
      values.push(embeddingsGenerated);
    }

    setClauses.push(`updated_at = NOW()`); // Always update timestamp

    if (setClauses.length === 0) {
      console.warn(`API: No fields to update for job ${jobId}.`);
      return false;
    }

    const query = `
        UPDATE jobs
        SET ${setClauses.join(", ")}
        WHERE job_id = $${paramIndex++}
        RETURNING job_id;
    `;
    values.push(jobId);

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
        SELECT job_id, code, status, output, error, execution_trace, expected_output, pass_fail_status, execution_time, embeddings_generated
        FROM jobs
        WHERE job_id = $1;
    `;
    const values = [jobId];
    const res = await db.query(query, values);

    if (res.rowCount === 0) {
      return null;
    }

    const dbJob = res.rows[0];

    // Safely parse JSON fields
    let executionTrace: TraceEntry[] = [];
    if (dbJob.execution_trace) {
      try {
        executionTrace = JSON.parse(dbJob.execution_trace);
      } catch (e) {
        console.error(`Error parsing execution_trace for job ${jobId}:`, e);
        executionTrace = [];
      }
    }

    const result: CodeExecutionResult | null =
      dbJob.output || dbJob.error || executionTrace.length > 0
        ? {
            output: dbJob.output || "",
            error: dbJob.error || null,
            execution_trace: executionTrace,
            execution_time: dbJob.execution_time || 0, // Ensure it's a number
          }
        : null;

    return {
      jobId: dbJob.job_id,
      code: dbJob.code, // Include code
      status: dbJob.status as JobStatus,
      expectedOutput: dbJob.expected_output || null, // Include expectedOutput
      passFailStatus: dbJob.pass_fail_status || "not_applicable", // Include passFailStatus
      executionTime: dbJob.execution_time || null, // Include executionTime
      embeddingsGenerated: dbJob.embeddings_generated || false,
      result: result,
    };
  } catch (error: any) {
    console.error(
      `API: Failed to retrieve job ${jobId} from DB:`,
      error.message
    );
    throw error;
  }
};
