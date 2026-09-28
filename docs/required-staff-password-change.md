# Required ATEC staff password change

Prepared locally on 28 September 2026. Not deployed or activated in production.

After activation, active internal staff must log in again and complete a password change before using ATEC. The server permits only session information, sign-out and self-service password change while the requirement is pending. Direct API calls and uploads are also blocked. On completion the current browser receives a renewed session; all earlier staff sessions are rejected. Existing customer accounts are not enrolled. Customer-linked accounts and inactive staff are excluded from the activation script.

The screen asks for the current password, a different new password and confirmation. It retains the existing eight-character minimum, rejects bcrypt truncation above 72 UTF-8 bytes, and directs anyone who cannot complete it to Jacques or their ATEC administrator. Admin password resets retain a pending change requirement; they do not mark the staff member as having chosen their own password.

## Validation

- `node scripts/regression/required-password-change.test.js`: real HTTP/JWT/bcrypt tests with a database double, covering all six internal roles, customer and legacy-session exclusion, direct-route and upload bypass denial, current/new password validation, CSRF, compare-and-set conflict, revocation, inactive users and database failure.
- `node scripts/uat/required-password-change-db.js`: local PostgreSQL, isolated temporary schema in a rolled-back transaction; migration default-off/idempotence, trigger revocation, legacy role mapping, customer exclusion and stale update denial.
- Existing self-password-change and session-expiry checks, syntax checks and frontend production build.
- Isolated browser preview: visual layout reviewed; mismatched confirmation displayed an error; matching values completed the preview without changing any account. Deployment safety regression passed.

## Approved live rollout procedure

1. Review the exact release diff and preserve unrelated local work (including the existing workspace notice). Obtain deployment/activation approval. Take a recoverable production database backup and retain its verification result.
2. Apply `2026-09-28-required-password-change.sql` through the migration ledger, verify schema and trigger, then deploy backend and frontend together. The migration alone enrols nobody.
3. Verify health, login and customer access. Run `node scripts/require-staff-password-change.js` on the production server to preview current active internal accounts, excluding customer-linked accounts. Review the returned list and count. The earlier browser snapshot had 36 active ATEC users; it is not an activation allowlist.
4. Activate the reviewed scope using `node scripts/require-staff-password-change.js --apply --expected-sha <reviewed-sha> --actor <administrator-id>`. The script locks users, rechecks the entire scope, updates flags/versions and writes per-user audit records in one transaction. A recorded campaign cannot be reapplied accidentally.
5. Verify that an old staff session is rejected, a newly authenticated affected staff member sees only the required-change screen, and real staff can complete their own password change. Do not enter or collect their new passwords. Verify customer login remains unaffected and no customer was flagged by the campaign.
6. Track completion using the campaign's audit `record_id` values joined to `tblusers.must_change_password` and `password_changed_at`; do not treat a login or verbal confirmation as proof. Check login failures and users needing administrator assistance.

## Limits and recovery

- Never clear the requirement merely to dismiss the screen. An administrator can perform the normal identity-checked password recovery; the staff member then chooses their own password.
- This changes known passwords and ends old sessions. It cannot prove who is typing a shared current password, or prevent future voluntary password sharing. Suspected impersonation needs individual identity verification.
- Each protected request adds a database lookup. An unavailable database denies access rather than relying on stale token claims. Validate normal production response times after rollout.
- If application rollback is necessary, retain the new columns and audit records. Reverting to token-only authentication loses the enforcement/revocation protection; do not call that a completed security rollout.
- Previously loaded screens/data cannot be erased remotely; subsequent protected requests are denied and the existing session check refreshes open pages.
