# South Deep pilot preparation — 24 September 2026

## Dedicated HTTPS address activated — 26 September 2026

- IT's forwarding change resolved TCP 80 reachability. Let's Encrypt issued a separate certificate for southdeep.atecinspections.co.za, valid through 25 December 2026.
- Activated https://southdeep.atecinspections.co.za/ with dedicated Nginx TLS configuration. Updated only the pilot environment origins, API prefix, root cookie path and frontend build base. Original /southdeep/ routes now redirect to the dedicated address.
- Backups of previous environment files, frontend build and Nginx configuration are in /root/southdeep-hostname-backup-20260926. Pilot backup service ran after activation. Existing ATEC application was not restarted.
- Public HTTPS homepage, frontend JavaScript and both applications' health endpoints returned 200. Unauthenticated pilot assets and signature uploads returned 401. Stored initial admin credentials returned 401; authenticated login remains unverified after cutover. No password reset was performed.
- Existing apex/www ATEC certificate renewal succeeded. Certbot timer is active; added an Nginx configuration-check/reload deploy hook for renewed certificates. Keep public port 80 forwarding enabled for future HTTP-01 renewals.
- Temporary SSH key remains authorized pending remaining login verification. SAP remains unconnected. Historical status below is superseded by this section.

## Subdomain activation attempt — 25 September 2026

- Jacques confirmed DNS creation and restored the temporary SSH key; authentication now succeeds. The key remains authorized while hostname setup is pending.
- Public DNS resolves southdeep.atecinspections.co.za to 154.66.199.64. HTTPS still presents the parent-domain certificate, which does not cover the new hostname; do not bypass the browser warning.
- A real Certbot webroot certificate request failed: Let's Encrypt timed out connecting to public TCP 80 at 154.66.199.64. Nginx listens on port 80 and the local hostname route responds with the expected setup-pending HTTP 503. No certificate was issued and no routing cutover was performed.
- Hosting/network administrator action remains necessary to make TCP 80 publicly reachable. After that, retry certificate issuance and complete the hostname configuration. The parent-domain certificate still expires 28 September 2026 and its renewal also needs attention.
- The earlier /southdeep/ deployment remains in place. Historical sections below describe its deployment; their statement that DNS is unavailable is superseded by this update.

## Approved scope

Jacques requested a full ATEC copy, hosted separately on the existing ATEC server, suitable for a presentation and later production acceptance after contract signature. Approved intended address: `southdeep.atecinspections.co.za`. Server account supplied by Jacques: `root@atecinspections.co.za`. Do not deploy over the existing ATEC site or use its database.

## Prepared

- Source base: `87c83cdfdbcfd43574382c62646614b2039eca8a`, with an optional frontend environment notice added in the working tree.
- Deployment preparation and new-database provisioning tools: `deployment/south-deep/`.
- Schema and reference data exported read-only from the local source. Included: six equipment groups, 31 types, 771 criteria and 13 public-holiday records. No customer records, inspection history, existing users, signatures or uploads copied.
- Separate local PostgreSQL cluster: `tmp/south-deep-local-postgres-20260924`, loopback port 5544. Working pilot database: `atec_south_deep_pilot_v2`, separate database login.
- Local runtime package: `tmp/south-deep-release-20260924-v2`; API port 5101, frontend verification proxy at `http://127.0.0.1:5181`.
- The initial failed local schema restore revealed a missing pg_trgm extension. Provisioning now creates the extension before restoring schema. Failed local attempts are retained separately; no existing database was dropped or reset.

## Verified locally

- New-role/new-database provisioning and all 12 schema contract requirements passed.
- Frontend build passed; existing large-bundle warning remains.
- Browser login and dashboard displayed the South Deep pilot notice and three fictional assets.
- Equipment description edited through the UI; application confirmed the save.
- API reads passed for session, customers, sites, sections, equipment types, criteria, assets, dashboard, certificate search and notification scheduler.
- Unauthenticated asset access returned HTTP 401.
- In the local test copy only, a clearly marked DEMO signature and DEMO-NOT-VALID inspector identifier were used to exercise actual inspection capture. Saved inspection has 17 result rows; certificate JSON, HTML and PDF returned successfully. This is not a physical inspection or a valid inspection certificate. These test records/files are not included in the clean online package.
- Current local pilot contains one demonstration customer, one new administrator and three fictional assets.

## Current status

The full pilot is online at **https://www.atecinspections.co.za/southdeep/**. Jacques approved this address after confirming he has no DNS-account login. The separate subdomain is not required for this pilot. Public browser login/dashboard and live inspection/PDF generation have been verified. SAP and email remain unconfigured. Production acceptance remains open.

**Before the meeting:** the existing parent-domain HTTPS certificate expires on **28 September 2026**. Certbot logs show repeated HTTP-01 connection timeouts to port 80 for both apex and www. Port 443 is externally reachable; port 80 times out even though Nginx listens on it. The hosting/network administrator must allow inbound TCP 80 to 154.66.199.64, then renewal must be retried and verified. This remains unresolved; do not treat HTTPS availability beyond expiry as assured.

## Outstanding

- Server installation and the approved /southdeep/ HTTPS path are complete. The intended subdomain remains unused because DNS access is unavailable.
- Jacques added the temporary SSH key and authentication succeeded. Its exact authorized-key entry was removed after deployment; a new SSH attempt with that key was denied, confirming revocation. The local private-key file remains under `.local/south-deep-deploy/` but no longer grants server access; never package or commit it.
- Public browser login, dashboard and live sample inspection/certificate rendering passed. Full customer role-based UAT, production data/signatory setup and SAP integration remain separate acceptance work.
- SAP is neither implemented nor connected. No simulated exchange is represented as real.
- Existing Accelo job-number requirement, certificate issuer/branding, signatures and site-specific workflows require South Deep agreement before production acceptance.
- Establish/reconcile a migration ledger for the schema snapshot before any future release migration.

## Server installation evidence — 24 September 2026

- Host: `root@atecinspections.co.za`, public IPv4 `154.66.199.64`. Node 22.23.1 and PostgreSQL 18.4. Original ATEC lives at `/var/www/atec/ATEC`, PM2 `atec-backend`; its HEAD is `eb85309f603c1464eb8dcb87b26c987c9d0ad7ec` and it has an untracked `output/` folder. Its Git history does not contain the pilot source commit. Those existing files/processes were preserved.
- Concurrent local staged backend/package/test changes were discovered and left untouched. The already prepared pilot bundle uses the documented earlier snapshot, not those staged changes.
- Installed release: `/var/www/atec-south-deep/releases/20260924`. Dedicated OS account `atec-southdeep`; systemd service `atec-southdeep.service` is enabled and active. Pilot-only server overlay binds port 5101 to `127.0.0.1`. It is not directly exposed on the public network.
- Bundle SHA-256: `f6dc28f92f43e42fb0e5a5a84f20ec423471d8ea83eafe26176a1f39bbb218ed`. Per-file manifest covers the UI notice, pilot-only loopback binding and provisioning support for PostgreSQL peer authentication with a separate application TCP login.
- Database `atec_south_deep_pilot`, role `atec_south_deep_pilot_app`. Seed: one demonstration customer, one new admin and three sample assets; 771 criteria. No original users/data copied.
- Lockfile installs, frontend build, and all 12 schema checks passed on the server. Loopback authenticated checks passed for session, customers, sites, sections, equipment, criteria, assets, dashboard, certificates and scheduler. Unauthenticated assets returned 401. Pilot login cookie was rejected by the original ATEC application; the pilot database role has neither schema USAGE nor asset-table SELECT in the original database.
- Original ATEC health still returns HTTP 200. Its server process was not restarted and its Nginx configuration file was not edited.
- New Nginx host `/etc/nginx/sites-available/atec-southdeep` is enabled on port 80. ACME challenge path is configured. Other requests deliberately return 503 until HTTPS can be installed. Nginx configuration validation passed and it was gracefully reloaded.
- Daily local backups: `atec-southdeep-backup.timer` at 02:40 server time, using `/usr/local/sbin/atec-southdeep-backup`; first run succeeded with verified checksums. Backup root `/var/backups/atec-southdeep` is private. There is no off-server backup or retention pruning configured yet.
- Initial database backup restored successfully into `atec_south_deep_restorecheck_20260924`; counts matched (1 customer, 1 user, 3 assets, 771 criteria). PUBLIC connection permission revoked on restore-check database.
- Generated login and database credentials remain in the root-only file `/var/www/atec-south-deep/releases/20260924/pilot-access.json`. Do not display database credentials or publish the release root; serve only frontend/dist and authenticated API/upload routes.
- DNS query of the authoritative service currently returns no A record for `southdeep.atecinspections.co.za`. Zone SOA identifies `dns-admin.domains.co.za` with `ns1.tld-ns.com`. Jacques needs help accessing Domains.co.za or its reseller to add the A record `southdeep.atecinspections.co.za → 154.66.199.64`.
- After DNS: issue a separate Let's Encrypt certificate using the existing ACME account/webroot; install the dedicated HTTPS vhost; retain HTTP ACME path and redirect other requests to HTTPS; verify public functionality; privately hand over the initial application login; remove temporary SSH access. Do not claim SAP integration exists.

## Final approved path deployment

- User approved `/southdeep/` instead of waiting for DNS. Public base: `https://www.atecinspections.co.za/southdeep/`. API and upload routes stay under that path. Frontend builds MUST pass `VITE_BASE_PATH=/southdeep/` in the build process environment; the existing Vite config does not load that value from `.env.production` for its base setting.
- Only the pilot copy's cookie was renamed to `atec_southdeep_session`; it is Secure/HttpOnly and scoped to `/southdeep`. Original ATEC still uses its original cookie and JWT secret. Cross-application session rejection was tested.
- Original Nginx vhost was backed up to `/root/atecinspections-before-southdeep-20260924.conf`. The only routing addition is an include for `/etc/nginx/snippets/southdeep-locations.conf`. Configuration validation and graceful reload passed. Existing API routing and ATEC process were preserved.
- Public frontend/JS, login, session, customers, assets, dashboard and certificates returned successfully. Unauthenticated asset and upload requests were rejected. Browser login and dashboard were visually verified.
- Created one explicitly marked fictional inspection on DEMO-SD-1 with 17 results. The demo account uses `DEMO-NOT-VALID` and a signature reading `DEMONSTRATION - NOT VALID`; certificate comments state no physical inspection occurred. The example is not an operational certificate. JSON, HTML and PDF all returned successfully through the public HTTPS route. The generated PDF is 264066 bytes. Approved production inspector credentials must replace this demonstration setup before live use.
- Snap Chromium could not start within the restricted service. Installed the official Puppeteer Chrome Headless Shell 154.0.8037.57 under `/var/lib/atec-southdeep/browser/` and configured only this pilot's PUPPETEER_EXECUTABLE_PATH. Installed its missing Ubuntu runtime/font libraries (32 new packages; no package upgrades/removals and no unrelated service restarts). `NoNewPrivileges=true` and `PrivateTmp=true` remain enabled.
- Daily backup ran again after final setup and passed. Original ATEC health still returns HTTP 200.
- Application-only login details were copied privately to `D:\Projects\ATEC\.local\south-deep-deploy\south-deep-pilot-login.txt`. Do not commit this file. Server credential JSON remains root-only and includes database credentials that must not be shared as login instructions.
- Deployment evidence is stored at `/root/south-deep-deployment-evidence/` and local `tmp/south-deep-server-evidence/`. The original bundle hash identifies the upload; the final per-file manifest records the later cookie/binding overlays. No Git commit/push was made; unrelated staged work remains untouched.
