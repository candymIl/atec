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
  const slingModule = await import(fileUrl("frontend/src/inspectionWizard/configurations/slingWizardConfig.js"))

  const slingConfig = slingModule.slingWizardConfig
  const frontendMain = read("frontend/src/main.js")
  const assetSetup = read("frontend/src/pages/AssetSetup.js")
  const inspections = read("frontend/src/pages/Inspections.js")
  const backendServer = read("backend/server.js")
  const certificateRenderer = read("backend/services/certificateRenderer.js")
  const slingMigration = read("database/2026-06-24-steel-wire-rope-sling-visual-passfail.sql")
  const slingDocs = read("docs/sling-inspection-wizard.md")
  const frameworkDocs = read("docs/inspection-wizard-framework.md")
  const workflowDocs = read("docs/inspection-workflow.md")

  const slingAsset = { equiptypeid: "201", equipgroupid: "200", equipmenttype: "Steel Wire Rope Sling" }
  const unsupportedSlingName = { equiptypeid: "900", equipgroupid: "200", equipmenttype: "Future Sling" }
  const slingCriteria = [
    { criteriaid: 1, equiptypeid: "201", inspectioncategory: "VISUAL", criterianame: "Wire rope free from birdcaging", severity: "CRITICAL", active: true },
    { criteriaid: 2, equiptypeid: "201", inspectioncategory: "VISUAL", criterianame: "Hook and latch are safe", severity: "CRITICAL", active: true },
    { criteriaid: 3, equiptypeid: "201", inspectioncategory: "VISUAL", criterianame: "Ferrule or splice secure", severity: "CRITICAL", active: true },
    { criteriaid: 4, equiptypeid: "201", inspectioncategory: "VISUAL", criterianame: "Rope diameter", fieldtype: "NUMBER", resulttype: "MEASURED", active: true },
    { criteriaid: 5, equiptypeid: "201", inspectioncategory: "LOADTEST", criterianame: "Applied load held", severity: "CRITICAL", active: true }
  ]

  assert.strictEqual(slingConfig.id, "SLING", "Sling wizard ID changed")
  assert(slingConfig.supportedEquipmentTypes.includes("201"), "Confirmed sling type 201 must be supported")
  assert(!slingConfig.supportedEquipmentTypes.includes("202"), "Unconfirmed type 202 must not be enabled")
  assert(!slingConfig.supportedEquipmentTypes.includes("203"), "Unconfirmed type 203 must not be enabled")
  assert.strictEqual(slingConfig.requireCriteriaForExplicitType, true, "Sling wizard must require criteria")

  assert.strictEqual(registry.getInspectionWizardKey(slingAsset, [], "VISUAL"), "GENERIC", "Sling without criteria must fall back")
  assert.strictEqual(registry.getInspectionWizardKey(slingAsset, slingCriteria, "VISUAL"), "SLING", "Sling with criteria must resolve")
  assert.strictEqual(registry.getInspectionWizardKey(unsupportedSlingName, slingCriteria, "VISUAL"), "GENERIC", "Related-sounding unsupported sling must remain generic")
  assert.strictEqual(registry.getInspectionWizardKey(slingAsset, slingCriteria, "LOADTEST"), "SLING", "Sling load test must resolve only with load-test criteria")

  assert.strictEqual(slingConfig.getCriteriaSection(slingCriteria[0]), "Wire Rope Condition", "Wire-rope grouping failed")
  assert.strictEqual(slingConfig.getCriteriaSection(slingCriteria[1]), "End Fittings and Connectors", "Hook/fitting grouping failed")
  assert.strictEqual(slingConfig.getCriteriaSection(slingCriteria[2]), "End Fittings and Connectors", "Ferrule/splice grouping failed")
  assert.strictEqual(slingConfig.getCriteriaSection(slingCriteria[3]), "Measurements", "Measurement grouping failed")
  assert.strictEqual(slingConfig.getCriteriaSection(slingCriteria[4], "LOADTEST"), "Rated Capacity and Test Load", "Load-test grouping failed")

  assertIncludes(frontendMain, "function renderSlingWizard(", "Sling wizard renderer must exist")
  assertIncludes(JSON.stringify(slingConfig), "slingCleanAvailable", "Sling clean/available setup field is missing")
  assertIncludes(JSON.stringify(slingConfig), "slingIdentificationLegible", "Sling identification setup field is missing")
  assertIncludes(JSON.stringify(slingConfig), "slingHistoryAvailable", "Sling history setup field is missing")
  assertIncludes(JSON.stringify(slingConfig), "slingKnownOverload", "Sling overload/shock-load capture is missing")
  assertIncludes(frontendMain, "Complete the sling inspection setup questions", "Required sling setup validation is missing")
  assertIncludes(frontendMain, "Enter a valid numeric measurement.", "Numeric validation must remain")
  assertIncludes(frontendMain, "Enter a reason/comment for every failed", "Failed criterion comment validation must remain")
  assertIncludes(frontendMain, "getSlingSetupReviewRows", "Sling review generation is missing")
  assertIncludes(frontendMain, "inspectionWizardKey === \"SLING\"", "Sling route selection is missing")
  assertIncludes(frontendMain, "updateInspectionSafetyWarning", "Critical safety UI hook must remain")
  assertIncludes(frontendMain, "window.inspectionSaveInProgress", "Double-submit protection must remain")

  assertIncludes(assetSetup, "assetSupportsInspectionWizard", "Asset setup must expose sling through registry")
  assertIncludes(inspections, "assetSupportsInspectionWizard", "Inspection page must expose sling through registry")

  assert.strictEqual(validation.normalizeInspectionTagValue("   "), null, "Optional blank tag must normalize to null")
  assert.strictEqual(validation.shouldValidateInspectionTagUniqueness("SLING-1"), true, "Duplicate non-blank tag validation must remain")
  assert.strictEqual(review.inspectionTagDisplay(""), "Not Issued", "Blank tag display failed")

  assertIncludes(backendServer, "WHERE userid = $1", "Logged-in inspector identity must remain")
  assertIncludes(backendServer, "role === \"VIEWER\"", "Viewer denial must remain")
  assertIncludes(backendServer, "role === \"CUSTOMER\"", "Customer denial must remain")
  assertIncludes(backendServer, "role === \"MANAGER\"", "Manager access path must remain")
  assertIncludes(backendServer, "role === \"INSPECTOR\"", "Inspector access path must remain")
  assertIncludes(backendServer, "applyCriticalSafetyRule", "Backend critical safety enforcement must remain")
  assertIncludes(backendServer, "isInspectionTagUniqueError", "Duplicate tag rejection must remain")
  assertIncludes(certificateRenderer, "certificateTagNumberDisplay", "Certificate optional tag handling must remain")

  assertIncludes(slingMigration, "WHERE equiptypeid = 201", "Sling migration audit must identify 201")
  assertIncludes(slingMigration, "inspectioncategory = 'VISUAL'", "Sling migration must be visual-only")
  assertIncludes(slingDocs, "201", "Sling docs must list 201")
  assertIncludes(frameworkDocs, "Sling", "Framework docs must mention Sling registration")
  assertIncludes(workflowDocs, "Sling", "Workflow docs must list Sling")

  console.log("Task 12C sling wizard regression checks passed")
})().catch(err => {
  console.error(err)
  process.exit(1)
})
