-- ATEC safe duplicate asset serial cleanup
--
-- Purpose:
--   Archive duplicate active assets where the same customer has the same serial number.
--
-- Safety rules:
--   1. Nothing is deleted.
--   2. Only duplicate assets with NO inspection/certificate history are archived.
--   3. Assets with inspection history stay active for manual review.
--   4. One asset is kept active per customer/serial group.
--
-- After running this script, run:
--   database/2026-07-08-prevent-active-duplicate-asset-serials.sql
--
-- If duplicate serial protection still fails, the remaining duplicates are linked
-- to inspection history and must be reviewed manually before merging.

BEGIN;

DROP TABLE IF EXISTS temp_duplicate_serial_archive_candidates;

CREATE TEMP TABLE temp_duplicate_serial_archive_candidates AS
WITH asset_history AS (
  SELECT
    a.assetid,
    a.clientid,
    lower(trim(a.serialno)) AS serial_key,
    NULLIF(trim(a.serialno), '') AS serial_no,
    COUNT(i.testid) AS inspection_count,
    MAX(i.testdate) AS latest_inspection
  FROM atec.tblasset a
  LEFT JOIN atec.tblinspection i ON i.assetid = a.assetid
  WHERE COALESCE(a.archived, false) = false
    AND a.clientid IS NOT NULL
    AND NULLIF(trim(COALESCE(a.serialno, '')), '') IS NOT NULL
  GROUP BY
    a.assetid,
    a.clientid,
    lower(trim(a.serialno)),
    NULLIF(trim(a.serialno), '')
),
duplicate_groups AS (
  SELECT
    clientid,
    serial_key
  FROM asset_history
  GROUP BY clientid, serial_key
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT
    ah.*,
    FIRST_VALUE(assetid) OVER (
      PARTITION BY clientid, serial_key
      ORDER BY
        CASE WHEN inspection_count > 0 THEN 0 ELSE 1 END,
        inspection_count DESC,
        latest_inspection DESC NULLS LAST,
        assetid ASC
    ) AS keep_assetid
  FROM asset_history ah
  JOIN duplicate_groups dg
    ON dg.clientid = ah.clientid
   AND dg.serial_key = ah.serial_key
)
SELECT *
FROM ranked
WHERE assetid <> keep_assetid
  AND inspection_count = 0;

SELECT COUNT(*) AS duplicate_assets_to_archive
FROM temp_duplicate_serial_archive_candidates;

UPDATE atec.tblasset a
SET archived = true
FROM temp_duplicate_serial_archive_candidates c
WHERE a.assetid = c.assetid
  AND COALESCE(a.archived, false) = false;

-- Show exactly what was archived.
SELECT
  c.clientid,
  cl.clientname,
  c.serial_no,
  c.keep_assetid,
  c.assetid AS archived_assetid
FROM temp_duplicate_serial_archive_candidates c
LEFT JOIN atec.tblclients cl ON cl.clientid = c.clientid
ORDER BY cl.clientname, c.serial_no, c.assetid;

-- Show remaining active duplicate serial groups after this cleanup.
-- These normally require manual review because more than one active asset has history.
WITH asset_history AS (
  SELECT
    a.assetid,
    a.clientid,
    lower(trim(a.serialno)) AS serial_key,
    NULLIF(trim(a.serialno), '') AS serial_no,
    COUNT(i.testid) AS inspection_count
  FROM atec.tblasset a
  LEFT JOIN atec.tblinspection i ON i.assetid = a.assetid
  WHERE COALESCE(a.archived, false) = false
    AND a.clientid IS NOT NULL
    AND NULLIF(trim(COALESCE(a.serialno, '')), '') IS NOT NULL
  GROUP BY
    a.assetid,
    a.clientid,
    lower(trim(a.serialno)),
    NULLIF(trim(a.serialno), '')
)
SELECT
  ah.clientid,
  cl.clientname,
  ah.serial_no,
  COUNT(*) AS active_asset_count,
  COUNT(*) FILTER (WHERE ah.inspection_count > 0) AS assets_with_history,
  COUNT(*) FILTER (WHERE ah.inspection_count = 0) AS assets_without_history,
  string_agg(ah.assetid::text, ', ' ORDER BY ah.assetid) AS assetids
FROM asset_history ah
LEFT JOIN atec.tblclients cl ON cl.clientid = ah.clientid
GROUP BY ah.clientid, cl.clientname, ah.serial_key, ah.serial_no
HAVING COUNT(*) > 1
ORDER BY cl.clientname, ah.serial_no
LIMIT 300;

COMMIT;
