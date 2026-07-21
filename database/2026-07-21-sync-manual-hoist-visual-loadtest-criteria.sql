BEGIN;

-- Keep the existing VISUAL criteria IDs so historical inspection result links
-- remain intact. LOADTEST is the canonical checklist for these two types.
WITH target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'hoists - manual chain hoist',
    'hoists - manual lever hoist'
  )
),
source AS (
  SELECT DISTINCT ON (c.equiptypeid, COALESCE(c.displayorder, c.sortorder, c.criteriaid))
    c.equiptypeid,
    c.criterianame,
    c.criteriadescription,
    c.fieldtype,
    c.resulttype,
    c.required,
    c.sortorder,
    c.displayorder,
    c.inspection_category,
    c.severity,
    COALESCE(c.displayorder, c.sortorder, c.criteriaid) AS effective_order
  FROM atec.tblequiptypecriteria c
  JOIN target_equipment_types target ON target.equiptypeid = c.equiptypeid
  WHERE UPPER(COALESCE(c.inspectioncategory, '')) = 'LOADTEST'
    AND COALESCE(c.active, true) = true
  ORDER BY c.equiptypeid,
    COALESCE(c.displayorder, c.sortorder, c.criteriaid),
    c.criteriaid
)
UPDATE atec.tblequiptypecriteria visual
SET
  criterianame = source.criterianame,
  criteriadescription = source.criteriadescription,
  fieldtype = source.fieldtype,
  resulttype = source.resulttype,
  required = source.required,
  sortorder = source.sortorder,
  displayorder = source.displayorder,
  inspectioncategory = 'VISUAL',
  inspection_category = source.inspection_category,
  severity = source.severity,
  active = true
FROM source
WHERE visual.equiptypeid = source.equiptypeid
  AND UPPER(COALESCE(visual.inspectioncategory, 'VISUAL')) = 'VISUAL'
  AND COALESCE(visual.displayorder, visual.sortorder, visual.criteriaid) = source.effective_order;

WITH target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'hoists - manual chain hoist',
    'hoists - manual lever hoist'
  )
),
source AS (
  SELECT DISTINCT ON (c.equiptypeid, COALESCE(c.displayorder, c.sortorder, c.criteriaid))
    c.equiptypeid,
    c.criterianame,
    c.criteriadescription,
    c.fieldtype,
    c.resulttype,
    c.required,
    c.sortorder,
    c.displayorder,
    c.inspection_category,
    c.severity,
    COALESCE(c.displayorder, c.sortorder, c.criteriaid) AS effective_order
  FROM atec.tblequiptypecriteria c
  JOIN target_equipment_types target ON target.equiptypeid = c.equiptypeid
  WHERE UPPER(COALESCE(c.inspectioncategory, '')) = 'LOADTEST'
    AND COALESCE(c.active, true) = true
  ORDER BY c.equiptypeid,
    COALESCE(c.displayorder, c.sortorder, c.criteriaid),
    c.criteriaid
)
INSERT INTO atec.tblequiptypecriteria (
  equiptypeid,
  criterianame,
  criteriadescription,
  fieldtype,
  resulttype,
  required,
  sortorder,
  displayorder,
  inspectioncategory,
  inspection_category,
  severity,
  active
)
SELECT
  source.equiptypeid,
  source.criterianame,
  source.criteriadescription,
  source.fieldtype,
  source.resulttype,
  source.required,
  source.sortorder,
  source.displayorder,
  'VISUAL',
  source.inspection_category,
  source.severity,
  true
FROM source
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptypecriteria visual
  WHERE visual.equiptypeid = source.equiptypeid
    AND UPPER(COALESCE(visual.inspectioncategory, 'VISUAL')) = 'VISUAL'
    AND COALESCE(visual.displayorder, visual.sortorder, visual.criteriaid) = source.effective_order
);

COMMIT;
