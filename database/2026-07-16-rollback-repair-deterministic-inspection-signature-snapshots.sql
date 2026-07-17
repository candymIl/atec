-- Rollback for:
--   2026-07-16-repair-deterministic-inspection-signature-snapshots.sql

BEGIN;

DO $$
BEGIN
  IF current_database() <> 'fbcranes' THEN
    RAISE EXCEPTION 'Refusing to run outside approved database fbcranes; current database is %', current_database();
  END IF;

  IF to_regclass('atec.inspection_signature_snapshot_repair_audit') IS NULL THEN
    RAISE EXCEPTION 'Required audit table atec.inspection_signature_snapshot_repair_audit does not exist';
  END IF;
END $$;

DO $$
DECLARE
  drift_count integer;
BEGIN
  SELECT COUNT(*) INTO drift_count
  FROM atec.inspection_signature_snapshot_repair_audit audit
  JOIN atec.tblinspection i
    ON i.testid = audit.testid
  WHERE audit.migration_name = '2026-07-16-repair-deterministic-inspection-signature-snapshots.sql'
    AND (
      i.inspector_signature_image IS DISTINCT FROM audit.assigned_inspector_signature_image
      OR i.inspector_lmi_number IS DISTINCT FROM audit.previous_inspector_lmi_number
    );

  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'Refusing rollback because % inspections drifted from audited signature values', drift_count;
  END IF;
END $$;

WITH restored AS (
  UPDATE atec.tblinspection i
  SET inspector_signature_image = audit.previous_inspector_signature_image
  FROM atec.inspection_signature_snapshot_repair_audit audit
  WHERE audit.migration_name = '2026-07-16-repair-deterministic-inspection-signature-snapshots.sql'
    AND i.testid = audit.testid
    AND i.inspector_signature_image IS NOT DISTINCT FROM audit.assigned_inspector_signature_image
    AND i.inspector_lmi_number IS NOT DISTINCT FROM audit.previous_inspector_lmi_number
  RETURNING i.testid
)
SELECT COUNT(*) AS restored_inspection_count
FROM restored;

COMMIT;
