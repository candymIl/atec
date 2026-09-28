BEGIN;
ALTER TABLE atec.tblusers ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE atec.tblusers ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
ALTER TABLE atec.tblusers ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

-- All staff password-writing routes revoke prior sessions, including admin resets.
CREATE OR REPLACE FUNCTION atec.revoke_staff_password_sessions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password THEN
    NEW.password_changed_at := now();
    IF COALESCE(NEW.role, CASE NEW.userlevel WHEN 1 THEN 'ADMIN' WHEN 2 THEN 'MANAGER'
      WHEN 3 THEN 'INSPECTOR' WHEN 5 THEN 'CUSTOMER' ELSE 'VIEWER' END)
      IN ('ADMIN', 'MANAGER', 'INSPECTOR', 'ASSISTANT', 'HR', 'VIEWER') THEN
      NEW.auth_version := OLD.auth_version + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS revoke_staff_password_sessions ON atec.tblusers;
CREATE TRIGGER revoke_staff_password_sessions BEFORE UPDATE OF password ON atec.tblusers
  FOR EACH ROW EXECUTE FUNCTION atec.revoke_staff_password_sessions();
-- Activation is deliberately separate: installing this schema does not enrol any users.
COMMIT;
