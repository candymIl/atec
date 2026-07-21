BEGIN;

ALTER TABLE atec.tblriskassessment
  ADD COLUMN IF NOT EXISTS assessment_time time NULL,
  ADD COLUMN IF NOT EXISTS hazard_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stop_questions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS manage_plan text NULL,
  ADD COLUMN IF NOT EXISTS monitor_notes text NULL,
  ADD COLUMN IF NOT EXISTS review_questions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS additional_notes text NULL,
  ADD COLUMN IF NOT EXISTS team_members jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS responsible_signoff_name text NULL,
  ADD COLUMN IF NOT EXISTS supervisor_signoff_name text NULL;

CREATE INDEX IF NOT EXISTS idx_tblriskassessment_hazard_categories
  ON atec.tblriskassessment USING gin (hazard_categories);

COMMIT;
