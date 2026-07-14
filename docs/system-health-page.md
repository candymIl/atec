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

## Page Location

The frontend page is named **System Health** and appears in the left navigation for Admin users only.

Managers, Inspectors, Viewers and Customer users should not see the menu item. If they try the API directly, they should receive `403`. Logged-out users should receive `401`.

## Optional Environment Variables

Backend:

```env
ATEC_BACKUP_ROOT=/var/www/atec/backups
BACKUP_MAX_AGE_HOURS=26
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

- Backup: current when the newest database backup is no older than `26` hours.
- Disk warning: used space at or above `85%`.
- Disk critical: used space at or above `95%`.
- Memory warning: system memory used at or above `90%`.
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
