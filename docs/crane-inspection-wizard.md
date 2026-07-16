# Crane Inspection And Load-Test Wizard

## Scope

Task 12A adds a guided frontend wizard for crane equipment types while preserving the existing generic inspection form, backend inspection save route, inspection results, photos, signatures, and certificate rendering.

No production deployment or production migration was run.

Task 12 Framework moved crane wizard resolution and criteria grouping into `frontend/src/inspectionWizard/configurations/craneWizardConfig.js` and `frontend/src/inspectionWizard/wizardRegistry.js`. The rendering and save integration still use the existing inspection page and backend route.

## Supported Equipment Types

The wizard is enabled explicitly for the crane equipment type IDs seeded by the existing overhead-crane criteria migration:

| Equipment type ID | Source |
| --- | --- |
| 401 | `database/2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql` |
| 402 | `database/2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql` |
| 404 | `database/2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql` |
| 406 | `database/2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql` |

The local `.env` points at an external database host, so the implementation audit did not connect to live data. The supported IDs are derived from the local migration/configuration files and existing frontend/backend behavior.

Unknown future group-400 equipment types do not automatically receive the crane wizard unless matching inspection criteria exist.

## Visual Wizard Flow

Visual crane inspections use these guided steps:

1. Asset confirmation
2. Inspection setup
3. Dynamic criteria sections:
   - Inspection Setup
   - Crane Structure
   - Hoist and Lifting Mechanism
   - Hooks and Load-Bearing Components
   - Ropes, Chains and Drums
   - Electrical and Control Systems
   - Safety Devices
   - Travel System and End Stops
   - Operational Checks
   - Defects and Final Safety
4. Photos
5. Inspector declaration
6. Review and submit

Criteria are still loaded from `/equipment-type-criteria` and saved through `POST /inspections`.

Inspection tag number is optional in the Crane Wizard. If left blank, the existing inspection save route stores it as `NULL` and certificates display `Not Issued`.

## Load-Test Wizard Flow

Crane load tests use these guided steps when load-test criteria exist for the selected equipment type:

1. Asset confirmation
2. Test setup
3. Dynamic criteria sections:
   - Pre/Post Test Inspection
   - Test Equipment and Calibration
   - Rated Capacity and Test Load
   - Static Test
   - Dynamic Test
   - Brake and Holding Test
   - Deflection Measurements
   - Defects and Final Safety
4. Photos
5. Inspector declaration
6. Review and submit

Rated capacity is displayed from the asset `wll`. No new load multiplier was introduced for crane types. If an approved criteria/configured load calculation is not present, intended and actual test load are manual inspector captures.

## Criteria Grouping

The wizard groups existing database criteria by stable metadata first where available in the loaded criteria rows, then by config sections, then by criterion text categories for display only. It does not create a separate hard-coded crane checklist. The submitted result rows still use the original `criteriaid` values.

`inspectioncategory` controls Visual versus Load Test applicability. `inspection_category` represents classification/grouping metadata and is not the primary applicability switch.

## Measurements

Measured criteria continue to use existing `fieldtype = NUMBER` / `resulttype = MEASURED` rows. Standard values are resolved from existing asset fields such as:

- `wll`
- `span`
- `permissibledeflection`
- `hooksize`
- `steelwireropemm`
- `hoistserialno`
- auxiliary hoist fields added by `database/2026-06-24-overhead-crane-aux-hoist-fields.sql`

The frontend rejects invalid numeric input before save and preserves entered decimal values instead of forcing trailing `.00` formatting.

## Tag Number

The Crane Wizard does not require an inspection tag number before moving through the setup or review steps. When a value is supplied, it is submitted unchanged through the existing `tagnumber` field so existing uniqueness/business validation can still apply. When blank, the backend uses its existing nullable representation and saves `NULL`.

Production databases must allow `atec.tblinspection.tagnumber` to be nullable for this refinement. Use `database/2026-07-15-task12a-optional-inspection-tag.sql` after normal backup/change approval.

## Critical Safety Logic

The wizard reuses the existing critical-safety implementation:

- Frontend criteria marked `severity = CRITICAL` force the visible SAFE FOR CONTINUED OPERATION criterion to `NO` when failed.
- Backend `applyCriticalSafetyRule` in `backend/server.js` rechecks submitted results and forces final status to `NOT SAFE`.
- Failed criteria require comments before submit.
- The review screen lists failed critical criteria that force `NOT SAFE`.

No critical rule is based on a crane-specific display text override where `severity = CRITICAL` exists.

## Photos

The wizard reuses the existing inspection photo upload flow:

- `inspectionPhotos`
- `photoCaptions`
- `photoTypes`
- `atec.tblinspectionphoto`
- existing compression and image validation middleware

Available photo types remain the current configured types: `GENERAL`, `DEFECT`, `REPAIR`, `LOAD_TEST`, `NAMEPLATE`, `HOOK`, `WIRE_ROPE`, `STRUCTURE`, and `ELECTRICAL`.

## Signature

The wizard displays the logged-in inspector identity and signature status. Submission still uses the backend inspector profile lookup for `req.user.user_id`; another user's signature cannot be selected from the wizard.

## Permissions

Frontend entry points remain limited to roles that can create inspections: `ADMIN`, `MANAGER`, and `INSPECTOR`. Backend authorization remains in the existing inspection route and middleware. `VIEWER` and `CUSTOMER` users do not receive create-inspection access.

## Certificate Integration

The wizard saves normal inspection headers and result rows, so completed crane wizard inspections continue to use:

- certificate preview
- certificate HTML view
- single PDF
- bulk PDF
- email PDF
- existing legal statements
- inspector signature and LMI number
- inspection photos where supported

No new certificate renderer was added.

## Database And Configuration Changes

The initial wizard uses existing migration-backed fields and criteria metadata:

- `database/2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql`
- `database/2026-06-24-overhead-crane-aux-hoist-fields.sql`
- `database/2026-06-26-add-additional-comments-criteria-401-402-404-406.sql`

The optional inspection tag refinement adds:

- `database/2026-07-15-task12a-optional-inspection-tag.sql`

## Local Testing

Run locally:

```powershell
cd D:\Projects\ATEC
node scripts\regression\task12a-crane-wizard.test.js
cd frontend
npm run build
```

## Production Deployment

Not executed.

Suggested production sequence after normal review and backup approval:

```bash
# NOT EXECUTED
cd /path/to/ATEC
npm --prefix frontend run build
# package and deploy frontend using the existing deployment process
# restart backend only if backend code changed in the reviewed release
```

No Task 12A production migration is required.

## Rollback

Rollback is a code rollback only:

1. Revert the Task 12A frontend and documentation changes.
2. Rebuild the frontend.
3. Redeploy the previous approved frontend bundle.

No Task 12A database rollback is required.

## Known Limitations

- The local audit did not query the external database in `.env`; live criteria counts and names must be verified in a safe staging or approved read-only production audit.
- Load-test calculations are manual unless existing configured criteria provide a specific approved calculation.
- Draft persistence is in-browser while moving between wizard steps; no partial inspection records are created before final submit.
