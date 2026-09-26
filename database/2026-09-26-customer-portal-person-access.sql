BEGIN;
ALTER TABLE atec.tblusers ADD COLUMN IF NOT EXISTS portal_personid bigint;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tblusers_portal_person_fk' AND conrelid = 'atec.tblusers'::regclass) THEN
    ALTER TABLE atec.tblusers ADD CONSTRAINT tblusers_portal_person_fk
      FOREIGN KEY (portal_personid) REFERENCES atec.tblpeople(personid);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tblusers_portal_person
  ON atec.tblusers(portal_personid) WHERE portal_personid IS NOT NULL;
ALTER TABLE IF EXISTS atec.tblnotificationdelivery ADD COLUMN IF NOT EXISTS responsibleid bigint;
COMMIT;
