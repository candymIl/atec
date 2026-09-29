BEGIN;
ALTER TABLE atec.tbljobcard
  ADD COLUMN IF NOT EXISTS inspection_work_date date,
  ADD COLUMN IF NOT EXISTS inspection_asset_exclusions integer[] NOT NULL DEFAULT '{}';
COMMIT;
