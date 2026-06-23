-- Phase 1: Stabilize atec.tblinspection.testid.
-- This migration makes tblinspection.testid a real primary key and links
-- the new inspection photo table to it.
--
-- It intentionally does NOT add a foreign key from tblinspectionresult yet,
-- because existing legacy data may contain result rows whose testid does not
-- exist in tblinspection. Clean those orphan rows first in a separate step.

BEGIN;

LOCK TABLE atec.tblinspection IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  null_count integer;
  duplicate_count integer;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM atec.tblinspection
  WHERE testid IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION 'Cannot make atec.tblinspection.testid primary key: % rows have NULL testid.', null_count;
  END IF;

  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT testid
    FROM atec.tblinspection
    GROUP BY testid
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot make atec.tblinspection.testid primary key: % duplicate testid values exist.', duplicate_count;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('atec.tblinspection_testid_seq') IS NULL THEN
    CREATE SEQUENCE atec.tblinspection_testid_seq;
  END IF;
END $$;

ALTER TABLE atec.tblinspection
  ALTER COLUMN testid SET DEFAULT nextval('atec.tblinspection_testid_seq'::regclass);

SELECT setval(
  'atec.tblinspection_testid_seq',
  GREATEST((SELECT COALESCE(MAX(testid), 0) FROM atec.tblinspection), 1),
  true
);

ALTER TABLE atec.tblinspection
  ALTER COLUMN testid SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'atec.tblinspection'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE atec.tblinspection
      ADD CONSTRAINT tblinspection_pkey
      PRIMARY KEY (testid);
  END IF;
END $$;

ALTER SEQUENCE atec.tblinspection_testid_seq
  OWNED BY atec.tblinspection.testid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblinspectionphoto_testid_fk'
      AND conrelid = 'atec.tblinspectionphoto'::regclass
  ) THEN
    ALTER TABLE atec.tblinspectionphoto
      ADD CONSTRAINT tblinspectionphoto_testid_fk
      FOREIGN KEY (testid)
      REFERENCES atec.tblinspection(testid)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tblinspection_testdate
  ON atec.tblinspection(testdate DESC);

CREATE INDEX IF NOT EXISTS idx_tblinspection_assetid
  ON atec.tblinspection(assetid);

CREATE INDEX IF NOT EXISTS idx_tblinspection_status
  ON atec.tblinspection(status);

CREATE INDEX IF NOT EXISTS idx_tblinspection_type
  ON atec.tblinspection(inspectiontype);

COMMIT;
