BEGIN;

WITH target_types(equiptypeid) AS (
  VALUES (401), (402), (404), (406)
),
next_orders AS (
  SELECT
    target_types.equiptypeid,
    COALESCE(MAX(COALESCE(c.displayorder, c.sortorder, 0)), 0) + 1 AS next_order
  FROM target_types
  LEFT JOIN atec.tblequiptypecriteria c
    ON c.equiptypeid = target_types.equiptypeid
  GROUP BY target_types.equiptypeid
)
INSERT INTO atec.tblequiptypecriteria
(
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
  next_orders.equiptypeid,
  'Any Additional Comments/Recommendations',
  'Any Additional Comments/Recommendations',
  'TEXT',
  'PASS_FAIL',
  false,
  next_orders.next_order,
  next_orders.next_order,
  'VISUAL',
  'PERIODIC_THOROUGH_INSPECTION',
  'MINOR',
  true
FROM next_orders
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptypecriteria existing
  WHERE existing.equiptypeid = next_orders.equiptypeid
    AND LOWER(COALESCE(existing.criterianame, '')) = LOWER('Any Additional Comments/Recommendations')
    AND COALESCE(existing.inspectioncategory, '') = 'VISUAL'
);

COMMIT;
