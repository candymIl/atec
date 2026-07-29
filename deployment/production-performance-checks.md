# ATEC Production Performance Checks

This checklist is a deployment companion to the authoritative guide in `docs/performance-and-capacity.md`.

Use these checks after deploying the performance changes.

## 1. Run Required Index Scripts

Run these against the production `fbcranes` database:

```bash
cd /var/www/atec/ATEC
psql -h localhost -U fbcranes -d fbcranes -f database/2026-06-30-performance-indexes.sql
psql -h localhost -U fbcranes -d fbcranes -f database/2026-07-02-pg-trgm-search-indexes.sql
psql -h localhost -U fbcranes -d fbcranes -f database/2026-07-14-task11-performance-capacity-indexes.sql
```

If `CREATE EXTENSION pg_trgm` is denied, ask the server/database administrator to run only that extension command once, then rerun the script.

## 2. Verify Indexes Exist

```sql
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'atec'
  AND indexname IN (
    'idx_tblasset_serialno_trgm',
    'idx_tblasset_assettagno_trgm',
    'idx_tblasset_description_trgm',
    'idx_tblclients_clientname_trgm',
    'idx_tblsites_sitename_trgm',
    'idx_tblsection_sectionname_trgm'
  )
ORDER BY indexname;
```

## 3. Recommended Production Environment Values

```env
DB_POOL_MAX=15
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=5000
DB_STATEMENT_TIMEOUT_MS=30000
DB_QUERY_TIMEOUT_MS=30000
SLOW_REQUEST_MS=2000
REQUEST_TIMEOUT_MS=900000
PDF_CONCURRENCY=1
BULK_PDF_MAX_CERTIFICATES=100
REPORT_EXPORT_MAX_ROWS=10000
UPLOAD_COMPRESSION_CONCURRENCY=2
UPLOAD_IMAGE_MAX_WIDTH=1600
UPLOAD_IMAGE_MAX_HEIGHT=1600
UPLOAD_IMAGE_QUALITY=72
UPLOAD_COMPRESS_MIN_BYTES=512000
```

Restart the backend after changing `.env`:

```bash
pm2 restart atec-backend --update-env
```

## 4. Admin Health Check

Log in as an admin, then open:

```text
https://www.atecinspections.co.za/api/admin/system-info
```

Review:

- database pool `waiting` should normally be `0`
- recent slow request count should be low during normal use
- PDF `active` should stay within `PDF_CONCURRENCY`
- upload folder and database size should trend slowly, not spike unexpectedly
- server logs should not show frequent `SLOW_REQUEST` entries

## 5. Bulk PDF Rule

Bulk PDF jobs are capped at 100 certificates. Larger result sets are divided into numbered 100-certificate downloads by the Certificates page. Keep `PDF_CONCURRENCY=1` so large PDFs queue one at a time instead of running many Chromium jobs at once. Single-certificate jobs are prioritised over bulk jobs that are still waiting in the queue.
