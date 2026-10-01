BEGIN;
ALTER TABLE atec.tblusers ADD COLUMN IF NOT EXISTS password_reset_hash text;
ALTER TABLE atec.tblusers ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz;
ALTER TABLE atec.tblusers ADD COLUMN IF NOT EXISTS password_reset_requested_at timestamptz;
ALTER TABLE atec.tblusers ADD COLUMN IF NOT EXISTS password_reset_auth_version integer;
ALTER TABLE atec.tblusers ADD COLUMN IF NOT EXISTS password_reset_email text;
CREATE UNIQUE INDEX IF NOT EXISTS tblusers_password_reset_hash_unique
  ON atec.tblusers(password_reset_hash) WHERE password_reset_hash IS NOT NULL;
-- Invalidate recovery links after every password/email change, including customer
-- admin resets whose existing session trigger does not increment auth_version.
CREATE OR REPLACE FUNCTION atec.invalidate_password_recovery() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password OR NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.password_reset_hash := NULL;
    NEW.password_reset_expires_at := NULL;
    NEW.password_reset_auth_version := NULL;
    NEW.password_reset_email := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invalidate_password_recovery ON atec.tblusers;
CREATE TRIGGER invalidate_password_recovery BEFORE UPDATE OF password, email ON atec.tblusers
  FOR EACH ROW EXECUTE FUNCTION atec.invalidate_password_recovery();
COMMIT;
