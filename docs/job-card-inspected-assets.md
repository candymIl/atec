# Automatic inspected-asset selection

For editable job cards, Equipment selects recorded inspected assets before saving. Matching uses customer, site, optional section, exact Accelo job number, one inspection work date, and the assigned technician plus selected crew. It applies to all job types, including services and load tests. Each asset appears once, even if it has several inspection records. Voided inspection records and archived assets are excluded; failed inspections are included because the work was performed.

The inspection work date is visible and saved on the card. Initially it uses the existing work-start date, arrival date, planned date, or today's South African date, in that order. Change this field when preparing a card for another day; the match is always one day, never the whole job's date range.

Inspectors can untick matches and add service-only assets. Unticked assets remain excluded after refresh, save and reopening; manually ticking one again removes that exclusion. Saving stores exactly the reviewed selection. The older rule that silently appended assets during saving has been removed.

Without a job number, the day/customer/site/crew matches are suggestions only. Use **Select daily matches** to include them after reviewing the scope. An Accelo job number remains required to save the job card. **Refresh inspected assets** checks for inspections recorded while the card was open. Submitted, approved, invoiced and cancelled cards are not automatically changed.

## Release and verification

Apply `2026-09-29-job-card-inspected-assets.sql` before releasing the backend and frontend together. It adds the work date and remembered exclusions to job cards without modifying their existing asset selections. The migration is registered in `deployment/production-migrations.json`.

Verification commands:

- `npm.cmd run test:job-card-inspected-assets`
- `npm.cmd run test:job-cards`
- `npm.cmd run test:inspection-job-number`
- `node scripts/uat/job-card-inspected-assets-local.js` (local PostgreSQL only; fixtures and migration roll back)
- `npm.cmd --prefix frontend run build`

Before production acceptance, check a real inspector's new and existing editable cards, a shared crew, removal/save/reopen, another work date and job number, and a submitted card. No customer or assignment email is required for this verification; use the draft workflow with assignment email disabled.
