BEGIN;

ALTER TABLE atec.tblinspection
  ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by_user_id integer,
  ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE atec.tblinspection
  DROP CONSTRAINT IF EXISTS tblinspection_record_status_check;

ALTER TABLE atec.tblinspection
  ADD CONSTRAINT tblinspection_record_status_check
  CHECK (record_status IN ('ACTIVE', 'VOID'));

CREATE INDEX IF NOT EXISTS idx_tblinspection_active_asset_type_date
  ON atec.tblinspection (assetid, inspectiontype, testdate DESC, testid DESC)
  WHERE record_status = 'ACTIVE';

COMMIT;
