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

## Live completion — 26 September 2026

Temporary server access was established after replacing an unreadable local SSH key. Live ATEC already contained the tested portal changes at server merge `ace20855` (application source from `551fcc3b`; additional differences were frontend package metadata). The running API and public frontend were verified without replacing those server-specific changes.

- Created 74 accounts from the original contact plan and linked five existing accounts. Preserved all 56 pre-existing passwords, with an in-transaction comparison before commit.
- A live-only responsible person at Valterra Platinum Amandelbult had an exact full-name match and a unique active email in two CSV records whose company explicitly included Amandelbult. Created that additional account; preserved all 130 accounts already present at that point.
- Final live result: **75 new accounts, five existing accounts linked, 80 person-linked accounts in total**. Both provisioning batches subsequently reported only `ALREADY_LINKED`.
- Archived approved customer 272 and its dependent master records after confirming the same identity, five sites, four sections, no equipment and no accounts as the local review.
- Verified all 75 new passwords in memory; tested actual password login and the public customer portal. Three responsible-person scopes passed report-filter tampering checks, recipient/attachment-data checks and denial of another person's certificate. An account without section assignments returned no assets, reports or certificates.
- The original contact plan still has 215 unresolved people. These were not provisioned from guesses. Live has 295 active people versus the local plan's 294; the additional matched live person accounts for that difference.
- Automatic sending remains disabled. No notification or welcome emails were sent.

## South Deep pilot completion and limits

The actual application path is `/var/www/atec-south-deep/releases/20260924/app`. Applied only the portal/report patch to its existing source, preserving its separate `atec_southdeep_session` cookie, loopback-only port 5101, branding and environment. Applied the person-access migration and recorded its checksum; older snapshot migration history was not rewritten. Built and served `portal-person-551fcc3b-20260926` at the dedicated South Deep hostname, then restarted only the pilot service.

The pilot database has one demonstration customer, three demonstration assets and **no responsible-person records**. All 79 original plan entries were therefore skipped as absent. No real customer/person records or accounts were copied into that database, and customer 272 is absent. API and public-session checks passed; pilot and live reject each other's sessions. Real pilot account provisioning remains dependent on approved customer/person data being present there.

## Evidence and remaining work

Private database rollback backups were created and their archives/checksums verified before mutations. Server evidence resides under `/root/portal-rollout-20260926/`; selected non-secret evidence is also retained in ignored `.local/portal-access-review/`. No environment files or plaintext passwords were duplicated for this rollout.

Both temporary SSH key identities were removed after the final health checks (three entries, including a duplicate). A fresh connection using the replacement key was denied, confirming revocation. Other authorized keys were preserved.

The remaining contact review is in `.local/portal-access-review/remaining-portal-contacts.csv`. Confirm missing/ambiguous email identities before provisioning those people. Accounts with no active assigned sections correctly see no equipment. Password changes remain available to users; the stored `update_pw` flag does not currently enforce a first-login password change.
