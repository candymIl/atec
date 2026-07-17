-- Rollback for:
--   2026-07-16-repair-deterministic-asset-hierarchy-inconsistencies.sql
--
-- Restores only assets recorded by atec.asset_hierarchy_repair_audit for this
-- migration. It refuses to continue if any repaired asset has since drifted
-- away from the audited proposed hierarchy.

BEGIN;

DO $$
BEGIN
  IF current_database() <> 'fbcranes' THEN
    RAISE EXCEPTION 'Refusing to run outside approved database fbcranes; current database is %', current_database();
  END IF;

  IF to_regclass('atec.asset_hierarchy_repair_audit') IS NULL THEN
    RAISE EXCEPTION 'Required audit table atec.asset_hierarchy_repair_audit does not exist';
  END IF;
END $$;

DO $$
DECLARE
  drift_count integer;
BEGIN
  SELECT COUNT(*) INTO drift_count
  FROM atec.asset_hierarchy_repair_audit audit
  JOIN atec.tblasset a
    ON a.assetid = audit.assetid
  WHERE audit.migration_name = '2026-07-16-repair-deterministic-asset-hierarchy-inconsistencies.sql'
    AND (
      a.clientid IS DISTINCT FROM audit.proposed_clientid
      OR a.siteid IS DISTINCT FROM audit.proposed_siteid
      OR a.sectionid IS DISTINCT FROM audit.proposed_sectionid
      OR a.responsibleid IS DISTINCT FROM audit.previous_responsibleid
    );

  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'Refusing rollback because % repaired assets no longer match audited proposed values', drift_count;
  END IF;
END $$;

WITH restored AS (
  UPDATE atec.tblasset a
  SET
    clientid = audit.previous_clientid,
    siteid = audit.previous_siteid,
    sectionid = audit.previous_sectionid
  FROM atec.asset_hierarchy_repair_audit audit
  WHERE audit.migration_name = '2026-07-16-repair-deterministic-asset-hierarchy-inconsistencies.sql'
    AND a.assetid = audit.assetid
    AND a.clientid IS NOT DISTINCT FROM audit.proposed_clientid
    AND a.siteid IS NOT DISTINCT FROM audit.proposed_siteid
    AND a.sectionid IS NOT DISTINCT FROM audit.proposed_sectionid
    AND a.responsibleid IS NOT DISTINCT FROM audit.previous_responsibleid
  RETURNING a.assetid
)
SELECT COUNT(*) AS restored_asset_count
FROM restored;

COMMIT;
