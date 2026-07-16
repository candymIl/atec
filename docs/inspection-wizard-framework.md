# Inspection Wizard Framework

## Scope

Task 12 introduces a reusable frontend wizard framework for equipment-family inspection flows while preserving the existing generic inspection workflow and backend save/certificate pipeline.

No production deployment, production connection, or production migration was run.

## Audit Findings

Shared behavior existed in `frontend/src/main.js`: criteria rendering, measurement capture, PASS/FAIL capture, failed-comment validation, critical safety warning, photo selection, review summary, save submission, double-submit prevention, API error preservation, valid-date handling, and generic fallback.

Duplicated behavior existed in crane and chain-block grouping logic. Both flows used text-based section categorisation and the same measurement/visual row renderers.

Equipment-specific behavior remains configuration-driven:

- Crane: supported types `401`, `402`, `404`, `406`, group `400`, visual/load-test sections, load-test setup fields, critical presentation.
- Chain Block / Lever Hoist: text-based family detection, existing section order, same criteria/results/certificate path.
- Harness/Fall-Arrest and Sling now register through the framework.

## Architecture

Framework files live under:

```text
frontend/src/inspectionWizard/
  InspectionWizard.js
  WizardNavigation.js
  WizardProgress.js
  WizardReview.js
  wizardCriteria.js
  wizardRegistry.js
  wizardState.js
  wizardValidation.js
  configurations/
    chainBlockWizardConfig.js
    craneWizardConfig.js
    harnessWizardConfig.js
    slingWizardConfig.js
```

`main.js` still owns the current application rendering and save route integration. The framework owns resolution, config metadata, shared criteria grouping, shared validation helpers, state helpers, progress/navigation helpers, and optional tag display helpers.

## Registry

`wizardRegistry.js` exports:

- `wizardConfigurations`
- `resolveInspectionWizard`
- `getInspectionWizardKey`
- `assetSupportsCraneWizard`

Resolution order:

1. Explicit supported equipment type.
2. Matching live criteria for the requested inspection type.
3. Equipment group or configured family text match.
4. Generic fallback.

Crane group `400` does not automatically activate unknown future group-400 equipment unless matching criteria exist.

## Config Model

Each configuration can define:

- `id`
- `displayName`
- `supportedEquipmentTypes`
- `supportedEquipmentGroups`
- `supportedInspectionTypes`
- `sections`
- `getCriteriaSection`
- `photoPrompts`
- `declarations`
- `genericFallback`

The actual inspection checklist remains database-driven through equipment criteria.

## Criteria Grouping

Grouping priority is:

1. Stable database metadata where available.
2. Config section mapping.
3. Display/sort order already supplied by criteria loading.
4. Text categorisation fallback.

`inspectioncategory` controls whether a criterion applies to `VISUAL` or `LOADTEST`.

`inspection_category` represents the inspection classification/grouping metadata such as periodic or load-test subcategory. It is not the primary visual/load-test applicability switch.

## Validation And State

Shared helpers cover:

- Optional tag normalization.
- Duplicate-tag lookup gating.
- Numeric validation.
- Failed-result comment detection.
- Declaration checks.
- Wizard dirty state.
- Double-submit state.
- Progress and navigation calculations.

The existing save flow still performs final validation and backend submission.

## Critical Safety

The frontend still detects `CRITICAL` criteria, shows critical failures, forces visible Safe For Continued Operation to `NO`, and prevents a misleading SAFE review state.

The backend remains authoritative through `applyCriticalSafetyRule` in `backend/server.js`.

## Optional Tag Behaviour

Rules:

- Blank or whitespace-only tags normalize to `NULL`.
- Duplicate validation is skipped for `NULL`.
- Non-blank tags are trimmed and stay unique.
- Duplicate non-blank tags are rejected through the existing safe backend error.
- Certificates render blank tags as `Not Issued`.

The supporting nullable migration is `database/2026-07-15-task12a-optional-inspection-tag.sql`. It was not executed.

## Generic Fallback

Asset-list generic buttons were removed for crane wizard assets. Inspectors can still choose `Use Generic Form` from inside the wizard.

Unsupported equipment and disabled wizard resolution still use the generic inspection form.

## Chain Block Migration

Chain Block / Lever Hoist now uses the shared config and criteria grouping helper while preserving its existing sections, criteria rows, safety behavior, generic save path, certificates, and fallback.

## Crane Migration

The Task 12A Crane Wizard now uses the shared registry and crane config for resolution and grouping while preserving:

- Types `401`, `402`, `404`, `406`.
- Group `400` classification.
- Visual and load-test flows.
- Manual test-load capture.
- Measurement rows.
- Critical safety presentation.
- Photos.
- Signature/declaration.
- Review.
- Existing certificate path.

## Harness And Sling Registration

Add a config file under `frontend/src/inspectionWizard/configurations/`, then add it to `wizardConfigurations` in `wizardRegistry.js`.

The engine should not need changes for a new family if the config provides supported types/groups, inspection types, sections, and a criteria-section callback.

Harness/Fall-Arrest is registered as `HARNESS_FALL_ARREST` for explicitly configured types `601` and `339` when active VISUAL criteria exist. It does not assume load testing or retirement calculations.

Sling is registered as `SLING` for explicitly configured type `201` when active criteria exist. Related-sounding future sling types are not activated by name alone.

## Access Control

The wizard selection is frontend-only convenience. It does not bypass backend authorization.

Backend permissions, inspector identity, asset/customer/site scoping, viewer denial, and customer denial remain server-controlled.

## Tests

Local framework regression:

```powershell
npm.cmd run test:task12-framework
```

Related regressions:

```powershell
npm.cmd run test:task12a
npm.cmd run test:task10
npm.cmd run test:task11
```

## Deployment

Local only in this task.

Production commands, not executed:

```bash
# NOT EXECUTED
cd /path/to/ATEC
npm --prefix frontend run build
# deploy reviewed frontend bundle and backend code through the existing process
```

## Rollback

Rollback is a code rollback unless the optional tag migration has been applied in an approved environment. If that migration was applied, keep the nullable tag behavior unless a formal database rollback is approved.

## Known Limitations

- Current rendering still lives mostly in `main.js`; the framework now owns resolution/config/shared helpers.
- No live database audit was performed.
- Draft persistence remains in memory until final submit.
- Additional sling families/types require confirmed active criteria before enablement.
