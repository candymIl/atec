# Harness And Fall-Arrest Inspection Wizard

## Scope

Task 12B adds a guided, mobile-friendly inspection wizard for configured harness and fall-arrest equipment using the reusable Task 12 inspection wizard framework.

No production deployment, production database connection, or production migration was run.

## Supported Equipment Types

Repository audit found these configured harness/fall-arrest references:

| Equipment type ID | Description / source | Wizard support |
| --- | --- | --- |
| 601 | Safety harness / lanyard criteria update in `2026-06-24-safety-harness-lanyard-safe-service-yesno.sql` | Supported when active VISUAL criteria exist |
| 339 | Fall arrestor criteria update in `2026-06-24-fall-arrestor-safe-service-yesno.sql` | Supported when active VISUAL criteria exist |
| 323 | Historical Safety Harness inserted under group 600, then merged away | Not enabled; migrated to 602 |
| 602 | Merge target for historical 323 assets | Not enabled because no harness criteria migration was found for 602 |

The wizard does not enable related-sounding future types unless they are explicitly configured and have suitable active criteria.

## Wizard Registration

The configuration lives at:

`frontend/src/inspectionWizard/configurations/harnessWizardConfig.js`

It is registered through `wizardRegistry.js` as `HARNESS_FALL_ARREST`.

The config supports `VISUAL` only. It does not assume load testing.

## Workflow

The wizard uses the shared step/progress/navigation/review mechanics:

1. Asset confirmation
2. Inspection setup
3. Criteria-driven inspection sections
4. Photos
5. Inspector declaration
6. Review and submit

The setup step captures:

- Item available for full examination
- Clean enough for reliable inspection
- Inspection history available
- Reason if inspection could not be completed
- Known fall arrest
- Shock loading
- Fire, heat, or chemical exposure
- Unknown history

These answers are stored in inspection comments with the final inspection.

## Criteria Grouping

Criteria remain database-driven. The config only groups available active criteria into display sections:

- Identification and Traceability
- Webbing and Textile Components
- Stitching and Seams
- Buckles, Adjusters and Connectors
- D-rings and Attachment Points
- Lanyards, Shock Absorbers and Fall-Arrest Components
- Labels, Markings and Instructions
- Contamination, Heat and Chemical Exposure
- Previous Fall / Loading History
- Defects and Rejection Decision
- Final Safe For Service

`inspectioncategory` controls whether a row applies to `VISUAL`. `inspection_category` remains classification metadata.

## Identification And Traceability

The wizard displays existing asset identity fields including asset ID, asset tag, customer, site, section, equipment type, description, manufacturer, model, serial/batch number, size where available, manufacture date where available, previous inspection, previous status, and previous valid date.

The wizard does not allow identity fields to be changed during inspection.

## Textile And Metal Components

The wizard groups existing database criteria for webbing, stitching, seams, buckles, adjusters, connectors, D-rings, attachment points, lanyards, shock absorbers, labels, contamination, heat, and chemical exposure.

No numerical acceptance limits were added.

## Fall History And Retirement

Fall history and exposure questions are captured for review and saved comments.

No retirement date or expiry calculation was added. The wizard uses existing asset dates and criteria only.

## Critical Safety

Any criterion marked `CRITICAL` continues to force NOT SAFE through the existing frontend warning and backend `applyCriticalSafetyRule`.

The frontend requires comments for failed criteria. The backend remains authoritative.

## Photos

The wizard reuses existing inspection photo upload handling. Suggested prompts are shown for general equipment, labels, serial/batch marking, webbing, stitching, D-rings, buckles, connectors, lanyards, shock absorber, defects, and quarantine/rejection marking.

No photo type migration was added.

## Signature

The wizard displays logged-in inspector identity and signature status. The backend still resolves the inspector from `req.user.user_id`.

## Optional Tag Number

The shared Task 12 optional tag behavior applies:

- Optional
- Trimmed
- Blank saves as `NULL`
- Unique when supplied
- Certificates display `Not Issued` for blank tags

## Certificate Integration

The wizard saves through `POST /inspections` and uses the existing certificate preview, HTML, PDF, bulk PDF, and email PDF paths.

No separate certificate renderer or legal wording was added.

## Permissions

Wizard selection is frontend convenience only. Backend authorization remains authoritative for Admin, Manager, Inspector, Viewer, and Customer roles.

## Database And Configuration Changes

No Task 12B database migration was added. The implementation uses existing criteria and metadata.

## Testing

Run:

```powershell
npm.cmd run test:task12b
```

Related:

```powershell
npm.cmd run test:task12-framework
npm.cmd run test:task12a
npm.cmd run build --prefix frontend
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

Rollback is a code rollback. No Task 12B migration rollback is required because no Task 12B migration was added.

## Known Limitations

- No live database audit was performed.
- Type `602` is not enabled until suitable active criteria are confirmed.
- No universal service-life or retirement rule is implemented.
- Load testing is not enabled for harness/fall-arrest types.
