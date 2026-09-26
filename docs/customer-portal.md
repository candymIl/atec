# Customer Portal

## Purpose

Task 15 gives customer users a read-only landing page for their own ATEC records. The first local slice exposes account-level asset status, certificate status, recent certificates, and links into the existing customer-scoped certificate and detailed report workflows.

## Access Model

- Only `CUSTOMER` users can open the Customer Portal page.
- Admin users create and manage customer login accounts from `Customer Portal Users` in the admin menu.
- Manager users can also create, edit, activate, deactivate, and reset passwords for Customer Portal Users only.
- Customer login usernames are always the user's email address. Correcting the email and saving a customer user also corrects the username.
- Responsible-person accounts have an explicit `tblusers.portal_personid` link. Their access follows active sections assigned to that person across sites within the same customer. An empty assignment gives no asset/certificate access. Email/profile changes never change this link.
- Existing customer-wide/site accounts without a person link retain their configured location scope. The bulk provisioning tool preserves existing passwords and skips conflicting or ambiguous accounts.
- Person access is enforced on portal summaries, asset history, detailed reports/exports, certificate search/downloads, MPI reports and protected uploads.
- The backend summary endpoint derives the customer scope from the logged-in user's `clientid`.
- Customer users cannot pass another `clientid` to the portal summary endpoint.
- Certificate and report detail links continue to use the existing customer-scoped certificate and report endpoints.

## Current Local Scope

- Customer portal landing page.
- Active asset, site, certificate and exception counts.
- Visual/load-test overdue counts.
- Certificate expiry and not-safe counts.
- Task 14 visit summary counts when visit tables exist.
- Recent certificate list with PDF download links.
- Shortcuts to Certificates and Detailed Report.
- Customer asset drill-down with search, status filter, latest visual/load-test status, validity dates, and certificate PDF links.
- Separate Customer Portal Users management view, distinct from internal ATEC administrators, managers, inspectors and viewers.

## Not Yet In This Slice

- Customer self-service preferences.
- Customer account administration.
- Separate physical database table for customer logins. The current slice keeps one authenticated user table and separates management in the UI.
- Write access to asset, inspection, visit, or disposition records.
- Customer editing of site, section, responsible person, or asset master data.
- Email notification preferences. These belong with Task 16.

## Verification

The person-access release requires `2026-09-26-customer-portal-person-access.sql` before backend activation. Provision with `scripts/provision-responsible-portals.cjs`; its default is dry-run. Apply only after access validation, a database backup and a reviewed target/plan. The apply command reads the bootstrap password from standard input. Never put passwords in a plan, argument or output file. On Windows, `scripts/save-portal-bootstrap-password.ps1` stores the chosen secret using user-bound DPAPI under ignored `.local` storage. Keep automatic notifications off during provisioning; no welcome emails are sent by the tool.

Run `node scripts/regression/customer-portal-person-access.test.js` in addition to the existing checks. Verify actual cross-person denial and notification recipient/attachment scope against the target database before release acceptance.

Run:

```sh
npm.cmd run test:task15
npm.cmd run test:task14
npm.cmd --prefix frontend run build
node --check backend\server.js
node --check frontend\src\main.js
```
