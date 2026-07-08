-- Prevent duplicate active master-data records inside the same customer.
-- This does not delete or change existing data. If active duplicates already
-- exist, the script stops and reports which area must be cleaned first.

BEGIN;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT clientid, lower(trim(sitename)) AS normalized_name
    FROM atec.tblsites
    WHERE clientid IS NOT NULL
      AND nullif(trim(sitename), '') IS NOT NULL
      AND COALESCE(archived, false) = false
    GROUP BY clientid, lower(trim(sitename))
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot add duplicate site protection: % active duplicate site name group(s) exist inside customers.', duplicate_count;
  END IF;

  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT clientid, siteid, lower(trim(sectionname)) AS normalized_name
    FROM atec.tblsection
    WHERE clientid IS NOT NULL
      AND siteid IS NOT NULL
      AND nullif(trim(sectionname), '') IS NOT NULL
      AND COALESCE(archived, false) = false
    GROUP BY clientid, siteid, lower(trim(sectionname))
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot add duplicate section protection: % active duplicate section name group(s) exist inside the same customer site.', duplicate_count;
  END IF;

  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT clientid, lower(trim(name)) AS normalized_name
    FROM atec.tblpeople
    WHERE clientid IS NOT NULL
      AND nullif(trim(name), '') IS NOT NULL
      AND COALESCE(archived, false) = false
    GROUP BY clientid, lower(trim(name))
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot add duplicate responsible person protection: % active duplicate responsible person group(s) exist inside customers.', duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblsites_active_client_name
  ON atec.tblsites (clientid, lower(trim(sitename)))
  WHERE clientid IS NOT NULL
    AND nullif(trim(sitename), '') IS NOT NULL
    AND COALESCE(archived, false) = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblsection_active_client_site_name
  ON atec.tblsection (clientid, siteid, lower(trim(sectionname)))
  WHERE clientid IS NOT NULL
    AND siteid IS NOT NULL
    AND nullif(trim(sectionname), '') IS NOT NULL
    AND COALESCE(archived, false) = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblpeople_active_client_name
  ON atec.tblpeople (clientid, lower(trim(name)))
  WHERE clientid IS NOT NULL
    AND nullif(trim(name), '') IS NOT NULL
    AND COALESCE(archived, false) = false;

COMMIT;
