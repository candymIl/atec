-- Phase 1: Clean remaining master-data references and add remaining FKs.
--
-- Repairs made:
-- - Assets pointing to missing site 14 but valid section 25 are moved to site 11,
--   because section 25 belongs to site 11.
-- - Missing section 130 is recreated as a recovered section under South Deep / Twin Shaft.
-- - Empty FB Crane sections with siteid 0 are assigned to Johannesburg site 108.
-- - Missing equipment type 323 is recreated as Safety Harness under group 600.

BEGIN;

UPDATE atec.tblasset
SET siteid = 11
WHERE clientid = 1
  AND siteid = 14
  AND sectionid = 25
  AND NOT EXISTS (
    SELECT 1
    FROM atec.tblsites s
    WHERE s.siteid = 14
  );

INSERT INTO atec.tblsection (
  sectionid,
  clientid,
  siteid,
  responsibleid,
  sectionname,
  archived
)
SELECT
  130,
  1,
  11,
  NULL,
  'Recovered Section 130',
  false
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblsection
  WHERE sectionid = 130
);

UPDATE atec.tblsection
SET siteid = 108
WHERE sectionid IN (594, 595)
  AND clientid = 2
  AND COALESCE(siteid, 0) = 0
  AND EXISTS (
    SELECT 1
    FROM atec.tblsites
    WHERE siteid = 108
      AND clientid = 2
  );

INSERT INTO atec.tblequiptype (
  equiptypeid,
  equipgroupid,
  description
)
SELECT
  323,
  600,
  'Safety Harness'
WHERE NOT EXISTS (
  SELECT 1
  FROM atec.tblequiptype
  WHERE equiptypeid = 323
);

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM atec.tblsection child
  LEFT JOIN atec.tblsites parent
    ON child.siteid = parent.siteid
  WHERE child.siteid IS NOT NULL
    AND parent.siteid IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot add tblsection.siteid FK: % orphan rows remain.', orphan_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM atec.tblpeople child
  LEFT JOIN atec.tblclients parent
    ON child.clientid = parent.clientid
  WHERE child.clientid IS NOT NULL
    AND parent.clientid IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot add tblpeople.clientid FK: % orphan rows remain.', orphan_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM atec.tblasset child
  LEFT JOIN atec.tblsites parent
    ON child.siteid = parent.siteid
  WHERE child.siteid IS NOT NULL
    AND parent.siteid IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot add tblasset.siteid FK: % orphan rows remain.', orphan_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM atec.tblasset child
  LEFT JOIN atec.tblsection parent
    ON child.sectionid = parent.sectionid
  WHERE child.sectionid IS NOT NULL
    AND parent.sectionid IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot add tblasset.sectionid FK: % orphan rows remain.', orphan_count;
  END IF;

  SELECT COUNT(*) INTO orphan_count
  FROM atec.tblasset child
  LEFT JOIN atec.tblequiptype parent
    ON child.equiptypeid = parent.equiptypeid
  WHERE child.equiptypeid IS NOT NULL
    AND parent.equiptypeid IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot add tblasset.equiptypeid FK: % orphan rows remain.', orphan_count;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblsection_siteid_fk'
      AND conrelid = 'atec.tblsection'::regclass
  ) THEN
    ALTER TABLE atec.tblsection
      ADD CONSTRAINT tblsection_siteid_fk
      FOREIGN KEY (siteid)
      REFERENCES atec.tblsites(siteid);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblpeople_clientid_fk'
      AND conrelid = 'atec.tblpeople'::regclass
  ) THEN
    ALTER TABLE atec.tblpeople
      ADD CONSTRAINT tblpeople_clientid_fk
      FOREIGN KEY (clientid)
      REFERENCES atec.tblclients(clientid);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblasset_siteid_fk'
      AND conrelid = 'atec.tblasset'::regclass
  ) THEN
    ALTER TABLE atec.tblasset
      ADD CONSTRAINT tblasset_siteid_fk
      FOREIGN KEY (siteid)
      REFERENCES atec.tblsites(siteid);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblasset_sectionid_fk'
      AND conrelid = 'atec.tblasset'::regclass
  ) THEN
    ALTER TABLE atec.tblasset
      ADD CONSTRAINT tblasset_sectionid_fk
      FOREIGN KEY (sectionid)
      REFERENCES atec.tblsection(sectionid);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblasset_equiptypeid_fk'
      AND conrelid = 'atec.tblasset'::regclass
  ) THEN
    ALTER TABLE atec.tblasset
      ADD CONSTRAINT tblasset_equiptypeid_fk
      FOREIGN KEY (equiptypeid)
      REFERENCES atec.tblequiptype(equiptypeid);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tblinspectionresult_criteriaid_fk'
      AND conrelid = 'atec.tblinspectionresult'::regclass
  ) THEN
    ALTER TABLE atec.tblinspectionresult
      ADD CONSTRAINT tblinspectionresult_criteriaid_fk
      FOREIGN KEY (criteriaid)
      REFERENCES atec.tblequiptypecriteria(criteriaid);
  END IF;
EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE NOTICE 'Skipping tblinspectionresult_criteriaid_fk because some criteriaid values do not exist in atec.tblequiptypecriteria.';
END $$;

SELECT setval('atec.tblsection_sectionid_seq', GREATEST((SELECT COALESCE(MAX(sectionid), 0) FROM atec.tblsection), 1), true);
SELECT setval('atec.tblequiptype_equiptypeid_seq', GREATEST((SELECT COALESCE(MAX(equiptypeid), 0) FROM atec.tblequiptype), 1), true);

COMMIT;
