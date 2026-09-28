# South Deep company certificate reminder upgrade

Requested rule: chene@fbcranes.co.za, at 60/30/14/7 days before expiry, then one
expired alert. Checks start at 07:00 Africa/Johannesburg. No weekly repeats.

## Prepared scope

The shared service, frontend preview, migration and tests are in commit `5ffa71af`.
The South Deep provisioning template explicitly leaves this rule disabled until
live activation. No customer records, company certificates, mail credentials or
other application data are included in these source changes.

## Existing hosted installation

The last recorded target is `https://southdeep.atecinspections.co.za/`, systemd
service `atec-southdeep.service`, database `atec_south_deep_pilot`, and release
`/var/www/atec-south-deep/releases/20260924`. Recheck these before an approved
deployment; they are historical installation records, not a live verification.

1. Confirm the pilot service, release, database and existing mail configuration.
   Back up its database, source, frontend build and private environment separately.
2. Preserve South Deep's dedicated cookie, loopback binding, hostname, JWT secret,
   uploads, database and environment notice. Do not replace its full server file
   with the main ATEC file without preserving those deployment-specific changes.
3. Compare and apply the bounded changes from `5ffa71af`: the reminder service,
   server import/preview route/scheduler wiring and Compliance Documents view.
   Include the reminder migration in the pilot's reconciled migration ledger;
   do not run all main-site migrations against an unbaselined pilot snapshot.
4. Apply `2026-09-28-compliance-expiry-reminders.sql` only to the verified pilot
   database, after checking its document table exists. Verify application-role
   access to the new table and sequence. Build the frontend with its own existing
   South Deep settings and restart only the pilot service.
5. Verify authenticated preview with reminders disabled, confirm the recipient
   and real published documents, and inspect exact milestone eligibility. Do not
   copy ATEC's private environment or data. Arrange approved sending credentials
   if mail remains unconfigured. No trial messages should be sent unintentionally.
6. After live activation approval, set only the pilot's
   `COMPLIANCE_EXPIRY_REMINDERS_ENABLED=true` and restart its service. Verify ledger
   evidence and mail delivery. Check main ATEC health without changing its service.

If the same certificate exists in both installations, each independently sends
its milestone notification to Chene. For failed/uncertain sends, PENDING ledger
entries require reconciliation before a retry; see the shared reminder document.

## Rollback

Disable the reminder environment switch and restart only the pilot service.
Keep delivery history to prevent duplicates. Restore the pilot source/frontend
backup if required, preserving the original environment and database isolation.

## Current status

Prepared in source only. Hosted deployment, migration, mail configuration,
activation and inbox receipt have not been performed or verified for this change.
