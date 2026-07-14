# ATEC Backup And Disaster Recovery

This document describes the Task 10 backup verification and disaster recovery system. These commands are production instructions only. Do not run them from local Codex against the live database.

## Architecture

ATEC backup jobs are run from the repository root with `scripts/atec-backup.js`. The script writes timestamped backup-set folders under `ATEC_BACKUP_ROOT` and records evidence in `manifest.json`.

Each backup set can contain:

- PostgreSQL custom-format database dump created with `pg_dump`.
- Media archive of the persistent upload tree.
- SHA-256 checksums and file sizes.
- Validation result.
- Restore-verification result.
- Retention result.
- Safe failure summary.

The backend System Health endpoint reads these manifests through `backend/services/backupStatus.js`. The endpoint remains Admin-only.

## Backup Contents

Database:

- Production database name is read from `DB_NAME`.
- Live server database is expected to be `fbcranes`.
- Schema is expected to be `atec`.

Media:

- Default source is `BACKUP_MEDIA_ROOT`, then `UPLOAD_ROOT`, then `UPLOADS_PATH`, then `backend/uploads`.
- Current upload folders discovered in the repo are `assets`, `inspections`, and `signatures`.
- Archive excludes temporary files, logs, existing archives, cleanup archive folders, `node_modules`, `dist`, and `.git`.

## Required Environment

Use PostgreSQL-standard credential handling such as `.pgpass`. Do not put database passwords in cron files, command lines, docs, or logs.

Recommended production values:

```env
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

## Manual Commands

Run from `/var/www/atec/ATEC`.

Create a full backup and validate it:

```bash
npm run backup:create
```

Validate the latest successful backup:

```bash
npm run backup:validate
```

Run weekly isolated restore verification:

```bash
npm run backup:restore-verify
```

Preview retention:

```bash
npm run backup:retention:dry-run
```

Apply retention after reviewing the dry-run:

```bash
npm run backup:retention:apply
```

Show machine-readable status:

```bash
npm run backup:status
```

## Scheduling

Cron example, not installed by this task:

```cron
15 01 * * * cd /var/www/atec/ATEC && /usr/bin/npm run backup:create >> /var/log/atec-backup.log 2>&1
30 02 * * 0 cd /var/www/atec/ATEC && /usr/bin/npm run backup:restore-verify >> /var/log/atec-restore-verify.log 2>&1
45 02 * * * cd /var/www/atec/ATEC && /usr/bin/npm run backup:retention:dry-run >> /var/log/atec-retention.log 2>&1
```

Systemd timer is also acceptable. Use an environment file readable only by the service user, for example `/etc/atec/backup.env`, and set `EnvironmentFile=/etc/atec/backup.env`.

Disable cron by commenting the crontab lines with `crontab -e`. Disable systemd timers with:

```bash
sudo systemctl disable --now atec-backup.timer atec-restore-verify.timer
```

## Lock Behaviour

Each job creates a lock under `BACKUP_LOCK_DIR` or `<backup-root>/.locks`. A second overlapping job exits non-zero with a safe error.

## Validation

Validation confirms:

- Manifest files exist.
- Database/media files exist.
- Files are non-empty.
- SHA-256 checksums match.
- `pg_restore --list` can read the custom-format dump.
- `tar -tzf` can list the media archive.

## Restore Verification

Routine isolated restore verification:

- Requires `RESTORE_VERIFY_ENABLED=true`.
- Creates a temporary database with prefix `atec_restore_verify_`.
- Refuses `fbcranes`, the configured `DB_NAME`, `postgres`, and template databases.
- Restores the latest valid dump.
- Queries critical `atec` tables without exposing row data.
- Drops the temporary verification database after success or failure where possible.

Real production restore is different and requires explicit human approval.

## Retention

Defaults:

- Keep daily backups for 14 days.
- Keep weekly backups for 8 weeks.
- Keep monthly backups for 12 months.

Retention dry-run is the default. Actual deletion requires `npm run backup:retention:apply`. The script never deletes the newest successful backup, the only successful backup, folders without valid ATEC names, or folders without manifests.

## Offsite Copy

Backups must be copied off-server after creation and validation. Use a secure offsite destination such as encrypted object storage, a separate server, or a protected external backup system.

Example:

```bash
rsync -a --checksum /var/www/atec/backups/ backup-user@backup-host:/srv/atec-backups/
```

## Full Server Loss Runbook

1. Provision a fresh Ubuntu server.
2. Install Node.js, npm, PostgreSQL client tools, PostgreSQL server if locally hosted, Nginx, Git, and PM2.
3. Restore the ATEC repository into `/var/www/atec/ATEC`.
4. Restore `backend/.env` from the secure credentials store.
5. Create the PostgreSQL role and database.
6. Restore the approved database backup:

   ```bash
   pg_restore --host=127.0.0.1 --username=<db-user> --dbname=fbcranes --clean --if-exists --no-owner /path/to/fbcranes.dump
   ```

7. Restore media into the configured uploads path:

   ```bash
   mkdir -p /var/www/atec/ATEC/backend/uploads
   tar -C /var/www/atec/ATEC/backend/uploads -xzf /path/to/media.tar.gz
   ```

8. Install backend dependencies:

   ```bash
   cd /var/www/atec/ATEC/backend
   npm ci
   ```

9. Build frontend:

   ```bash
   cd /var/www/atec/ATEC/frontend
   npm ci
   npm run build
   ```

10. Configure Nginx from `deployment/nginx/atec.conf.example`.
11. Start or restart PM2:

    ```bash
    cd /var/www/atec/ATEC/backend
    pm2 start server.js --name atec-backend
    pm2 save
    ```

12. Verify:

    ```bash
    curl -fsS http://127.0.0.1:5000/health
    npm run backup:status
    ```

13. Restore DNS/SSL only after the application, database, media, and System Health checks are confirmed.

## Rollback And Failure Handling

- If backup creation fails, do not delete the previous successful backup.
- If validation fails, do not promote the backup as proven.
- If restore verification fails, investigate the manifest `lastFailure`, PostgreSQL logs, and `/var/log/atec-restore-verify.log`.
- For deployment rollback, restore the previous code release and use the last verified backup only with explicit approval.

## Local Test Commands

```bash
node --check backend/services/backupStatus.js
node --check scripts/atec-backup.js
node scripts/regression/task10-backup-dr.test.js
```

## Known Limitations

- The scripts depend on PostgreSQL client tools being available on the production server.
- Media archive listing uses `tar`, which is expected on Ubuntu.
- Restore verification proves database recoverability, not application-level correctness of every certificate PDF.
