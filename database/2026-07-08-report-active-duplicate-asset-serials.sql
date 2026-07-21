-- Report active duplicate asset serial numbers inside the same customer.
--
-- This script is READ ONLY. It does not update, archive, or delete anything.
-- Use it before deciding which asset records are true duplicates.

\echo 'Duplicate active asset serial groups by customer'

WITH duplicate_groups AS (
  SELECT
    clientid,
    lower(trim(serialno)) AS normalized_serial,
    COUNT(*) AS duplicate_count
  FROM atec.tblasset
  WHERE clientid IS NOT NULL
    AND serialno IS NOT NULL
    AND trim(serialno) <> ''
    AND COALESCE(archived, false) = false
  GROUP BY clientid, lower(trim(serialno))
  HAVING COUNT(*) > 1
)
SELECT
  c.clientid,
  c.clientname,
  dg.normalized_serial AS serial_no,
  dg.duplicate_count,
  string_agg(a.assetid::text, ', ' ORDER BY a.assetid) AS assetids
FROM duplicate_groups dg
JOIN atec.tblclients c
  ON c.clientid = dg.clientid
JOIN atec.tblasset a
  ON a.clientid = dg.clientid
 AND lower(trim(a.serialno)) = dg.normalized_serial
 AND COALESCE(a.archived, false) = false
GROUP BY c.clientid, c.clientname, dg.normalized_serial, dg.duplicate_count
ORDER BY c.clientname, dg.normalized_serial
LIMIT 200;

\echo 'Detailed rows for duplicate active asset serials'

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
  COALESCE(a.archived, false) AS archived
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
WHERE COALESCE(a.archived, false) = false
ORDER BY c.clientname, lower(trim(a.serialno)), a.assetid
LIMIT 1000;
