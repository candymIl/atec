BEGIN;

WITH target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'trolley jack',
    'pallet jack',
    'trolley jack / pallet jack',
    'trolley jack/pallet jack'
  )
),
criteria_rows(displayorder, criteriadescription, fieldtype, resulttype, severity) AS (
  VALUES
    (1, 'Verify the equipment identification and rated capacity/WLL markings are present, legible and match the test record', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (2, 'Record the required test load and actual applied test load', 'NUMBER', 'MEASURED', 'CRITICAL'),
    (3, 'Raise the test load through the intended operating range and verify lifting is smooth, controlled and satisfactory', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (4, 'Hold the test load for the prescribed duration and verify there is no load drift, hydraulic pressure loss, leakage or unintended lowering', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (5, 'Lower and release the test load smoothly and verify the controls, release mechanism and safety devices operate correctly', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (6, 'SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL')
)
INSERT INTO atec.tblequiptypecriteria
(
  equiptypeid, criterianame, criteriadescription, fieldtype, resulttype,
  required, sortorder, displayorder, inspectioncategory,
  inspection_category, severity, active
)
SELECT
  target.equiptypeid, source.criteriadescription, source.criteriadescription,
  source.fieldtype, source.resulttype, true, source.displayorder,
  source.displayorder, 'LOADTEST', 'FREQUENT_INSPECTION', source.severity, true
FROM target_equipment_types target
CROSS JOIN criteria_rows source
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptypecriteria existing
  WHERE existing.equiptypeid = target.equiptypeid
    AND COALESCE(existing.inspectioncategory, '') = 'LOADTEST'
    AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) = LOWER(source.criteriadescription)
);

WITH target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'trolley jack', 'pallet jack', 'trolley jack / pallet jack', 'trolley jack/pallet jack'
  )
),
criteria_rows(displayorder, criteriadescription, fieldtype, resulttype, severity) AS (
  VALUES
    (1, 'Verify the equipment identification and rated capacity/WLL markings are present, legible and match the test record', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (2, 'Record the required test load and actual applied test load', 'NUMBER', 'MEASURED', 'CRITICAL'),
    (3, 'Raise the test load through the intended operating range and verify lifting is smooth, controlled and satisfactory', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (4, 'Hold the test load for the prescribed duration and verify there is no load drift, hydraulic pressure loss, leakage or unintended lowering', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (5, 'Lower and release the test load smoothly and verify the controls, release mechanism and safety devices operate correctly', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (6, 'SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL')
)
UPDATE atec.tblequiptypecriteria existing
SET
  criterianame = source.criteriadescription,
  criteriadescription = source.criteriadescription,
  fieldtype = source.fieldtype,
  resulttype = source.resulttype,
  required = true,
  sortorder = source.displayorder,
  displayorder = source.displayorder,
  inspectioncategory = 'LOADTEST',
  inspection_category = 'FREQUENT_INSPECTION',
  severity = source.severity,
  active = true
FROM target_equipment_types target
CROSS JOIN criteria_rows source
WHERE existing.equiptypeid = target.equiptypeid
  AND COALESCE(existing.inspectioncategory, '') = 'LOADTEST'
  AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) = LOWER(source.criteriadescription);

COMMIT;
