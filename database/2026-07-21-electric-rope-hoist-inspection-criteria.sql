BEGIN;

-- Equipment type 105: Hoists - Electric rope hoist.
-- VISUAL rows are frequent inspections; LOADTEST rows are periodic thorough
-- inspections and performance tests.
CREATE TEMP TABLE electric_rope_hoist_criteria (
  inspectioncategory text,
  inspection_category text,
  displayorder integer,
  criteriadescription text,
  fieldtype text,
  resulttype text,
  severity text
) ON COMMIT DROP;

INSERT INTO electric_rope_hoist_criteria VALUES
  ('VISUAL', 'FREQUENT_INSPECTION', 1, 'Verify the rated capacity, equipment identification and warning labels are present and legible', 'PASS_FAIL', 'PASS_FAIL', 'MAJOR'),
  ('VISUAL', 'FREQUENT_INSPECTION', 2, 'Inspect the hoist body, covers and supporting connection for cracks, corrosion, deformation or damage', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 3, 'Inspect the top and bottom hooks for cracks, wear, twisting, deformation or excessive throat opening', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 4, 'Verify all hook safety latches are fitted, functional and undamaged', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 5, 'Inspect the wire rope for broken wires, corrosion, flattening, kinking, crushing, bird-caging, heat damage or abnormal wear', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 6, 'Verify the wire rope is correctly reeved and seated in the drum and sheave grooves', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 7, 'Inspect accessible rope terminations, anchors, wedges, sockets and clamps for security or damage', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 8, 'Inspect the drum, rope guide and accessible sheaves for damage, excessive wear or abnormal operation', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 9, 'Verify the hoisting brake operates correctly and holds the load without slipping or uncontrolled lowering', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 10, 'Verify hoisting and lowering motions operate smoothly without abnormal noise, vibration or overheating', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 11, 'Verify the upper and lower limit devices operate correctly, testing the upper limit with an unloaded hook', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 12, 'Inspect the pendant or remote control, emergency stop and control labels for correct operation and damage', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 13, 'Inspect accessible electrical cables, plugs, glands, enclosures and connections for damage or exposed conductors', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('VISUAL', 'FREQUENT_INSPECTION', 14, 'Where trolley-mounted, inspect trolley wheels, side plates, stops and travel operation for damage or abnormal movement', 'PASS_FAIL', 'PASS_FAIL', 'MAJOR'),
  ('VISUAL', 'FREQUENT_INSPECTION', 15, 'Verify all accessible nuts, bolts, pins and fasteners are present and secure', 'PASS_FAIL', 'PASS_FAIL', 'MAJOR'),
  ('VISUAL', 'FREQUENT_INSPECTION', 16, 'Record defects, observations or recommended corrective action', 'TEXT', 'PASS_FAIL', 'MINOR'),
  ('VISUAL', 'FREQUENT_INSPECTION', 17, 'SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL');

INSERT INTO electric_rope_hoist_criteria VALUES
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 1, 'Enter the measured top hook throat opening in millimetres', 'NUMBER', 'MEASURED', 'MAJOR'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 2, 'Enter the measured bottom hook throat opening in millimetres', 'NUMBER', 'MEASURED', 'MAJOR'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 3, 'Enter the measured wire-rope diameter in millimetres', 'NUMBER', 'MEASURED', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 4, 'Inspect hooks, swivels, bearings and safety latches for wear, cracks, deformation or damage', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 5, 'Thoroughly inspect the full accessible wire-rope length and record any deterioration', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 6, 'Inspect rope terminations, drum anchorage, sockets, wedges and clamps for security and damage', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 7, 'Inspect the rope drum, grooves, flanges and rope guide for wear, cracks or damage', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 8, 'Inspect sheaves, grooves, bearings, shafts and rope-retaining guards', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 9, 'Verify correct reeving and equal rope tension where multiple rope parts are used', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 10, 'Inspect the hoist frame, body, covers, suspension connection and load-bearing structure', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 11, 'Inspect the gearbox, couplings and bearings for wear, leakage or abnormal operation', 'PASS_FAIL', 'PASS_FAIL', 'MAJOR'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 12, 'Inspect and functionally test the hoisting brake and load-holding system', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 13, 'Inspect the motor, electrical equipment, contactors, cables, earthing and enclosures', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 14, 'Test the pendant or remote controls, emergency stop and operating-direction markings', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 15, 'Test the upper and lower limit devices without a test load on the hook', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 16, 'Where fitted, inspect and test the overload limiter or load-limiting device', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 17, 'Where trolley-mounted, inspect and test trolley wheels, travel mechanism, stops and brakes', 'PASS_FAIL', 'PASS_FAIL', 'MAJOR'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 18, 'Confirm the hoist is suitable and safe to proceed with the performance test', 'YESNO', 'YES_NO', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 19, 'Enter the load-cell serial or identification number', 'TEXT', 'PASS_FAIL', 'MINOR'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 20, 'Enter the load-cell calibration certificate number and expiry date', 'TEXT', 'PASS_FAIL', 'MAJOR'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 21, 'Enter the hoist safe working load in kilograms', 'NUMBER', 'MEASURED', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 22, 'Enter the applicable proof-load percentage', 'NUMBER', 'MEASURED', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 23, 'Enter the maximum proof load applied in kilograms', 'NUMBER', 'MEASURED', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 24, 'Verify the hoist lifts, holds and lowers the test load without slipping or uncontrolled movement', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 25, 'Verify the brake holds the suspended test load securely', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 26, 'Where fitted and authorised for testing, verify the overload limiter operates at the approved setting', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 27, 'Perform a post-test inspection for permanent deformation, rope movement, cracking, damage or malfunction', 'PASS_FAIL', 'PASS_FAIL', 'CRITICAL'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 28, 'Record defects, repairs, observations or recommendations', 'TEXT', 'PASS_FAIL', 'MINOR'),
  ('LOADTEST', 'PERIODIC_THOROUGH_INSPECTION', 29, 'SAFE FOR CONTINUED OPERATION', 'YESNO', 'YES_NO', 'CRITICAL');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM atec.tblequiptype
    WHERE equiptypeid = 105
      AND LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) = 'hoists - electric rope hoist'
  ) THEN
    RAISE EXCEPTION 'Equipment type 105 is not Hoists - Electric rope hoist';
  END IF;
END $$;

INSERT INTO atec.tblequiptypecriteria (
  equiptypeid, criterianame, criteriadescription, fieldtype, resulttype,
  required, sortorder, displayorder, inspectioncategory,
  inspection_category, severity, active
)
SELECT
  105, source.criteriadescription, source.criteriadescription,
  source.fieldtype, source.resulttype, true, source.displayorder,
  source.displayorder, source.inspectioncategory, source.inspection_category,
  source.severity, true
FROM electric_rope_hoist_criteria source
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptypecriteria existing
  WHERE existing.equiptypeid = 105
    AND UPPER(COALESCE(existing.inspectioncategory, '')) = source.inspectioncategory
    AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) = LOWER(source.criteriadescription)
);

UPDATE atec.tblequiptypecriteria existing
SET
  criterianame = source.criteriadescription,
  criteriadescription = source.criteriadescription,
  fieldtype = source.fieldtype,
  resulttype = source.resulttype,
  required = true,
  sortorder = source.displayorder,
  displayorder = source.displayorder,
  inspectioncategory = source.inspectioncategory,
  inspection_category = source.inspection_category,
  severity = source.severity,
  active = true
FROM electric_rope_hoist_criteria source
WHERE existing.equiptypeid = 105
  AND UPPER(COALESCE(existing.inspectioncategory, '')) = source.inspectioncategory
  AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) = LOWER(source.criteriadescription);

DO $$
DECLARE
  visual_count integer;
  loadtest_count integer;
BEGIN
  SELECT COUNT(*) INTO visual_count
  FROM atec.tblequiptypecriteria
  WHERE equiptypeid = 105 AND COALESCE(active, true) AND inspectioncategory = 'VISUAL';

  SELECT COUNT(*) INTO loadtest_count
  FROM atec.tblequiptypecriteria
  WHERE equiptypeid = 105 AND COALESCE(active, true) AND inspectioncategory = 'LOADTEST';

  IF visual_count <> 17 OR loadtest_count <> 29 THEN
    RAISE EXCEPTION 'Expected 17 VISUAL and 29 LOADTEST criteria for equipment type 105; found % and %', visual_count, loadtest_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM atec.tblequiptypecriteria
    WHERE equiptypeid = 105 AND COALESCE(active, true)
      AND ((inspectioncategory = 'VISUAL' AND inspection_category <> 'FREQUENT_INSPECTION')
        OR (inspectioncategory = 'LOADTEST' AND inspection_category <> 'PERIODIC_THOROUGH_INSPECTION'))
  ) THEN
    RAISE EXCEPTION 'Electric rope hoist criteria contain an incorrect inspection category';
  END IF;
END $$;

COMMIT;
