BEGIN;

-- ATEC already has atec.tblusers. This migration keeps that table and adds
-- only the fields needed for modern role/session control.
ALTER TABLE atec.tblusers
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE atec.tblusers
SET role =
  CASE
    WHEN userlevel = 1 THEN 'ADMIN'
    WHEN userlevel = 2 THEN 'MANAGER'
    WHEN userlevel = 3 THEN 'INSPECTOR'
    WHEN userlevel = 4 THEN 'VIEWER'
    WHEN userlevel = 5 THEN 'CUSTOMER'
    WHEN role IN ('ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER', 'CUSTOMER') THEN role
    ELSE 'VIEWER'
  END;

ALTER TABLE atec.tblusers
  ALTER COLUMN role SET NOT NULL;

ALTER TABLE atec.tblusers
  DROP CONSTRAINT IF EXISTS tblusers_role_check;

ALTER TABLE atec.tblusers
  ADD CONSTRAINT tblusers_role_check
  CHECK (role IN ('ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER', 'CUSTOMER'));

CREATE INDEX IF NOT EXISTS idx_tblusers_role
  ON atec.tblusers (role);

CREATE INDEX IF NOT EXISTS idx_tblusers_active
  ON atec.tblusers (is_active);

CREATE TABLE IF NOT EXISTS atec.audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  record_id TEXT,
  ip_address INET,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id
  ON atec.audit_log (user_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_module
  ON atec.audit_log (module);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON atec.audit_log (created_at DESC);

ALTER TABLE atec.tblinspection
  ADD COLUMN IF NOT EXISTS inspector_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS inspector_name TEXT,
  ADD COLUMN IF NOT EXISTS inspector_lmi_number TEXT,
  ADD COLUMN IF NOT EXISTS inspector_signature_image TEXT;

UPDATE atec.tblinspection
SET inspector_name = COALESCE(NULLIF(inspector_name, ''), NULLIF(inspector, ''))
WHERE inspector_name IS NULL OR inspector_name = '';

CREATE INDEX IF NOT EXISTS idx_tblinspection_inspector_user_id
  ON atec.tblinspection (inspector_user_id);

COMMIT;

-- If you need to create a new admin in atec.tblusers:
-- 1. Generate a bcrypt hash in D:\Projects\ATEC\backend:
--    node -e "const bcrypt=require('bcryptjs'); bcrypt.hash('ChangeMeNow123!', 12).then(console.log)"
-- 2. Insert the admin:
--    INSERT INTO atec.tblusers (username, password, userlevel, role, lmi_no, email, fullname, is_active)
--    VALUES ('admin', '<PASTE_BCRYPT_HASH>', 1, 'ADMIN', NULL, 'admin@atec.local', 'System Administrator', true);
