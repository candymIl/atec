-- Merge active duplicate sites inside the same customer.
--
-- Safe behaviour:
-- - Keeps the lowest siteid in each duplicate group.
-- - Moves linked assets/users/risk assessments from duplicate sites to the kept site.
-- - Moves sections from duplicate sites to the kept site.
-- - If the kept site already has a section with the same name, linked records are moved
--   to that existing section and the duplicate section is archived.
-- - Archives duplicate sites instead of deleting them.
--
-- Run a database backup before this script.

BEGIN;

CREATE TEMP TABLE tmp_duplicate_site_groups AS
SELECT
  s.clientid,
  lower(trim(s.sitename)) AS normalized_sitename,
  MIN(s.siteid) AS keep_siteid,
  array_remove(array_agg(s.siteid ORDER BY s.siteid), MIN(s.siteid)) AS duplicate_siteids
FROM atec.tblsites s
WHERE COALESCE(s.archived, false) = false
  AND s.clientid IS NOT NULL
  AND trim(COALESCE(s.sitename, '')) <> ''
GROUP BY s.clientid, lower(trim(s.sitename))
HAVING COUNT(*) > 1;

CREATE TEMP TABLE tmp_site_merge_map AS
SELECT
  clientid,
  normalized_sitename,
  keep_siteid,
  unnest(duplicate_siteids) AS duplicate_siteid
FROM tmp_duplicate_site_groups;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*) INTO duplicate_count FROM tmp_site_merge_map;

  IF duplicate_count = 0 THEN
    RAISE NOTICE 'No active duplicate sites found. Nothing to merge.';
  ELSE
    RAISE NOTICE 'Found % duplicate active site(s) to merge.', duplicate_count;
  END IF;
END $$;

-- Build a section merge map before moving section site IDs.
-- If a section with the same name already exists on the kept site, keep that section.
-- Otherwise keep the duplicate section and move it to the kept site.
CREATE TEMP TABLE tmp_section_merge_map AS
SELECT
  duplicate_sec.sectionid AS duplicate_sectionid,
  COALESCE(keep_sec.sectionid, duplicate_sec.sectionid) AS keep_sectionid,
  site_map.duplicate_siteid,
  site_map.keep_siteid
FROM atec.tblsection duplicate_sec
JOIN tmp_site_merge_map site_map
  ON duplicate_sec.siteid = site_map.duplicate_siteid
LEFT JOIN atec.tblsection keep_sec
  ON keep_sec.clientid = duplicate_sec.clientid
  AND keep_sec.siteid = site_map.keep_siteid
  AND lower(trim(keep_sec.sectionname)) = lower(trim(duplicate_sec.sectionname))
  AND COALESCE(keep_sec.archived, false) = false
WHERE COALESCE(duplicate_sec.archived, false) = false;

-- Move records linked to duplicate sections onto the kept section where needed.
UPDATE atec.tblasset asset
SET sectionid = section_map.keep_sectionid
FROM tmp_section_merge_map section_map
WHERE asset.sectionid = section_map.duplicate_sectionid
  AND section_map.keep_sectionid <> section_map.duplicate_sectionid;

UPDATE atec.tblusers users
SET sectionid = section_map.keep_sectionid
FROM tmp_section_merge_map section_map
WHERE users.sectionid = section_map.duplicate_sectionid
  AND section_map.keep_sectionid <> section_map.duplicate_sectionid;

UPDATE atec.tblriskassessment risk
SET sectionid = section_map.keep_sectionid
FROM tmp_section_merge_map section_map
WHERE risk.sectionid = section_map.duplicate_sectionid
  AND section_map.keep_sectionid <> section_map.duplicate_sectionid;

-- Archive duplicate sections when their records were moved to an existing kept section.
UPDATE atec.tblsection section_to_archive
SET archived = true
FROM tmp_section_merge_map section_map
WHERE section_to_archive.sectionid = section_map.duplicate_sectionid
  AND section_map.keep_sectionid <> section_map.duplicate_sectionid;

-- Move duplicate-site sections that do not have a matching kept-site section.
UPDATE atec.tblsection section_to_move
SET siteid = section_map.keep_siteid
FROM tmp_section_merge_map section_map
WHERE section_to_move.sectionid = section_map.duplicate_sectionid
  AND section_map.keep_sectionid = section_map.duplicate_sectionid;

-- Move direct site links from duplicate sites to kept sites.
UPDATE atec.tblasset asset
SET siteid = site_map.keep_siteid
FROM tmp_site_merge_map site_map
WHERE asset.siteid = site_map.duplicate_siteid;

UPDATE atec.tblusers users
SET siteid = site_map.keep_siteid
FROM tmp_site_merge_map site_map
WHERE users.siteid = site_map.duplicate_siteid;

UPDATE atec.tblriskassessment risk
SET siteid = site_map.keep_siteid
FROM tmp_site_merge_map site_map
WHERE risk.siteid = site_map.duplicate_siteid;

-- Archive duplicate sites after all linked records have been moved.
UPDATE atec.tblsites duplicate_site
SET archived = true
FROM tmp_site_merge_map site_map
WHERE duplicate_site.siteid = site_map.duplicate_siteid;

-- Final safety check: no active duplicate site names should remain.
DO $$
DECLARE
  remaining_count integer;
BEGIN
  SELECT COUNT(*) INTO remaining_count
  FROM (
    SELECT s.clientid, lower(trim(s.sitename)) AS normalized_sitename
    FROM atec.tblsites s
    WHERE COALESCE(s.archived, false) = false
      AND s.clientid IS NOT NULL
      AND trim(COALESCE(s.sitename, '')) <> ''
    GROUP BY s.clientid, lower(trim(s.sitename))
    HAVING COUNT(*) > 1
  ) remaining;

  IF remaining_count > 0 THEN
    RAISE EXCEPTION 'Duplicate site merge incomplete: % active duplicate site group(s) remain.', remaining_count;
  END IF;
END $$;

COMMIT;

SELECT
  c.clientname,
  s.siteid,
  s.sitename,
  COALESCE(s.archived, false) AS archived,
  COUNT(DISTINCT sec.sectionid) FILTER (WHERE COALESCE(sec.archived, false) = false) AS active_sections,
  COUNT(DISTINCT a.assetid) FILTER (WHERE COALESCE(a.archived, false) = false) AS active_assets
FROM atec.tblsites s
JOIN atec.tblclients c
  ON c.clientid = s.clientid
LEFT JOIN atec.tblsection sec
  ON sec.siteid = s.siteid
LEFT JOIN atec.tblasset a
  ON a.siteid = s.siteid
WHERE s.siteid IN (
  SELECT keep_siteid FROM tmp_site_merge_map
  UNION
  SELECT duplicate_siteid FROM tmp_site_merge_map
)
GROUP BY c.clientname, s.siteid, s.sitename, s.archived
ORDER BY c.clientname, lower(s.sitename), s.siteid;
