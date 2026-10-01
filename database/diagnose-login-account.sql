-- Read-only diagnostic. Do not select or share password hashes.
SELECT userid, username, email, is_active, role, userlevel,
       last_login_at, updated_at, must_change_password,
       password_changed_at, auth_version,
       CASE WHEN password ~ '^\$2[aby]\$[0-9]{2}\$' THEN 'bcrypt' ELSE 'unexpected format' END AS password_format
FROM atec.tblusers
WHERE lower(trim(username)) = 'jacques@fbcranes.co.za'
   OR lower(trim(email)) = 'jacques@fbcranes.co.za';
-- Shared email addresses are permitted. Each employee should use their own username.
-- Check the specific account's identity and active status; retain shared contact addresses.
