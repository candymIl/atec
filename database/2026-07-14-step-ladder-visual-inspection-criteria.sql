BEGIN;

WITH target_equipment_types(equiptypeid) AS (
  VALUES (338)
),
criteria_rows(displayorder, criteriadescription, resulttype, inspection_category, severity) AS (
  VALUES
    (1, 'Ladder identification, duty rating and inspection tag are legible and match the asset records', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MINOR'),
    (2, 'Rated capacity and ladder type are suitable for the intended use and clearly displayed on the ladder', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (3, 'Side rails/stiles are straight and free from cracks, splits, sharp edges, corrosion or deformation', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (4, 'Steps, rungs and treads are secure, clean and free from cracks, bending, missing anti-slip surfaces or excessive wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (5, 'Platform, top cap and handhold/tool tray are secure, undamaged and correctly seated', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (6, 'Spreaders, hinges, stays and locking devices open fully and lock positively', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (7, 'Feet, shoes and end caps are present, secure, slip-resistant and not worn through', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (8, 'Braces, rivets, bolts and fasteners are present, tight and free from damage or unauthorised repair', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (9, 'Ladder stands level and stable with no twist, wobble or misalignment when opened', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (10, 'Ladder is free from oil, grease, paint build-up, chemical contamination or debris that could hide defects', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (11, 'No evidence of overloading, impact damage, heat or electrical damage, or unauthorised modification', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (12, 'Safety labels, warnings and user instructions relevant to safe use are legible', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MINOR'),
    (13, 'SAFE FOR CONTINUED OPERATION', 'YES_NO', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL')
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
  target.equiptypeid,
  source.criteriadescription,
  source.criteriadescription,
  CASE WHEN source.resulttype = 'YES_NO' THEN 'YESNO' ELSE 'PASS_FAIL' END,
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
    AND COALESCE(existing.inspectioncategory, '') = 'VISUAL'
    AND (
      LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) = LOWER(source.criteriadescription)
      OR (
        source.criteriadescription = 'SAFE FOR CONTINUED OPERATION'
        AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) IN ('safe for continued operation', 'safe for service')
      )
    )
);

WITH target_equipment_types(equiptypeid) AS (
  VALUES (338)
),
criteria_rows(displayorder, criteriadescription, resulttype, inspection_category, severity) AS (
  VALUES
    (1, 'Ladder identification, duty rating and inspection tag are legible and match the asset records', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MINOR'),
    (2, 'Rated capacity and ladder type are suitable for the intended use and clearly displayed on the ladder', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (3, 'Side rails/stiles are straight and free from cracks, splits, sharp edges, corrosion or deformation', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (4, 'Steps, rungs and treads are secure, clean and free from cracks, bending, missing anti-slip surfaces or excessive wear', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (5, 'Platform, top cap and handhold/tool tray are secure, undamaged and correctly seated', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (6, 'Spreaders, hinges, stays and locking devices open fully and lock positively', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (7, 'Feet, shoes and end caps are present, secure, slip-resistant and not worn through', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (8, 'Braces, rivets, bolts and fasteners are present, tight and free from damage or unauthorised repair', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (9, 'Ladder stands level and stable with no twist, wobble or misalignment when opened', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (10, 'Ladder is free from oil, grease, paint build-up, chemical contamination or debris that could hide defects', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MAJOR'),
    (11, 'No evidence of overloading, impact damage, heat or electrical damage, or unauthorised modification', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL'),
    (12, 'Safety labels, warnings and user instructions relevant to safe use are legible', 'PASS_FAIL', 'PERIODIC_THOROUGH_INSPECTION', 'MINOR'),
    (13, 'SAFE FOR CONTINUED OPERATION', 'YES_NO', 'PERIODIC_THOROUGH_INSPECTION', 'CRITICAL')
)
UPDATE atec.tblequiptypecriteria existing
SET
  criterianame = source.criteriadescription,
  criteriadescription = source.criteriadescription,
  fieldtype = CASE WHEN source.resulttype = 'YES_NO' THEN 'YESNO' ELSE 'PASS_FAIL' END,
  resulttype = source.resulttype,
  required = true,
  sortorder = source.displayorder,
  displayorder = source.displayorder,
  inspectioncategory = 'VISUAL',
  inspection_category = source.inspection_category,
  severity = source.severity,
  active = true
FROM criteria_rows source
CROSS JOIN target_equipment_types target
WHERE existing.equiptypeid = target.equiptypeid
  AND COALESCE(existing.inspectioncategory, '') = 'VISUAL'
  AND (
    LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) = LOWER(source.criteriadescription)
    OR (
      source.criteriadescription = 'SAFE FOR CONTINUED OPERATION'
      AND LOWER(COALESCE(existing.criteriadescription, existing.criterianame, '')) IN ('safe for continued operation', 'safe for service')
    )
  );

COMMIT;
