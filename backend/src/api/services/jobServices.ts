// codeviz-ai/backend/src/api/services/jobService.ts
import { v4 as uuidv4 } from "uuid";
import db from "../../common/db"; // Import the PostgreSQL connection pool
import { CodeExecutionResult, JobStatus, Job } from "../../common/types";

export const submitJob = async (
  code: string
): Promise<{ jobId: string; status: JobStatus }> => {
  const jobId = uuidv4(); // Generate UUID here for immediate return

  try {
    const query = `
            INSERT INTO jobs (job_id, code, status)
            VALUES ($1, $2, $3)
            RETURNING job_id, status;
        `;
    const values = [jobId, code, "queued"];
    const res = await db.query(query, values);

    console.log(`API: Job ${jobId} created in DB.`);
    return { jobId: res.rows[0].job_id, status: res.rows[0].status };
  } catch (error: any) {
    console.error(`API: Failed to submit job ${jobId}:`, error.message);
    // Attempt to update job status to error if initial insert failed or subsequent steps
    try {
      await db.query(
        `UPDATE jobs SET status = $1, error = $2, updated_at = NOW() WHERE job_id = $3;`,
        ["error", `Failed to queue job: ${error.message}`, jobId]
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
  result: CodeExecutionResult | null = null
): Promise<boolean> => {
  try {
    const query = `
            UPDATE jobs
            SET
                status = $1,
                output = $2,
                error = $3,
                execution_trace = $4,
                updated_at = NOW()
            WHERE job_id = $5
            RETURNING job_id;
        `;
    const values = [
      status,
      result?.output || null,
      result?.error || null,
      result?.execution_trace ? JSON.stringify(result.execution_trace) : null, // Convert trace to JSON string
      jobId,
    ];
    const res = await db.query(query, values);

    if (res.rowCount === 0) {
      console.warn(`API: Attempted to update non-existent job: ${jobId}`);
      return false;
    }

    console.log(`API: Job ${jobId} updated to status: ${status} in DB.`);
    return true;
  } catch (error: any) {
    console.error(`API: Failed to update job ${jobId} in DB:`, error.message);
    throw error;
  }
};

export const getJobStatus = async (jobId: string): Promise<Job | null> => {
  try {
    const query = `
            SELECT job_id, code, status, output, error, execution_trace
            FROM jobs
            WHERE job_id = $1;
        `;
    const values = [jobId];
    const res = await db.query(query, values);

    if (res.rowCount === 0) {
      return null;
    }

    const dbJob = res.rows[0];

    return {
      jobId: dbJob.job_id,
      status: dbJob.status as JobStatus,
      result:
        dbJob.output || dbJob.error || dbJob.execution_trace
          ? {
              output: dbJob.output || "",
              error: dbJob.error || null,
              execution_trace: dbJob.execution_trace || [],
            }
          : null,
    };
  } catch (error: any) {
    console.error(
      `API: Failed to retrieve job ${jobId} from DB:`,
      error.message
    );
    throw error;
  }
};
