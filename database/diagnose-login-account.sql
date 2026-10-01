-- Read-only diagnostic. Do not select or share password hashes.
SELECT userid, username, email, is_active, role, userlevel,
       last_login_at, updated_at, must_change_password,
       password_changed_at, auth_version,
       CASE WHEN password ~ '^\$2[aby]\$[0-9]{2}\$' THEN 'bcrypt' ELSE 'unexpected format' END AS password_format
FROM atec.tblusers
WHERE lower(trim(username)) = 'jacques@fbcranes.co.za'
   OR lower(trim(email)) = 'jacques@fbcranes.co.za';
-- Multiple matching rows need investigation; the login query currently uses LIMIT 1.
