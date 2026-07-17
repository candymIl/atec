# Customer Portal

## Purpose

Task 15 gives customer users a read-only landing page for their own ATEC records. The first local slice exposes account-level asset status, certificate status, recent certificates, and links into the existing customer-scoped certificate and detailed report workflows.

## Access Model

- Only `CUSTOMER` users can open the Customer Portal page.
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

## Not Yet In This Slice

- Customer self-service preferences.
- Customer account administration.
- Write access to asset, inspection, visit, or disposition records.
- Email notification preferences. These belong with Task 16.

## Verification

Run:

```sh
npm.cmd run test:task15
npm.cmd run test:task14
npm.cmd --prefix frontend run build
node --check backend\server.js
node --check frontend\src\main.js
```
