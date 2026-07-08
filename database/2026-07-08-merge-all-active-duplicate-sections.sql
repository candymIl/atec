-- Merge active duplicate sections inside the same customer and site.
--
-- Safe behaviour:
-- - Keeps the lowest sectionid in each duplicate group.
-- - Moves linked assets/users/risk assessments from duplicate sections to the kept section.
-- - Archives duplicate sections instead of deleting them.
--
-- Run a database backup before this script.

BEGIN;

CREATE TEMP TABLE tmp_duplicate_section_groups AS
SELECT
  sec.clientid,
  sec.siteid,
  lower(trim(sec.sectionname)) AS normalized_sectionname,
  MIN(sec.sectionid) AS keep_sectionid,
  array_remove(array_agg(sec.sectionid ORDER BY sec.sectionid), MIN(sec.sectionid)) AS duplicate_sectionids
FROM atec.tblsection sec
WHERE COALESCE(sec.archived, false) = false
  AND sec.clientid IS NOT NULL
  AND sec.siteid IS NOT NULL
  AND trim(COALESCE(sec.sectionname, '')) <> ''
GROUP BY sec.clientid, sec.siteid, lower(trim(sec.sectionname))
HAVING COUNT(*) > 1;

CREATE TEMP TABLE tmp_section_merge_map AS
SELECT
  clientid,
  siteid,
  normalized_sectionname,
  keep_sectionid,
  unnest(duplicate_sectionids) AS duplicate_sectionid
FROM tmp_duplicate_section_groups;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*) INTO duplicate_count FROM tmp_section_merge_map;

  IF duplicate_count = 0 THEN
    RAISE NOTICE 'No active duplicate sections found. Nothing to merge.';
  ELSE
    RAISE NOTICE 'Found % duplicate active section(s) to merge.', duplicate_count;
  END IF;
END $$;

-- Move direct section links from duplicate sections to kept sections.
UPDATE atec.tblasset asset
SET sectionid = section_map.keep_sectionid
FROM tmp_section_merge_map section_map
WHERE asset.sectionid = section_map.duplicate_sectionid;

UPDATE atec.tblusers users
SET sectionid = section_map.keep_sectionid
FROM tmp_section_merge_map section_map
WHERE users.sectionid = section_map.duplicate_sectionid;

UPDATE atec.tblriskassessment risk
SET sectionid = section_map.keep_sectionid
FROM tmp_section_merge_map section_map
WHERE risk.sectionid = section_map.duplicate_sectionid;

-- Archive duplicate sections after all linked records have been moved.
UPDATE atec.tblsection duplicate_section
SET archived = true
FROM tmp_section_merge_map section_map
WHERE duplicate_section.sectionid = section_map.duplicate_sectionid;

-- Final safety check: no active duplicate section names should remain inside the same customer/site.
DO $$
DECLARE
  remaining_count integer;
BEGIN
  SELECT COUNT(*) INTO remaining_count
  FROM (
    SELECT sec.clientid, sec.siteid, lower(trim(sec.sectionname)) AS normalized_sectionname
    FROM atec.tblsection sec
    WHERE COALESCE(sec.archived, false) = false
      AND sec.clientid IS NOT NULL
      AND sec.siteid IS NOT NULL
      AND trim(COALESCE(sec.sectionname, '')) <> ''
    GROUP BY sec.clientid, sec.siteid, lower(trim(sec.sectionname))
    HAVING COUNT(*) > 1
  ) remaining;

  IF remaining_count > 0 THEN
    RAISE EXCEPTION 'Duplicate section merge incomplete: % active duplicate section group(s) remain.', remaining_count;
  END IF;
END $$;

COMMIT;

SELECT
  c.clientname,
  s.sitename,
  sec.sectionid,
  sec.sectionname,
  COALESCE(sec.archived, false) AS archived,
  COUNT(DISTINCT a.assetid) FILTER (WHERE COALESCE(a.archived, false) = false) AS active_assets
FROM atec.tblsection sec
JOIN atec.tblclients c
  ON c.clientid = sec.clientid
LEFT JOIN atec.tblsites s
  ON s.siteid = sec.siteid
LEFT JOIN atec.tblasset a
  ON a.sectionid = sec.sectionid
WHERE sec.sectionid IN (
  SELECT keep_sectionid FROM tmp_section_merge_map
  UNION
  SELECT duplicate_sectionid FROM tmp_section_merge_map
)
GROUP BY c.clientname, s.sitename, sec.sectionid, sec.sectionname, sec.archived
ORDER BY c.clientname, s.sitename, lower(sec.sectionname), sec.sectionid;
