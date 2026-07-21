-- Phase 1: Archive orphan inspection results and add the result -> inspection FK.
--
-- Context:
-- atec.tblinspection.testid is now a primary key.
-- Existing legacy rows in tblinspectionresult may reference missing inspections.
-- This migration quarantines those orphan rows before deleting them from the live table.

BEGIN;

CREATE TABLE IF NOT EXISTS atec.tblinspectionresult_orphan_archive (
  archive_id bigserial PRIMARY KEY,
  archived_at timestamptz NOT NULL DEFAULT now(),
  original_resultid bigint,
  testid bigint,
  criteriaid bigint,
  result character varying,
  remarks text,
  assetvalue character varying,
  measuredvalue character varying,
  archive_reason text NOT NULL DEFAULT 'Missing parent row in atec.tblinspection'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblinspectionresult_orphan_archive_original_resultid
  ON atec.tblinspectionresult_orphan_archive(original_resultid);

INSERT INTO atec.tblinspectionresult_orphan_archive (
  original_resultid,
  testid,
  criteriaid,
  result,
  remarks,
  assetvalue,
  measuredvalue
)
SELECT
  r.resultid,
  r.testid,
  r.criteriaid,
  r.result,
  r.remarks,
  r.assetvalue,
  r.measuredvalue
FROM atec.tblinspectionresult r
LEFT JOIN atec.tblinspection i
  ON r.testid = i.testid
WHERE i.testid IS NULL
ON CONFLICT (original_resultid) DO NOTHING;

DELETE FROM atec.tblinspectionresult r
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblinspection i
  WHERE i.testid = r.testid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblinspectionresult_testid_fk'
      AND conrelid = 'atec.tblinspectionresult'::regclass
  ) THEN
    ALTER TABLE atec.tblinspectionresult
      ADD CONSTRAINT tblinspectionresult_testid_fk
      FOREIGN KEY (testid)
      REFERENCES atec.tblinspection(testid)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblinspectionresult_criteriaid_fk'
      AND conrelid = 'atec.tblinspectionresult'::regclass
  ) THEN
    ALTER TABLE atec.tblinspectionresult
      ADD CONSTRAINT tblinspectionresult_criteriaid_fk
      FOREIGN KEY (criteriaid)
      REFERENCES atec.tblequiptypecriteria(criteriaid);
  END IF;
EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE NOTICE 'Skipping tblinspectionresult_criteriaid_fk because some criteriaid values do not exist in atec.tblequiptypecriteria.';
END $$;

CREATE INDEX IF NOT EXISTS idx_tblinspectionresult_testid
  ON atec.tblinspectionresult(testid);

CREATE INDEX IF NOT EXISTS idx_tblinspectionresult_criteriaid
  ON atec.tblinspectionresult(criteriaid);

COMMIT;
