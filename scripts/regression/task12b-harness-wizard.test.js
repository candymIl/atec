const fs = require("fs")
const path = require("path")
const assert = require("assert")

const root = path.resolve(__dirname, "..", "..")
const fileUrl = relativePath => new URL(`file:///${path.join(root, relativePath).replace(/\\/g, "/")}`).href
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8")

function assertIncludes(file, text, message) {
  assert(file.includes(text), message || `Expected source to include ${text}`)
}

(async () => {
  const registry = await import(fileUrl("frontend/src/inspectionWizard/wizardRegistry.js"))
  const validation = await import(fileUrl("frontend/src/inspectionWizard/wizardValidation.js"))
  const review = await import(fileUrl("frontend/src/inspectionWizard/WizardReview.js"))
  const harnessConfigModule = await import(fileUrl("frontend/src/inspectionWizard/configurations/harnessWizardConfig.js"))

  const harnessConfig = harnessConfigModule.harnessWizardConfig
  const frontendMain = read("frontend/src/main.js")
  const assetSetup = read("frontend/src/pages/AssetSetup.js")
  const inspections = read("frontend/src/pages/Inspections.js")
  const backendServer = read("backend/server.js")
  const certificateRenderer = read("backend/services/certificateRenderer.js")
  const frameworkDocs = read("docs/inspection-wizard-framework.md")
  const harnessDocs = read("docs/harness-inspection-wizard.md")
  const workflowDocs = read("docs/inspection-workflow.md")
  const harnessMigration = read("database/2026-06-24-safety-harness-lanyard-safe-service-yesno.sql")
  const fallArrestorMigration = read("database/2026-06-24-fall-arrestor-safe-service-yesno.sql")

  const harnessAsset = { equiptypeid: "601", equipgroupid: "600", equipmenttype: "Safety Harness / Lanyard" }
  const fallArrestorAsset = { equiptypeid: "339", equipgroupid: "600", equipmenttype: "Fall Arrestor" }
  const unsupportedAsset = { equiptypeid: "777", equipgroupid: "600", equipmenttype: "Future fall item" }
  const harnessCriteria = [
    { criteriaid: 1, equiptypeid: "601", inspectioncategory: "VISUAL", criterianame: "Webbing free from cuts", severity: "CRITICAL", active: true },
    { criteriaid: 2, equiptypeid: "601", inspectioncategory: "VISUAL", criterianame: "Stitching is intact", severity: "CRITICAL", active: true },
    { criteriaid: 3, equiptypeid: "601", inspectioncategory: "VISUAL", criterianame: "Connector gate locks correctly", severity: "CRITICAL", active: true },
    { criteriaid: 4, equiptypeid: "601", inspectioncategory: "VISUAL", criterianame: "Shock absorber has not deployed", severity: "CRITICAL", active: true },
    { criteriaid: 5, equiptypeid: "339", inspectioncategory: "VISUAL", criterianame: "Confirm whether the equipment is safe for service", resulttype: "YES_NO", active: true }
  ]

  assert.strictEqual(harnessConfig.id, "HARNESS_FALL_ARREST", "Harness wizard ID changed")
  assert(harnessConfig.supportedEquipmentTypes.includes("601"), "Harness type 601 must be supported")
  assert(harnessConfig.supportedEquipmentTypes.includes("339"), "Fall-arrestor type 339 must be supported")
  assert.strictEqual(harnessConfig.supportedInspectionTypes.includes("VISUAL"), true, "Harness wizard must support visual inspection")
  assert.strictEqual(harnessConfig.supportedInspectionTypes.includes("LOADTEST"), false, "Harness wizard must not assume load testing")
  assert.strictEqual(harnessConfig.requireCriteriaForExplicitType, true, "Harness wizard must require matching criteria")

  assert.strictEqual(registry.getInspectionWizardKey(harnessAsset, [], "VISUAL"), "GENERIC", "Harness without criteria must fall back")
  assert.strictEqual(registry.getInspectionWizardKey(harnessAsset, harnessCriteria, "VISUAL"), "HARNESS_FALL_ARREST", "Harness with criteria must resolve")
  assert.strictEqual(registry.getInspectionWizardKey(fallArrestorAsset, harnessCriteria, "VISUAL"), "HARNESS_FALL_ARREST", "Fall-arrestor with criteria must resolve")
  assert.strictEqual(registry.getInspectionWizardKey(unsupportedAsset, harnessCriteria, "VISUAL"), "GENERIC", "Unsupported type must stay generic")
  assert.strictEqual(registry.getInspectionWizardKey(harnessAsset, harnessCriteria, "LOADTEST"), "GENERIC", "Harness load test must stay generic unless configured")

  assert.strictEqual(harnessConfig.getCriteriaSection(harnessCriteria[0]), "Webbing and Textile Components", "Webbing criteria grouping failed")
  assert.strictEqual(harnessConfig.getCriteriaSection(harnessCriteria[1]), "Stitching and Seams", "Stitching criteria grouping failed")
  assert.strictEqual(harnessConfig.getCriteriaSection(harnessCriteria[2]), "Buckles, Adjusters and Connectors", "Connector criteria grouping failed")
  assert.strictEqual(harnessConfig.getCriteriaSection(harnessCriteria[3]), "Lanyards, Shock Absorbers and Fall-Arrest Components", "Shock absorber grouping failed")

  assertIncludes(frontendMain, "function renderHarnessWizard(", "Harness wizard renderer must exist")
  assertIncludes(JSON.stringify(harnessConfig), "harnessAvailableForFullExamination", "Full-examination setup field is missing")
  assertIncludes(JSON.stringify(harnessConfig), "harnessCleanEnoughForInspection", "Clean-enough setup field is missing")
  assertIncludes(JSON.stringify(harnessConfig), "harnessInspectionHistoryAvailable", "Inspection-history setup field is missing")
  assertIncludes(JSON.stringify(harnessConfig), "harnessArrestedFall", "Fall-history capture is missing")
  assertIncludes(JSON.stringify(harnessConfig), "harnessShockLoaded", "Shock-load capture is missing")
  assertIncludes(JSON.stringify(harnessConfig), "harnessHeatChemicalExposure", "Heat/chemical exposure capture is missing")
  assertIncludes(JSON.stringify(harnessConfig), "harnessUnknownHistory", "Unknown-history capture is missing")
  assertIncludes(frontendMain, "Valid date cannot be before the inspection date.", "Invalid date ordering validation is missing")
  assertIncludes(frontendMain, "Enter a valid numeric measurement.", "Invalid numeric validation is missing")
  assertIncludes(frontendMain, "Enter a reason/comment for every failed", "Failed criterion comment validation is missing")
  assertIncludes(frontendMain, "getHarnessSetupReviewRows", "Harness review generation is missing")
  assertIncludes(frontendMain, "HARNESS_FALL_ARREST", "Harness start route is missing")
  assertIncludes(frontendMain, "updateInspectionSafetyWarning", "Critical safety UI hook must remain")
  assertIncludes(frontendMain, "window.inspectionSaveInProgress", "Double-submit protection must remain")

  assertIncludes(assetSetup, "assetSupportsInspectionWizard", "Asset setup must expose harness through registry")
  assertIncludes(inspections, "assetSupportsInspectionWizard", "Inspection page must expose harness through registry")

  assert.strictEqual(validation.normalizeInspectionTagValue("   "), null, "Blank tag must normalize to null")
  assert.strictEqual(validation.shouldValidateInspectionTagUniqueness("TAG-601"), true, "Duplicate non-blank tag validation must remain")
  assert.strictEqual(review.inspectionTagDisplay(""), "Not Issued", "Certificate/review blank tag display failed")

  assertIncludes(backendServer, "WHERE userid = $1", "Inspector identity must remain server-controlled")
  assertIncludes(backendServer, "role === \"VIEWER\"", "Viewer denial must remain")
  assertIncludes(backendServer, "role === \"CUSTOMER\"", "Customer denial must remain")
  assertIncludes(backendServer, "role === \"MANAGER\"", "Manager permission path must remain")
  assertIncludes(backendServer, "role === \"INSPECTOR\"", "Inspector permission path must remain")
  assertIncludes(backendServer, "routePath === \"/inspections\"", "Inspection create route must remain protected")
  assertIncludes(backendServer, "applyCriticalSafetyRule", "Backend critical safety enforcement must remain")
  assertIncludes(backendServer, "isInspectionTagUniqueError", "Duplicate tag rejection must remain")
  assertIncludes(certificateRenderer, "certificateTagNumberDisplay", "Certificate null tag handling must remain")

  assertIncludes(harnessMigration, "WHERE equiptypeid = 601", "Harness migration audit must identify 601")
  assertIncludes(fallArrestorMigration, "WHERE equiptypeid = 339", "Fall-arrestor migration audit must identify 339")
  assertIncludes(frameworkDocs, "Harness", "Framework docs must mention harness registration")
  assertIncludes(harnessDocs, "601", "Harness docs must list 601")
  assertIncludes(harnessDocs, "339", "Harness docs must list 339")
  assertIncludes(workflowDocs, "Wizard", "Workflow docs must cover wizard fallback")

  console.log("Task 12B harness wizard regression checks passed")
})().catch(err => {
  console.error(err)
  process.exit(1)
})
