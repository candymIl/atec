-- ATEC Work Package 2 read-only inspection integrity diagnostics.
-- Approved test target: atlas.febserver.com:5432 / fbcranes / schema atec.
-- This script classifies inspections with no result rows and checks equipment
-- types used by active assets that have no active criteria.

WITH no_result AS (
  SELECT
    i.testid,
    i.assetid,
    a.equiptypeid,
    i.inspectiontype,
    i.testdate,
    COALESCE(i.inspector_name, i.inspector) AS inspector,
    i.status,
    i.inspector_lmi_number,
    i.inspector_signature_image,
    EXISTS (
      SELECT 1
      FROM atec.tblinspectionphoto p
      WHERE p.testid = i.testid
    ) AS has_photos,
    EXISTS (
      SELECT 1
      FROM atec.tblinspection newer
      WHERE newer.assetid = i.assetid
        AND newer.inspectiontype = i.inspectiontype
        AND (newer.testdate, newer.testid) > (i.testdate, i.testid)
        AND EXISTS (
          SELECT 1
          FROM atec.tblinspectionresult nr
          WHERE nr.testid = newer.testid
        )
    ) AS superseded_by_completed,
    EXISTS (
      SELECT 1
      FROM atec.tblinspection dupe
      WHERE dupe.assetid = i.assetid
        AND dupe.inspectiontype = i.inspectiontype
        AND dupe.testdate = i.testdate
        AND dupe.testid <> i.testid
        AND EXISTS (
          SELECT 1
          FROM atec.tblinspectionresult dr
          WHERE dr.testid = dupe.testid
        )
    ) AS duplicate_completed_same_day
  FROM atec.tblinspection i
  LEFT JOIN atec.tblasset a
    ON a.assetid = i.assetid
  WHERE NOT EXISTS (
    SELECT 1
    FROM atec.tblinspectionresult r
    WHERE r.testid = i.testid
  )
),
classified AS (
  SELECT
    *,
    CASE
      WHEN duplicate_completed_same_day THEN 'D - Duplicate Shell'
      WHEN superseded_by_completed
        AND (COALESCE(inspector_signature_image, '') = '' OR COALESCE(inspector_lmi_number, '') = '')
        THEN 'B - Cancelled or Abandoned'
      WHEN COALESCE(inspector, '') <> ''
        OR has_photos
        OR status IN ('SAFE', 'NOT SAFE')
        THEN 'A - Draft or Incomplete'
      ELSE 'F - Unknown'
    END AS classification
  FROM no_result
)
SELECT classification, COUNT(*)::int AS inspection_count
FROM classified
GROUP BY classification
ORDER BY classification;

WITH active_asset_equipment_types AS (
  SELECT DISTINCT a.equiptypeid
  FROM atec.tblasset a
  WHERE COALESCE(a.archived, false) = false
    AND a.equiptypeid IS NOT NULL
)
SELECT
  et.equiptypeid,
  et.description,
  COUNT(DISTINCT a.assetid)::int AS active_assets,
  COUNT(DISTINCT c.criteriaid)::int AS active_criteria,
  COUNT(DISTINCT i.testid)::int AS inspections
FROM active_asset_equipment_types used_type
JOIN atec.tblequiptype et
  ON et.equiptypeid = used_type.equiptypeid
LEFT JOIN atec.tblasset a
  ON a.equiptypeid = et.equiptypeid
 AND COALESCE(a.archived, false) = false
LEFT JOIN atec.tblequiptypecriteria c
  ON c.equiptypeid = et.equiptypeid
 AND COALESCE(c.active, true) = true
LEFT JOIN atec.tblinspection i
  ON i.assetid = a.assetid
GROUP BY et.equiptypeid, et.description
HAVING COUNT(DISTINCT c.criteriaid) = 0
ORDER BY et.equiptypeid;
