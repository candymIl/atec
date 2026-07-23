# ATEC Next Roadmap: Tasks 13 To 18

## Task 13: NFC Asset Support - Complete Locally

Add secure NFC URL tags for assets while preserving QR workflows. NFC uses a separate random lookup token, authenticated asset resolution, Admin/Manager token controls, audit events, and manual NDEF URI writing guidance.

## Task 14: On-Site Due-Asset Coverage - Complete Locally

Build visit/session-based coverage for due assets at a customer site. This depends on Task 13/QR-style fast asset identification and must track completed during visit, still due, not found, out of service, removed, inaccessible, deferred, customer says missing, and newly discovered unregistered assets.

## Task 15: Customer Portal - Complete Locally

Expose customer-facing certificate, asset, and report workflows through explicit customer scoping. This depends on the existing RBAC model and must not expose private data through NFC or QR endpoints.

## Task 16: Email And Notifications - Complete Locally

Add automated email and notification workflows for due assets, coverage exceptions, certificates, and portal events. This should depend on Task 14 visit events and Task 15 customer preferences, with audit logging and opt-in configuration.

## Task 17: Scheduled Automatic Notifications - Complete Locally

Turn the manual Notification Centre into a controlled automatic send workflow. This adds delivery history, last-sent visibility, daily scheduler controls, duplicate-send protection, and a manual "run scheduled check" action for admins and managers.

## Task 18: Notification History And Templates - Complete Locally

Expose recent manual and automatic notification delivery history on the dashboard and improve customer-facing notification email wording so customers can quickly see what needs attention.

Verification:

- Notification history and template regression checks pass.
- Task 18 is included in the root release test suite.

## Next Delivery Focus

1. Complete production-like, role-based UAT across Admin, Manager, Inspector, Viewer, and Customer accounts.
2. Prove database and uploads restore against an isolated restore database.
3. Resolve migration-ledger drift and keep all future production migrations checksum-governed.
4. Add browser-level tests for asset setup, inspections, job cards, notifications, and customer isolation.
5. Gradually split the large backend and frontend entry files into domain modules.
