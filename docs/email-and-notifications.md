# Email And Notifications

## Purpose

Task 16 added notification workflows on top of the customer portal, due-asset coverage, certificate expiry, and visit exception data. Task 17 turns that manual Notification Centre into a controlled scheduled workflow with delivery history and duplicate-send protection. Task 18 makes the history visible on the dashboard and improves the customer-facing email wording.

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
- Delivery history for manual and automatic sends.
- Last sent date and automatic readiness on each Notification Centre row.
- Recent Notification History panel on the dashboard.
- Clearer customer notification email body with only active attention items listed.
- Scheduler status on the dashboard.
- Manual "run scheduled check" action for admins and managers.
- Dashboard summary cache includes notification data.
- Standalone `/dashboard/notification-centre` endpoint for fallback loading.

## Access Model

- Internal dashboard roles use the same dashboard access as existing operational alerts.
- Customer/viewer scoping follows the existing dashboard customer scope.
- Customer portal users are counted as recipients only when active and carrying an email address.
- Notification Centre rows respect the customer preference toggles before showing counts.
- Automatic sending is off unless `NOTIFICATION_AUTO_SEND_ENABLED=true`.
- Automatic sending uses `NOTIFICATION_AUTO_SEND_TIME`, defaulting to `07:00`.
- The same customer/site is protected by `NOTIFICATION_AUTO_SEND_COOLDOWN_HOURS`, defaulting to 24 hours.

## Scheduled Automatic Notifications

The scheduler checks the Notification Centre rows and sends only rows that:

- Have active Customer Portal Users with email addresses.
- Still have notification items needing attention.
- Have not been sent inside the configured cooldown window.
- Are allowed by that customer's notification preferences.

Useful live environment settings:

```sh
NOTIFICATION_AUTO_SEND_ENABLED=false
NOTIFICATION_AUTO_SEND_TIME=07:00
NOTIFICATION_AUTO_SEND_COOLDOWN_HOURS=24
NOTIFICATION_AUTO_SEND_CHECK_MINUTES=5
NOTIFICATION_AUTO_SEND_MAX_ROWS=25
```

Keep automatic sending off while SMTP is being fixed. Once test emails work, switch `NOTIFICATION_AUTO_SEND_ENABLED=true` and restart the backend.

## Not Yet In This Slice

- Per-event notification audit records.
- Separate branded HTML email templates for due assets, visit exceptions, or portal events.

## Verification

Run:

```sh
npm.cmd run test:task16
npm.cmd run test:task17
npm.cmd run test:task18
npm.cmd run test:task15
npm.cmd --prefix frontend run build
node --check backend\server.js
node --check frontend\src\main.js
```
