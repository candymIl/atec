BEGIN;

UPDATE atec.tblequiptypecriteria criteria
SET inspection_category = 'FREQUENT_INSPECTION'
FROM atec.tblequiptype equipment_type
WHERE criteria.equiptypeid = equipment_type.equiptypeid
  AND LOWER(REGEXP_REPLACE(TRIM(equipment_type.description), '\s+', ' ', 'g')) IN (
    'winch', 'wire rope winch', 'winch / wire rope winch', 'winch/wire rope winch',
    'trolley jack', 'pallet jack', 'trolley jack / pallet jack', 'trolley jack/pallet jack',
    'trestle', 'trestles', 'engine lifter', 'trestles / engine lifter', 'trestles/engine lifter',
    'steel wire rope sling', 'steel wire rope slings',
    'safety harness lanyard', 'safety harness lanyards', 'safety harness', 'safety harnesses',
    'polyester sling', 'polyester slings', 'webbing sling', 'webbing slings',
    'polyester sling / webbing sling', 'polyester sling/webbing sling',
    'plate grab', 'plate grabs',
    'man cage', 'man cages', 'boatswain chair', 'boatswain chairs',
    'man cage / boatswain chair', 'man cage/boatswain chair'
  )
  AND COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'
  AND COALESCE(criteria.inspection_category, '') <> 'FREQUENT_INSPECTION';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM atec.tblequiptypecriteria criteria
    INNER JOIN atec.tblequiptype equipment_type ON criteria.equiptypeid = equipment_type.equiptypeid
    WHERE LOWER(REGEXP_REPLACE(TRIM(equipment_type.description), '\s+', ' ', 'g')) IN (
        'winch', 'wire rope winch', 'winch / wire rope winch', 'winch/wire rope winch',
        'trolley jack', 'pallet jack', 'trolley jack / pallet jack', 'trolley jack/pallet jack',
        'trestle', 'trestles', 'engine lifter', 'trestles / engine lifter', 'trestles/engine lifter',
        'steel wire rope sling', 'steel wire rope slings',
        'safety harness lanyard', 'safety harness lanyards', 'safety harness', 'safety harnesses',
        'polyester sling', 'polyester slings', 'webbing sling', 'webbing slings',
        'polyester sling / webbing sling', 'polyester sling/webbing sling',
        'plate grab', 'plate grabs',
        'man cage', 'man cages', 'boatswain chair', 'boatswain chairs',
        'man cage / boatswain chair', 'man cage/boatswain chair'
      )
      AND COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'
      AND COALESCE(criteria.inspection_category, '') <> 'FREQUENT_INSPECTION'
  ) THEN
    RAISE EXCEPTION 'One or more requested equipment types still contain non-frequent visual criteria';
  END IF;
END $$;

COMMIT;
