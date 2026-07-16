-- Rollback for:
--   2026-07-16-assign-deterministic-missing-section-responsible-persons.sql
--
-- This rollback restores only sections recorded by the migration audit table.
-- It refuses to continue if a repaired section has since been changed to a
-- different responsible person.

BEGIN;

DO $$
BEGIN
  IF current_database() <> 'fbcranes' THEN
    RAISE EXCEPTION 'Refusing to run outside approved database fbcranes; current database is %', current_database();
  END IF;

  IF to_regclass('atec.responsible_person_ownership_repair_audit') IS NULL THEN
    RAISE EXCEPTION 'Required audit table atec.responsible_person_ownership_repair_audit does not exist';
  END IF;
END $$;

DO $$
DECLARE
  drift_count integer;
BEGIN
  SELECT COUNT(*) INTO drift_count
  FROM atec.responsible_person_ownership_repair_audit audit
  JOIN atec.tblsection sec
    ON sec.sectionid = audit.sectionid
  WHERE audit.migration_name = '2026-07-16-assign-deterministic-missing-section-responsible-persons.sql'
    AND sec.responsibleid IS DISTINCT FROM audit.assigned_responsibleid;

  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'Refusing rollback because % repaired sections no longer match audit assignments', drift_count;
  END IF;
END $$;

WITH restored AS (
  UPDATE atec.tblsection sec
  SET responsibleid = audit.previous_responsibleid
  FROM atec.responsible_person_ownership_repair_audit audit
  WHERE audit.migration_name = '2026-07-16-assign-deterministic-missing-section-responsible-persons.sql'
    AND sec.sectionid = audit.sectionid
    AND sec.responsibleid IS NOT DISTINCT FROM audit.assigned_responsibleid
  RETURNING sec.sectionid
)
SELECT COUNT(*) AS restored_section_count
FROM restored;

COMMIT;
