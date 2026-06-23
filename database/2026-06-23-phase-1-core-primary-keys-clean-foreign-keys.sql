-- Phase 1: Add primary keys and clean foreign keys for core master data.
--
-- This migration adds safe constraints only where existing data is clean.
-- It also adds sequences/defaults to legacy ID columns because the app inserts
-- new rows without manually providing IDs.
--
-- Dirty relationships intentionally skipped for later cleanup:
-- - tblsection.siteid -> tblsites.siteid
-- - tblpeople.clientid -> tblclients.clientid
-- - tblasset.siteid -> tblsites.siteid
-- - tblasset.sectionid -> tblsection.sectionid
-- - tblasset.equiptypeid -> tblequiptype.equiptypeid

BEGIN;

DO $$
DECLARE
  duplicate_count integer;
  null_count integer;
BEGIN
  -- tblclients
  SELECT COUNT(*) INTO null_count FROM atec.tblclients WHERE clientid IS NULL;
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT clientid FROM atec.tblclients GROUP BY clientid HAVING COUNT(*) > 1
  ) rows;
  IF null_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION 'tblclients.clientid is not ready for a primary key. Nulls: %, duplicates: %', null_count, duplicate_count;
  END IF;

  -- tblsites
  SELECT COUNT(*) INTO null_count FROM atec.tblsites WHERE siteid IS NULL;
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT siteid FROM atec.tblsites GROUP BY siteid HAVING COUNT(*) > 1
  ) rows;
  IF null_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION 'tblsites.siteid is not ready for a primary key. Nulls: %, duplicates: %', null_count, duplicate_count;
  END IF;

  -- tblsection
  SELECT COUNT(*) INTO null_count FROM atec.tblsection WHERE sectionid IS NULL;
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT sectionid FROM atec.tblsection GROUP BY sectionid HAVING COUNT(*) > 1
  ) rows;
  IF null_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION 'tblsection.sectionid is not ready for a primary key. Nulls: %, duplicates: %', null_count, duplicate_count;
  END IF;

  -- tblpeople
  SELECT COUNT(*) INTO null_count FROM atec.tblpeople WHERE personid IS NULL;
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT personid FROM atec.tblpeople GROUP BY personid HAVING COUNT(*) > 1
  ) rows;
  IF null_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION 'tblpeople.personid is not ready for a primary key. Nulls: %, duplicates: %', null_count, duplicate_count;
  END IF;

  -- tblasset
  SELECT COUNT(*) INTO null_count FROM atec.tblasset WHERE assetid IS NULL;
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT assetid FROM atec.tblasset GROUP BY assetid HAVING COUNT(*) > 1
  ) rows;
  IF null_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION 'tblasset.assetid is not ready for a primary key. Nulls: %, duplicates: %', null_count, duplicate_count;
  END IF;

  -- tblequipgroup
  SELECT COUNT(*) INTO null_count FROM atec.tblequipgroup WHERE equipgroupid IS NULL;
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT equipgroupid FROM atec.tblequipgroup GROUP BY equipgroupid HAVING COUNT(*) > 1
  ) rows;
  IF null_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION 'tblequipgroup.equipgroupid is not ready for a primary key. Nulls: %, duplicates: %', null_count, duplicate_count;
  END IF;

  -- tblequiptype
  SELECT COUNT(*) INTO null_count FROM atec.tblequiptype WHERE equiptypeid IS NULL;
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT equiptypeid FROM atec.tblequiptype GROUP BY equiptypeid HAVING COUNT(*) > 1
  ) rows;
  IF null_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION 'tblequiptype.equiptypeid is not ready for a primary key. Nulls: %, duplicates: %', null_count, duplicate_count;
  END IF;

  -- tblusers
  SELECT COUNT(*) INTO null_count FROM atec.tblusers WHERE userid IS NULL;
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT userid FROM atec.tblusers GROUP BY userid HAVING COUNT(*) > 1
  ) rows;
  IF null_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION 'tblusers.userid is not ready for a primary key. Nulls: %, duplicates: %', null_count, duplicate_count;
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS atec.tblclients_clientid_seq;
SELECT setval('atec.tblclients_clientid_seq', GREATEST((SELECT COALESCE(MAX(clientid), 0) FROM atec.tblclients), 1), true);
ALTER TABLE atec.tblclients ALTER COLUMN clientid SET DEFAULT nextval('atec.tblclients_clientid_seq'::regclass);
ALTER TABLE atec.tblclients ALTER COLUMN clientid SET NOT NULL;
ALTER SEQUENCE atec.tblclients_clientid_seq OWNED BY atec.tblclients.clientid;

CREATE SEQUENCE IF NOT EXISTS atec.tblsites_siteid_seq;
SELECT setval('atec.tblsites_siteid_seq', GREATEST((SELECT COALESCE(MAX(siteid), 0) FROM atec.tblsites), 1), true);
ALTER TABLE atec.tblsites ALTER COLUMN siteid SET DEFAULT nextval('atec.tblsites_siteid_seq'::regclass);
ALTER TABLE atec.tblsites ALTER COLUMN siteid SET NOT NULL;
ALTER SEQUENCE atec.tblsites_siteid_seq OWNED BY atec.tblsites.siteid;

CREATE SEQUENCE IF NOT EXISTS atec.tblsection_sectionid_seq;
SELECT setval('atec.tblsection_sectionid_seq', GREATEST((SELECT COALESCE(MAX(sectionid), 0) FROM atec.tblsection), 1), true);
ALTER TABLE atec.tblsection ALTER COLUMN sectionid SET DEFAULT nextval('atec.tblsection_sectionid_seq'::regclass);
ALTER TABLE atec.tblsection ALTER COLUMN sectionid SET NOT NULL;
ALTER SEQUENCE atec.tblsection_sectionid_seq OWNED BY atec.tblsection.sectionid;

CREATE SEQUENCE IF NOT EXISTS atec.tblpeople_personid_seq;
SELECT setval('atec.tblpeople_personid_seq', GREATEST((SELECT COALESCE(MAX(personid), 0) FROM atec.tblpeople), 1), true);
ALTER TABLE atec.tblpeople ALTER COLUMN personid SET DEFAULT nextval('atec.tblpeople_personid_seq'::regclass);
ALTER TABLE atec.tblpeople ALTER COLUMN personid SET NOT NULL;
ALTER SEQUENCE atec.tblpeople_personid_seq OWNED BY atec.tblpeople.personid;

CREATE SEQUENCE IF NOT EXISTS atec.tblasset_assetid_seq;
SELECT setval('atec.tblasset_assetid_seq', GREATEST((SELECT COALESCE(MAX(assetid), 0) FROM atec.tblasset), 1), true);
ALTER TABLE atec.tblasset ALTER COLUMN assetid SET DEFAULT nextval('atec.tblasset_assetid_seq'::regclass);
ALTER TABLE atec.tblasset ALTER COLUMN assetid SET NOT NULL;
ALTER SEQUENCE atec.tblasset_assetid_seq OWNED BY atec.tblasset.assetid;

CREATE SEQUENCE IF NOT EXISTS atec.tblequipgroup_equipgroupid_seq;
SELECT setval('atec.tblequipgroup_equipgroupid_seq', GREATEST((SELECT COALESCE(MAX(equipgroupid), 0) FROM atec.tblequipgroup), 1), true);
ALTER TABLE atec.tblequipgroup ALTER COLUMN equipgroupid SET DEFAULT nextval('atec.tblequipgroup_equipgroupid_seq'::regclass);
ALTER TABLE atec.tblequipgroup ALTER COLUMN equipgroupid SET NOT NULL;
ALTER SEQUENCE atec.tblequipgroup_equipgroupid_seq OWNED BY atec.tblequipgroup.equipgroupid;

CREATE SEQUENCE IF NOT EXISTS atec.tblequiptype_equiptypeid_seq;
SELECT setval('atec.tblequiptype_equiptypeid_seq', GREATEST((SELECT COALESCE(MAX(equiptypeid), 0) FROM atec.tblequiptype), 1), true);
ALTER TABLE atec.tblequiptype ALTER COLUMN equiptypeid SET DEFAULT nextval('atec.tblequiptype_equiptypeid_seq'::regclass);
ALTER TABLE atec.tblequiptype ALTER COLUMN equiptypeid SET NOT NULL;
ALTER SEQUENCE atec.tblequiptype_equiptypeid_seq OWNED BY atec.tblequiptype.equiptypeid;

CREATE SEQUENCE IF NOT EXISTS atec.tblusers_userid_seq;
SELECT setval('atec.tblusers_userid_seq', GREATEST((SELECT COALESCE(MAX(userid), 0) FROM atec.tblusers), 1), true);
ALTER TABLE atec.tblusers ALTER COLUMN userid SET DEFAULT nextval('atec.tblusers_userid_seq'::regclass);
ALTER TABLE atec.tblusers ALTER COLUMN userid SET NOT NULL;
ALTER SEQUENCE atec.tblusers_userid_seq OWNED BY atec.tblusers.userid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'atec.tblclients'::regclass AND contype = 'p') THEN
    ALTER TABLE atec.tblclients ADD CONSTRAINT tblclients_pkey PRIMARY KEY (clientid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'atec.tblsites'::regclass AND contype = 'p') THEN
    ALTER TABLE atec.tblsites ADD CONSTRAINT tblsites_pkey PRIMARY KEY (siteid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'atec.tblsection'::regclass AND contype = 'p') THEN
    ALTER TABLE atec.tblsection ADD CONSTRAINT tblsection_pkey PRIMARY KEY (sectionid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'atec.tblpeople'::regclass AND contype = 'p') THEN
    ALTER TABLE atec.tblpeople ADD CONSTRAINT tblpeople_pkey PRIMARY KEY (personid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'atec.tblasset'::regclass AND contype = 'p') THEN
    ALTER TABLE atec.tblasset ADD CONSTRAINT tblasset_pkey PRIMARY KEY (assetid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'atec.tblequipgroup'::regclass AND contype = 'p') THEN
    ALTER TABLE atec.tblequipgroup ADD CONSTRAINT tblequipgroup_pkey PRIMARY KEY (equipgroupid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'atec.tblequiptype'::regclass AND contype = 'p') THEN
    ALTER TABLE atec.tblequiptype ADD CONSTRAINT tblequiptype_pkey PRIMARY KEY (equiptypeid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'atec.tblusers'::regclass AND contype = 'p') THEN
    ALTER TABLE atec.tblusers ADD CONSTRAINT tblusers_pkey PRIMARY KEY (userid);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblsites_clientid_fk' AND conrelid = 'atec.tblsites'::regclass) THEN
    ALTER TABLE atec.tblsites
      ADD CONSTRAINT tblsites_clientid_fk
      FOREIGN KEY (clientid) REFERENCES atec.tblclients(clientid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblsection_clientid_fk' AND conrelid = 'atec.tblsection'::regclass) THEN
    ALTER TABLE atec.tblsection
      ADD CONSTRAINT tblsection_clientid_fk
      FOREIGN KEY (clientid) REFERENCES atec.tblclients(clientid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblsection_responsibleid_fk' AND conrelid = 'atec.tblsection'::regclass) THEN
    ALTER TABLE atec.tblsection
      ADD CONSTRAINT tblsection_responsibleid_fk
      FOREIGN KEY (responsibleid) REFERENCES atec.tblpeople(personid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblasset_clientid_fk' AND conrelid = 'atec.tblasset'::regclass) THEN
    ALTER TABLE atec.tblasset
      ADD CONSTRAINT tblasset_clientid_fk
      FOREIGN KEY (clientid) REFERENCES atec.tblclients(clientid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblasset_responsibleid_fk' AND conrelid = 'atec.tblasset'::regclass) THEN
    ALTER TABLE atec.tblasset
      ADD CONSTRAINT tblasset_responsibleid_fk
      FOREIGN KEY (responsibleid) REFERENCES atec.tblpeople(personid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblequiptype_equipgroupid_fk' AND conrelid = 'atec.tblequiptype'::regclass) THEN
    ALTER TABLE atec.tblequiptype
      ADD CONSTRAINT tblequiptype_equipgroupid_fk
      FOREIGN KEY (equipgroupid) REFERENCES atec.tblequipgroup(equipgroupid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblequiptypecriteria_equiptypeid_fk' AND conrelid = 'atec.tblequiptypecriteria'::regclass) THEN
    ALTER TABLE atec.tblequiptypecriteria
      ADD CONSTRAINT tblequiptypecriteria_equiptypeid_fk
      FOREIGN KEY (equiptypeid) REFERENCES atec.tblequiptype(equiptypeid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblinspection_assetid_fk' AND conrelid = 'atec.tblinspection'::regclass) THEN
    ALTER TABLE atec.tblinspection
      ADD CONSTRAINT tblinspection_assetid_fk
      FOREIGN KEY (assetid) REFERENCES atec.tblasset(assetid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblinspection_inspector_user_id_fk' AND conrelid = 'atec.tblinspection'::regclass) THEN
    ALTER TABLE atec.tblinspection
      ADD CONSTRAINT tblinspection_inspector_user_id_fk
      FOREIGN KEY (inspector_user_id) REFERENCES atec.tblusers(userid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblinspectionphoto_uploaded_by_user_id_fk' AND conrelid = 'atec.tblinspectionphoto'::regclass) THEN
    ALTER TABLE atec.tblinspectionphoto
      ADD CONSTRAINT tblinspectionphoto_uploaded_by_user_id_fk
      FOREIGN KEY (uploaded_by_user_id) REFERENCES atec.tblusers(userid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_user_id_fk' AND conrelid = 'atec.audit_log'::regclass) THEN
    ALTER TABLE atec.audit_log
      ADD CONSTRAINT audit_log_user_id_fk
      FOREIGN KEY (user_id) REFERENCES atec.tblusers(userid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tblsites_clientid ON atec.tblsites(clientid);
CREATE INDEX IF NOT EXISTS idx_tblsection_clientid ON atec.tblsection(clientid);
CREATE INDEX IF NOT EXISTS idx_tblsection_siteid ON atec.tblsection(siteid);
CREATE INDEX IF NOT EXISTS idx_tblsection_responsibleid ON atec.tblsection(responsibleid);
CREATE INDEX IF NOT EXISTS idx_tblpeople_clientid ON atec.tblpeople(clientid);
CREATE INDEX IF NOT EXISTS idx_tblasset_clientid ON atec.tblasset(clientid);
CREATE INDEX IF NOT EXISTS idx_tblasset_siteid ON atec.tblasset(siteid);
CREATE INDEX IF NOT EXISTS idx_tblasset_sectionid ON atec.tblasset(sectionid);
CREATE INDEX IF NOT EXISTS idx_tblasset_responsibleid ON atec.tblasset(responsibleid);
CREATE INDEX IF NOT EXISTS idx_tblasset_equiptypeid ON atec.tblasset(equiptypeid);
CREATE INDEX IF NOT EXISTS idx_tblequiptype_equipgroupid ON atec.tblequiptype(equipgroupid);
CREATE INDEX IF NOT EXISTS idx_tblequiptypecriteria_equiptypeid ON atec.tblequiptypecriteria(equiptypeid);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON atec.audit_log(user_id);

COMMIT;
