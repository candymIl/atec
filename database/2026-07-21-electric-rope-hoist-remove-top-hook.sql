BEGIN;

DELETE FROM atec.tblequiptypecriteria
WHERE equiptypeid = 105
  AND UPPER(COALESCE(inspectioncategory, '')) = 'LOADTEST'
  AND LOWER(COALESCE(criteriadescription, criterianame, '')) =
    'enter the measured top hook throat opening in millimetres';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM atec.tblequiptypecriteria
    WHERE equiptypeid = 105
      AND COALESCE(active, true)
      AND LOWER(COALESCE(criteriadescription, criterianame, '')) LIKE '%top hook%'
  ) THEN
    RAISE EXCEPTION 'Electric rope hoist still contains an active top-hook criterion';
  END IF;

END $$;

COMMIT;
