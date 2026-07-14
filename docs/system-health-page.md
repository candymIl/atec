# ATEC System Health Page

The System Health page is an Admin-only operational page for confirming which ATEC build is running and whether the backend, database, disk and backup checks look healthy.

Local Codex changes are not automatically live. This page proves the live version only after the changes have been committed, pushed to GitHub, pulled onto Ubuntu, the frontend rebuilt and the backend restarted.

## Routes

- `GET /health`
  - Public minimal monitoring endpoint.
  - Returns only `{ "status": "ok" }`.
  - Does not expose database, server, Git or backup details.

- `GET /admin/system-info`
  - Detailed system endpoint.
  - Requires a valid session.
  - Restricted to `ADMIN` users.
  - Returns application, deployment, database, server, disk and backup status.
  - Task 10 backup fields include latest backup set ID, database/media timestamps, validation status, checksum status, restore-verification status, retention status and safe failure summary.
  - Task 11 performance fields include safe recent request aggregates and PDF queue metrics.
  - Production Admin URL through the proxy: `https://www.atecinspections.co.za/api/admin/system-info`.

## Page Location

The frontend page is named **System Health** and appears in the left navigation for Admin users only.

Managers, Inspectors, Viewers and Customer users should not see the menu item. If they try the API directly, they should receive `403`. Logged-out users should receive `401`.

## Optional Environment Variables

Backend:

```env
ATEC_BACKUP_ROOT=/var/www/atec/backups
BACKUP_MAX_AGE_HOURS=26
BACKUP_VERIFY_MAX_AGE_HOURS=30
RESTORE_VERIFY_MAX_AGE_HOURS=192
BACKUP_DAILY_RETENTION_DAYS=14
BACKUP_WEEKLY_RETENTION_WEEKS=8
BACKUP_MONTHLY_RETENTION_MONTHS=12
RESTORE_VERIFY_DB_PREFIX=atec_restore_verify_
RESTORE_VERIFY_ENABLED=false
BACKUP_MEDIA_ROOT=
BACKUP_LOCK_DIR=
DISK_WARNING_PERCENT=85
DISK_CRITICAL_PERCENT=95
MEMORY_WARNING_PERCENT=90
BUILD_ID=
BUILD_DATE=
FRONTEND_BUILD_ID=
```

Frontend build:

```env
VITE_BUILD_ID=
VITE_BUILD_TIMESTAMP=
```

`ATEC_BACKUP_ROOT` takes priority over the older `BACKUP_ROOT` value. If neither is set, the backend uses `/var/www/atec/backups`.

## Thresholds

- Backup: healthy when the latest successful manifest-backed backup is recent, checksum validation is successful, and restore verification is current.
- Warning: backup is approaching maximum age, validation is stale, restore verification is overdue, or restore verification has not yet been run.
- Critical: backup is missing, failed, corrupt, too old, has checksum mismatch, or restore verification failed.
- Legacy backup freshness: if no Task 10 manifest exists, the backend falls back to the older file freshness scan.
- Disk warning: used space at or above `85%`.
- Disk critical: used space at or above `95%`.
- Memory warning: system memory used at or above `90%`.
- Slow request warning context: recent slow request counts are based on `SLOW_REQUEST_MS`, default `2000`.
- PDF queue context: active and queued jobs should stay within `PDF_CONCURRENCY`.
- Auto refresh: frontend refreshes no faster than every `60` seconds.

## Git And Deployment Identity

The backend reads Git information with fixed `git -C <project> ...` commands. The endpoint accepts no command input from the browser.

If the production folder is not a Git checkout, Git fields return safe fallback values such as `unavailable` and deployment status becomes `Unverified`.

The frontend and backend deployment identifiers match only when the frontend build was created with the same identifier as the backend, for example:

```bash
export BUILD_ID="$(git rev-parse HEAD)"
export BUILD_DATE="$(date -Iseconds)"
export FRONTEND_BUILD_ID="$BUILD_ID"
export VITE_BUILD_ID="$BUILD_ID"
export VITE_BUILD_TIMESTAMP="$BUILD_DATE"
```

## Ubuntu Verification

After an approved production deployment:

```bash
cd /var/www/atec/ATEC
git rev-parse HEAD
git status --porcelain
pm2 status atec-backend
curl -fsS https://www.atecinspections.co.za/health
```

Then log in as Admin and open **System Health**.

Confirm:

- Running commit matches the expected Git commit.
- Database status is `Connected`.
- Backup status is `Current`.
- Disk is not `Critical`.
- Memory is `Healthy`.
- Frontend/backend deployment identifiers match when build IDs were supplied.

## Deployment Reminder

For this page to reflect a new version:

1. Commit the code.
2. Push to GitHub.
3. Pull on Ubuntu.
4. Install backend/frontend dependencies if needed.
5. Rebuild the frontend.
6. Restart the backend.
7. Refresh the System Health page as Admin.

Do not treat local Codex changes as live until those steps are complete.
