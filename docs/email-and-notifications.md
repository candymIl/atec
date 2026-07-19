# Email And Notifications

## Purpose

Task 16 adds notification workflows on top of the customer portal, due-asset coverage, certificate expiry, and visit exception data. The first local slice creates a dashboard Notification Centre so ATEC can review who needs attention before automatic email sending is enabled.

## Current Local Scope

- Dashboard Notification Centre grouped by customer and site.
- Counts for due assets, overdue assets, expiring certificates, failed assets, open visits, unresolved visit items, and deferred follow-ups due.
- Customer portal recipient readiness based on active customer users with email addresses.
- Customer notification preferences on the Customer Setup form.
- Per-customer toggles for certificate expiry, overdue assets, failed assets, and visit exceptions.
- Per-customer expiry reminder lead days.
- CSV export of the notification rows.
- Customer report shortcut from each notification row.
- Manual email preview from each notification row.
- Manual notification sending to active Customer Portal Users for the selected customer/site.
- Audit logging for manually sent notifications.
- Dashboard summary cache includes notification data.
- Standalone `/dashboard/notification-centre` endpoint for fallback loading.

## Access Model

- Internal dashboard roles use the same dashboard access as existing operational alerts.
- Customer/viewer scoping follows the existing dashboard customer scope.
- Customer portal users are counted as recipients only when active and carrying an email address.
- Notification Centre rows respect the customer preference toggles before showing counts.

## Not Yet In This Slice

- Scheduled daily or weekly jobs.
- Per-event notification audit records.
- Email templates for due assets, visit exceptions, or portal events.

## Verification

Run:

```sh
npm.cmd run test:task16
npm.cmd run test:task15
npm.cmd --prefix frontend run build
node --check backend\server.js
node --check frontend\src\main.js
```
