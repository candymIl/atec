# On-Site Inspection Visits

## Business Purpose

On-site visits help an inspection team reconcile the due assets at a customer site before leaving. The feature is visit/session based: ATEC snapshots the due worklist at visit creation, then tracks scans, completed inspections, dispositions, discoveries, and closure.

## Visit Lifecycle

Visits move through:

- `DRAFT`
- `OPEN`
- `PAUSED`
- `RECONCILIATION_REQUIRED`
- `COMPLETED`
- `CANCELLED`

Admin and Manager users can create, start, and close visits. Inspectors can work visits, scan assets, perform inspections, add dispositions, and record discoveries.

## Due-Asset Snapshot

The worklist is generated from active, non-archived assets for one customer and one site, optionally filtered by section. The current source of truth is the latest `atec.tblinspection.validdate` for each asset and inspection type:

- Last visual inspection: latest `tblinspection` row for `assetid` and `inspectiontype = 'VISUAL'`.
- Last load test: latest `tblinspection` row for `assetid` and `inspectiontype = 'LOADTEST'`.
- Next due date: latest matching inspection `validdate`.
- Overdue status: due date before the visit snapshot date/current date.
- Customer/site/section: `tblasset.clientid`, `tblasset.siteid`, `tblasset.sectionid`.
- Inspection completion time: linked `tblinspection.testdate` plus visit asset `completed_at`.

The generated rows are stored in `atec.tblinspectionvisitasset` with customer/site/section, equipment, tag, serial, description, due dates, due flags, overdue flag, required scope, and reconciliation state. Later asset edits do not rewrite the historical visit scope.

## Scope Selection

Supported visit types:

- Visual inspection
- Load test
- Combined
- Survey / asset verification

Combined visits can require visual, load test, or both on the same asset. Both-required assets are not fully completed until both linked inspections are present.

## QR/NFC Linking

QR and NFC quick lookup remain unchanged. When a scanned asset belongs to exactly one active visit worklist, the UI offers to open it in that visit. Scanning marks the asset as seen for the visit, but scanning does not mark inspection work complete.

If multiple visits match, the user must choose. If no active visit matches, normal Quick Inspection behavior remains available.

## Inspection Linking

When a visit inspection is started from the visit worklist, the frontend carries the visit ID into the normal inspection save. The backend validates that:

- The visit is active.
- The asset belongs to the visit worklist.
- The inspection type matches the visit scope.

The existing inspection save remains transactional. The visit asset row is linked to the created visual or load-test inspection inside that transaction.

## Reconciliation Statuses

Supported visit asset outcomes:

- `COMPLETED`
- `OUTSTANDING`
- `NOT_FOUND`
- `OUT_OF_SERVICE`
- `REMOVED_FROM_SITE`
- `INACCESSIBLE`
- `DEFERRED`
- `CUSTOMER_CONFIRMED_REMOVED`
- `DUPLICATE_RECORD`
- `NOT_REQUIRED`
- `OTHER`

Non-completed outcomes require comments. Customer-confirmed removal also requires a customer confirmation note. Duplicate records and removals do not delete, archive, or alter the asset master record automatically.

## Missing-Unit Handling

ATEC does not infer that an asset is missing merely because it was not inspected. Outstanding assets remain `OUTSTANDING` until an inspection is linked or an authorised user records a disposition.

## New Asset Discovery

Users can record newly discovered unregistered equipment during a visit with description, equipment type if known, serial number, asset tag, location, notes, customer comment, and whether inspection was performed. The system checks obvious duplicate serial, asset tag, and QR identifiers and stores duplicate warnings.

No permanent asset is created automatically.

## Closure Rules

The closure flow blocks silent completion while visit assets remain `OUTSTANDING`. Admin/Manager users can provide an explicit closure override reason. Inspector users cannot override closure.

Completed visits are intended to be read-only except for controlled Admin corrections in a future hardening pass.

## Visit Report

The report endpoint returns visit details, customer/site, dates, planned scope, summary counts, all visit assets, dispositions, and discoveries. The frontend opens a printable report view. This does not replace legal inspection certificates.

## Dashboard

The internal dashboard API includes visit alert counts for open visits, reconciliation-required visits, outstanding due assets, deferred follow-ups, and recently completed visits.

## Permissions

Admin:
- Full visit access.
- Create/start/close.
- Closure override.

Manager:
- Create/start/close.
- Assign and reconcile work.
- Closure override.

Inspector:
- View and work visits.
- Scan assets.
- Perform inspections.
- Add dispositions and discoveries.
- No closure override.

Viewer and Customer:
- No internal visit access in Task 14.

## Audit History

Audit events include visit creation, worklist generation, visit start, asset scan, inspection linked, disposition set, discovery recorded, closure blocked, closure override, and visit completion.

## Database Migration

The migration `database/2026-07-15-task14-onsite-inspection-visits.sql` adds:

- `atec.tblinspectionvisit`
- `atec.tblinspectionvisitasset`
- `atec.tblinspectionvisitmember`
- `atec.tblinspectionvisitactivity`
- `atec.tblinspectionvisitdiscovery`

It includes indexes for customer/site/status, visit worklist status, outstanding reconciliation, asset lookup, activity history, and discoveries.

## Testing

Run:

```sh
npm.cmd run test:task14
npm.cmd run test:task13
npm.cmd run test:task12-framework
npm.cmd run test:task12a
npm.cmd run test:task12b
npm.cmd run test:task12c
npm.cmd run test:task11
npm.cmd run test:task10
npm.cmd run test:task9
npm.cmd run test:task7
npm.cmd --prefix frontend run build
node --check backend\server.js
node --check frontend\src\main.js
```

## Deployment

Production deployment must be reviewed. Apply the migration, deploy backend and frontend together, then smoke-test visit creation, QR/NFC quick scan, visual save linking, load-test save linking, disposition, close blocking, and report output.

NOT EXECUTED:

```sh
psql "$DATABASE_URL" -f database/2026-07-15-task14-onsite-inspection-visits.sql
npm.cmd --prefix frontend run build
```

## Rollback

The migration contains rollback guidance to drop visit discovery, activity, member, asset, and visit tables. Rolling back removes visit records but does not alter inspection certificates or asset master records.

## Known Limitations

The first local implementation does not provide offline sync, bulk assignment UX, customer portal views, email notifications, or automatic asset creation from discoveries. Visit reports are printable JSON-style operational reports, not polished certificate PDFs.

## Future Customer Portal Integration

Task 15 can expose a safe customer view of visit summaries, completed inspections, outstanding items, deferred work, missing/removed dispositions, discoveries, and certificates.

## Future Email/Notification Events

Task 16 can subscribe to internal events for visit created, visit started, asset completed, due asset unresolved, asset marked not found, asset deferred, new asset discovered, reconciliation required, and visit completed.
