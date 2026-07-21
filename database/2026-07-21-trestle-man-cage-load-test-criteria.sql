BEGIN;

WITH criteria_sets(equipment_group, displayorder, criteriadescription, fieldtype, resulttype, severity) AS (
  VALUES
    ('TRESTLE', 1, 'Verify equipment identification and rated capacity/WLL markings are present, legible and match the load-test record', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('TRESTLE', 2, 'Record the required test load and the SWL/test load actually lifted', 'NUMBER', 'MEASURED', 'CRITICAL'),
    ('TRESTLE', 3, 'Verify the frame, legs, boom or mast, welds, pins, hook and load-support points are correctly positioned, secured and locked before applying the test load', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('TRESTLE', 4, 'Apply the test load steadily in the intended working configuration and verify the unit remains stable, aligned and free from abnormal movement or deformation', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('TRESTLE', 5, 'Hold the test load for the prescribed duration and verify there is no settlement, load drift, hydraulic pressure loss, leakage, cracking or structural distress', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('TRESTLE', 6, 'After removing the load, verify there is no permanent deformation or damage and confirm the unit is SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL'),
    ('MAN_CAGE', 1, 'Verify equipment identification, rated capacity/WLL and maximum-person markings are present, legible and match the load-test record', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('MAN_CAGE', 2, 'Record the required test load and the SWL/test load actually lifted', 'NUMBER', 'MEASURED', 'CRITICAL'),
    ('MAN_CAGE', 3, 'Verify the suspension and lifting points, structure, welds, floor, guardrails, gate, locking devices and personnel anchorages are secured before applying the test load', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('MAN_CAGE', 4, 'Apply and distribute the test load in the prescribed positions and verify the cage or chair remains stable, level and free from abnormal movement or deformation', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('MAN_CAGE', 5, 'Hold the test load for the prescribed duration and verify there is no excessive deflection, slipping, cracking, weld failure or movement at suspension points', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('MAN_CAGE', 6, 'After removing the load, verify there is no permanent deformation or damage and confirm the unit is SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL')
),
target_equipment_types AS (
  SELECT
    equiptypeid,
    CASE
      WHEN LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
        'trestle', 'trestles', 'engine lifter', 'trestles / engine lifter', 'trestles/engine lifter'
      ) THEN 'TRESTLE'
      WHEN LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
        'man cage', 'man cages', 'boatswain chair', 'boatswain chairs',
        'man cage / boatswain chair', 'man cage/boatswain chair'
      ) THEN 'MAN_CAGE'
    END AS equipment_group
  FROM atec.tblequiptype
)
INSERT INTO atec.tblequiptypecriteria (
  equiptypeid, criterianame, criteriadescription, fieldtype, resulttype,
  required, sortorder, displayorder, inspectioncategory,
  inspection_category, severity, active
)
SELECT
  target.equiptypeid, source.criteriadescription, source.criteriadescription,
  source.fieldtype, source.resulttype, true, source.displayorder, source.displayorder,
  'LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', source.severity, true
FROM target_equipment_types target
JOIN criteria_sets source ON source.equipment_group = target.equipment_group
WHERE target.equipment_group IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM atec.tblequiptypecriteria existing
    WHERE existing.equiptypeid = target.equiptypeid
      AND UPPER(COALESCE(existing.inspectioncategory, '')) = 'LOADTEST'
      AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) = LOWER(source.criteriadescription)
  );

WITH criteria_sets(equipment_group, displayorder, criteriadescription, fieldtype, resulttype, severity) AS (
  VALUES
    ('TRESTLE', 1, 'Verify equipment identification and rated capacity/WLL markings are present, legible and match the load-test record', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('TRESTLE', 2, 'Record the required test load and the SWL/test load actually lifted', 'NUMBER', 'MEASURED', 'CRITICAL'),
    ('TRESTLE', 3, 'Verify the frame, legs, boom or mast, welds, pins, hook and load-support points are correctly positioned, secured and locked before applying the test load', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('TRESTLE', 4, 'Apply the test load steadily in the intended working configuration and verify the unit remains stable, aligned and free from abnormal movement or deformation', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('TRESTLE', 5, 'Hold the test load for the prescribed duration and verify there is no settlement, load drift, hydraulic pressure loss, leakage, cracking or structural distress', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('TRESTLE', 6, 'After removing the load, verify there is no permanent deformation or damage and confirm the unit is SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL'),
    ('MAN_CAGE', 1, 'Verify equipment identification, rated capacity/WLL and maximum-person markings are present, legible and match the load-test record', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('MAN_CAGE', 2, 'Record the required test load and the SWL/test load actually lifted', 'NUMBER', 'MEASURED', 'CRITICAL'),
    ('MAN_CAGE', 3, 'Verify the suspension and lifting points, structure, welds, floor, guardrails, gate, locking devices and personnel anchorages are secured before applying the test load', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('MAN_CAGE', 4, 'Apply and distribute the test load in the prescribed positions and verify the cage or chair remains stable, level and free from abnormal movement or deformation', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('MAN_CAGE', 5, 'Hold the test load for the prescribed duration and verify there is no excessive deflection, slipping, cracking, weld failure or movement at suspension points', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    ('MAN_CAGE', 6, 'After removing the load, verify there is no permanent deformation or damage and confirm the unit is SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL')
),
target_equipment_types AS (
  SELECT
    equiptypeid,
    CASE
      WHEN LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
        'trestle', 'trestles', 'engine lifter', 'trestles / engine lifter', 'trestles/engine lifter'
      ) THEN 'TRESTLE'
      WHEN LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
        'man cage', 'man cages', 'boatswain chair', 'boatswain chairs',
        'man cage / boatswain chair', 'man cage/boatswain chair'
      ) THEN 'MAN_CAGE'
    END AS equipment_group
  FROM atec.tblequiptype
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
  inspection_category = 'PERIODIC_THOROUGH_INSPECTION',
  severity = source.severity,
  active = true
FROM target_equipment_types target
JOIN criteria_sets source ON source.equipment_group = target.equipment_group
WHERE existing.equiptypeid = target.equiptypeid
  AND UPPER(COALESCE(existing.inspectioncategory, '')) = 'LOADTEST'
  AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) = LOWER(source.criteriadescription);

COMMIT;
