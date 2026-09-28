# Company certificate expiry reminders

Prepared for Chene Jonker, chene@fbcranes.co.za. Not enabled by default.

The independent company-document rule checks every five minutes from 07:00 SAST.
Published documents receive one reminder at each of 60, 30, 14 and 7 days before
their expiry date. There are no weekly repeats or reminders on intervening days.
The first check after a certificate expires sends one further expired alert.
Each milestone is recorded separately for the document/expiry date/recipient.
Valid-until dates include that day. Milestones missed before activation or during
a full-day outage are not sent retrospectively; subsequent milestones still apply.
No CCs, attachments, customer recipients, or changes to Chene's login are involved.

Drafts, archived documents, and documents without expiry dates are excluded.
When uploading a replacement, archive its superseded document to stop old reminders.
The Compliance Documents page displays activation status and read-only mail previews.

## Activation after release approval

1. Back up the production database and apply
   `database/2026-09-28-compliance-expiry-reminders.sql` through the release process.
2. Deploy the reviewed backend and frontend changes. Verify the new preview on the
   Compliance Documents page while reminders remain disabled.
3. Confirm mail configuration, then set `COMPLIANCE_EXPIRY_REMINDERS_ENABLED=true`
   on the intended production instance and restart its backend. Local and
   demonstration instances stay disabled. South Deep has its own requested setup
   and separate activation procedure in
   `deployment/south-deep/certificate-reminder-upgrade.md`.
4. Check the first delivery ledger rows and mailbox evidence. Setting the variable
   to `false` and restarting stops the rule. The existing customer notification
   switch is independent and must not be changed to enable this rule.

## Duplicate protection and operational recovery

A PostgreSQL advisory lock serializes workers. Each attempt is persisted before
the mail provider is called. Successful provider acceptance is recorded as SENT;
this is not proof of inbox receipt. Failed or interrupted attempts remain PENDING
and suppress further attempts for that document/expiry/recipient. This deliberately
prevents duplicate mail when provider acceptance is uncertain. Investigate application
logs and sent-mail evidence before reconciling any PENDING entry; do not blindly
delete reservations or retry. Keep the attempt ledger for audit purposes.

Validation: 11 unit tests passed, as did the existing compliance-library,
customer scheduler, and deployment-safety checks, syntax checks, and frontend build.
The opt-in `scripts/regression/compliance-expiry-postgres.test.js` passed against
local PostgreSQL using temporary tables and a rolled-back transaction. It verifies
exact 60/30/14/7-day inclusion, next-milestone eligibility, one expired alert,
excluded document statuses, no-expiry documents, absence of weekly repeats,
pending suppression, and repeated-run duplicate protection.
No real mail was sent. Production scheduling and mailbox delivery remain to be verified.
