BEGIN;

UPDATE atec.tblequiptypecriteria criteria
SET inspection_category = 'FREQUENT_INSPECTION'
FROM atec.tblequiptype equipment_type
WHERE criteria.equiptypeid = equipment_type.equiptypeid
  AND LOWER(REGEXP_REPLACE(TRIM(equipment_type.description), '\s+', ' ', 'g')) IN (
    'd shackle',
    'd shackles',
    'd-shackle',
    'd-shackles',
    'dee shackle',
    'dee shackles',
    'drum lifter',
    'drum lifters',
    'endless round sling',
    'endless round slings',
    'eye bolt',
    'eye bolts',
    'eyebolt',
    'eyebolts',
    'fall arrestor',
    'fall arrestors',
    'fall arrester',
    'fall arresters'
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
    WHERE LOWER(REGEXP_REPLACE(TRIM(equipment_type.description), '\s+', ' ', 'g')) IN (
        'd shackle', 'd shackles', 'd-shackle', 'd-shackles', 'dee shackle', 'dee shackles',
        'drum lifter', 'drum lifters',
        'endless round sling', 'endless round slings',
        'eye bolt', 'eye bolts', 'eyebolt', 'eyebolts',
        'fall arrestor', 'fall arrestors', 'fall arrester', 'fall arresters'
      )
      AND COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'
      AND COALESCE(criteria.inspection_category, '') <> 'FREQUENT_INSPECTION'
  ) THEN
    RAISE EXCEPTION 'One or more additional lifting tackle criteria still contain a non-frequent inspection category';
  END IF;
END $$;

COMMIT;
