# ATEC Performance And Production Capacity

This is the authoritative production performance guide for ATEC. It supersedes the older short notes in `deployment/performance-maintenance.md`; keep that file only as a quick operational pointer.

Do not run production load tests from Codex. Do not apply database indexes without a verified backup and an approved maintenance plan.

## Task 11 Audit Findings

- Assets: `/assets` and `/inspections/assets` use server-side pagination with validated page size, search field allowlist, sort allowlist, role/customer scoping, `LIMIT`, and `OFFSET`.
- Certificates: `/certificates/search` uses server-side pagination, summary counts, sort allowlist, role/customer scoping, and parameterised SQL.
- Reports: `/reports/customer-detailed` uses server-side pagination for preview and enforces export row caps for PDF/XLSX.
- Dashboard: summary work is grouped and cached in-process; queries use CTEs and `Promise.allSettled` to avoid one failed widget breaking all summary data.
- Pool: backend pool values now use bounded fallbacks from `backend/services/runtimeConfig.js`.
- Slow requests: backend records safe aggregate metrics and logs structured slow entries without request bodies, cookies, tokens, SQL or parameter values.
- PDF: Chromium/PDF work is queued with `PDF_CONCURRENCY`; bulk certificate jobs are capped with `BULK_PDF_MAX_CERTIFICATES`.
- Uploads: image compression uses bounded width, height, quality, minimum-size and concurrency settings.
- System Health: Admin-only `/api/admin/system-info` exposes safe pool, PDF queue and recent request-performance summaries.

## Environment Variables

Recommended production defaults:

```env
DB_POOL_MAX=15
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=5000
DB_STATEMENT_TIMEOUT_MS=30000
DB_QUERY_TIMEOUT_MS=30000
SLOW_REQUEST_MS=2000
REQUEST_TIMEOUT_MS=900000
PDF_CONCURRENCY=1
BULK_PDF_MAX_CERTIFICATES=50
REPORT_EXPORT_MAX_ROWS=10000
UPLOAD_IMAGE_MAX_WIDTH=1600
UPLOAD_IMAGE_MAX_HEIGHT=1600
UPLOAD_IMAGE_QUALITY=72
UPLOAD_COMPRESS_MIN_BYTES=512000
UPLOAD_COMPRESSION_CONCURRENCY=2
```

All numeric values are bounded in code. Invalid values fall back safely.

## Database Index Deployment

Existing index files:

- `database/2026-06-30-performance-indexes.sql`
- `database/2026-07-02-pg-trgm-search-indexes.sql`
- `database/2026-07-14-task11-performance-capacity-indexes.sql`

The Task 11 index file is idempotent and uses `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. It supports:

- latest inspection lookup by asset/type/date
- certificate date/status/type filters
- active customer-scoped asset queries
- customer/site/section report filters
- responsible-person filters
- SHE risk assessment filters

Production commands, not executed by this task:

```bash
cd /var/www/atec/ATEC
psql -h 127.0.0.1 -U fbcranes -d fbcranes -f database/2026-06-30-performance-indexes.sql
psql -h 127.0.0.1 -U fbcranes -d fbcranes -f database/2026-07-02-pg-trgm-search-indexes.sql
psql -h 127.0.0.1 -U fbcranes -d fbcranes -f database/2026-07-14-task11-performance-capacity-indexes.sql
```

If `pg_trgm` extension creation is not allowed, ask the database administrator to create the extension once, then rerun the trigram index script.

## Safe EXPLAIN Usage

Use read-only EXPLAIN on staging or during an approved production maintenance window:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM atec.tblinspection i
JOIN atec.tblasset a ON a.assetid = i.assetid
WHERE a.clientid = 1
  AND i.testdate >= current_date - interval '1 year';
```

Do not paste customer data, credentials or raw production result rows into tickets or chat logs.

## Pagination Behaviour

- Default page size: 25.
- Maximum page size: 250.
- Sort fields are whitelisted.
- Sort direction is restricted to ascending or descending.
- Customer users remain scoped to their own customer records.
- Frontend searches on Assets are debounced.
- Filter changes reset heavy pages to page 1.

## Monitoring

Admin System Health URL:

```text
https://www.atecinspections.co.za/api/admin/system-info
```

Review:

- `database.pool.max`, `total`, `idle`, `waiting`
- `performance.recentSlowRequestCount`
- `performance.recentAverageMs`
- `performance.recentMaxMs`
- `pdf.active`, `pdf.queued`, `pdf.failed`
- memory status
- disk and backup status

Slow request logs include method, route label, status and duration only.

## Capacity Assumptions

The defaults support bulk certificate dumps up to 50 certificates, with a hard application maximum of 100. Keep `PDF_CONCURRENCY=1` unless memory testing proves the server can safely handle more; large PDF jobs should queue rather than run many Chromium/PDF jobs at the same time. Single-certificate jobs receive queue priority over bulk jobs that have not started.

Use controlled localhost or staging load testing before raising:

- `DB_POOL_MAX`
- `PDF_CONCURRENCY`
- `BULK_PDF_MAX_CERTIFICATES`
- `REPORT_EXPORT_MAX_ROWS`

## Upload Performance

New asset and inspection photos are compressed when they meet the minimum size threshold. Signatures are not recompressed. Existing media compression remains a separate dry-run-first maintenance action:

```bash
cd /var/www/atec/ATEC/backend
npm run compress-uploads:check
npm run compress-uploads
```

## Rollback

- Code rollback: revert the deployment and restart PM2.
- Index rollback: only remove a new index if EXPLAIN or operational evidence shows harm. Use `DROP INDEX CONCURRENTLY IF EXISTS atec.<index_name>;`.
- Config rollback: restore the previous backend `.env` and restart with `pm2 restart atec-backend --update-env`.

## Production Verification

Commands, not executed by this task:

```bash
cd /var/www/atec/ATEC
node --check backend/server.js
node --check backend/db.js
node --check backend/services/runtimeConfig.js
npm run test:task11
cd frontend && npm run build
pm2 restart atec-backend --update-env
```

Then log in as Admin and confirm System Health is healthy or warning-free for the changed area.

## Known Limitations

- Offset pagination is acceptable for current expected scale, but keyset pagination may be better for very deep asset/certificate result pages later.
- Dashboard metrics are still live SQL; if customer volume grows substantially, consider materialized summaries.
- The frontend bundle is moderate and still mostly eager-loaded. Larger route-level lazy loading would require a broader frontend refactor.
