-- Merge active duplicate asset serial numbers and keep the asset with the latest history.
--
-- Rules:
-- - Serial numbers are compared within the same customer, case-insensitively, after trimming spaces.
-- - Blank serial numbers are ignored.
-- - The keeper is the active duplicate asset with the newest inspection/load-test date.
-- - If a group has no inspection history, the lowest assetid is kept.
-- - Inspection rows from duplicate assets are reassigned to the keeper.
-- - Inspection photos are also reassigned to the keeper assetid; result rows remain linked by testid.
-- - Duplicate asset rows are archived, not deleted.
--
-- Run a pg_dump backup before running this on production.

BEGIN;

DROP TABLE IF EXISTS pg_temp.duplicate_serial_assets;
DROP TABLE IF EXISTS pg_temp.duplicate_serial_merge_plan;

CREATE TEMP TABLE duplicate_serial_assets AS
WITH asset_history AS (
    SELECT
        a.assetid,
        COUNT(i.testid) AS inspection_count,
        MAX(i.testdate) AS latest_history_date
    FROM atec.tblasset a
    LEFT JOIN atec.tblinspection i
        ON i.assetid = a.assetid
    GROUP BY a.assetid
),
duplicate_groups AS (
    SELECT
        a.clientid,
        lower(trim(a.serialno)) AS normalized_serial,
        COUNT(*) AS active_asset_count
    FROM atec.tblasset a
    WHERE a.clientid IS NOT NULL
      AND a.serialno IS NOT NULL
      AND trim(a.serialno) <> ''
      AND COALESCE(a.archived, false) = false
    GROUP BY a.clientid, lower(trim(a.serialno))
    HAVING COUNT(*) > 1
),
duplicate_assets AS (
    SELECT
        a.assetid,
        a.clientid,
        lower(trim(a.serialno)) AS normalized_serial,
        a.serialno,
        ah.inspection_count,
        ah.latest_history_date
    FROM atec.tblasset a
    JOIN duplicate_groups dg
        ON dg.clientid = a.clientid
       AND dg.normalized_serial = lower(trim(a.serialno))
    JOIN asset_history ah
        ON ah.assetid = a.assetid
    WHERE COALESCE(a.archived, false) = false
),
keepers AS (
    SELECT DISTINCT ON (clientid, normalized_serial)
        clientid,
        normalized_serial,
        assetid AS keep_assetid
    FROM duplicate_assets
    ORDER BY
        clientid,
        normalized_serial,
        latest_history_date DESC NULLS LAST,
        inspection_count DESC,
        assetid
)
SELECT
    da.assetid,
    da.clientid,
    da.normalized_serial,
    da.serialno,
    da.inspection_count,
    da.latest_history_date,
    k.keep_assetid
FROM duplicate_assets da
JOIN keepers k
    ON k.clientid = da.clientid
   AND k.normalized_serial = da.normalized_serial;

CREATE TEMP TABLE duplicate_serial_merge_plan AS
SELECT
    d.assetid AS archive_assetid,
    d.keep_assetid,
    d.clientid,
    d.normalized_serial,
    d.serialno,
    d.inspection_count,
    d.latest_history_date
FROM duplicate_serial_assets d
WHERE d.assetid <> d.keep_assetid;

SELECT 'Merge counts before update' AS step;

SELECT
    (
        SELECT COUNT(*)
        FROM (
            SELECT clientid, normalized_serial
            FROM duplicate_serial_assets
            GROUP BY clientid, normalized_serial
        ) groups
    ) AS duplicate_serial_groups,
    (
        SELECT COUNT(*)
        FROM duplicate_serial_merge_plan
    ) AS duplicate_assets_to_archive,
    (
        SELECT COUNT(*)
        FROM atec.tblinspection i
        JOIN duplicate_serial_merge_plan p
            ON p.archive_assetid = i.assetid
    ) AS inspection_rows_to_move,
    (
        SELECT COUNT(*)
        FROM atec.tblinspectionphoto pht
        JOIN duplicate_serial_merge_plan p
            ON p.archive_assetid = pht.assetid
    ) AS inspection_photo_rows_to_move;

SELECT 'Duplicate serial merge plan' AS step;

SELECT
    cl.clientname,
    p.normalized_serial AS serial_no,
    p.keep_assetid,
    keep_asset.serialno AS keep_serialno,
    keep_history.inspection_count AS keep_inspection_count,
    COALESCE(keep_history.latest_history_date::text, '-') AS keep_latest_history_date,
    p.archive_assetid,
    p.serialno AS archive_serialno,
    p.inspection_count AS archive_inspection_count,
    COALESCE(p.latest_history_date::text, '-') AS archive_latest_history_date
FROM duplicate_serial_merge_plan p
JOIN atec.tblclients cl
    ON cl.clientid = p.clientid
JOIN atec.tblasset keep_asset
    ON keep_asset.assetid = p.keep_assetid
JOIN duplicate_serial_assets keep_history
    ON keep_history.assetid = p.keep_assetid
ORDER BY cl.clientname, p.normalized_serial, p.archive_assetid
LIMIT 1500;

UPDATE atec.tblinspection i
SET assetid = p.keep_assetid
FROM duplicate_serial_merge_plan p
WHERE i.assetid = p.archive_assetid;

UPDATE atec.tblinspectionphoto pht
SET assetid = p.keep_assetid
FROM duplicate_serial_merge_plan p
WHERE pht.assetid = p.archive_assetid;

UPDATE atec.tblasset a
SET archived = true
FROM duplicate_serial_merge_plan p
WHERE a.assetid = p.archive_assetid;

SELECT 'Archived duplicate serial assets' AS step;

SELECT
    cl.clientname,
    p.normalized_serial AS serial_no,
    p.keep_assetid,
    p.archive_assetid
FROM duplicate_serial_merge_plan p
JOIN atec.tblclients cl
    ON cl.clientid = p.clientid
ORDER BY cl.clientname, p.normalized_serial, p.archive_assetid
LIMIT 1500;

SELECT 'Remaining active duplicate serial groups after merge' AS step;

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
