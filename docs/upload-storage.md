# ATEC Upload Storage

Last verified: 2026-07-23

## Policy

Business media must live outside the application source tree. The application reads the active location from `UPLOAD_ROOT`; `UPLOADS_PATH` remains a compatibility alias.

Production startup enforces this policy:

- `UPLOAD_ROOT` or the compatibility alias must be configured.
- The resolved path must be outside the application source tree.
- The backend exits with a clear configuration error rather than silently creating an empty production media directory inside the checkout.

Development retains the legacy fallback to `backend/uploads` for disposable local environments.

Recommended locations:

- Windows: `D:\ATECData\uploads`
- Linux: `/var/lib/atec/uploads`

The upload root contains four operational areas:

- `assets`
- `inspections`
- `signatures`
- `job-cards`

These files are business records. They must be backed up together with the matching PostgreSQL database state.

## Local Migration Completed

On 2026-07-23 the existing `backend/uploads` store was copied to `D:\ATECData\uploads`.

Verification at copy time:

- Source files: 33,863
- Destination files: 33,863
- Source bytes: 1,889,664,525
- Destination bytes: 1,889,664,525

The local backend environment now uses:

```env
UPLOAD_ROOT=D:\ATECData\uploads
```

The backend was restarted after configuration and passed its health check. The verified legacy `backend/uploads` copy was then removed with explicit approval.

Current cutover state:

- External copy: healthy and byte-count matched.
- Backend environment: points to the external root.
- Backend service: restarted and healthy on port 5000.
- Backup: fresh database and media set is checksum-verified.
- Legacy in-workspace copy: removed.

## Verification

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-upload-storage.ps1
```

The check fails if the configured root is missing, empty, inside the Git workspace, or lacks the expected operational directories.

## Backup

The root backup tool resolves media in this order:

1. `BACKUP_MEDIA_ROOT`
2. `UPLOAD_ROOT`
3. `UPLOADS_PATH`
4. Legacy `backend/uploads` fallback

Production must set `UPLOAD_ROOT` explicitly so a missing environment file cannot silently create a new empty media store in the source checkout.
