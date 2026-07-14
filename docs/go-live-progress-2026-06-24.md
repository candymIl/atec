# ATEC Go-Live Progress - 2026-06-24

## Completed In This Pass

- Added production-safe frontend API helper using `VITE_API_URL`.
- Removed hardcoded frontend `http://localhost:5000` API/file links from source pages.
- Historical note: added support for the retired subpath deployment shape.
- Historical note: updated frontend favicon and title for the retired subpath deployment.
- Historical note: tightened backend production CORS default at the time. Current production origin is `https://www.atecinspections.co.za`.
- Historical note: added production cookie path support for the retired subpath deployment.
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
- Historical note: built frontend assets were emitted under the retired subpath deployment shape at that time.
- Single certificate PDF, bulk PDF, and email PDF now share `createCertificatePdfBuffer` / `createBulkCertificatesPdfBuffer`.

## Backup Proof

Fresh backup created successfully:

- Historical Windows local backup evidence was created during that pass.

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
