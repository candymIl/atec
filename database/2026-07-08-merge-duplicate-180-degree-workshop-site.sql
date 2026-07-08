-- Safe cleanup for the duplicate "Workshop" site under
-- 180 Degrees Mining Solotions.
--
-- Screenshot duplicate:
--   keep siteid:      711
--   duplicate siteid: 820
--
-- What this script does:
-- - Keeps site 711 active.
-- - Moves assets, sections, users and risk assessments from site 820 to site 711.
-- - If a section with the same name already exists under site 711, linked records
--   are moved to the existing section and the duplicate section is archived.
-- - Archives site 820.
-- - Does not permanently delete anything.

BEGIN;

DO $$
DECLARE
  keep_site_id integer := 711;
  duplicate_site_id integer := 820;
  keep_client_id integer;
  duplicate_client_id integer;
  keep_site_name text;
  duplicate_site_name text;
  duplicate_section record;
  matching_section_id integer;
BEGIN
  SELECT clientid, sitename
  INTO keep_client_id, keep_site_name
  FROM atec.tblsites
  WHERE siteid = keep_site_id
    AND COALESCE(archived, false) = false;

  SELECT clientid, sitename
  INTO duplicate_client_id, duplicate_site_name
  FROM atec.tblsites
  WHERE siteid = duplicate_site_id
    AND COALESCE(archived, false) = false;

  IF keep_client_id IS NULL THEN
    RAISE EXCEPTION 'Keep site % was not found as an active site.', keep_site_id;
  END IF;

  IF duplicate_client_id IS NULL THEN
    RAISE EXCEPTION 'Duplicate site % was not found as an active site.', duplicate_site_id;
  END IF;

  IF keep_client_id <> duplicate_client_id THEN
    RAISE EXCEPTION 'Sites % and % do not belong to the same customer.', keep_site_id, duplicate_site_id;
  END IF;

  IF lower(trim(keep_site_name)) <> lower(trim(duplicate_site_name)) THEN
    RAISE EXCEPTION 'Sites % and % do not have the same normalized site name.', keep_site_id, duplicate_site_id;
  END IF;

  FOR duplicate_section IN
    SELECT sectionid, sectionname
    FROM atec.tblsection
    WHERE siteid = duplicate_site_id
      AND COALESCE(archived, false) = false
  LOOP
    SELECT sectionid
    INTO matching_section_id
    FROM atec.tblsection
    WHERE clientid = keep_client_id
      AND siteid = keep_site_id
      AND lower(trim(sectionname)) = lower(trim(duplicate_section.sectionname))
      AND COALESCE(archived, false) = false
    ORDER BY sectionid
    LIMIT 1;

    IF matching_section_id IS NOT NULL THEN
      UPDATE atec.tblasset
      SET siteid = keep_site_id,
          sectionid = matching_section_id
      WHERE sectionid = duplicate_section.sectionid;

      UPDATE atec.tblriskassessment
      SET siteid = keep_site_id,
          sectionid = matching_section_id
      WHERE sectionid = duplicate_section.sectionid;

      UPDATE atec.tblusers
      SET siteid = keep_site_id,
          sectionid = matching_section_id
      WHERE sectionid = duplicate_section.sectionid;

      UPDATE atec.tblsection
      SET archived = true
      WHERE sectionid = duplicate_section.sectionid;
    ELSE
      UPDATE atec.tblsection
      SET siteid = keep_site_id
      WHERE sectionid = duplicate_section.sectionid;

      UPDATE atec.tblasset
      SET siteid = keep_site_id
      WHERE sectionid = duplicate_section.sectionid;

      UPDATE atec.tblriskassessment
      SET siteid = keep_site_id
      WHERE sectionid = duplicate_section.sectionid;

      UPDATE atec.tblusers
      SET siteid = keep_site_id
      WHERE sectionid = duplicate_section.sectionid;
    END IF;
  END LOOP;

  UPDATE atec.tblasset
  SET siteid = keep_site_id
  WHERE siteid = duplicate_site_id;

  UPDATE atec.tblriskassessment
  SET siteid = keep_site_id
  WHERE siteid = duplicate_site_id;

  UPDATE atec.tblusers
  SET siteid = keep_site_id
  WHERE siteid = duplicate_site_id;

  UPDATE atec.tblsites
  SET archived = true
  WHERE siteid = duplicate_site_id;
END $$;

COMMIT;

-- Check result after running:
SELECT
  s.siteid,
  c.clientname,
  s.sitename,
  COALESCE(s.archived, false) AS archived,
  COUNT(DISTINCT sec.sectionid)::int AS active_sections,
  COUNT(DISTINCT a.assetid)::int AS active_assets
FROM atec.tblsites s
LEFT JOIN atec.tblclients c ON c.clientid = s.clientid
LEFT JOIN atec.tblsection sec
  ON sec.siteid = s.siteid
  AND COALESCE(sec.archived, false) = false
LEFT JOIN atec.tblasset a
  ON a.siteid = s.siteid
  AND COALESCE(a.archived, false) = false
WHERE s.siteid IN (711, 820)
GROUP BY s.siteid, c.clientname, s.sitename, s.archived
ORDER BY s.siteid;
