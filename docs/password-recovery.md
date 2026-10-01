# ATEC password recovery

Prepared locally on 1 October 2026. Not deployed. Jacques's live login failure and account state remain unverified.

The login screen now has Forgot password. The user enters their registered email address and receives a single-use HTTPS link valid for 30 minutes. The email contains no password. A SHA-256 token digest is stored, while passwords continue to use bcrypt with cost 12. Links use a URL fragment; the frontend removes the fragment from browser history before displaying the recovery form. Completion requires matching password entries, applies the existing eight-character minimum and 72 UTF-8 byte limit, clears the staff change requirement, revokes existing sessions for every role, records an audit event and sends a change notification. The user signs in normally after recovery.

Unknown, inactive, duplicate-email and throttled accounts receive the same generic acknowledgement. Responses do not await account lookup or email delivery. A five-minute account cooldown and separate IP limits protect requests and token redemption. CSRF origin checks apply to both public endpoints. Password and email changes invalidate outstanding links. Failed delivery clears the new token and its cooldown; logs record only a fixed failure code, never the secret link or provider error body. Operators should monitor PASSWORD_RECOVERY_DELIVERY_FAILED and PASSWORD_RECOVERY_NOTICE_FAILED. Delivery is awaited in the running process after acknowledgement; this is not a durable email queue, so a restart at that point can require another request after the cooldown.

## Login diagnosis and immediate administrator recovery

Run database/diagnose-login-account.sql read-only on the live ATEC database. Confirm exactly one matching user, the expected username/email, active status and bcrypt password format; review last_login_at/password_changed_at and relevant audit records. Invalid username or password can indicate a password mismatch or an inactive account. The current login query uses LIMIT 1, so multiple matching accounts also need investigation. Do not select or share password hashes.

A signed-in ATEC administrator can use the existing Users > Reset Password action for the verified account. If no administrator can sign in, a server-side recovery must hash the new password with bcrypt before a narrowly scoped database update, preserve account roles and active status, and record the recovery. Never store a plaintext password in tblusers.password or email it. No live password update has been executed as part of this local feature work.

## Validation

- node --test scripts/regression/password-recovery.test.js: ten tests passed, including token storage, replay/expiry rejection, inactive accounts, account cooldown, password/confirmation validation, changed credentials, delivery failure, HTTPS enforcement and HTTP CSRF/rate limits.
- node scripts/uat/password-recovery-db.js: real local PostgreSQL, isolated schema and rollback; idempotent migration, atomic consumption, staff/customer session versions, expiry/replay, administrator resets and email changes passed. No existing accounts changed.
- Required-password-change HTTP regression, self-password-change checks, deployment safety checks, backend syntax check and frontend production build passed.
- Production account diagnosis, real mailbox delivery and end-to-end browser recovery are not yet verified.

## Release

Obtain approval for the exact live release under Jacques's standing approval requirement. Preserve the production environment and take a verified recoverable database backup. The recovery migration is registered after the required-password-change migration in deployment/production-migrations.json and its columns are included in the schema contract. Deploy backend, migration and frontend together through the established ATEC release process. Ensure PUBLIC_APP_URL points to the correct HTTPS frontend path and the existing application mail transport is configured. Insecure URLs do not send reset mail.

Verify health and normal login. With the approved account owner, request a recovery link, confirm delivery, choose a password privately, sign in, and check expiry/reuse and old-session denial. Verify an inactive account cannot reset. Do not claim the feature live or Jacques's access restored until these checks succeed. A code rollback may retain the nullable recovery columns and invalidation trigger; it must preserve the existing session revocation enforcement.
