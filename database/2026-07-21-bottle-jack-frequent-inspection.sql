BEGIN;

UPDATE atec.tblequiptypecriteria criteria
SET inspection_category = 'FREQUENT_INSPECTION'
FROM atec.tblequiptype equipment_type
WHERE criteria.equiptypeid = equipment_type.equiptypeid
  AND LOWER(TRIM(equipment_type.description)) IN (
    'bottle jack',
    'bottlejack',
    'hydraulic bottle jack'
  )
  AND COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'
  AND COALESCE(criteria.inspection_category, '') <> 'FREQUENT_INSPECTION';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM atec.tblequiptypecriteria criteria
    INNER JOIN atec.tblequiptype equipment_type
      ON criteria.equiptypeid = equipment_type.equiptypeid
    WHERE LOWER(TRIM(equipment_type.description)) IN (
        'bottle jack',
        'bottlejack',
        'hydraulic bottle jack'
      )
      AND COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'
      AND COALESCE(criteria.inspection_category, '') <> 'FREQUENT_INSPECTION'
  ) THEN
    RAISE EXCEPTION 'Bottle jack visual criteria still contain a non-frequent inspection category';
  END IF;
END $$;

COMMIT;
