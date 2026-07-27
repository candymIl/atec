BEGIN;

-- The former combined equipment type represents a trestle only. Keep this
-- idempotent because the production description may already have been fixed.
UPDATE atec.tblequiptype
SET description = 'Trestle'
WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
  'engine lifter',
  'trestles / engine lifter',
  'trestles/engine lifter'
);

WITH target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'trestle',
    'trestles'
  )
)
UPDATE atec.tblequiptypecriteria criteria
SET active = false
FROM target_equipment_types target
WHERE criteria.equiptypeid = target.equiptypeid
  AND UPPER(COALESCE(criteria.inspectioncategory, '')) = 'LOADTEST';

WITH target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'trestle',
    'trestles'
  )
)
UPDATE atec.tblequiptypecriteria criteria
SET active = false
FROM target_equipment_types target
WHERE criteria.equiptypeid = target.equiptypeid
  AND UPPER(COALESCE(criteria.inspectioncategory, 'VISUAL')) = 'VISUAL';

WITH criteria_set(displayorder, criteriadescription, fieldtype, resulttype, severity) AS (
  VALUES
    (1, 'Verify the manufacturer identification, trestle serial or batch reference and safe working load (SWL) are permanently marked, legible and match the inspection documentation', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (2, 'Inspect the trestle frame and structural members for cracks, bending, deformation, buckling, excessive wear, impact damage or other defects', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (3, 'Inspect all welds for cracks, separation, corrosion or other defects', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (4, 'Verify all components, joints, locking devices, bracing, bolts and pins are present, correctly assembled, secure and undamaged', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (5, 'Verify the height-adjustment mechanism is secure, operates correctly and cannot be accidentally disturbed by vibration or shock', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (6, 'Inspect the base and feet for damage and verify the trestle stands firm, level and stable without movement, settlement, sinking, tilting or uneven support', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (7, 'Inspect the platform-carrying member and welded end stops for damage, deformation, excessive wear or missing parts', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (8, 'Where boards or a working platform are fitted, verify they are correctly supported and secured against slipping, with no unsafe or excessive overhang', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (9, 'Inspect for evidence of overloading, misuse, unauthorized alteration or stacking beyond the trestle design and safe working load', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (10, 'Inspect the protective surface finish and verify corrosion has not reduced the strength or safe use of the trestle', 'PASS_FAIL', 'PASS_FAIL', 'MAJOR'),
    (11, 'Record defects, impact or weather damage, repairs, corrective actions, observations or recommendations', 'TEXT', 'PASS_FAIL', 'MAJOR'),
    (12, 'Confirm the trestle is structurally sound, stable, complete and SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL')
),
target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'trestle',
    'trestles'
  )
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
  target.equiptypeid,
  source.criteriadescription,
  source.criteriadescription,
  source.fieldtype,
  source.resulttype,
  true,
  source.displayorder,
  source.displayorder,
  'VISUAL',
  'FREQUENT_INSPECTION',
  source.severity,
  true
FROM target_equipment_types target
CROSS JOIN criteria_set source
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptypecriteria existing
  WHERE existing.equiptypeid = target.equiptypeid
    AND UPPER(COALESCE(existing.inspectioncategory, 'VISUAL')) = 'VISUAL'
    AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) =
        LOWER(source.criteriadescription)
);

WITH criteria_set(displayorder, criteriadescription, fieldtype, resulttype, severity) AS (
  VALUES
    (1, 'Verify the manufacturer identification, trestle serial or batch reference and safe working load (SWL) are permanently marked, legible and match the inspection documentation', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (2, 'Inspect the trestle frame and structural members for cracks, bending, deformation, buckling, excessive wear, impact damage or other defects', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (3, 'Inspect all welds for cracks, separation, corrosion or other defects', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (4, 'Verify all components, joints, locking devices, bracing, bolts and pins are present, correctly assembled, secure and undamaged', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (5, 'Verify the height-adjustment mechanism is secure, operates correctly and cannot be accidentally disturbed by vibration or shock', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (6, 'Inspect the base and feet for damage and verify the trestle stands firm, level and stable without movement, settlement, sinking, tilting or uneven support', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (7, 'Inspect the platform-carrying member and welded end stops for damage, deformation, excessive wear or missing parts', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (8, 'Where boards or a working platform are fitted, verify they are correctly supported and secured against slipping, with no unsafe or excessive overhang', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (9, 'Inspect for evidence of overloading, misuse, unauthorized alteration or stacking beyond the trestle design and safe working load', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (10, 'Inspect the protective surface finish and verify corrosion has not reduced the strength or safe use of the trestle', 'PASS_FAIL', 'PASS_FAIL', 'MAJOR'),
    (11, 'Record defects, impact or weather damage, repairs, corrective actions, observations or recommendations', 'TEXT', 'PASS_FAIL', 'MAJOR'),
    (12, 'Confirm the trestle is structurally sound, stable, complete and SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL')
),
target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'trestle',
    'trestles'
  )
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
  inspectioncategory = 'VISUAL',
  inspection_category = 'FREQUENT_INSPECTION',
  severity = source.severity,
  active = true
FROM target_equipment_types target
CROSS JOIN criteria_set source
WHERE existing.equiptypeid = target.equiptypeid
  AND UPPER(COALESCE(existing.inspectioncategory, 'VISUAL')) = 'VISUAL'
  AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) =
      LOWER(source.criteriadescription);

WITH criteria_set(displayorder, criteriadescription, fieldtype, resulttype, severity) AS (
  VALUES
    (1, 'Verify the manufacturer identification, trestle serial or batch reference and safe working load (SWL) are permanently marked, legible and match the test documentation', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (2, 'Verify the trestle design and dimensions comply with SANS 1854 clause 4, including a maximum height of 2.35 m, adjustment increments not exceeding 250 mm, secure height adjustment, correctly sized platform-carrying member and end stops at least 30 mm high', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (3, 'Inspect the frame, members, welds, connections, locking devices and bracing for cracks, deformation, buckling, excessive wear, corrosion, missing parts or other defects, and verify the protective surface finish is serviceable', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (4, 'Verify the trestle is erected on a firm level base and is stable; for a rectangular base, the smallest base dimension measured centre-to-centre is at least 0.34 times the maximum height', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (5, 'Record the quoted safe working load (SWL) in kN and verify it is not less than the SANS 1854 minimum of 8 kN', 'NUMBER', 'MEASURED', 'CRITICAL'),
    (6, 'Erect the trestle at maximum height and 1 degree 30 minutes out of plumb without wedges or packing; when testing multiples, incline them in the same direction and connect their tops with rigid load-distribution members', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (7, 'Record the required test load in kN; it must be at least twice the quoted SWL and not less than 16 kN', 'NUMBER', 'MEASURED', 'CRITICAL'),
    (8, 'Verify the test load is divided evenly and applied through rigid bearing pads 75 mm long, 5 mm thick and at least as wide as the trestle platform-carrying member bearing surface', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (9, 'Apply the axial compression load at no more than 5 kN per minute with the top and bottom of the trestle unrestrained from lateral movement', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (10, 'Verify and record that the trestle withstands toppling during the stability test, including inspection observations at 10 kN', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (11, 'Record the final test load in kN', 'NUMBER', 'MEASURED', 'CRITICAL'),
    (12, 'Record the trestle performance at the final load, including deformation, defects, corrective action, failure mode and the location of any failure', 'TEXT', 'PASS_FAIL', 'MAJOR'),
    (13, 'After removing the test load, verify there is no structural damage, instability or missing component and confirm the trestle is SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL')
),
target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'trestle',
    'trestles'
  )
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
  target.equiptypeid,
  source.criteriadescription,
  source.criteriadescription,
  source.fieldtype,
  source.resulttype,
  true,
  source.displayorder,
  source.displayorder,
  'LOADTEST',
  'PERIODIC_THOROUGH_INSPECTION',
  source.severity,
  true
FROM target_equipment_types target
CROSS JOIN criteria_set source
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptypecriteria existing
  WHERE existing.equiptypeid = target.equiptypeid
    AND UPPER(COALESCE(existing.inspectioncategory, '')) = 'LOADTEST'
    AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) =
        LOWER(source.criteriadescription)
);

WITH criteria_set(displayorder, criteriadescription, fieldtype, resulttype, severity) AS (
  VALUES
    (1, 'Verify the manufacturer identification, trestle serial or batch reference and safe working load (SWL) are permanently marked, legible and match the test documentation', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (2, 'Verify the trestle design and dimensions comply with SANS 1854 clause 4, including a maximum height of 2.35 m, adjustment increments not exceeding 250 mm, secure height adjustment, correctly sized platform-carrying member and end stops at least 30 mm high', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (3, 'Inspect the frame, members, welds, connections, locking devices and bracing for cracks, deformation, buckling, excessive wear, corrosion, missing parts or other defects, and verify the protective surface finish is serviceable', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (4, 'Verify the trestle is erected on a firm level base and is stable; for a rectangular base, the smallest base dimension measured centre-to-centre is at least 0.34 times the maximum height', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (5, 'Record the quoted safe working load (SWL) in kN and verify it is not less than the SANS 1854 minimum of 8 kN', 'NUMBER', 'MEASURED', 'CRITICAL'),
    (6, 'Erect the trestle at maximum height and 1 degree 30 minutes out of plumb without wedges or packing; when testing multiples, incline them in the same direction and connect their tops with rigid load-distribution members', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (7, 'Record the required test load in kN; it must be at least twice the quoted SWL and not less than 16 kN', 'NUMBER', 'MEASURED', 'CRITICAL'),
    (8, 'Verify the test load is divided evenly and applied through rigid bearing pads 75 mm long, 5 mm thick and at least as wide as the trestle platform-carrying member bearing surface', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (9, 'Apply the axial compression load at no more than 5 kN per minute with the top and bottom of the trestle unrestrained from lateral movement', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (10, 'Verify and record that the trestle withstands toppling during the stability test, including inspection observations at 10 kN', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
    (11, 'Record the final test load in kN', 'NUMBER', 'MEASURED', 'CRITICAL'),
    (12, 'Record the trestle performance at the final load, including deformation, defects, corrective action, failure mode and the location of any failure', 'TEXT', 'PASS_FAIL', 'MAJOR'),
    (13, 'After removing the test load, verify there is no structural damage, instability or missing component and confirm the trestle is SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL')
),
target_equipment_types AS (
  SELECT equiptypeid
  FROM atec.tblequiptype
  WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) IN (
    'trestle',
    'trestles'
  )
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
CROSS JOIN criteria_set source
WHERE existing.equiptypeid = target.equiptypeid
  AND UPPER(COALESCE(existing.inspectioncategory, '')) = 'LOADTEST'
  AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) =
      LOWER(source.criteriadescription);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM atec.tblequiptype
    WHERE LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) LIKE '%engine lifter%'
  ) THEN
    RAISE EXCEPTION 'Engine lifter must not remain in the trestle equipment-type description';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atec.tblequiptype equipment_type
    WHERE LOWER(REGEXP_REPLACE(TRIM(equipment_type.description), '\s+', ' ', 'g')) IN (
      'trestle',
      'trestles'
    )
      AND (
        SELECT COUNT(*)
        FROM atec.tblequiptypecriteria criteria
        WHERE criteria.equiptypeid = equipment_type.equiptypeid
          AND UPPER(COALESCE(criteria.inspectioncategory, '')) = 'LOADTEST'
          AND criteria.active = true
      ) <> 13
  ) THEN
    RAISE EXCEPTION 'Every trestle equipment type must have exactly 13 active SANS 1854 load-test criteria';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atec.tblequiptype equipment_type
    WHERE LOWER(REGEXP_REPLACE(TRIM(equipment_type.description), '\s+', ' ', 'g')) IN (
      'trestle',
      'trestles'
    )
      AND (
        SELECT COUNT(*)
        FROM atec.tblequiptypecriteria criteria
        WHERE criteria.equiptypeid = equipment_type.equiptypeid
          AND UPPER(COALESCE(criteria.inspectioncategory, 'VISUAL')) = 'VISUAL'
          AND criteria.active = true
      ) <> 12
  ) THEN
    RAISE EXCEPTION 'Every trestle equipment type must have exactly 12 active SANS 1854 visual-inspection criteria';
  END IF;
END $$;

COMMIT;
