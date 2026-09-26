# Responsible-person portal rollout — 26 September 2026

## Change

Portal accounts use a stored person ID and follow that person's active sections across sites within one customer. Changing the login email does not change ownership. Empty assignments return no assets or certificates. Existing unlinked customer/site accounts retain their configured location scope.

Notification rows, recipient lookup and attachments are grouped by section owner across sites. Unassigned rows cannot be sent. Delivery history records the responsible person for cooldown checks. No emails are sent by migration or provisioning.

## Local completion

- Applied `2026-09-26-customer-portal-person-access.sql` after a database backup.
- Created 74 matched customer accounts using the Windows-encrypted bootstrap secret; each has a separate salted password hash and explicit person link.
- Linked five existing customer accounts without resetting their passwords.
- Re-running the provisioning dry-run identified all 79 accounts as already linked, with no proposed duplicates.
- Customer 272, “180 Degrees Mining Solotions”, and its sites/sections/people were archived following the user's exact confirmation. It had no equipment, inspections or portal accounts and is excluded from provisioning.
- Four user-confirmed South Deep name variants are recorded in the private matching plan. Other ambiguous or unmatched contacts remain pending.
- Automatic notification sending was off and remains off. No emails were sent.

The private plans, before-state archive record, database backups, provisioning results and UAT evidence are in ignored `.local/portal-access-review/`; these include personal data and must not enter Git. The DPAPI password file must never be copied to a Linux server or committed.

## Validation

Local HTTP tests ran against the actual Express routes inside a rolled-back database transaction: portal summary/assets/options, forced report-owner tampering, certificate search/count and another person's certificate (403), MPI listing, person-specific notification preview, and empty-assignment accounts. Notifications were not sent. Unit tests cover immutable identity, cross-site ownership, wrong customer/section, inactive/archived links and unconfigured access. Existing portal, notification, report, certificate, MPI and deployment checks plus frontend build passed.

## Live and South Deep pilot — pending

Neither environment has been changed by this rollout. An SSH connection attempt to the current ATEC DNS address timed out on port 22. Temporary access is required before preflight, target reconciliation or deployment.

For each environment independently:

1. Inspect the actual app/release, schema, customers, people, existing accounts, backup method and notification configuration. Do not use the legacy `lifttest3` connection as live ATEC. Do not assume local person/customer IDs match the target.
2. Take and verify a target backup; keep automatic sending off during account provisioning. Apply the exact tested release and migration. Preserve pilot isolation, binding, origins, cookie path and branding overlay.
3. Run provisioning in dry-run mode. It matches the reviewed customer/person names against that target, preserves existing accounts/passwords and skips missing/ambiguous/inactive/conflicting records. Do not copy real customer data into the pilot to satisfy missing person matches.
4. Apply only the reconciled plan, passing the secret privately over authenticated SSH standard input. Store no plaintext password file and emit no hash/password output.
5. Verify person access, denied cross-person downloads, correct notification recipients/attachments and account-count/idempotence results without sending mail. Archive the exact approved customer only if its target identity and dependencies match the reviewed scope.
6. Record target-specific results, then remove the exact temporary authorized-key entry and verify revocation.
