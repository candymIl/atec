-- Report active assets that look like exact duplicates.
--
-- This script is READ ONLY. It does not update, archive, or delete anything.
--
-- It groups duplicate serial numbers inside the same customer only when the
-- site, section, equipment type, description, WLL and key dimensions also match.
-- These are the safest candidates to review before archiving duplicate asset rows.

\echo 'Exact duplicate active asset candidates'

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
),
duplicate_groups AS (
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
    COUNT(*) AS duplicate_count,
    MIN(assetid) AS keep_assetid
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
)
SELECT
  c.clientname,
  dg.normalized_serial AS serial_no,
  dg.duplicate_count,
  dg.keep_assetid,
  string_agg(a.assetid::text, ', ' ORDER BY a.assetid) AS assetids,
  COALESCE(s.sitename, '-') AS site,
  COALESCE(sec.sectionname, '-') AS section,
  COALESCE(et.description, '-') AS equipment_type,
  MAX(a.description) AS asset_description
FROM duplicate_groups dg
JOIN atec.tblasset a
  ON a.clientid = dg.clientid
 AND lower(trim(a.serialno)) = dg.normalized_serial
 AND COALESCE(a.siteid, 0) = dg.siteid
 AND COALESCE(a.sectionid, 0) = dg.sectionid
 AND COALESCE(a.equiptypeid, 0) = dg.equiptypeid
 AND lower(trim(COALESCE(a.description, ''))) = dg.normalized_description
 AND lower(trim(COALESCE(a.wll::text, ''))) = dg.normalized_wll
 AND lower(trim(COALESCE(a.span::text, ''))) = dg.normalized_span
 AND lower(trim(COALESCE(a.hooksize::text, ''))) = dg.normalized_hooksize
 AND lower(trim(COALESCE(a.heightoflift::text, ''))) = dg.normalized_heightoflift
 AND COALESCE(a.archived, false) = false
JOIN atec.tblclients c
  ON c.clientid = dg.clientid
LEFT JOIN atec.tblsites s
  ON s.siteid = NULLIF(dg.siteid, 0)
LEFT JOIN atec.tblsection sec
  ON sec.sectionid = NULLIF(dg.sectionid, 0)
LEFT JOIN atec.tblequiptype et
  ON et.equiptypeid = NULLIF(dg.equiptypeid, 0)
GROUP BY
  c.clientname,
  dg.normalized_serial,
  dg.duplicate_count,
  dg.keep_assetid,
  s.sitename,
  sec.sectionname,
  et.description
ORDER BY c.clientname, dg.normalized_serial
LIMIT 300;

\echo 'Exact duplicate active asset detail rows'

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
),
duplicate_groups AS (
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
    MIN(assetid) AS keep_assetid
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
)
SELECT
  c.clientname,
  a.assetid,
  CASE WHEN a.assetid = dg.keep_assetid THEN 'KEEP' ELSE 'REVIEW_DUPLICATE' END AS suggested_action,
  a.serialno,
  COALESCE(a.assettagno, '-') AS asset_tag,
  COALESCE(s.sitename, '-') AS site,
  COALESCE(sec.sectionname, '-') AS section,
  COALESCE(et.description, '-') AS equipment_type,
  COALESCE(a.description, '-') AS asset_description,
  COALESCE(a.wll::text, '-') AS wll,
  COALESCE(a.span::text, '-') AS span,
  COALESCE(a.hooksize::text, '-') AS hook_size,
  COALESCE(a.heightoflift::text, '-') AS height_of_lift
FROM duplicate_groups dg
JOIN atec.tblasset a
  ON a.clientid = dg.clientid
 AND lower(trim(a.serialno)) = dg.normalized_serial
 AND COALESCE(a.siteid, 0) = dg.siteid
 AND COALESCE(a.sectionid, 0) = dg.sectionid
 AND COALESCE(a.equiptypeid, 0) = dg.equiptypeid
 AND lower(trim(COALESCE(a.description, ''))) = dg.normalized_description
 AND lower(trim(COALESCE(a.wll::text, ''))) = dg.normalized_wll
 AND lower(trim(COALESCE(a.span::text, ''))) = dg.normalized_span
 AND lower(trim(COALESCE(a.hooksize::text, ''))) = dg.normalized_hooksize
 AND lower(trim(COALESCE(a.heightoflift::text, ''))) = dg.normalized_heightoflift
 AND COALESCE(a.archived, false) = false
JOIN atec.tblclients c
  ON c.clientid = a.clientid
LEFT JOIN atec.tblsites s
  ON s.siteid = a.siteid
LEFT JOIN atec.tblsection sec
  ON sec.sectionid = a.sectionid
LEFT JOIN atec.tblequiptype et
  ON et.equiptypeid = a.equiptypeid
ORDER BY c.clientname, lower(trim(a.serialno)), a.assetid
LIMIT 1000;
