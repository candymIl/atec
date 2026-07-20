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

## Task 18: Notification History And Templates - In Progress Locally

Expose recent manual and automatic notification delivery history on the dashboard and improve customer-facing notification email wording so customers can quickly see what needs attention.
