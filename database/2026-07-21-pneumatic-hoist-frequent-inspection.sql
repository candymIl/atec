BEGIN;

UPDATE atec.tblequiptypecriteria criteria
SET inspection_category = 'FREQUENT_INSPECTION'
FROM atec.tblequiptype equipment_type
WHERE criteria.equiptypeid = equipment_type.equiptypeid
  AND equipment_type.equiptypeid = 103
  AND LOWER(REGEXP_REPLACE(TRIM(equipment_type.description), '\s+', ' ', 'g')) = 'hoists - air / pneumatic hoist'
  AND UPPER(COALESCE(criteria.inspectioncategory, 'VISUAL')) = 'VISUAL'
  AND COALESCE(criteria.active, true)
  AND COALESCE(criteria.inspection_category, '') <> 'FREQUENT_INSPECTION';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM atec.tblequiptype
    WHERE equiptypeid = 103
      AND LOWER(REGEXP_REPLACE(TRIM(description), '\s+', ' ', 'g')) = 'hoists - air / pneumatic hoist'
  ) THEN
    RAISE EXCEPTION 'Equipment type 103 is not Hoists - Air / Pneumatic hoist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atec.tblequiptypecriteria
    WHERE equiptypeid = 103
      AND UPPER(COALESCE(inspectioncategory, 'VISUAL')) = 'VISUAL'
      AND COALESCE(active, true)
      AND COALESCE(inspection_category, '') <> 'FREQUENT_INSPECTION'
  ) THEN
    RAISE EXCEPTION 'Pneumatic hoist visual criteria still contain a non-frequent inspection category';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atec.tblequiptypecriteria
    WHERE equiptypeid = 103
      AND UPPER(COALESCE(inspectioncategory, '')) = 'LOADTEST'
      AND COALESCE(active, true)
      AND COALESCE(inspection_category, '') <> 'PERIODIC_THOROUGH_INSPECTION'
  ) THEN
    RAISE EXCEPTION 'Pneumatic hoist load-test criteria must remain periodic thorough inspection';
  END IF;
END $$;

COMMIT;
