-- Archive exact duplicate active assets that have no inspection history.
--
-- This script is intentionally conservative:
-- - It only considers assets duplicated inside the same customer.
-- - The duplicate assets must also match site, section, equipment type,
--   description, WLL and key dimensions.
-- - It keeps the lowest assetid in each exact duplicate group.
-- - It archives duplicate asset rows only when they have no records in
--   atec.tblinspection.
-- - It does NOT delete anything.
--
-- Run a database backup before using this script.

BEGIN;

DROP TABLE IF EXISTS pg_temp.exact_duplicate_asset_groups;
DROP TABLE IF EXISTS pg_temp.exact_duplicate_asset_archive_candidates;

CREATE TEMP TABLE exact_duplicate_asset_groups AS
WITH normalized_assets AS (
  SELECT
    a.assetid,
    a.clientid,
    lower(trim(a.serialno)) AS normalized_serial,
    COALESCE(a.siteid, 0) AS siteid,
    COALESCE(a.sectionid, 0) AS sectionid,
    COALESCE(a.equiptypeid, 0) AS equiptypeid,
    lower(trim(COALESCE(a.description, ''))) AS normalized_description,
    lower(trim(COALESCE(a.wll::text, ''))) AS normalized_wll,
    lower(trim(COALESCE(a.span::text, ''))) AS normalized_span,
    lower(trim(COALESCE(a.hooksize::text, ''))) AS normalized_hooksize,
    lower(trim(COALESCE(a.heightoflift::text, ''))) AS normalized_heightoflift
  FROM atec.tblasset a
  WHERE a.clientid IS NOT NULL
    AND a.serialno IS NOT NULL
    AND trim(a.serialno) <> ''
    AND COALESCE(a.archived, false) = false
)
SELECT
  clientid,
  normalized_serial,
  siteid,
  sectionid,
  equiptypeid,
  normalized_description,
  normalized_wll,
  normalized_span,
  normalized_hooksize,
  normalized_heightoflift,
  MIN(assetid) AS keep_assetid,
  COUNT(*) AS duplicate_count
FROM normalized_assets
GROUP BY
  clientid,
  normalized_serial,
  siteid,
  sectionid,
  equiptypeid,
  normalized_description,
  normalized_wll,
  normalized_span,
  normalized_hooksize,
  normalized_heightoflift
HAVING COUNT(*) > 1;

CREATE TEMP TABLE exact_duplicate_asset_archive_candidates AS
SELECT
  a.assetid,
  g.keep_assetid,
  a.clientid,
  a.serialno
FROM atec.tblasset a
JOIN exact_duplicate_asset_groups g
  ON g.clientid = a.clientid
 AND g.normalized_serial = lower(trim(a.serialno))
 AND g.siteid = COALESCE(a.siteid, 0)
 AND g.sectionid = COALESCE(a.sectionid, 0)
 AND g.equiptypeid = COALESCE(a.equiptypeid, 0)
 AND g.normalized_description = lower(trim(COALESCE(a.description, '')))
 AND g.normalized_wll = lower(trim(COALESCE(a.wll::text, '')))
 AND g.normalized_span = lower(trim(COALESCE(a.span::text, '')))
 AND g.normalized_hooksize = lower(trim(COALESCE(a.hooksize::text, '')))
 AND g.normalized_heightoflift = lower(trim(COALESCE(a.heightoflift::text, '')))
WHERE a.assetid <> g.keep_assetid
  AND COALESCE(a.archived, false) = false
  AND NOT EXISTS (
    SELECT 1
    FROM atec.tblinspection i
    WHERE i.assetid = a.assetid
  );

DO $$
DECLARE
  candidate_count integer;
BEGIN
  SELECT COUNT(*)
  INTO candidate_count
  FROM exact_duplicate_asset_archive_candidates;

  RAISE NOTICE 'Exact duplicate assets without inspection history to archive: %', candidate_count;
END $$;

UPDATE atec.tblasset a
SET archived = true
FROM exact_duplicate_asset_archive_candidates c
WHERE a.assetid = c.assetid;

\echo 'Archived exact duplicate asset rows'

SELECT
  c.clientname,
  ac.serialno,
  ac.keep_assetid,
  ac.assetid AS archived_assetid
FROM exact_duplicate_asset_archive_candidates ac
JOIN atec.tblclients c
  ON c.clientid = ac.clientid
ORDER BY c.clientname, lower(trim(ac.serialno)), ac.assetid
LIMIT 500;

\echo 'Remaining exact duplicate active groups after archive'

WITH normalized_assets AS (
  SELECT
    a.assetid,
    a.clientid,
    lower(trim(a.serialno)) AS normalized_serial,
    COALESCE(a.siteid, 0) AS siteid,
    COALESCE(a.sectionid, 0) AS sectionid,
    COALESCE(a.equiptypeid, 0) AS equiptypeid,
    lower(trim(COALESCE(a.description, ''))) AS normalized_description,
    lower(trim(COALESCE(a.wll::text, ''))) AS normalized_wll,
    lower(trim(COALESCE(a.span::text, ''))) AS normalized_span,
    lower(trim(COALESCE(a.hooksize::text, ''))) AS normalized_hooksize,
    lower(trim(COALESCE(a.heightoflift::text, ''))) AS normalized_heightoflift
  FROM atec.tblasset a
  WHERE a.clientid IS NOT NULL
    AND a.serialno IS NOT NULL
    AND trim(a.serialno) <> ''
    AND COALESCE(a.archived, false) = false
)
SELECT COUNT(*) AS remaining_exact_duplicate_groups
FROM (
  SELECT
    clientid,
    normalized_serial,
    siteid,
    sectionid,
    equiptypeid,
    normalized_description,
    normalized_wll,
    normalized_span,
    normalized_hooksize,
    normalized_heightoflift
  FROM normalized_assets
  GROUP BY
    clientid,
    normalized_serial,
    siteid,
    sectionid,
    equiptypeid,
    normalized_description,
    normalized_wll,
    normalized_span,
    normalized_hooksize,
    normalized_heightoflift
  HAVING COUNT(*) > 1
) remaining;

COMMIT;
