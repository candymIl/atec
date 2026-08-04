BEGIN;

-- This legacy table can be owned by the database administrator rather than
-- the account used by the ATEC backend.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fbcranes') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE atec.tblinspectioncriteriasnapshot
      TO fbcranes;
  END IF;
END
$$;

COMMIT;
