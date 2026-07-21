BEGIN;

UPDATE atec.tblequiptypecriteria criteria
SET inspection_category = 'FREQUENT_INSPECTION'
FROM atec.tblequiptype equipment_type
WHERE criteria.equiptypeid = equipment_type.equiptypeid
  AND LOWER(REGEXP_REPLACE(TRIM(equipment_type.description), '\s+', ' ', 'g')) IN (
    'manual chain hoist', 'hoists - manual chain hoist',
    'manual lever hoist', 'hoists - manual lever hoist'
  )
  AND UPPER(COALESCE(criteria.inspectioncategory, 'VISUAL')) = 'VISUAL'
  AND COALESCE(criteria.inspection_category, '') <> 'FREQUENT_INSPECTION';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM atec.tblequiptypecriteria criteria
    INNER JOIN atec.tblequiptype equipment_type ON criteria.equiptypeid = equipment_type.equiptypeid
    WHERE LOWER(REGEXP_REPLACE(TRIM(equipment_type.description), '\s+', ' ', 'g')) IN (
      'manual chain hoist', 'hoists - manual chain hoist',
      'manual lever hoist', 'hoists - manual lever hoist'
    )
      AND UPPER(COALESCE(criteria.inspectioncategory, 'VISUAL')) = 'VISUAL'
      AND COALESCE(criteria.inspection_category, '') <> 'FREQUENT_INSPECTION'
  ) THEN
    RAISE EXCEPTION 'Manual chain and lever hoist visual criteria must use Frequent Inspection';
  END IF;
END $$;

COMMIT;
