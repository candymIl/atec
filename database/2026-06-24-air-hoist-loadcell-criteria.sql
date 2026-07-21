BEGIN;

UPDATE atec.tblequiptypecriteria
SET
  sortorder = sortorder + 1,
  displayorder = COALESCE(displayorder, sortorder) + 1
WHERE equiptypeid = 103
  AND inspectioncategory = 'LOADTEST'
  AND COALESCE(displayorder, sortorder, criteriaid) >= 17
  AND NOT EXISTS (
    SELECT 1
    FROM atec.tblequiptypecriteria existing
    WHERE existing.equiptypeid = 103
      AND existing.inspectioncategory = 'LOADTEST'
      AND lower(existing.criterianame) IN ('loadcell number', 'load cell number')
  );

INSERT INTO atec.tblequiptypecriteria
(
  equiptypeid,
  criterianame,
  criteriadescription,
  fieldtype,
  resulttype,
  inspectioncategory,
  inspection_category,
  severity,
  required,
  active,
  sortorder,
  displayorder
)
SELECT
  103,
  'Loadcell Number',
  'Loadcell Number',
  'NUMBER',
  'MEASURED',
  'LOADTEST',
  'PERIODIC_THOROUGH_INSPECTION',
  'MINOR',
  true,
  true,
  16,
  16
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptypecriteria existing
  WHERE existing.equiptypeid = 103
    AND existing.inspectioncategory = 'LOADTEST'
    AND lower(existing.criterianame) IN ('loadcell number', 'load cell number')
);

COMMIT;
