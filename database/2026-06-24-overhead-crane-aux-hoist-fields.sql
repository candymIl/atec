BEGIN;

ALTER TABLE atec.tblasset
  ADD COLUMN IF NOT EXISTS auxhoistdescription text,
  ADD COLUMN IF NOT EXISTS auxhoistserialno text,
  ADD COLUMN IF NOT EXISTS auxhoistwll text,
  ADD COLUMN IF NOT EXISTS auxhoisthooksize text,
  ADD COLUMN IF NOT EXISTS auxhoistropemm text;

COMMIT;
