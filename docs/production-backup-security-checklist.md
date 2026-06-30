# ATEC Production Backup And Security Checklist

Use this checklist before ATEC goes online and then repeat it every month.

## Backup Proof

1. Create a fresh database and uploads backup:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-atec.ps1 -BackupRoot D:\ATECBackups
   ```

   If this says `Could not find pg_dump`, install the PostgreSQL client tools on the server or pass the full path:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-atec.ps1 `
     -BackupRoot D:\ATECBackups `
     -PgDumpPath "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
   ```

2. Confirm the backup folder contains:

   - `*.dump` database backup
   - `uploads-*.zip` uploaded photos and files, if uploads exist
   - `manifest.json` with SHA256 checksums

3. Copy the backup folder to an off-server location.

   Recommended locations:

   - external drive
   - secure cloud storage
   - separate server

4. Restore the backup into a test database, never into the live database:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-restore-atec.ps1 `
     -BackupDump D:\ATECBackups\atec-YYYYMMDD-HHMMSS\atec-YYYYMMDD-HHMMSS.dump `
     -RestoreDatabaseName atec_restore_test `
     -UploadsZip D:\ATECBackups\atec-YYYYMMDD-HHMMSS\uploads-YYYYMMDD-HHMMSS.zip `
     -RestoreUploadsPath D:\ATECBackups\restore-test-uploads
   ```

5. Confirm the restore output shows counts for:

   - clients
   - assets
   - inspections
   - inspection results
   - users

6. Keep the restore output and `manifest.json` as evidence that backups are working.

## Backup Schedule

- Database backup: daily.
- Uploads backup: daily.
- Off-server copy: daily.
- Restore test: monthly.
- Retention: keep 7 daily, 4 weekly, and 12 monthly backups.
- Before major changes: create a manual backup first.

## Security Settings To Confirm Before Online Use

In production, `backend\.env` must use real production values:

```env
NODE_ENV=production
FRONTEND_ORIGIN=https://www.fbcranes.co.za
COOKIE_SECURE=true
JWT_SECRET=use-a-long-random-secret-at-least-32-characters
```

Confirm these items:

- HTTPS is enabled.
- The backend is not publicly exposed except through the intended `/atec/api` route.
- PostgreSQL is not open to the internet.
- The database password is strong and not reused.
- Test users are removed or disabled.
- Every real user has the correct role.
- Admin accounts are limited to trusted people only.
- Upload folders are not executable.
- Uploaded files are limited to allowed image/PDF types where applicable.
- Backups are encrypted or stored in a protected location.
- The server firewall only allows required ports.
- Error messages shown to users do not expose database details.
- Audit logging is enabled for login, logout, inspections, certificates, assets, and user changes.

## Go-Live Security Test

Run these checks before giving customers access:

1. Log in as ADMIN and confirm all menus work.
2. Log in as INSPECTOR and confirm user management is hidden.
3. Log in as VIEWER and confirm edits are blocked.
4. Try opening a protected API URL while logged out and confirm it is rejected.
5. Upload a valid photo and confirm it saves.
6. Try uploading a non-image file where photos are expected and confirm it is rejected.
7. Generate a certificate PDF and confirm photos, signatures, and footer data display correctly.
8. Restore the latest backup to a test database and confirm the restored data opens in a test ATEC instance.

## Minimum Production Decision

ATEC should only go online when:

- The latest backup has been restored successfully into a test database.
- HTTPS and secure cookies are active.
- Admin, inspector, manager, viewer, and customer access have been tested.
- Certificate PDF output has been checked.
- Upload and restore of photos has been checked.
- A written rollback plan exists.
