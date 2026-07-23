# ATEC Release Readiness - 2026-07-23

## Verified

- Repository branch: `main`
- Working tree was clean before this implementation pass.
- Backend syntax checks pass.
- Security middleware syntax check passes.
- Frontend production build passes.
- All root release regression checks pass.
- Production schema contract passes.
- PostgreSQL sequence check passes with zero sequences behind.
- Upload storage was copied and byte-count verified outside the source workspace.
- The backend was restarted against `D:\ATECData\uploads`, passed its health check, and the legacy in-workspace upload copy was removed.
- Production startup now fails closed when upload storage is missing or points inside the source checkout.
- Fresh database-and-media backup `atec-20260723T085033Z` was created and checksum-validated.
- Backup `atec-20260723T085033Z` was successfully restored into the isolated pre-created database `atec_restore_verify_manual`; critical asset, inspection, result, equipment-type, and user tables were queried successfully.
- The repeatable `npm run smoke:release` check passes for backend health, database/schema connectivity, external uploads, current backup evidence, SMTP configuration, and the local Edge PDF engine.
- Read-only API security smoke checks pass: public health is available, protected session/admin endpoints return 401 anonymously, login without an allowed origin returns 403, and invalid credentials with an allowed origin return 401.
- Microsoft Graph mail authentication succeeds and a self-addressed integration message was accepted by Graph with HTTP 202. No customer data was used.
- The sequence synchronization and technician job-card migrations are now tracked through deployment automation.

## Current Functional Scope

- Customer, site, section, responsible-person, asset, and user administration
- Visual, frequent, and load-test inspections
- Equipment-specific inspection wizards
- Photos, signatures, certificates, PDF, Excel, and email
- QR and NFC asset workflows
- On-site inspection visit coverage
- Customer portal and customer isolation
- Notification preferences, scheduled delivery, history, and templates
- Technician job cards
- System health, audit logging, backup, restore, and deployment tooling

## Database Findings

- Production schema contract: passed.
- Migration ledger: 26 migrations tracked at the time of review.
- `2026-07-21-technician-job-cards.sql` was present in the production manifest but not yet tracked in the ledger at initial review.
- Migration reporting now separates 9 verified historical baseline drifts from true checksum mismatches. There are zero true checksum mismatches and zero ledger-missing production migrations.
- `atec.tblusers.userid_seq` was behind the current maximum user ID at initial review. The idempotent sequence synchronization migration was added to the governed production manifest for correction.

## Remaining Release Proof

1. Run browser UAT with every supported role.
2. Verify scheduled notification execution and an end-to-end certificate PDF.
3. Reconcile historical baseline checksum records without reapplying historical cleanup scripts.

## Deferred Scope

- QR batch printing remains post-go-live.
- SHE remains an internal prototype until corrective-action ownership, evidence, close-out, KPI, and audit workflows are complete.
