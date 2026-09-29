# South Deep review update — 29 September 2026

Live: https://southdeep.atecinspections.co.za/
Release: /var/www/atec-south-deep/releases/20260929-review-updates/app
Build: 2026-09-29T12-12-43-252Z
Service: atec-southdeep.service; active on loopback 5101.

## Scope
Preserved the parallel workflow deployment (sortable job-card headings, Accelo status, redesigned timesheet approvals, date sorting and crew review) and added invalid-timesheet closure from commit 09fd040d. Kept South Deep hoist routes, isolated cookie/database, environment settings, uploads and disabled automatic notifications.

The first cutover failed the public build identity check and rolled back. A concurrent task had updated the previous release. Its main.js, style.css and server.js were retained in the combined candidate, with the closure handler added to main.js. The combined cutover succeeded after allowing Nginx reload convergence.

## Validation
- Closure unit tests, approvals sorting, Accelo review, job-card search and lean workforce checks passed.
- Frontend production build passed.
- Backup restored to isolated verification database and closure migration applied twice successfully.
- Closure migration applied using the South Deep app database role.
- Public build identity and API health passed; protected endpoints reject unauthenticated access.
- Signed-in browser: approvals loads; history includes CLOSED INVALID and the corresponding search succeeds; job-card sortable headings and Accelo-status view load; Manual Hoists page loads.
- Database counts remain 432 assets and zero timesheets. No production approval/closure action exercised because no timesheets exist.
- Main ATEC health remains healthy; main ATEC service/configuration not changed by this deployment.

## Recovery evidence
Pre-cutover backup: /var/backups/atec-southdeep/20260929T121314Z
Post-cutover backup: /var/backups/atec-southdeep/20260929T121319Z
Original restore-verified backup: /var/backups/atec-southdeep/20260929T120453Z
Remote config copies, source hashes and health/build evidence: /root/southdeep-review-upgrade-20260929-combined
Previous release: /var/www/atec-south-deep/releases/20260928-hoists-candidate/app
Closure schema is additive and is retained if application rollback is needed.
