# Inspection Workflow

## Overview

ATEC supports generic inspections and configured wizard inspections. Both save through the same backend inspection route and produce the same certificate records.

## Flow

1. Select an asset.
2. Choose inspection or load test.
3. The wizard registry resolves a family-specific wizard if supported.
4. Unsupported assets use the generic inspection form.
5. Results, comments, photos, tag number, and final status are submitted to `POST /inspections`.
6. Certificates render from saved inspection headers, results, photos, and inspector identity.

## Wizard Fallback

Wizard-supported assets show wizard buttons in asset lists. The separate list-level generic buttons were removed. Inspectors can still open the generic form from inside the wizard using `Use Generic Form`.

Currently registered wizard families:

- Crane
- Chain Block / Lever Hoist
- Harness / Fall-Arrest
- Sling

## Optional Tag Number

Inspection tag number is optional in generic forms and wizard forms:

- Blank becomes `NULL`.
- Whitespace becomes `NULL`.
- Supplied values are trimmed.
- Duplicate checks apply only to supplied non-blank values.
- Certificates display `Not Issued` for blank tags.

## Security

Frontend wizard selection does not grant access. Backend role checks, inspector identity lookup, asset scoping, and customer/viewer denial remain authoritative.
