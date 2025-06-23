ALTER TABLE jobs
ADD COLUMN expected_output TEXT;

-- Add pass_fail_status column
-- 'not_applicable' for jobs without expected output, 'passed', 'failed'
ALTER TABLE jobs
ADD COLUMN pass_fail_status TEXT NOT NULL DEFAULT 'not_applicable';

-- Add an index for pass_fail_status if you plan to query by it frequently
CREATE INDEX idx_jobs_pass_fail_status ON jobs (pass_fail_status);