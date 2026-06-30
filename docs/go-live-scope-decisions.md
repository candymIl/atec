# ATEC Go-Live Scope Decisions

## QR Batch Printing

Status: moved out of go-live scope.

Reason:

- Single asset QR labels and QR lookup are already useful for internal work.
- Batch QR printing needs final label size, printer stock, page layout, and field verification before customer-facing use.
- This can be completed safely after the main inspection/certificate workflow is stable.

Go-live scope:

- Keep single asset QR labels.
- Keep QR asset lookup.
- Keep QR certificate/PDF links where already available.

After go-live:

- Add batch QR label selection.
- Add label sheet presets.
- Add print preview verification.

## SHE / Risk Assessment Module

Status: internal prototype only for go-live.

Reason:

- SHE risk assessments exist, but corrective action workflow, ownership, due dates, close-out evidence, and SHE dashboard reporting still need final workflow testing.

Go-live scope:

- Hide or limit SHE to internal admin/manager use.
- Do not present SHE as a completed customer-facing module yet.

After go-live:

- Finish corrective actions.
- Add close-out evidence uploads.
- Add SHE dashboard KPIs.
- Add SHE report exports.
- Add audit coverage for corrective action changes.
