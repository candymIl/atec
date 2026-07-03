# ATEC Production Performance Checks

Use these checks after deploying the performance changes.

## 1. Run Required Index Scripts

Run these against the production `fbcranes` database:

```bash
cd /var/www/atec/ATEC
psql -h localhost -U fbcranes -d fbcranes -f database/2026-06-30-performance-indexes.sql
psql -h localhost -U fbcranes -d fbcranes -f database/2026-07-02-pg-trgm-search-indexes.sql
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
PDF_CONCURRENCY=1
BULK_PDF_MAX_CERTIFICATES=50
REPORT_EXPORT_MAX_ROWS=10000
UPLOAD_COMPRESSION_CONCURRENCY=2
```

Restart the backend after changing `.env`:

```bash
pm2 restart atec-backend --update-env
```

## 4. Admin Health Check

Log in as an admin, then open:

```text
https://www.atecinspections.co.za/api/admin/system-health
```

Review:

- database pool `waiting` should normally be `0`
- PDF `active` should stay within `PDF_CONCURRENCY`
- upload folder and database size should trend slowly, not spike unexpectedly
- server logs should not show frequent `SLOW_REQUEST` entries

## 5. Bulk PDF Rule

Bulk PDF jobs are capped by `BULK_PDF_MAX_CERTIFICATES`. If users need more, download in smaller batches. This protects the server from running many Chromium/PDF jobs at the same time.
