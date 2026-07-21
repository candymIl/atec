BEGIN;

UPDATE atec.tblequiptypecriteria
SET inspection_category = 'PERIODIC_THOROUGH_INSPECTION'
WHERE UPPER(COALESCE(inspectioncategory, '')) = 'LOADTEST'
  AND COALESCE(inspection_category, '') <> 'PERIODIC_THOROUGH_INSPECTION';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM atec.tblequiptypecriteria
    WHERE UPPER(COALESCE(inspectioncategory, '')) = 'LOADTEST'
      AND COALESCE(inspection_category, '') <> 'PERIODIC_THOROUGH_INSPECTION'
  ) THEN
    RAISE EXCEPTION 'Load-test criteria must use Periodic Thorough Inspection';
  END IF;
END $$;

COMMIT;
