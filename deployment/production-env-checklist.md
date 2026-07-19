# ATEC Production Environment Checklist

Use this checklist when creating the live environment files on the server.

## Frontend

Create `frontend/.env.production` on the Ubuntu production server before building:

```env
VITE_API_URL=https://www.atecinspections.co.za/api
VITE_BASE_PATH=/
VITE_GOOGLE_MAPS_API_KEY=your_browser_restricted_google_maps_key
```

The Maps key must allow the live site origin and have the Maps JavaScript API and Places API enabled. The deployment script stops before publishing if this setting is absent.

Then build on Ubuntu:

```bash
cd /var/www/atec/ATEC/frontend
npm run build
```

Copy the contents of `frontend/dist` to the live web root for `https://www.atecinspections.co.za/`.

## Backend

Create `backend/.env` on the production server:

```env
NODE_ENV=production
PORT=5000

DB_HOST=
DB_PORT=5432
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_SCHEMA=atec

FRONTEND_ORIGIN=https://www.atecinspections.co.za
PUBLIC_APP_URL=https://www.atecinspections.co.za
PUBLIC_BASE_PATH=/
BACKEND_API_PREFIX=/api
TRUST_PROXY=1

JWT_SECRET=replace-with-a-long-random-production-secret
JWT_EXPIRES_IN=8h

COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_PATH=/

UPLOADS_PATH=/var/www/atec/ATEC/backend/uploads
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=ATEC <no-reply@atecinspections.co.za>

# Microsoft Graph application email (recommended for Microsoft 365)
MAIL_PROVIDER=graph
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
GRAPH_SENDER=certificates@atecinspections.co.za

ATEC_BACKUP_ROOT=/var/www/atec/backups
BACKUP_MEDIA_ROOT=/var/www/atec/ATEC/backend/uploads
BACKUP_MAX_AGE_HOURS=26
BACKUP_VERIFY_MAX_AGE_HOURS=30
RESTORE_VERIFY_MAX_AGE_HOURS=192
BACKUP_DAILY_RETENTION_DAYS=14
BACKUP_WEEKLY_RETENTION_WEEKS=8
BACKUP_MONTHLY_RETENTION_MONTHS=12
RESTORE_VERIFY_DB_PREFIX=atec_restore_verify_
RESTORE_VERIFY_ENABLED=true
BACKUP_LOCK_DIR=/var/www/atec/backups/.locks
```

## Live Verification

The live deployment helper now enforces this order automatically:

1. Create and validate a pre-migration backup.
2. Apply only migrations listed in `deployment/production-migrations.json`.
3. Record each applied filename and checksum in `atec.schema_migrations`.
4. Verify `deployment/production-schema-contract.json` against the live database.
5. Restart the backend only after all earlier checks pass.
6. Verify the website and API health endpoint.

When a release introduces a required database change, add its SQL filename to
`deployment/production-migrations.json` and add the required tables/columns to
`deployment/production-schema-contract.json` in the same commit. Never edit a
migration after it has been applied; create a new migration instead. A checksum
mismatch or missing schema requirement stops deployment while the existing
backend process remains running.

After deployment, confirm:

- `https://www.atecinspections.co.za/` opens the login page.
- Refresh/F5 on `https://www.atecinspections.co.za/` still opens the app.
- Login works and sets a secure `atec_session` cookie.
- `https://www.atecinspections.co.za/api/health` returns `{ "status": "ok" }` through the proxy.
- `https://www.atecinspections.co.za/api/admin/system-info` returns detailed System Health JSON for Admin sessions.
- Asset photos load after login.
- A certificate preview opens.
- A single certificate PDF downloads.
- A bulk PDF download works for a small selection.
- Logout clears the session.
