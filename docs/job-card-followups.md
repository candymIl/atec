# Job-card follow-ups and management reports

## Use

Admins and Managers open **Job Cards → Follow-ups & Management Reports**.
Managers see cards assigned to their linked employees, using the existing job-card access scope.

- Technicians tick **Quote required** and describe the recommendation. Office staff mark **Handed to Accelo**, optionally recording its reference. No quoting, customer messages or Accelo integration is introduced.
- **Return visit required** needs a description of unfinished work and the reason. Office staff can mark Waiting, Booked (return date required), or Completed. A return job card can be selected from the same customer/site.
- Restricted or out-of-service job cards produce an attention item for each linked asset. The existing equipment status applies to the whole card; use separate cards where assets have different final conditions. Further-work and not-tested conditions are not automatically classified as unsafe.
- Assign a responsible person and due date during review. Resolution, completion, waiting and cancellation require notes. Reopen with Open. History is retained.

Approval, invoicing, cancellation of the source card, unchecking a follow-up selection, removing an asset, or changing its condition does **not** implicitly close an existing follow-up. Office staff review and resolve it explicitly. Saving the same card does not duplicate items or reopen closed ones. Edits to source descriptions update outstanding follow-ups with history; closed records retain their original text. There is one quote and one return-visit item per source card, plus one attention item per linked asset. Separate new work uses a new job card.

## Management review

The overview and three tabs support raised-date range, customer, site, responsible person, open/closed/all and overdue filters. Excel and PDF use the applied filters and include all matching items, not only the visible page or the operational queue's 250-card cap. Excel includes action history.

Ageing bands are 0–7, 8–14, 15–30 and over 30 calendar days, using South African dates. Closed-item age stops on closure. Due today is not overdue; unassigned due dates are not treated as overdue. Attention totals count distinct assets; detailed rows retain separate source issues for the same asset. Return visits marked Booked remain open until Completed but are separated from Awaiting rebooking.

The date filter selects when an item was raised; this is a current-status report for that cohort, not a historical "as at" reconstruction. Full status-change history remains available.

The separate Date raised column defaults to newest first. Click Date raised, Customer / asset, Follow-up, Responsibility / dates (responsible person's name), or Status to sort; click again to reverse direction. Arrows show the selected order. Sorting includes all matching items before pagination and is retained in Excel/PDF exports. Mobile screens provide a sort selector and direction button.

## Release

This change requires `database/2026-09-25-job-card-followups.sql` before the new backend is used. The migration and schema contract are registered in the deployment manifests. The migration is repeatable and imports existing restricted/out-of-service job-card records as **open items requiring review**; it does not assert the assets are still unsafe. Historic quotation/rebooking needs are not inferred from free text. Review the imported attention backlog and mark already-resolved items with evidence after deployment.

No production migration or deployment was performed during implementation. Deploy only through the approved release process.

For the everyday local development database, run `node scripts/uat/apply-job-card-followups-local.js --apply` before opening the feature. This helper refuses non-local or production configuration, records the migration and verifies the actual report query before committing. Without `--apply`, it only verifies the report. The isolated regression database does not activate the feature in the normal local database.

## Validation

- `npm.cmd run test:job-card-followups` checks ageing boundaries, dates, state validation, concurrency and summary rules.
- `node scripts/regression/job-card-followups.test.js --database` uses only a disposable PostgreSQL test cluster on `127.0.0.1:55439` with no application credentials. It creates and removes its own temporary test database. Never point this cluster at production.
- Add `--browser` to test the actual UI with a headless browser. Set `FOLLOWUP_BROWSER` to a compatible Chromium executable if needed. The test verifies completion/history and creates temporary desktop/mobile screenshots and PDF/Excel samples under `tmp/followups-qa`.
- Integration checks cover repeatable migration, asset-specific resolution, role/manager restrictions, stale-version rejection, return-card customer/site validation, retained closed items, and complete exports beyond 250 rows.
