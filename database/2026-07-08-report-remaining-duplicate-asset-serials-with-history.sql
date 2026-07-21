-- Report remaining active duplicate asset serials with inspection history counts.
--
-- This script is READ ONLY. It does not update, archive, or delete anything.
--
-- Use this after running the safe exact-duplicate archive script. It helps
-- decide which remaining duplicates must be corrected manually, archived, or
-- given a corrected serial number.

\echo 'Remaining active duplicate serial groups'

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
),
asset_history AS (
  SELECT
    a.assetid,
    COUNT(i.testid) AS inspection_count,
    MAX(i.testdate) AS latest_inspection_date
  FROM atec.tblasset a
  LEFT JOIN atec.tblinspection i
    ON i.assetid = a.assetid
  GROUP BY a.assetid
)
SELECT
  c.clientid,
  c.clientname,
  dg.normalized_serial AS serial_no,
  dg.active_asset_count,
  SUM(CASE WHEN ah.inspection_count > 0 THEN 1 ELSE 0 END) AS assets_with_history,
  SUM(CASE WHEN ah.inspection_count = 0 THEN 1 ELSE 0 END) AS assets_without_history,
  string_agg(a.assetid::text, ', ' ORDER BY a.assetid) AS assetids
FROM duplicate_groups dg
JOIN atec.tblclients c
  ON c.clientid = dg.clientid
JOIN atec.tblasset a
  ON a.clientid = dg.clientid
 AND lower(trim(a.serialno)) = dg.normalized_serial
 AND COALESCE(a.archived, false) = false
JOIN asset_history ah
  ON ah.assetid = a.assetid
GROUP BY
  c.clientid,
  c.clientname,
  dg.normalized_serial,
  dg.active_asset_count
ORDER BY
  assets_with_history DESC,
  c.clientname,
  dg.normalized_serial
LIMIT 300;

\echo 'Remaining active duplicate serial detail rows'

WITH duplicate_groups AS (
  SELECT
    clientid,
    lower(trim(serialno)) AS normalized_serial
  FROM atec.tblasset
  WHERE clientid IS NOT NULL
    AND serialno IS NOT NULL
    AND trim(serialno) <> ''
    AND COALESCE(archived, false) = false
  GROUP BY clientid, lower(trim(serialno))
  HAVING COUNT(*) > 1
),
asset_history AS (
  SELECT
    a.assetid,
    COUNT(i.testid) AS inspection_count,
    MAX(i.testdate) AS latest_inspection_date
  FROM atec.tblasset a
  LEFT JOIN atec.tblinspection i
    ON i.assetid = a.assetid
  GROUP BY a.assetid
)
SELECT
  c.clientname,
  a.assetid,
  a.serialno,
  COALESCE(a.assettagno, '-') AS asset_tag,
  COALESCE(s.sitename, '-') AS site,
  COALESCE(sec.sectionname, '-') AS section,
  COALESCE(et.description, '-') AS equipment_type,
  COALESCE(a.description, '-') AS asset_description,
  ah.inspection_count,
  COALESCE(ah.latest_inspection_date::text, '-') AS latest_inspection_date
FROM atec.tblasset a
JOIN duplicate_groups dg
  ON dg.clientid = a.clientid
 AND dg.normalized_serial = lower(trim(a.serialno))
JOIN atec.tblclients c
  ON c.clientid = a.clientid
LEFT JOIN atec.tblsites s
  ON s.siteid = a.siteid
LEFT JOIN atec.tblsection sec
  ON sec.sectionid = a.sectionid
LEFT JOIN atec.tblequiptype et
  ON et.equiptypeid = a.equiptypeid
JOIN asset_history ah
  ON ah.assetid = a.assetid
WHERE COALESCE(a.archived, false) = false
ORDER BY
  c.clientname,
  lower(trim(a.serialno)),
  ah.inspection_count DESC,
  a.assetid
LIMIT 1500;
