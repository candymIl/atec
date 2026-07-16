# Sling Inspection Wizard

## Scope

Task 12C adds a guided sling inspection wizard using the reusable Task 12 inspection wizard framework.

No production deployment, production database connection, production migration, real sling inspection, or real sling load test was run.

## Supported Equipment Types

Repository audit found one confirmed sling criteria migration:

| Equipment type ID | Source | Wizard support |
| --- | --- | --- |
| 201 | `2026-06-24-steel-wire-rope-sling-visual-passfail.sql` | Supported when active criteria exist |

Types `202` and `203` appear in certificate regulation-note grouping, but no repository migration with suitable sling criteria was found. They are not enabled.

The wizard does not activate an equipment type merely because its name contains `sling`.

## Framework Registration

The config lives at:

`frontend/src/inspectionWizard/configurations/slingWizardConfig.js`

It is registered as `SLING` in `wizardRegistry.js`.

## Family-Specific Flow

The wizard uses the shared wizard shell:

1. Asset confirmation
2. Inspection setup
3. Criteria-driven sections
4. Photos
5. Inspector declaration
6. Review and submit

For load-test criteria, the same wizard can show configured load-test sections, but no proof-load multiplier is invented.

## Criteria Grouping

Criteria remain database-driven and are grouped for display into:

- Identification and Traceability
- Sling Body / Material Inspection
- Wire Rope Condition
- Chain Links and Components
- Webbing / Round Sling Body
- End Fittings and Connectors
- Wear, Deformation and Damage
- Heat, Chemical and Environmental Exposure
- Load History and Misuse
- Measurements
- Defects and Rejection Decision
- Final Safe For Service

`inspectioncategory` controls Visual versus Load Test applicability. `inspection_category` remains classification metadata.

## Measurements

Configured `NUMBER` or `MEASURED` rows are shown as measurement rows. Invalid numeric values are rejected before save. No discard limits, wear percentages, elongation limits, or proof-load multipliers were added.

## Load-Test Handling

Load-test flow is only selected when active load-test criteria exist for a supported sling type. The wizard displays rated WLL from the asset where available and captures intended/actual test load manually unless approved configured calculations exist.

## Critical Rejection Logic

Any criterion marked `CRITICAL` continues to force NOT SAFE through frontend presentation and backend `applyCriticalSafetyRule`. Failed criteria require comments.

No rejection rule is implemented solely from legal wording or invented thresholds.

## Photos

The wizard reuses existing inspection photo handling. Prompts include general sling view, identification tag, sling body, end eye, master link, hook, safety latch, chain links, wire rope, ferrule/splice, textile damage, defect, and load-test setup.

No photo migration was added.

## Signature

The logged-in inspector identity and saved signature status are used. Another user signature cannot be selected.

## Optional Tag

Shared optional tag behavior applies:

- Optional
- Trimmed
- Blank saves as `NULL`
- Unique when supplied
- `Not Issued` display when blank

## Certificates

The wizard saves through existing `POST /inspections` and uses existing certificate preview, HTML, PDF, bulk PDF, and email PDF rendering.

No separate renderer or legal wording was added.

## Permissions

Wizard resolution is frontend-only convenience. Backend authorization, inspector identity, asset scoping, Viewer denial, and Customer denial remain authoritative.

## Database Changes

No Task 12C migration was added. The implementation uses existing criteria and metadata.

## Testing

Run:

```powershell
npm.cmd run test:task12c
```

Related:

```powershell
npm.cmd run test:task12b
npm.cmd run test:task12-framework
npm.cmd run test:task12a
cd frontend
npm.cmd run build
```

## Deployment

Not executed.

Production commands, not executed:

```bash
# NOT EXECUTED
cd /path/to/ATEC
npm --prefix frontend run build
# deploy reviewed frontend/backend bundle through the existing process
```

## Rollback

Rollback is a code rollback. No Task 12C migration rollback is required because no Task 12C migration was added.

## Known Limitations

- No live database audit was performed.
- Only type `201` is enabled.
- No sling proof-load multiplier or discard threshold is implemented.
- Load-test flow depends on configured active load-test criteria.
