# ATEC Performance And Maintenance Notes

These steps keep ATEC fast and stop photos/backups from quietly filling the server.

## 1. Compress New Uploads

The backend now compresses new asset and inspection photos automatically.

Recommended production settings in `backend/.env`:

```env
UPLOAD_IMAGE_MAX_WIDTH=1600
UPLOAD_IMAGE_MAX_HEIGHT=1600
UPLOAD_IMAGE_QUALITY=72
UPLOAD_COMPRESS_MIN_BYTES=512000
```

Restart the backend after changing these values:

```bash
pm2 restart atec-backend --update-env
```

## 2. Compress Existing Uploads

Always run the dry check first:

```bash
cd /var/www/atec/ATEC/backend
npm run compress-uploads:check
```

If the report looks right, compress the files:

```bash
cd /var/www/atec/ATEC/backend
npm run compress-uploads
```

This keeps the same filenames, so database photo links do not need to change.

## 3. Apply Performance Indexes

Run this once after a backup:

```bash
psql -h localhost -U fbcranes -d fbcranes -f /var/www/atec/ATEC/database/2026-06-30-performance-indexes.sql
```

Indexes speed up asset searches, certificate searches, reports and inspection history.

## 4. Weekly Health Check

Run:

```bash
bash /var/www/atec/ATEC/scripts/atec-server-health-check.sh
```

Check:

- Disk space should ideally stay below 75%.
- Backups should show files from the last 24 hours.
- Uploads folder size should not grow unexpectedly.
- `atec-backend` should show as online.

## 5. Bigger Future Performance Work

The next larger performance upgrade is server-side pagination for heavy pages like Assets and Certificates. That is more involved because the frontend currently keeps many records in memory for searching, sorting and page navigation.
