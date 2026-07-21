-- Safely archive duplicate active assets with the same serial number inside the same customer.
--
-- IMPORTANT SAFETY RULES
-- - This script does NOT delete assets.
-- - This script does NOT archive any asset that has inspection/load-test history.
-- - This script does NOT move inspection history.
-- - If a duplicate group has inspection history, the asset with history is kept.
-- - If a duplicate group has no inspection history at all, the lowest assetid is kept.
-- - Only duplicate asset records without inspection history are archived.
--
-- Run a pg_dump backup before running this on production.

BEGIN;

DROP TABLE IF EXISTS pg_temp.duplicate_serial_assets;
DROP TABLE IF EXISTS pg_temp.duplicate_serial_archive_candidates;

CREATE TEMP TABLE duplicate_serial_assets AS
WITH asset_history AS (
    SELECT
        a.assetid,
        COUNT(i.testid) AS inspection_count,
        MAX(i.testdate) AS latest_inspection_date
    FROM atec.tblasset a
    LEFT JOIN atec.tblinspection i
        ON i.assetid = a.assetid
    GROUP BY a.assetid
),
duplicate_groups AS (
    SELECT
        a.clientid,
        lower(trim(a.serialno)) AS normalized_serial,
        COUNT(*) AS active_asset_count,
        SUM(CASE WHEN ah.inspection_count > 0 THEN 1 ELSE 0 END) AS assets_with_history
    FROM atec.tblasset a
    JOIN asset_history ah
        ON ah.assetid = a.assetid
    WHERE a.clientid IS NOT NULL
      AND a.serialno IS NOT NULL
      AND trim(a.serialno) <> ''
      AND COALESCE(a.archived, false) = false
    GROUP BY a.clientid, lower(trim(a.serialno))
    HAVING COUNT(*) > 1
)
SELECT
    a.assetid,
    a.clientid,
    lower(trim(a.serialno)) AS normalized_serial,
    a.serialno,
    ah.inspection_count,
    ah.latest_inspection_date,
    dg.assets_with_history,
    MIN(a.assetid) OVER (
        PARTITION BY a.clientid, lower(trim(a.serialno))
    ) AS lowest_assetid,
    FIRST_VALUE(a.assetid) OVER (
        PARTITION BY a.clientid, lower(trim(a.serialno))
        ORDER BY
            CASE WHEN ah.inspection_count > 0 THEN 0 ELSE 1 END,
            ah.inspection_count DESC,
            ah.latest_inspection_date DESC NULLS LAST,
            a.assetid
    ) AS preferred_keep_assetid
FROM atec.tblasset a
JOIN duplicate_groups dg
    ON dg.clientid = a.clientid
   AND dg.normalized_serial = lower(trim(a.serialno))
JOIN asset_history ah
    ON ah.assetid = a.assetid
WHERE COALESCE(a.archived, false) = false;

CREATE TEMP TABLE duplicate_serial_archive_candidates AS
SELECT
    d.assetid,
    d.clientid,
    d.normalized_serial,
    d.serialno,
    CASE
        WHEN d.assets_with_history > 0 THEN d.preferred_keep_assetid
        ELSE d.lowest_assetid
    END AS keep_assetid
FROM duplicate_serial_assets d
WHERE d.inspection_count = 0
  AND d.assetid <> CASE
      WHEN d.assets_with_history > 0 THEN d.preferred_keep_assetid
      ELSE d.lowest_assetid
  END;

DO $$
DECLARE
    candidate_count integer;
BEGIN
    SELECT COUNT(*)
    INTO candidate_count
    FROM duplicate_serial_archive_candidates;

    RAISE NOTICE 'Duplicate serial assets without inspection history to archive: %', candidate_count;
END $$;

UPDATE atec.tblasset a
SET archived = true
FROM duplicate_serial_archive_candidates c
WHERE a.assetid = c.assetid;

\echo 'Archived duplicate serial assets without inspection history'
SELECT
    cl.clientname,
    c.serialno,
    c.keep_assetid,
    c.assetid AS archived_assetid
FROM duplicate_serial_archive_candidates c
JOIN atec.tblclients cl
    ON cl.clientid = c.clientid
ORDER BY cl.clientname, lower(trim(c.serialno)), c.assetid
LIMIT 1000;

\echo 'Remaining active duplicate serial groups after archive'
WITH duplicate_groups AS (
    SELECT
        clientid,
        lower(trim(serialno)) AS normalized_serial,
        COUNT(*) AS active_asset_count
    FROM atec.tblasset
    WHERE clientid IS NOT NULL
      AND serialno IS NOT NULL
      AND trim(serialno) <> ''
      AND COALESCE(archived, false) = false
    GROUP BY clientid, lower(trim(serialno))
    HAVING COUNT(*) > 1
)
SELECT COUNT(*) AS remaining_duplicate_serial_groups
FROM duplicate_groups;

COMMIT;
