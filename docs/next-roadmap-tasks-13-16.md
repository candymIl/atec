# ATEC Next Roadmap: Tasks 13 To 16

## Task 13: NFC Asset Support - Complete Locally

Add secure NFC URL tags for assets while preserving QR workflows. NFC uses a separate random lookup token, authenticated asset resolution, Admin/Manager token controls, audit events, and manual NDEF URI writing guidance.

## Task 14: On-Site Due-Asset Coverage - In Progress Locally

Build visit/session-based coverage for due assets at a customer site. This depends on Task 13/QR-style fast asset identification and must track completed during visit, still due, not found, out of service, removed, inaccessible, deferred, customer says missing, and newly discovered unregistered assets.

## Task 15: Customer Portal - Next

Expose customer-facing certificate, asset, and report workflows through explicit customer scoping. This depends on the existing RBAC model and must not expose private data through NFC or QR endpoints.

## Task 16: Email And Notifications - After Task 15

Add automated email and notification workflows for due assets, coverage exceptions, certificates, and portal events. This should depend on Task 14 visit events and Task 15 customer preferences, with audit logging and opt-in configuration.
