# South Deep full ATEC pilot

This is a separate full application deployment, not a presentation mockup. SAP integration is not implemented or connected. It has not yet completed production acceptance.

## Prepare

From the ATEC repository run `node deployment/south-deep/prepare.cjs tmp/south-deep-release`.
The source database must be local. It is read only. The package includes a schema snapshot and only five reference tables: roles, equipment groups, equipment types, inspection criteria and public holidays. Customer records, inspection history, users, signatures and uploaded files are excluded. SHA-256 hashes identify the packaged files. The source revision and small optional UI overlays are recorded in the manifest.

## Install on the agreed host

Use a separate hostname, application directory, database role/database, upload directory, process and backup set. Do not run the existing `deploy-live.sh`: that script targets the current ATEC installation and migrations.

1. Check Node and PostgreSQL compatibility, including support for the bundled schema dump and the pg_trgm extension. Install Node dependencies in `app/backend` and `app/frontend` using their lock files.
2. Supply the PostgreSQL administrator connection through PGHOST, PGPORT, PGUSER and PGPASSWORD in the administrator's secure environment. Do not paste passwords into chat or command history.
3. Set PILOT_ORIGIN to the exact HTTPS address, PILOT_DATABASE to a fresh name beginning `atec_south_deep_pilot`, and PILOT_PORT to a free backend port (default 5101). Set PILOT_PSQL if psql is not on PATH.
4. Run `node provision.cjs`. It refuses existing databases, roles and environment files. Failure may leave the newly created role/database for inspection; it never deletes an existing installation.
5. Secure `pilot-access.json` and both environment files so only the deployment operator/service can read them. Never publish these files. Deliver the generated initial login privately and replace its password before sharing access.
6. Build the frontend from `app/frontend`. Start the backend with `app/backend` as its working directory. Restrict the backend port to the server/proxy; this app listens on all interfaces by default.
7. Serve only `app/frontend/dist` through the HTTPS host. Proxy `/api/` and `/uploads/` to this pilot backend. Use a distinct process name. Do not publish the package root or database dumps.
8. Run the schema contract check using the pilot environment. Verify login, asset editing, real inspection capture, certificate rendering, reports, role restrictions, upload access, and separation from the original ATEC installation.

The pilot starts with an administrator and clearly fictional assets. Email and automatic notifications are unconfigured/disabled. No real inspector signature or qualification is fabricated. Upload a clearly labelled demonstration signature if inspection capture requires one during the meeting.

## Company certificate reminders

The shared application now includes Chene's company certificate reminders at
60, 30, 14 and 7 days before expiry, plus one alert after expiry. The recipient is
`chene@fbcranes.co.za`. New South Deep packages include the same service and
Compliance Documents preview. `COMPLIANCE_EXPIRY_REMINDERS_ENABLED=false` is
explicit in the generated environment until email configuration and live activation
are approved. Customer inspection notifications remain a separate setting.

The rule reads only the South Deep database's published Compliance Documents.
It does not read or copy the main ATEC documents. Duplicate protection is local to
each database: publishing the same company certificate in both systems can result
in one reminder from each system at each milestone.

For the existing hosted South Deep installation, use the bounded upgrade procedure
in [certificate-reminder-upgrade.md](certificate-reminder-upgrade.md). Committing or
pushing this setup does not upgrade or activate that installation.

The existing inspection form still requires a numeric Accelo job number. That is an inherited ATEC workflow, not SAP integration. Agree the South Deep work-order reference behavior before live acceptance; do not present this field as an SAP connection.

## Move to live operation after acceptance

Keep the same deployment architecture. Confirm the issuing company's identity, inspector permissions and signing authority; reconcile/import the agreed equipment register; remove demonstration data through reviewed application workflows or start from a fresh clean database; rotate pilot credentials; configure approved email; verify backup and restore; and complete South Deep's acceptance checks. Update the optional frontend label/notice and rebuild only when its claims are true. SAP remains a separate delivery milestone requiring their SAP team, approved interfaces, credentials, field mapping and end-to-end tests. The database snapshot does not establish a production migration baseline: reconcile the migration ledger before future upgrades.

For isolated local verification only, set PILOT_LOCAL=true and use a loopback HTTP origin. Never enable local mode for an online deployment.
