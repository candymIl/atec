# ATEC Technical Handover Document

Last reviewed: 2026-06-29  
Repository root: `D:\Projects\ATEC`

## 1. Project Overview

ATEC is a web-based lifting-equipment inspection and certificate management system for FB Cranes / ATEC operations. It stores customers, sites, sections, responsible persons, lifting assets, equipment-type inspection criteria, inspection records, inspection photos, certificates, SHE risk assessments, and operational dashboards.

Main features:

- Secure login with roles for administrators, managers, inspectors, viewers, and customer users.
- Customer, site, section, responsible-person, asset, and user management.
- Asset photo upload and QR-code lookup/label generation.
- Visual and load-test inspection capture with equipment-specific criteria.
- Critical-failure rule that automatically marks equipment as not safe when critical inspection criteria fail.
- Certificate search, preview, PDF download, bulk print, bulk PDF, deletion, and email.
- Customer detailed reports in JSON, PDF, and Excel formats.
- SHE risk register with PDF and Excel export.
- Dashboards for asset counts, failed equipment, upcoming expiries, overdue work, and alerts.
- Authenticated uploads for asset photos, inspection photos, and user signatures.
- Audit logging for login, logout, writes, certificate actions, uploads, and security-relevant events.

High-level architecture:

- Browser client served as a Vite static build from `/`.
- Node.js Express API served behind a reverse proxy under `/api/`.
- PostgreSQL database with the application data under the `atec` schema.
- Filesystem upload storage for photos and signatures.
- Optional SMTP server for emailing certificate PDFs.
- Optional Chromium/Edge executable used by `puppeteer-core` for HTML-to-PDF certificate generation.

Overall workflow:

1. A user signs in through the frontend.
2. The backend validates the username/email and password against `atec.tblusers`.
3. The backend sets an HTTP-only `atec_session` cookie containing a JWT.
4. All protected API calls use the cookie, or a Bearer token, and pass through role authorization.
5. Administrators/managers maintain master data and assets.
6. Inspectors create inspections for assets, upload inspection photos, and record criteria results.
7. The system stores inspection rows, inspection-result rows, photos, and calculated safety status.
8. Users generate certificates, QR labels, dashboards, SHE reports, and customer reports from stored data.

## 2. Technology Stack

Programming languages:

- JavaScript, CommonJS in the backend.
- JavaScript, ES modules in the frontend.
- SQL for PostgreSQL migrations.
- PowerShell scripts for backup and restore verification.

Backend:

- Node.js with Express.
- Observed local Node version: `v24.16.0`.
- Observed local npm version: `11.13.0`.
- No `engines` field is declared. For production, pin a current Node.js LTS release, test the app on it, and document the chosen version on the server.

Frontend:

- Vite static frontend.
- Vite base path is `/` for current production.
- The frontend is mostly plain JavaScript in `frontend/src/main.js` with page modules under `frontend/src/pages`.

Package manager:

- npm, with `package-lock.json` files in the repository root, `backend`, and `frontend`.

Database:

- PostgreSQL.
- Application schema: `atec`.
- Backend library: `pg`.

Required server software:

- Linux server.
- Node.js and npm.
- PostgreSQL server or reachable PostgreSQL instance.
- Nginx or Apache as a reverse proxy.
- Certbot or another SSL certificate manager.
- PostgreSQL client tools: `psql`, `pg_dump`, and `pg_restore`.
- A Chromium-compatible executable if certificate PDF rendering needs `puppeteer-core`.
- SMTP account if certificate emailing is required.

Important third-party backend libraries:

- `express`: HTTP API.
- `pg`: PostgreSQL client.
- `dotenv`: environment loading.
- `cors`: CORS.
- `cookie-parser`: cookie handling.
- `helmet`: security headers.
- `express-rate-limit`: login rate limiting.
- `jsonwebtoken`: session token signing and verification.
- `bcryptjs`: password hashing and comparison.
- `multer`: file uploads.
- `sharp`: image handling dependency.
- `pdfkit`: PDF creation for labels, reports, and certificate-related output.
- `exceljs`: Excel export.
- `qrcode`: QR code generation.
- `nodemailer`: certificate email.
- `puppeteer-core`: browser-backed PDF rendering.

Frontend dependencies:

- `vite`.
- No React package is currently declared in `frontend/package.json`, although there are `.jsx`/React-looking files. Treat the actual app entry point as `frontend/src/main.js` unless dependencies are updated.

## 3. Folder Structure

Repository root:

- `package.json`: root package file. Currently only declares `multer`; the real application dependencies are in `backend/package.json` and `frontend/package.json`.
- `package-lock.json`: lock file for the root package.
- `.gitignore`: ignore rules. This file is currently modified in the working tree.
- `node_modules`: root dependency folder. Do not deploy this folder directly; install dependencies on the server.

`backend`:

- Main Node.js API application.
- `backend/server.js`: Express application, middleware setup, auth, authorization, uploads, all API routes, PDF/Excel generation, email sending, and server startup.
- `backend/db.js`: PostgreSQL `Pool` configured from `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`.
- `backend/package.json`: backend scripts and dependencies.
- `backend/package-lock.json`: exact backend dependency lock.
- `backend/.env.example`: complete example backend environment file.
- `backend/uploads`: legacy fallback upload root when neither `UPLOAD_ROOT` nor `UPLOADS_PATH` is set. Current Windows development uses the external `D:\ATECData\uploads` store.

`backend/middleware`:

- `backend/middleware/security.js`: JWT helpers, cookie options, `requireAuth`, role helpers, audit logger, async route wrapper, centralized error handler, upload MIME/extension validation, filename sanitization, and file magic-byte validation.

Upload storage:

- `assets`: asset photos.
- `inspections`: inspection photos.
- `signatures`: inspector/user signature images.
- `job-cards`: job-card photos and customer signatures.
- These directories contain business data and must be backed up with the matching database.
- Keep the active store outside the source tree. Prefer `UPLOAD_ROOT=D:\ATECData\uploads` on Windows or `UPLOAD_ROOT=/var/lib/atec/uploads` on Linux.
- `UPLOADS_PATH` remains a compatibility alias.

`frontend`:

- Vite frontend project.
- `frontend/index.html`: app HTML shell.
- `frontend/vite.config.js`: sets `base` from `VITE_BASE_PATH` and defaults to `/`.
- `frontend/package.json`: frontend npm scripts.
- `frontend/.env.example`: frontend API URL example.
- `frontend/src/main.js`: primary app entry and much of the UI logic.
- `frontend/src/api.js`: API base URL and asset URL helpers.
- `frontend/src/style.css` and `frontend/src/App.css`: application styling.
- `frontend/src/pages`: page-specific modules.
- `frontend/src/tableSort.js` and `pagination.js`: UI utility modules.
- `frontend/src/assets`: source assets.

`frontend/public`:

- Static public assets copied into the Vite build.
- `logo.png`, `header.jpg`, `footer.jpg`, `favicon.svg`, `icons.svg`.
- `.htaccess` and `web.config` support static hosting fallback on Apache/IIS.

`database`:

- SQL migration and data-correction scripts.
- Scripts are date-prefixed and should be run in chronological order against a database that already contains the historical ATEC schema and data.
- There is no full baseline schema dump in this repository. A server migration should use a verified production backup/restore as the baseline, then apply any missing scripts.

`deployment`:

- Deployment examples and production checklist.
- `deployment/nginx/atec.conf.example`: Nginx reverse proxy and static frontend example.
- `deployment/apache/atec.conf.example`: Apache reverse proxy and static frontend example.
- `deployment/iis/web.config.example`: IIS rewrite/proxy example.
- `deployment/production-env-checklist.md`: production environment checklist.
- `deployment/cpanel-public-html-root-redirect.htaccess.example`: optional legacy `/Atec` redirect.
- `deployment/atec-frontend-public_html-atec.zip`: generated frontend package artifact.

`docs`:

- Existing deployment, backup, security, go-live, and scope notes.
- This file is the full technical handover.

`scripts`:

- `scripts/backup-atec.ps1`: creates a PostgreSQL custom dump, zips uploads, and writes a SHA256 manifest.
- `scripts/verify-restore-atec.ps1`: restores a backup into a test database and verifies key counts.
- `scripts/cleanup-orphaned-asset-images.js`: utility for cleaning orphaned upload files.

`tmp`:

- Temporary working files generated during development/testing. Do not deploy.

`api`, `config`, `services`, `utilities`, `logs`:

- These folders are not present as dedicated top-level folders.
- API routes are currently centralized in `backend/server.js`.
- Configuration is environment-variable based, with examples in `.env.example` files and reverse proxy templates under `deployment`.
- Services/utilities are mostly inline helper functions in `backend/server.js` plus `backend/db.js` and `backend/middleware/security.js`.
- Runtime logs are currently standard output/error from the Node process and reverse proxy logs, not a project-local `logs` folder.

## 4. Database

Database type:

- PostgreSQL.
- Schema: `atec`.
- Connection method: backend uses `pg.Pool` from `backend/db.js`.

Core tables used by the application:

- `atec.tblclients`: customers. Primary key: `clientid`.
- `atec.tblsites`: customer sites. Primary key: `siteid`. Foreign key: `clientid -> tblclients.clientid`.
- `atec.tblsection`: site sections/departments. Primary key: `sectionid`. Foreign keys include `clientid -> tblclients.clientid`, `siteid -> tblsites.siteid` where clean, and `responsibleid -> tblpeople.personid`.
- `atec.tblpeople`: responsible persons. Primary key: `personid`. Foreign key: `clientid -> tblclients.clientid`.
- `atec.tblasset`: lifting assets. Primary key: `assetid`. Foreign keys include `clientid`, `siteid`, `sectionid`, `responsibleid`, and `equiptypeid`.
- `atec.tblequipgroup`: equipment groups. Primary key: `equipgroupid`.
- `atec.tblequiptype`: equipment types. Primary key: `equiptypeid`. Foreign key: `equipgroupid -> tblequipgroup.equipgroupid`.
- `atec.tblequiptypecriteria`: inspection criteria by equipment type. Primary key: `criteriaid`. Foreign key: `equiptypeid -> tblequiptype.equiptypeid`.
- `atec.tblinspection`: inspection/certificate header rows. Primary key: `testid`. Foreign keys include `assetid -> tblasset.assetid` and `inspector_user_id -> tblusers.userid`.
- `atec.tblinspectionresult`: criteria results for an inspection. Foreign keys: `testid -> tblinspection.testid`, `criteriaid -> tblequiptypecriteria.criteriaid`.
- `atec.tblinspectionphoto`: additional inspection photos. Primary key: `photoid`. Foreign keys: `testid -> tblinspection.testid`, `uploaded_by_user_id -> tblusers.userid`.
- `atec.tblusers`: application users. Primary key: `userid`.
- `atec.audit_log`: audit events. Primary key: `audit_id`. Foreign key: `user_id -> tblusers.userid`.
- `atec.tblriskassessment`: SHE risk register. Primary key: `riskid`. Foreign key: `assetid -> tblasset.assetid`.
- `atec.tblinspectionresult_orphan_archive`: archive table for orphan inspection result cleanup.

Important relationships:

- Customer has many sites, sections, responsible persons, and assets.
- Site has many sections and assets.
- Section has many assets.
- Equipment type has many criteria and many assets.
- Asset has many inspections and inspection photos.
- Inspection has many inspection results and inspection photos.
- User can be an inspector for many inspections and can upload many inspection photos.
- Customer users are scoped to `clientid`.

Required seed data:

- Existing customers, sites, sections, assets, equipment groups, equipment types, equipment criteria, users, and historical inspection data are required for meaningful operation.
- This repository does not include a single clean baseline seed file.
- The migration scripts include criteria seed/update rows for specific equipment types and safety checks.
- At least one active admin user must exist in `atec.tblusers`. The security migration includes instructions for generating a bcrypt hash and inserting an admin.

Migration process:

1. Restore a verified production database backup into PostgreSQL.
2. Confirm the `atec` schema exists.
3. Apply SQL scripts in `database` in filename/date order.
4. Review any scripts that intentionally skip constraints if legacy data is dirty.
5. Re-run scripts only if needed; they are generally written to be repeatable with `IF NOT EXISTS`, `ON CONFLICT`, or guarded blocks.
6. Run smoke tests after migrations: login, load customers/assets, create a test inspection, generate a certificate, and verify reports.

Key migrations:

- `2026-06-23-security-access-control.sql`: roles, active users, audit log, inspector metadata on inspections.
- `2026-06-23-phase-1-core-primary-keys-clean-foreign-keys.sql`: sequences, primary keys, foreign keys, indexes.
- `2026-06-23-phase-1-fix-tblinspection-testid-primary-key.sql`: fixes `tblinspection.testid` as the inspection primary key.
- `2026-06-23-phase-1-archive-orphan-inspection-results-add-fk.sql`: archives orphaned inspection results and adds result foreign keys.
- `2026-06-23-phase-3-qr-asset-labels.sql`: adds asset QR code support.
- `2026-06-23-phase-5-she-risk-assessments.sql`: creates SHE risk assessment table.
- `2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql`: criteria metadata, inspection photo table, overhead crane criteria, critical safety rule fields.
- `2026-06-24-*`: equipment-specific criteria and safe-service checks.
- `2026-06-26-add-additional-comments-criteria-401-402-404-406.sql`: extra criteria rows.

## 5. Environment Variables

Backend variables:

- `DB_HOST`: PostgreSQL host.
- `DB_PORT`: PostgreSQL port, usually `5432`.
- `DB_NAME`: PostgreSQL database name.
- `DB_USER`: database username.
- `DB_PASSWORD`: database password.
- `PORT`: backend HTTP port, default `5000`.
- `NODE_ENV`: `development` or `production`.
- `FRONTEND_ORIGIN`: comma-separated allowed browser origins for CORS.
- `JWT_SECRET`: required, at least 32 characters. Used to sign and verify sessions.
- `JWT_EXPIRES_IN`: JWT lifetime, default `8h`.
- `COOKIE_SECURE`: `true` in HTTPS production.
- `COOKIE_SAME_SITE`: cookie SameSite value, normally `lax`.
- `COOKIE_PATH`: cookie path. Use `/` for current production.
- `PUBLIC_APP_URL`: public frontend URL, used in QR labels and generated links.
- `PUBLIC_BASE_PATH`: frontend base path, currently `/`.
- `BACKEND_API_PREFIX`: mounted API prefix, normally `/api` in production.
- `TRUST_PROXY`: set to `1` behind Nginx/Apache/SSL proxy.
- `UPLOAD_ROOT`: preferred upload-storage variable. It is mandatory in production and must resolve outside the application source tree.
- `UPLOADS_PATH`: compatibility alias for older environments. Development may fall back to `backend/uploads`; production does not.
- `BACKUP_ROOT`: optional default backup location for `scripts/backup-atec.ps1`.
- `PUPPETEER_EXECUTABLE_PATH`: path to Chromium/Edge when Chromium is not bundled.
- `SMTP_HOST`: SMTP server host.
- `SMTP_PORT`: SMTP server port, default `587`.
- `SMTP_SECURE`: `true` for implicit TLS, usually port `465`.
- `SMTP_USER`: SMTP username.
- `SMTP_PASS`: SMTP password.
- `MAIL_FROM`: sender address used for certificate email.
- `MAIL_PROVIDER`: set to `graph` to use Microsoft Graph; otherwise the SMTP transport is used.
- `GRAPH_TENANT_ID`: Microsoft Entra tenant ID for application authentication.
- `GRAPH_CLIENT_ID`: Microsoft Entra application/client ID.
- `GRAPH_CLIENT_SECRET`: Microsoft Entra application secret. Store and rotate it as a production secret.
- `GRAPH_SENDER`: licensed/shared mailbox used by the Graph `sendMail` endpoint.

Frontend variables:

- `VITE_API_URL`: full API base URL. Production example: `https://www.atecinspections.co.za/api`.

Production backend example:

```env
NODE_ENV=production
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=atec
DB_USER=atec_app
DB_PASSWORD=replace-with-strong-password
FRONTEND_ORIGIN=https://www.atecinspections.co.za
PUBLIC_APP_URL=https://www.atecinspections.co.za
PUBLIC_BASE_PATH=/
BACKEND_API_PREFIX=/api
TRUST_PROXY=1
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
JWT_EXPIRES_IN=8h
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_PATH=/
UPLOAD_ROOT=/var/lib/atec/uploads
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=atec@example.com
SMTP_PASS=replace-with-secret
MAIL_FROM=ATEC <no-reply@example.com>
```

## 6. API Documentation

All API endpoints except `GET /` and `POST /auth/login` require authentication. In production, endpoints are normally accessed under `/api`, for example `/api/auth/login`. The backend can also accept stripped paths such as `/auth/login`.

Authentication:

- Cookie: `atec_session`, HTTP-only JWT.
- Alternative: `Authorization: Bearer <jwt>`.

Standard error response:

```json
{ "error": "An unexpected server error occurred" }
```

Auth endpoints:

| Method | URL | Parameters | Auth | Response |
| --- | --- | --- | --- | --- |
| GET | `/` | none | none | text: `ATEC backend is running` |
| POST | `/auth/login` | JSON: `username`, `password` | none, rate-limited | `{ "user": { "user_id": 1, "username": "admin", "role": "ADMIN" } }` and session cookie |
| POST | `/auth/logout` | none | any logged-in user | `{ "success": true }` |
| GET | `/auth/me` | none | any logged-in user | `{ "user": { ... } }` |

Users:

| Method | URL | Parameters | Auth | Response |
| --- | --- | --- | --- | --- |
| GET | `/users` | none | admin | array of users |
| POST | `/users` | JSON: `username`, `email`, `password`, `full_name`, `role`, `lmi_number`, `clientid`, `siteid`, `sectionid`, `is_active` | admin | created user |
| PUT | `/users/:id` | same as create; optional `password` | admin | updated user |
| DELETE | `/users/:id` | `id` path parameter | admin | `{ "success": true, "user": { ... } }`; soft-deactivates |
| POST | `/users/me/signature` | multipart `signature` | current user | `{ "user": { ... } }` |
| POST | `/users/:id/signature` | multipart `signature` | admin | `{ "user": { ... } }` |
| POST | `/users/:id/reset-password` | JSON: `password` | admin | `{ "success": true }` |

Customers, sites, sections, and responsible persons:

| Method | URL | Parameters | Auth | Response |
| --- | --- | --- | --- | --- |
| GET | `/customers` | none | manager/admin read; customer restrictions handled elsewhere | customer array |
| POST | `/customers` | JSON: `clientname`, `clientaddr` | admin | created customer |
| PUT | `/customers/:id` | JSON: `clientname`, `clientaddr` | admin | updated customer |
| PUT | `/customers/:id/archive` | `id` | admin | `{ "success": true }`; cascades archive flag to sites, sections, people, assets |
| PUT | `/customers/:id/unarchive` | `id` | admin | `{ "success": true }`; cascades unarchive flag |
| GET | `/sites` | none | authenticated read roles | site array |
| POST | `/sites` | JSON: `clientid`, `sitename` | admin | created site |
| PUT | `/sites/:id` | JSON: `sitename` | admin | updated site |
| PUT | `/sites/:id/archive` | `id` | admin | archived site; blocked if active assets exist |
| PUT | `/sites/:id/unarchive` | `id` | admin | unarchived site |
| GET | `/sections` | none | authenticated read roles | section array |
| POST | `/sections` | JSON: `clientid`, `siteid`, `responsibleid`, `sectionname` | admin | created section |
| PUT | `/sections/:id` | JSON: `responsibleid`, `sectionname` | admin | updated section |
| PUT | `/sections/:id/archive` | `id` | admin | archived section; blocked if active assets exist |
| PUT | `/sections/:id/unarchive` | `id` | admin | unarchived section |
| GET | `/responsible-persons` | none | authenticated read roles | responsible-person array |
| POST | `/responsible-persons` | JSON: `clientid`, `name` | admin | created person |
| PUT | `/responsible-persons/:id` | JSON: `clientid`, `name` | admin | updated person |

Assets:

| Method | URL | Parameters | Auth | Response |
| --- | --- | --- | --- | --- |
| GET | `/assets` | none | manager/viewer/inspector read | active asset array |
| GET | `/assets/qr/:code` | QR code, asset ID, or `ATEC-ASSET-<id>` | authenticated | asset |
| GET | `/assets/:id/qr-label.pdf` | `id` | authenticated | PDF |
| GET | `/assets/:id/quick-details` | `id` | authenticated | compact asset details |
| GET | `/assets/:id` | `id` | authenticated | asset |
| POST | `/assets` | JSON asset fields: customer/site/section/equipment, serial, tag, WLL, hoist fields, auxiliary hoist fields | admin | created asset with QR code |
| PUT | `/assets/:id` | JSON asset fields | admin; inspector can only update `assettagno` | updated asset |
| PUT | `/assets/:id/move` | JSON: `siteid`, `sectionid` | admin | moved asset |
| PUT | `/assets/:id/archive` | `id` | admin | archived asset |
| PUT | `/assets/:id/unarchive` | `id` | admin | unarchived asset |
| POST | `/assets/:id/photos` | multipart `photo1`, `photo2` | admin/inspector where allowed | updated asset |
| DELETE | `/assets/:id/photos/:slot` | `slot` is `1` or `2` | admin/inspector where allowed | updated asset |
| GET | `/assets/:id/inspection-history` | `id` | authenticated | inspection summary array |

Equipment types and criteria:

| Method | URL | Parameters | Auth | Response |
| --- | --- | --- | --- | --- |
| GET | `/equipment-types` | none | authenticated read roles | equipment type array |
| GET | `/equipment-type-criteria` | optional query `category` | authenticated read roles | criteria array |
| POST | `/equipment-type-criteria` | JSON: `equiptypeid`, `criterianame`, `criteriadescription`, `fieldtype`, `resulttype`, `required`, `sortorder`, `displayorder`, `inspectioncategory`, `inspection_category`, `severity`, `active` | admin | created criterion |
| PUT | `/equipment-type-criteria/:id` | same as create | admin | updated criterion |
| DELETE | `/equipment-type-criteria/:id` | `id` | admin | `{ "success": true }` |

Inspections and inspection results:

| Method | URL | Parameters | Auth | Response |
| --- | --- | --- | --- | --- |
| POST | `/inspections` | multipart: `assetid`, `testdate`, `validdate`, `comments`, `status`, `inspectiontype`, `tagnumber`, `results` JSON, `updateassetphotos`, `photo1`, `photo2`, `inspectionPhotos[]`, `photoCaptions[]`, `photoTypes[]` | inspector/admin | `{ "success": true, "testid": 123, "resultcount": 10, "status": "SAFE", "photocount": 2 }` |
| GET | `/inspections/:testid/photos` | `testid` | authenticated; customer scoped | inspection photo array |
| POST | `/inspections/:testid/photos` | multipart `inspectionPhotos[]`, optional captions/types | inspection owner/admin | created photo array |
| PUT | `/inspection-photos/:photoid` | JSON: `caption`, `photo_type` | inspection owner/admin | updated photo |
| DELETE | `/inspection-photos/:photoid` | `photoid` | inspection owner/admin | `{ "success": true }` |
| GET | `/inspection-results/:testid` | `testid` | authenticated | result array |
| POST | `/inspections/:testid/results` | JSON: `results[]` | inspector owner/admin | `{ "message": "Inspection results saved successfully", "count": 10 }` |
| POST | `/inspection-results` | JSON: `testid`, `criteriaid`, `result`, `remarks` | authenticated write role | created result |
| GET | `/inspections/assets/search` | query `q` | authenticated | matching assets |

Certificates:

| Method | URL | Parameters | Auth | Response |
| --- | --- | --- | --- | --- |
| GET | `/certificates/search` | query `search`, `inspectiontype`, `status`, `clientid`, `siteid`, `sectionid`, `datefrom`, `dateto` | authenticated; customer scoped | certificate summary array |
| GET | `/certificates/bulk-print` | required query `clientid`, `datefrom`, `dateto`; optional `siteid`, `inspectiontype`, `status` | authenticated; customer scoped | `{ "certificates": [...] }` |
| GET | `/certificates/bulk-pdf` | same as bulk print plus optional `testids` comma list | authenticated; customer scoped | PDF |
| GET | `/certificates/count` | none | authenticated; customer scoped | `{ "total": "123" }` |
| GET | `/inspections/:testid/certificate` | `testid` | authenticated; customer scoped | certificate JSON |
| GET | `/inspections/:testid/certificate.pdf` | `testid`; query `inline=1` for inline disposition | authenticated; customer scoped | PDF |
| DELETE | `/certificates/:testid` | `testid` | admin | `{ "success": true, "deleted": 1 }` |
| POST | `/certificates/:testid/email` | JSON: `to`, optional `subject`, `message` | manager/inspector/customer/admin; customer can only email own registered address | `{ "success": true }` |

SHE risk assessments:

| Method | URL | Parameters | Auth | Response |
| --- | --- | --- | --- | --- |
| GET | `/she/risk-assessments` | query `status`, `search` | authenticated read roles | risk array |
| GET | `/she/risk-assessments.pdf` | query `status`, `search` | authenticated read roles | PDF |
| GET | `/she/risk-assessments.xlsx` | query `status`, `search` | authenticated read roles | Excel file |
| POST | `/she/risk-assessments` | JSON: `assetid`, `clientid`, `siteid`, `sectionid`, `assessment_date`, `activity`, `hazard`, `consequence`, severity/likelihood fields, controls, action, responsible, due date, status | admin/manager/inspector | created risk |
| PUT | `/she/risk-assessments/:id` | same as create | admin/manager/inspector | updated risk |
| PUT | `/she/risk-assessments/:id/archive` | `id` | admin/manager/inspector | archived risk |

Reports and dashboard:

| Method | URL | Parameters | Auth | Response |
| --- | --- | --- | --- | --- |
| GET | `/reports/customer-detailed` | query `clientid`, `siteid`, `sectionid`, `responsibleid`, `equiptypeid`, `datefrom`, `dateto` | authenticated; customer scoped | report JSON |
| GET | `/reports/customer-detailed.pdf` | same filters | authenticated; customer scoped | PDF |
| GET | `/reports/customer-detailed.xlsx` | same filters | authenticated; customer scoped | Excel file |
| GET | `/dashboard/stats` | none | authenticated dashboard roles | counts object |
| GET | `/dashboard/attention` | none | authenticated dashboard roles | due/overdue asset array |
| GET | `/dashboard/failed-equipment` | none | authenticated dashboard roles | failed equipment array |
| GET | `/dashboard/upcoming-expiries` | none | authenticated dashboard roles | upcoming expiry array |
| GET | `/dashboard/alerts` | none | authenticated dashboard roles | alert counts |
| GET | `/dashboard/visual-due` | none | authenticated dashboard roles | currently returns `{ "total": 0 }` |

Upload access:

- Static uploads are served from `/uploads` after authentication.
- Under production reverse proxy, `/uploads/...` should proxy to backend `/uploads/...`.
- Customer users can only fetch upload files referenced by their own customer records.

## 7. Authentication

Login process:

1. User submits username/email and password to `POST /auth/login`.
2. Backend finds a matching row in `atec.tblusers` by case-insensitive username or email.
3. Backend compares the submitted password with the stored bcrypt hash.
4. Inactive users are rejected.
5. `last_login_at` is updated.
6. Audit event `LOGIN` is inserted.
7. A signed JWT is returned in the HTTP-only `atec_session` cookie.

Password storage:

- Passwords are stored in `atec.tblusers.password`.
- New and reset passwords are hashed with `bcryptjs` using cost factor `12`.
- Plaintext passwords must never be stored or backed up separately.

Sessions/JWT:

- JWT payload contains public user fields only.
- JWT is signed with `JWT_SECRET`.
- Default expiry is `8h`.
- Token is accepted from the `atec_session` cookie or `Authorization: Bearer`.
- Cookie options are controlled by `COOKIE_SECURE`, `COOKIE_SAME_SITE`, and `COOKIE_PATH`.

Roles:

- `ADMIN`: full access, including users and certificate deletion.
- `MANAGER`: broad read access, SHE write access, and certificate email.
- `INSPECTOR`: read access needed for inspections, create inspections, upload photos, edit own inspection photos, update own signature, update asset tag/photo fields.
- `VIEWER`: read-only access to selected asset, certificate, dashboard, report, inspection-photo, equipment-type, and SHE endpoints.
- `CUSTOMER`: limited certificate/report access scoped to their `clientid`; upload/file access is also scoped.

Permissions:

- Implemented in `authorizeRequest` in `backend/server.js`.
- Additional ownership checks exist for inspector inspection-result updates and inspection-photo management.
- Customers are scoped in certificate searches, certificate views, reports, and upload access.

## 8. Configuration Files

`package.json` files:

- Root `package.json`: currently only contains a `multer` dependency. It is not the primary app package.
- `backend/package.json`: backend scripts:
  - `npm start`: runs `node server.js`.
  - `npm run dev`: runs `nodemon server.js`.
  - Contains backend runtime dependencies.
- `frontend/package.json`: frontend scripts:
  - `npm run dev`: starts Vite dev server.
  - `npm run build`: builds static frontend to `frontend/dist`.
  - `npm run preview`: previews the Vite build.

`backend/server.js`:

- Main Express entry point.
- Configures base-path stripping, CORS, Helmet, JSON parsing, cookie parsing, upload storage, auth, authorization, audit logging, routes, and error handling.
- Starts HTTP listener on `PORT`.

`backend/db.js`:

- Creates and exports PostgreSQL pool.
- Reads DB connection values from environment variables.

`backend/middleware/security.js`:

- Auth/session helpers, upload validation, audit logger, and error handling.

`frontend/vite.config.js`:

```js
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/'
})
```

This means the built frontend expects to be hosted at `/` unless a different `VITE_BASE_PATH` is supplied.

`frontend/src/api.js`:

- Resolves `API_BASE` from `VITE_API_URL`.
- In production, falls back to `window.location.origin + BASE_URL + '/api'`.
- Provides `apiUrl()` and `assetUrl()` helpers.

`.env.example` files:

- `backend/.env.example`: backend variables and production examples.
- `frontend/.env.example`: frontend API URL examples.

Reverse proxy examples:

- `deployment/nginx/atec.conf.example`.
- `deployment/apache/atec.conf.example`.
- `deployment/iis/web.config.example`.

Apache/frontend fallback:

- `frontend/public/.htaccess`, if present in the working tree/build, supports refresh fallback for static hosting.
- `frontend/public/web.config` supports IIS fallback.

TypeScript, Webpack, PM2, Docker:

- No `tsconfig` is present.
- No Webpack config is present.
- No PM2 config is present.
- No Dockerfile or docker-compose file is present.
- If PM2 or Docker is adopted for production, add the configuration to source control and document it here.

## 9. Deployment on a New Linux Server

Assumptions:

- Public app URL: `https://www.atecinspections.co.za`.
- Backend listens privately on `127.0.0.1:5000`.
- Frontend files are served from `/var/www/atec`.
- Uploads live in `/var/lib/atec/uploads`.
- PostgreSQL runs locally. Adjust host values if using managed PostgreSQL.

Install OS packages:

```bash
sudo apt update
sudo apt install -y nginx postgresql postgresql-contrib git curl unzip
```

Install Node.js:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Use the same tested Node major version across staging and production. The development workstation currently uses Node `v24.16.0`, but production should use a pinned and tested LTS release unless the team explicitly approves Node 24.

Create Linux user and folders:

```bash
sudo useradd --system --create-home --shell /bin/bash atec
sudo mkdir -p /opt/atec /var/www/atec /var/lib/atec/uploads /var/backups/atec
sudo chown -R atec:atec /opt/atec /var/lib/atec/uploads /var/backups/atec
```

Deploy code:

```bash
sudo -u atec git clone <repo-url> /opt/atec/app
cd /opt/atec/app
```

Install dependencies:

```bash
cd /opt/atec/app/backend
npm ci

cd /opt/atec/app/frontend
npm ci
```

Create backend environment:

```bash
sudo -u atec nano /opt/atec/app/backend/.env
```

Use the production `.env` template from section 5.

Create frontend production environment:

```bash
sudo -u atec tee /opt/atec/app/frontend/.env.production >/dev/null <<'EOF'
VITE_API_URL=https://www.atecinspections.co.za/api
VITE_BASE_PATH=/
EOF
```

Build frontend:

```bash
cd /opt/atec/app/frontend
npm run build
sudo rsync -a --delete dist/ /var/www/atec/
sudo chown -R www-data:www-data /var/www/atec
```

Database setup:

```bash
sudo -u postgres psql
```

```sql
CREATE USER atec_app WITH PASSWORD 'replace-with-strong-password';
CREATE DATABASE atec OWNER atec_app;
\q
```

Restore database backup:

```bash
sudo -u postgres pg_restore --dbname=atec --clean --if-exists /path/to/verified-atec.dump
```

Grant access if restored ownership differs:

```bash
sudo -u postgres psql -d atec -c "GRANT USAGE ON SCHEMA atec TO atec_app;"
sudo -u postgres psql -d atec -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA atec TO atec_app;"
sudo -u postgres psql -d atec -c "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA atec TO atec_app;"
```

Apply migrations:

```bash
cd /opt/atec/app
for file in database/*.sql; do
  psql "postgresql://atec_app:replace-with-strong-password@127.0.0.1:5432/atec" -v ON_ERROR_STOP=1 -f "$file"
done
```

Restore uploads:

```bash
sudo -u atec unzip /path/to/uploads.zip -d /var/lib/atec/uploads
```

Install Chromium if needed:

```bash
sudo apt install -y chromium-browser || sudo apt install -y chromium
which chromium-browser || which chromium
```

Set `PUPPETEER_EXECUTABLE_PATH` to the detected path.

Create systemd service:

```ini
[Unit]
Description=ATEC backend
After=network.target postgresql.service

[Service]
Type=simple
User=atec
WorkingDirectory=/opt/atec/app/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Save as `/etc/systemd/system/atec.service`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now atec
sudo systemctl status atec
```

Alternative PM2 setup:

```bash
sudo npm install -g pm2
cd /opt/atec/app/backend
pm2 start server.js --name atec-backend
pm2 save
pm2 startup systemd -u atec --hp /home/atec
```

No PM2 config file currently exists, so systemd is cleaner unless PM2 is a server standard.

Nginx reverse proxy:

```nginx
server {
  listen 80;
  server_name www.atecinspections.co.za atecinspections.co.za;

  location /api/ {
    proxy_pass http://127.0.0.1:5000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 180s;
  }

  location /uploads/ {
    proxy_pass http://127.0.0.1:5000/uploads/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 180s;
  }

  location / {
    root /var/www/atec;
    try_files $uri $uri/ /index.html;
  }
}
```

Enable site and SSL:

```bash
sudo ln -s /etc/nginx/sites-available/atec /etc/nginx/sites-enabled/atec
sudo nginx -t
sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d www.atecinspections.co.za -d atecinspections.co.za
```

Firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Required ports:

- Public: `80` and `443`.
- Private/local only: `5000` for backend.
- PostgreSQL: `5432` local only, or restricted to trusted DB clients.
- SSH: `22` or the server's configured SSH port.

Post-deployment checks:

- `https://www.atecinspections.co.za/` opens login.
- `https://www.atecinspections.co.za/api/` returns backend health text.
- Login sets a secure `atec_session` cookie.
- Customers/assets load.
- Asset photos load.
- Create or view an inspection.
- Certificate preview works.
- Single and bulk certificate PDFs work.
- Certificate email works if SMTP is configured.
- Reports export to PDF and Excel.

## 10. Startup Process

Backend startup:

1. `node server.js` starts in `backend`.
2. `dotenv` loads `backend/.env`.
3. `backend/db.js` creates a PostgreSQL connection pool.
4. Express app is created.
5. `trust proxy` is set if `TRUST_PROXY` is configured.
6. The app installs URL-prefix normalization for `/api`, the retired prefixed API shape, and upload paths.
7. Security middleware is installed: Helmet, CORS, JSON parser, cookie parser.
8. Upload storage is configured with `multer`.
9. Public routes are registered: `GET /`, `POST /auth/login`.
10. Protected upload route `/uploads` is mounted.
11. `requireAuth`, role authorization, inspector ownership checks, and audit middleware are applied to all later API routes.
12. API routes are registered.
13. Central error handler is installed.
14. App listens on `PORT` and logs `ATEC server running on port <PORT>`.

Frontend startup:

1. Browser loads `/index.html`.
2. Vite-built JS/CSS assets load from `/assets/...`.
3. Frontend resolves API base from `VITE_API_URL` or `/api`.
4. UI checks `/auth/me` to determine logged-in state.
5. Logged-in users see navigation based on their role.

## 11. External Services

Email:

- Uses Microsoft Graph when `MAIL_PROVIDER=graph`; this is the currently verified provider.
- Graph requires `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, and `GRAPH_SENDER`.
- SMTP via `nodemailer` remains available as a fallback when Graph is not selected.
- SMTP requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`.
- Used by `POST /certificates/:testid/email` to email certificate PDFs.

PDF/browser rendering:

- Uses `puppeteer-core`.
- Auto-detects common Chrome, Edge, and Chromium locations. Set `PUPPETEER_EXECUTABLE_PATH` when the browser is installed elsewhere.

PostgreSQL:

- Required external or local database service.

Other services:

- No SMS integration found.
- No payment gateway found.
- No Azure-specific integration found.
- Microsoft 365 Graph application-mail integration is available and is the active local provider when `MAIL_PROVIDER=graph`.
- No Google API integration found.
- No maps integration found.

## 12. Scheduled Jobs

Application scheduled jobs:

- No in-app cron jobs, queues, or background workers were found.

Operational scheduled tasks recommended:

- Daily database and uploads backup using `scripts/backup-atec.ps1` or Linux equivalent.
- Daily off-server backup copy.
- Monthly restore verification using `scripts/verify-restore-atec.ps1` or Linux equivalent.
- Optional log rotation is handled by journald/Nginx on Linux.

## 13. Security

Authentication:

- JWT sessions stored in HTTP-only cookies.
- Login is rate-limited to 10 attempts per 15 minutes.
- Bcrypt password hashing with cost factor 12.

Authorization:

- Central role-based authorization in `backend/server.js`.
- Extra customer scoping for certificate/report/upload access.
- Extra inspector ownership check for result updates and photo management.

Secrets management:

- Secrets are read from environment variables.
- Do not commit `backend/.env` or `frontend/.env.production` with real secrets.
- Restrict file permissions on production `.env`.
- Rotate `JWT_SECRET`, database password, and SMTP credentials if exposed.

Encryption:

- TLS/SSL must terminate at Nginx/Apache.
- Cookies must use `COOKIE_SECURE=true` in production.
- Passwords are hashed, not encrypted.

Rate limiting:

- Login route uses `express-rate-limit`.
- Other routes do not currently have route-specific rate limits.

CORS:

- Allowed origins come from `FRONTEND_ORIGIN`.
- Credentials are enabled.
- Production should set only the real public origin.

CSRF:

- Mutating `POST`, `PUT`, `PATCH`, and `DELETE` requests are protected by configured-origin validation.
- Login, logout, and all authenticated mutating routes use the same CSRF-origin policy.
- Session cookies also use SameSite protection.
- Production must keep `FRONTEND_ORIGIN` restricted to the real public application origins.

Uploads:

- Uploads are limited to 15 MB per file.
- Allowed upload types are JPG, PNG, and WebP.
- Files are checked by MIME type, extension, and magic bytes.
- Filenames are sanitized and timestamp-prefixed.
- Uploads are served only after authentication.
- Customer upload access is DB-scoped.

Security headers:

- Helmet is enabled.
- `crossOriginResourcePolicy` is set to `cross-origin` so authenticated images/PDFs can render where needed.

## 14. Logging

Application logs:

- Backend logs to stdout/stderr with `console.log` and `console.error`.
- Under systemd, view logs with:

```bash
sudo journalctl -u atec -f
```

Audit logs:

- Business/security audit events are written to `atec.audit_log`.
- Captures user, action, module, record ID, IP address, details JSON, and timestamp.

Reverse proxy logs:

- Nginx logs are usually in `/var/log/nginx/access.log` and `/var/log/nginx/error.log`.
- Apache logs depend on vhost configuration, commonly `/var/log/apache2`.

Error handling:

- Central error handler converts server errors to a generic response.
- Multer upload errors return user-friendly 400 responses.
- Details remain in backend logs.

Monitoring:

- No APM/monitoring integration is configured.
- Recommended minimum: uptime monitor for `/api/`, disk-space alerting for uploads/backups, DB health checks, and service restart alerts.

## 15. Backup Requirements

Back up:

- PostgreSQL database.
- Uploads path, including assets, inspections, and signatures.
- Backend `.env`.
- Frontend `.env.production`.
- Reverse proxy configuration.
- systemd/PM2 process configuration.
- SSL renewal configuration.

Backup schedule:

- Database: daily.
- Uploads: daily.
- Off-server copy: daily.
- Restore test: monthly.
- Retention: 7 daily, 4 weekly, 12 monthly.
- Manual backup before migrations or deployments.

Windows backup script:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-atec.ps1 -BackupRoot D:\ATECBackups
```

Linux equivalent:

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /var/backups/atec/atec-$TIMESTAMP
PGPASSWORD='replace-with-password' pg_dump \
  --host=127.0.0.1 \
  --port=5432 \
  --username=atec_app \
  --format=custom \
  --blobs \
  --file=/var/backups/atec/atec-$TIMESTAMP/atec-$TIMESTAMP.dump \
  atec
tar -czf /var/backups/atec/atec-$TIMESTAMP/uploads-$TIMESTAMP.tar.gz -C /var/lib/atec uploads
sha256sum /var/backups/atec/atec-$TIMESTAMP/* > /var/backups/atec/atec-$TIMESTAMP/manifest.sha256
```

Restore process:

1. Stop the backend service.
2. Restore database into a new/test database first.
3. Verify counts for clients, assets, inspections, inspection results, and users.
4. Restore uploads to a separate test path and confirm photos load.
5. For production restore, restore DB with `pg_restore --clean --if-exists`.
6. Replace uploads path from the matching backup.
7. Start backend.
8. Run smoke tests.

## 16. Developer Guide

Install locally:

```powershell
cd D:\Projects\ATEC\backend
npm install

cd D:\Projects\ATEC\frontend
npm install
```

Create `backend/.env` from `backend/.env.example`, then set real DB credentials and a long `JWT_SECRET`.

Create `frontend/.env.local` if needed:

```env
VITE_API_URL=http://localhost:5000
```

Run locally:

```powershell
cd D:\Projects\ATEC\backend
npm run dev
```

```powershell
cd D:\Projects\ATEC\frontend
npm run dev
```

Typical local URLs:

- Backend: `http://localhost:5000`.
- Frontend: `http://localhost:5173` or `http://localhost:5174`.

Debug:

- Backend errors appear in the terminal running `npm run dev`.
- Browser network errors usually mean `VITE_API_URL`, CORS, cookie path, or backend process is wrong.
- Use `GET /auth/me` to check session validity.
- Use browser dev tools to confirm `atec_session` cookie path and secure settings.

Build:

```powershell
cd D:\Projects\ATEC\frontend
npm run build
```

Release smoke check:

```powershell
cd D:\Projects\ATEC
npm.cmd run smoke:release
```

This read-only check verifies backend HTTP health, PostgreSQL/schema connectivity, external upload storage, current backup/restore evidence, required SMTP configuration, and an available Chrome/Edge/Chromium PDF engine. It does not send email or modify business data.

Mail-provider authentication check:

```powershell
npm.cmd run mail:verify
```

Explicit self-addressed delivery test:

```powershell
npm.cmd run mail:test-self
```

The command follows `MAIL_PROVIDER`. For Graph it authenticates with the configured application credentials and sends only to `GRAPH_SENDER`; for SMTP it sends only to `SMTP_USER`. The message identifies itself as an integration test and does not use customer data.

Deploy:

- Build frontend.
- Copy `frontend/dist` contents to the web root.
- Install backend dependencies with `npm ci`.
- Restart backend service.
- Apply database migrations before code that depends on them.

Update software:

1. Take database and uploads backup.
2. Pull or copy the new release.
3. Review migration scripts.
4. Apply migrations.
5. Run `npm ci` in backend/frontend if package files changed.
6. Build frontend.
7. Restart backend.
8. Smoke test.
9. Keep rollback artifacts ready.

## 17. Architecture Diagram

```text
                                  Internet
                                     |
                                     v
                         +-----------------------+
                         |  Nginx / Apache TLS   |
                         |  https://domain/      |
                         +-----------+-----------+
                                     |
                  +------------------+------------------+
                  |                                     |
                  v                                     v
        +-------------------+              +-------------------------+
        | Static Frontend   |              | Reverse Proxy           |
        | /var/www/atec     |              | /api -> :5000           |
        | Vite HTML/CSS/JS  |              | /uploads -> API         |
        +---------+---------+              +------------+------------+
                  |                                     |
                  | HTTPS API calls with cookie          v
                  |                         +-------------------------+
                  +------------------------>| Node.js Express Backend |
                                            | backend/server.js       |
                                            +-----+---------+---------+
                                                  |         |
                           SQL via pg.Pool        |         | Filesystem reads/writes
                                                  v         v
                                      +----------------+  +----------------------+
                                      | PostgreSQL     |  | Upload Storage       |
                                      | schema: atec   |  | assets/ inspections/ |
                                      +----------------+  | signatures/          |
                                                          +----------------------+
                                                  |
                         Optional outbound SMTP   v
                                            +-------------+
                                            | SMTP Server |
                                            +-------------+
```

## 18. Migration Checklist for New Server Without Downtime

Preparation:

- Confirm current production domain and target URL path.
- Freeze schema changes during migration window.
- Record current Node, npm, PostgreSQL, and OS versions.
- Confirm latest code branch/revision to deploy.
- Confirm DNS TTL is low enough for cutover.
- Prepare rollback plan and rollback owner.
- Create a fresh database backup.
- Create a fresh uploads backup.
- Copy backups off-server.
- Restore backup into a test database and verify counts.
- Confirm uploaded photos exist in restored upload path.
- Confirm admin login credentials for the new server.

New server build:

- Install OS packages, Node.js, npm, PostgreSQL client tools, Nginx/Apache, SSL tooling.
- Create `atec` service user.
- Create `/opt/atec/app`, `/var/www/atec`, `/var/lib/atec/uploads`, and `/var/backups/atec`.
- Clone or copy the application.
- Create production backend `.env`.
- Create frontend `.env.production`.
- Install backend dependencies with `npm ci`.
- Install frontend dependencies with `npm ci`.
- Build frontend.
- Restore database backup.
- Restore uploads backup.
- Apply pending database migrations.
- Configure systemd or PM2.
- Configure reverse proxy.
- Configure SSL.
- Configure firewall.
- Start backend service.
- Confirm `/api/` health response.
- Confirm `/` frontend loads.

Parallel validation:

- Use hosts-file override or staging subdomain to test new server before DNS cutover.
- Log in as admin.
- Log in as inspector.
- Log in as customer.
- Check customer scoping.
- Load asset photos.
- Generate QR label PDF.
- Generate certificate preview.
- Download certificate PDF.
- Test bulk PDF for a small range.
- Test customer detailed PDF/XLSX.
- Test SHE PDF/XLSX.
- Test SMTP email if configured.
- Confirm audit log receives events.
- Confirm service logs are clean.

Cutover:

- Announce maintenance window or read-only period.
- Stop writes on old server.
- Take final database and uploads backup.
- Restore final backup to new server.
- Run final migrations if needed.
- Start new backend.
- Run smoke test.
- Switch DNS or load balancer to new server.
- Monitor access logs, backend logs, database load, and disk space.

Post-cutover:

- Keep old server intact but read-only until sign-off.
- Run a restore proof from the new server backup.
- Confirm daily backups are scheduled and copied off-server.
- Confirm SSL auto-renewal.
- Confirm firewall blocks direct DB/backend public access.
- Document final server IP, credentials location, service names, and backup location.

Rollback:

- Stop writes on new server.
- Point DNS/load balancer back to old server.
- Restore any new-server-only records if necessary, or declare accepted data loss for the rollback window.
- Preserve logs and failed deployment state for diagnosis.

## 19. Known Issues, Assumptions, and Technical Debt

- No full baseline schema dump is committed. Migration depends on a restored existing ATEC database.
- API routes and many helper functions are concentrated in `backend/server.js`, which makes future maintenance harder.
- The repository has a root release suite covering major feature regressions, backend syntax, and the frontend production build. Browser and live integration coverage still needs expansion.
- No TypeScript, lint, or formatting configuration is present.
- No Docker configuration is present.
- No PM2 ecosystem file is present.
- No dedicated application log folder exists; logging depends on process manager and reverse proxy logs.
- CSRF protection is origin-based rather than token-based. Keep the allowed-origin configuration narrow and review whether a token-based design is required if additional client types are introduced.
- Dedicated rate-limit profiles protect login, search, uploads, PDF generation, exports, email, and scheduler actions. Continue reviewing new high-cost routes as they are added.
- `GET /dashboard/visual-due` now calculates a real customer-scoped count for active assets with no visual inspection or an expired visual inspection.
- Root `package.json` orchestrates release, backup, media-maintenance, and regression commands.
- The unused React/JSX starter files were removed; the frontend is intentionally a Vite/plain-JavaScript application.
- Operational uploads are excluded from Git and the active Windows upload store is outside the source workspace. The verified legacy in-workspace copy was removed after the backend restarted successfully against the external store.
- Production startup now rejects a missing upload-root configuration or any upload root inside the source tree.
- Historical migration checks distinguish verified baseline checksum drift from true post-baseline checksum mismatches. Baseline drift still requires documentation, but it does not imply that historical data-changing migrations should be rerun.
- Certificate PDF generation depends on a Chromium-compatible executable when using `puppeteer-core`; this must be verified on the target Linux distribution.
- Microsoft Graph is the verified mail provider. On 2026-07-23, application authentication succeeded and a self-addressed test message was accepted by Graph with HTTP 202. SMTP remains a fallback path and may still be blocked by Microsoft 365 security defaults.
- Some foreign keys were historically skipped until data was cleaned. Validate constraints after restoring a live database.
