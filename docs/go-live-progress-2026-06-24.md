# ATEC Go-Live Progress - 2026-06-24

## Completed In This Pass

- Added production-safe frontend API helper using `VITE_API_URL`.
- Removed hardcoded frontend `http://localhost:5000` API/file links from source pages.
- Added Vite base path `/atec/`.
- Updated frontend favicon and title for `/atec/` deployment.
- Tightened backend production CORS default to `https://www.fbcranes.co.za`.
- Added production cookie path support for `/atec`.
- Added configurable uploads root using `UPLOADS_PATH`.
- Added production deployment notes for reverse proxy setup.
- Updated backend and frontend environment examples.
- Consolidated backend certificate PDFs so single PDF, bulk PDF, and email PDF now use the same HTML/Puppeteer PDF path.
- Centralized backend certificate regulation note selection for the HTML PDF path.
- Updated protected upload file resolution to respect `UPLOADS_PATH`.

## Verification

- Frontend production build passed.
- Backend `server.js` syntax check passed.
- Backend `middleware/security.js` syntax check passed.
- Built frontend assets are emitted under `/atec/`.
- Single certificate PDF, bulk PDF, and email PDF now share `createCertificatePdfBuffer` / `createBulkCertificatesPdfBuffer`.

## Backup Proof

Fresh backup created successfully:

- Folder: `D:\ATECBackups\atec-20260624-194206`
- Database dump: `D:\ATECBackups\atec-20260624-194206\fbcranes-20260624-194206.dump`
- Uploads zip: `D:\ATECBackups\atec-20260624-194206\uploads-20260624-194206.zip`
- Manifest: `D:\ATECBackups\atec-20260624-194206\manifest.json`

## Restore Test Status

Restore test was skipped by business decision on 2026-06-24.

Technical note from attempted restore:

- The configured database user can read and dump the live database.
- The configured database user cannot create a separate restore-test database.
- `createdb.exe` is also not available in the pgAdmin runtime folder.

Recommended future action:

- Create a separate restore database manually, for example `atec_restore_test_20260624_194206`, using a PostgreSQL admin account.
- Then rerun `scripts\verify-restore-atec.ps1` with `-SkipCreateDatabase`.

## Remaining Go-Live Tasks

1. Finish full certificate consolidation by moving frontend preview/modal/bulk print onto the same backend HTML layout endpoint, or accept the current two-engine split for go-live.
2. Complete route-by-route RBAC and customer isolation testing.
3. Final UAT on visual inspections, load tests, photos, certificates, and PDFs.
4. Finish SMTP/email templates and final production mailbox configuration.
5. QR batch printing is moved out of go-live scope.
6. SHE is marked as internal prototype only for go-live.
