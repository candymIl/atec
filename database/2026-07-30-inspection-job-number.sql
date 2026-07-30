BEGIN;

ALTER TABLE atec.tblinspection
  ADD COLUMN IF NOT EXISTS job_number text NOT NULL DEFAULT '';

COMMENT ON COLUMN atec.tblinspection.job_number IS
  'External CRM job number captured when the inspection certificate is created.';

CREATE INDEX IF NOT EXISTS idx_tblinspection_job_number
  ON atec.tblinspection (lower(job_number))
  WHERE job_number <> '';

COMMIT;
