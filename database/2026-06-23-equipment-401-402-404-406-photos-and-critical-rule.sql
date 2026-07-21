-- ATEC overhead crane criteria, inspection severity/category fields, and inspection photos.
-- Criteria are applied to equipment type IDs 401, 402, 404, and 406.
-- Run this script against the PostgreSQL database that contains the atec schema.
-- It is written to be repeatable: existing columns/rows are left in place.

BEGIN;

ALTER TABLE atec.tblequiptypecriteria
  ADD COLUMN IF NOT EXISTS criteriadescription text,
  ADD COLUMN IF NOT EXISTS resulttype text,
  ADD COLUMN IF NOT EXISTS inspection_category text,
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS displayorder integer;

UPDATE atec.tblequiptypecriteria
SET
  criteriadescription = COALESCE(NULLIF(criteriadescription, ''), criterianame),
  resulttype = COALESCE(
    NULLIF(resulttype, ''),
    CASE
      WHEN UPPER(COALESCE(fieldtype, '')) = 'NUMBER' THEN 'MEASURED'
      ELSE 'PASS_FAIL'
    END
  ),
  inspection_category = COALESCE(NULLIF(inspection_category, ''), 'PERIODIC_THOROUGH_INSPECTION'),
  severity = COALESCE(NULLIF(severity, ''), 'MINOR'),
  active = COALESCE(active, true),
  displayorder = COALESCE(displayorder, sortorder, criteriaid)
WHERE
  criteriadescription IS NULL
  OR resulttype IS NULL
  OR inspection_category IS NULL
  OR severity IS NULL
  OR active IS NULL
  OR displayorder IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tblequiptypecriteria_resulttype_check'
      AND conrelid = 'atec.tblequiptypecriteria'::regclass
  ) THEN
    ALTER TABLE atec.tblequiptypecriteria
      ADD CONSTRAINT tblequiptypecriteria_resulttype_check
      CHECK (resulttype IN ('PASS_FAIL', 'MEASURED', 'YES_NO'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tblequiptypecriteria_inspection_category_check'
      AND conrelid = 'atec.tblequiptypecriteria'::regclass
  ) THEN
    ALTER TABLE atec.tblequiptypecriteria
      ADD CONSTRAINT tblequiptypecriteria_inspection_category_check
      CHECK (inspection_category IN ('FREQUENT_INSPECTION', 'PERIODIC_THOROUGH_INSPECTION'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tblequiptypecriteria_severity_check'
      AND conrelid = 'atec.tblequiptypecriteria'::regclass
  ) THEN
    ALTER TABLE atec.tblequiptypecriteria
      ADD CONSTRAINT tblequiptypecriteria_severity_check
      CHECK (severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS atec.tblinspectionphoto (
  photoid serial PRIMARY KEY,
  testid integer NOT NULL,
  assetid integer,
  uploaded_by_user_id integer,
  photo_path text NOT NULL,
  original_filename text,
  caption text,
  photo_type text DEFAULT 'GENERAL',
  uploaded_at timestamp DEFAULT now(),
  CONSTRAINT tblinspectionphoto_photo_type_check
    CHECK (photo_type IN (
      'GENERAL',
      'DEFECT',
      'REPAIR',
      'LOAD_TEST',
      'NAMEPLATE',
      'HOOK',
      'WIRE_ROPE',
      'STRUCTURE',
      'ELECTRICAL'
    ))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tblinspectionphoto_testid_fk'
      AND conrelid = 'atec.tblinspectionphoto'::regclass
  ) THEN
    ALTER TABLE atec.tblinspectionphoto
      ADD CONSTRAINT tblinspectionphoto_testid_fk
      FOREIGN KEY (testid)
      REFERENCES atec.tblinspection(testid)
      ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN invalid_foreign_key THEN
    RAISE NOTICE 'Skipping tblinspectionphoto_testid_fk because atec.tblinspection(testid) is not unique/primary key in this database.';
END $$;

CREATE INDEX IF NOT EXISTS idx_tblinspectionphoto_testid
  ON atec.tblinspectionphoto(testid);

CREATE INDEX IF NOT EXISTS idx_tblinspectionphoto_assetid
  ON atec.tblinspectionphoto(assetid);

WITH criteria_rows(displayorder, criteriadescription, resulttype, inspection_category, severity) AS (
  VALUES
  (1, 'Crane identification markings are legible and match the equipment records', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MINOR'),
  (2, 'Safe Working Load (SWL) markings are clearly displayed and readable', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (3, 'Record book and previous inspection records are available and up to date', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MINOR'),
  (4, 'No visible structural damage, cracks, distortion or excessive corrosion on the crane structure', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (5, 'Bridge girders show no signs of cracking, deformation or impact damage', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (6, 'End carriages are secure and free from excessive wear or damage', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (7, 'Gantry rails and runway rails are free from damage, excessive wear or obstruction', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (8, 'End stops and buffers are present, secure and in serviceable condition', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (9, 'All accessible bolts, nuts and fasteners are present, secure and show no signs of loosening', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (10, 'Access ladders, platforms and walkways are secure and safe to use', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (11, 'Handrails, guards and toe boards are fitted, secure and undamaged', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (12, 'Electrical isolator functions correctly and can be safely operated', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (13, 'Electrical panels, covers and enclosures are secure and free from damage', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (14, 'Electrical cabling and festoon systems show no damage, exposed conductors or excessive wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (15, 'Earth continuity and grounding arrangements appear intact and secure', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (16, 'Pendant controls operate correctly and all buttons return to neutral position', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
  (17, 'Remote control unit operates correctly and is free from visible damage', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'MAJOR'),
  (18, 'Emergency stop device functions correctly and stops crane movement when activated', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
  (19, 'Audible and visual warning devices function correctly', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'MAJOR'),
  (20, 'Upper hoist limit switch stops upward movement before over-travel occurs', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (21, 'Lower hoist limit switch operates correctly and prevents rope overrun', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (22, 'Long travel limit devices operate correctly and prevent over-travel', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (23, 'Cross travel limit devices operate correctly and prevent over-travel', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (24, 'Overload protection system is fitted and functioning correctly', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (25, 'Hoist motor is securely mounted and free from abnormal noise, vibration or overheating', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (26, 'Gearboxes show no oil leaks and operate smoothly', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (27, 'Brakes hold the load securely and show no signs of excessive wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (28, 'Wheels are free from cracks, damage and abnormal wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (29, 'Bearings operate smoothly with no excessive play or abnormal noise', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (30, 'Wire rope shows no broken wires, bird-caging, crushing, kinking or excessive wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (31, 'Wire rope diameter is within allowable limits', 'MEASURED', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (32, 'Rope anchorage points are secure and free from damage', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (33, 'Rope drum is free from cracks, excessive wear and rope spooling defects', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (34, 'Sheaves rotate freely and show no excessive groove wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (35, 'Hook block assembly is complete, secure and free from visible defects', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (36, 'Hook safety latch is fitted and functions correctly', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (37, 'Hook opening dimension is within allowable limits', 'MEASURED', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (38, 'Hook wear does not exceed allowable limits', 'MEASURED', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (39, 'Hook rotates freely without excessive resistance or binding', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (40, 'Hoist raising function operates smoothly without abnormal noise or vibration', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
  (41, 'Hoist lowering function operates smoothly without abnormal noise or vibration', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
  (42, 'Long travel function operates smoothly through full travel range', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
  (43, 'Cross travel function operates smoothly through full travel range', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
  (44, 'Brake holding test completed successfully without load drift', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
  (45, 'General condition of crane is clean, maintained and free from defects affecting safe operation', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
  (46, 'SAFE FOR CONTINUED OPERATION', 'YES_NO', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL')
)
,
target_equipment_types(equiptypeid) AS (
  VALUES (401), (402), (404), (406)
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
  CASE WHEN source.resulttype = 'MEASURED' THEN 'NUMBER' ELSE 'PASS_FAIL' END,
  source.resulttype,
  true,
  source.displayorder,
  source.displayorder,
  'VISUAL',
  source.inspection_category,
  source.severity,
  true
FROM criteria_rows source
CROSS JOIN target_equipment_types target
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptypecriteria existing
  WHERE existing.equiptypeid = target.equiptypeid
    AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame)) = LOWER(source.criteriadescription)
);

UPDATE atec.tblequiptypecriteria existing
SET
  criteriadescription = source.criteriadescription,
  criterianame = source.criteriadescription,
  fieldtype = CASE WHEN source.resulttype = 'MEASURED' THEN 'NUMBER' ELSE 'PASS_FAIL' END,
  resulttype = source.resulttype,
  sortorder = source.displayorder,
  displayorder = source.displayorder,
  inspectioncategory = 'VISUAL',
  inspection_category = source.inspection_category,
  severity = source.severity,
  active = true
FROM (
  SELECT *
  FROM (VALUES
    (1, 'Crane identification markings are legible and match the equipment records', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MINOR'),
    (2, 'Safe Working Load (SWL) markings are clearly displayed and readable', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (3, 'Record book and previous inspection records are available and up to date', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MINOR'),
    (4, 'No visible structural damage, cracks, distortion or excessive corrosion on the crane structure', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (5, 'Bridge girders show no signs of cracking, deformation or impact damage', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (6, 'End carriages are secure and free from excessive wear or damage', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (7, 'Gantry rails and runway rails are free from damage, excessive wear or obstruction', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (8, 'End stops and buffers are present, secure and in serviceable condition', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (9, 'All accessible bolts, nuts and fasteners are present, secure and show no signs of loosening', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (10, 'Access ladders, platforms and walkways are secure and safe to use', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (11, 'Handrails, guards and toe boards are fitted, secure and undamaged', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (12, 'Electrical isolator functions correctly and can be safely operated', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (13, 'Electrical panels, covers and enclosures are secure and free from damage', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (14, 'Electrical cabling and festoon systems show no damage, exposed conductors or excessive wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (15, 'Earth continuity and grounding arrangements appear intact and secure', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (16, 'Pendant controls operate correctly and all buttons return to neutral position', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
    (17, 'Remote control unit operates correctly and is free from visible damage', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'MAJOR'),
    (18, 'Emergency stop device functions correctly and stops crane movement when activated', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
    (19, 'Audible and visual warning devices function correctly', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'MAJOR'),
    (20, 'Upper hoist limit switch stops upward movement before over-travel occurs', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (21, 'Lower hoist limit switch operates correctly and prevents rope overrun', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (22, 'Long travel limit devices operate correctly and prevent over-travel', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (23, 'Cross travel limit devices operate correctly and prevent over-travel', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (24, 'Overload protection system is fitted and functioning correctly', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (25, 'Hoist motor is securely mounted and free from abnormal noise, vibration or overheating', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (26, 'Gearboxes show no oil leaks and operate smoothly', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (27, 'Brakes hold the load securely and show no signs of excessive wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (28, 'Wheels are free from cracks, damage and abnormal wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (29, 'Bearings operate smoothly with no excessive play or abnormal noise', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (30, 'Wire rope shows no broken wires, bird-caging, crushing, kinking or excessive wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (31, 'Wire rope diameter is within allowable limits', 'MEASURED', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (32, 'Rope anchorage points are secure and free from damage', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (33, 'Rope drum is free from cracks, excessive wear and rope spooling defects', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (34, 'Sheaves rotate freely and show no excessive groove wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (35, 'Hook block assembly is complete, secure and free from visible defects', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (36, 'Hook safety latch is fitted and functions correctly', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (37, 'Hook opening dimension is within allowable limits', 'MEASURED', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (38, 'Hook wear does not exceed allowable limits', 'MEASURED', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (39, 'Hook rotates freely without excessive resistance or binding', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (40, 'Hoist raising function operates smoothly without abnormal noise or vibration', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
    (41, 'Hoist lowering function operates smoothly without abnormal noise or vibration', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
    (42, 'Long travel function operates smoothly through full travel range', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
    (43, 'Cross travel function operates smoothly through full travel range', 'PASS_FAIL', 'FREQUENT_INSPECTION', 'CRITICAL'),
    (44, 'Brake holding test completed successfully without load drift', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (45, 'General condition of crane is clean, maintained and free from defects affecting safe operation', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (46, 'SAFE FOR CONTINUED OPERATION', 'YES_NO', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL')
  ) AS rows(displayorder, criteriadescription, resulttype, inspection_category, severity)
) source
WHERE existing.equiptypeid IN (401, 402, 404, 406)
  AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame)) = LOWER(source.criteriadescription);

DELETE FROM atec.tblequiptypecriteria existing
USING (
  SELECT *
  FROM (VALUES
    ('Crane identification markings are legible and match the equipment records'),
    ('Safe Working Load (SWL) markings are clearly displayed and readable'),
    ('Record book and previous inspection records are available and up to date'),
    ('No visible structural damage, cracks, distortion or excessive corrosion on the crane structure'),
    ('Bridge girders show no signs of cracking, deformation or impact damage'),
    ('End carriages are secure and free from excessive wear or damage'),
    ('Gantry rails and runway rails are free from damage, excessive wear or obstruction'),
    ('End stops and buffers are present, secure and in serviceable condition'),
    ('All accessible bolts, nuts and fasteners are present, secure and show no signs of loosening'),
    ('Access ladders, platforms and walkways are secure and safe to use'),
    ('Handrails, guards and toe boards are fitted, secure and undamaged'),
    ('Electrical isolator functions correctly and can be safely operated'),
    ('Electrical panels, covers and enclosures are secure and free from damage'),
    ('Electrical cabling and festoon systems show no damage, exposed conductors or excessive wear'),
    ('Earth continuity and grounding arrangements appear intact and secure'),
    ('Pendant controls operate correctly and all buttons return to neutral position'),
    ('Remote control unit operates correctly and is free from visible damage'),
    ('Emergency stop device functions correctly and stops crane movement when activated'),
    ('Audible and visual warning devices function correctly'),
    ('Upper hoist limit switch stops upward movement before over-travel occurs'),
    ('Lower hoist limit switch operates correctly and prevents rope overrun'),
    ('Long travel limit devices operate correctly and prevent over-travel'),
    ('Cross travel limit devices operate correctly and prevent over-travel'),
    ('Overload protection system is fitted and functioning correctly'),
    ('Hoist motor is securely mounted and free from abnormal noise, vibration or overheating'),
    ('Gearboxes show no oil leaks and operate smoothly'),
    ('Brakes hold the load securely and show no signs of excessive wear'),
    ('Wheels are free from cracks, damage and abnormal wear'),
    ('Bearings operate smoothly with no excessive play or abnormal noise'),
    ('Wire rope shows no broken wires, bird-caging, crushing, kinking or excessive wear'),
    ('Wire rope diameter is within allowable limits'),
    ('Rope anchorage points are secure and free from damage'),
    ('Rope drum is free from cracks, excessive wear and rope spooling defects'),
    ('Sheaves rotate freely and show no excessive groove wear'),
    ('Hook block assembly is complete, secure and free from visible defects'),
    ('Hook safety latch is fitted and functions correctly'),
    ('Hook opening dimension is within allowable limits'),
    ('Hook wear does not exceed allowable limits'),
    ('Hook rotates freely without excessive resistance or binding'),
    ('Hoist raising function operates smoothly without abnormal noise or vibration'),
    ('Hoist lowering function operates smoothly without abnormal noise or vibration'),
    ('Long travel function operates smoothly through full travel range'),
    ('Cross travel function operates smoothly through full travel range'),
    ('Brake holding test completed successfully without load drift'),
    ('General condition of crane is clean, maintained and free from defects affecting safe operation'),
    ('SAFE FOR CONTINUED OPERATION')
  ) AS rows(criteriadescription)
) source
WHERE existing.equiptypeid = 400
  AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame)) = LOWER(source.criteriadescription);

COMMIT;
