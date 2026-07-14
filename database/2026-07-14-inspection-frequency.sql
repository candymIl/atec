ALTER TABLE atec.tblinspection
  ADD COLUMN IF NOT EXISTS inspectionfrequency text;

ALTER TABLE atec.tblinspection
  DROP CONSTRAINT IF EXISTS tblinspection_inspectionfrequency_check;

ALTER TABLE atec.tblinspection
  ADD CONSTRAINT tblinspection_inspectionfrequency_check
  CHECK (
    inspectionfrequency IS NULL
    OR inspectionfrequency IN ('FREQUENT', 'ANNUAL')
  );
