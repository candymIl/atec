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
  const criteria = await import(fileUrl("frontend/src/inspectionWizard/wizardCriteria.js"))
  const validation = await import(fileUrl("frontend/src/inspectionWizard/wizardValidation.js"))
  const navigation = await import(fileUrl("frontend/src/inspectionWizard/WizardNavigation.js"))
  const progress = await import(fileUrl("frontend/src/inspectionWizard/WizardProgress.js"))
  const review = await import(fileUrl("frontend/src/inspectionWizard/WizardReview.js"))
  const state = await import(fileUrl("frontend/src/inspectionWizard/wizardState.js"))
  const engine = await import(fileUrl("frontend/src/inspectionWizard/InspectionWizard.js"))

  const frontendMain = read("frontend/src/main.js")
  const backendServer = read("backend/server.js")
  const certificateRenderer = read("backend/services/certificateRenderer.js")
  const assetSetup = read("frontend/src/pages/AssetSetup.js")
  const inspections = read("frontend/src/pages/Inspections.js")

  const craneAsset = { equiptypeid: "401", equipgroupid: "400", equipmenttype: "Crane - A-Frame" }
  const unknownCraneGroupAsset = { equiptypeid: "499", equipgroupid: "400", equipmenttype: "Future Crane" }
  const chainAsset = { equiptypeid: "101", equipgroupid: "100", equipmenttype: "Manual Chain Hoist" }
  const slingAsset = { equiptypeid: "900", equipgroupid: "900", equipmenttype: "Sling" }
  const loadTestCriteria = [
    { criteriaid: 1, equiptypeid: "499", inspectioncategory: "LOADTEST", criterianame: "Proof Load", active: true },
    { criteriaid: 2, equiptypeid: "401", inspectioncategory: "LOADTEST", criterianame: "Deflection", active: true },
    { criteriaid: 3, equiptypeid: "101", inspectioncategory: "VISUAL", criterianame: "Load Chain", active: true }
  ]

  assert.strictEqual(registry.getInspectionWizardKey(craneAsset, [], "VISUAL"), "CRANE", "Explicit crane type must resolve")
  assert.strictEqual(registry.getInspectionWizardKey(unknownCraneGroupAsset, [], "VISUAL"), "GENERIC", "Unknown crane group type without criteria must stay generic")
  assert.strictEqual(registry.getInspectionWizardKey(unknownCraneGroupAsset, loadTestCriteria, "LOADTEST"), "CRANE", "Unknown crane group type with matching criteria can resolve")
  assert.strictEqual(registry.getInspectionWizardKey(chainAsset, loadTestCriteria, "VISUAL"), "CHAIN_BLOCK_LEVER_HOIST", "Chain block must still resolve")
  assert.strictEqual(registry.getInspectionWizardKey(slingAsset, loadTestCriteria, "VISUAL"), "GENERIC", "Unsupported family must fall back to generic")

  const wizardContext = engine.createInspectionWizardContext({
    asset: craneAsset,
    criteria: loadTestCriteria.filter(row => String(row.equiptypeid) === "401"),
    inspectiontype: "LOADTEST"
  })
  assert.strictEqual(wizardContext.config.id, "CRANE", "Engine context must resolve crane config")
  assert(wizardContext.groupedCriteria.length > 0, "Engine context must group criteria")

  assert.strictEqual(criteria.criteriaInspectionType({ inspectioncategory: "LOADTEST", inspection_category: "PERIODIC" }), "LOADTEST", "inspectioncategory controls visual/load-test applicability")
  assert.strictEqual(validation.normalizeInspectionTagValue("   "), null, "Whitespace tag must normalize to null")
  assert.strictEqual(validation.normalizeInspectionTagValue(" TAG-1 "), "TAG-1", "Supplied tag must trim")
  assert.strictEqual(validation.shouldValidateInspectionTagUniqueness(""), false, "Blank tag must skip duplicate lookup")
  assert.strictEqual(validation.shouldValidateInspectionTagUniqueness("TAG-1"), true, "Non-blank tag must preserve duplicate validation")
  assert.strictEqual(validation.isNumericInputValid("12.5"), true, "Numeric validation must accept numbers")
  assert.strictEqual(validation.isNumericInputValid("abc"), false, "Numeric validation must reject text")
  assert.strictEqual(validation.failedResultNeedsComment("FAIL"), true, "Failed result must need comment")

  assert.strictEqual(navigation.nextWizardStep(0, 3), 1, "Navigation next failed")
  assert.strictEqual(navigation.previousWizardStep(0), 0, "Navigation back must not underflow")
  assert.strictEqual(navigation.isWizardReviewStep(2, 3), true, "Review step detection failed")
  assert.strictEqual(progress.wizardProgressLabel(1, 4), "Step 2 of 4", "Progress label failed")
  assert.deepStrictEqual(progress.wizardProgressValue(1, 4), { value: 2, max: 4 }, "Progress value failed")
  assert.strictEqual(review.inspectionTagDisplay(""), "Not Issued", "Blank certificate tag display failed")
  assert.strictEqual(review.finalStatusFromFailures([], []), "SAFE", "Review safe status failed")
  assert.strictEqual(review.finalStatusFromFailures([{}], []), "NOT SAFE", "Review failure status failed")

  const wizardState = state.createWizardState()
  assert.strictEqual(state.beginWizardSubmit(wizardState), true, "First submit must be allowed")
  assert.strictEqual(state.beginWizardSubmit(wizardState), false, "Double submit must be blocked")
  state.endWizardSubmit(wizardState)
  assert.strictEqual(state.beginWizardSubmit(wizardState), true, "Submit must unlock after ending")
  state.markWizardDirty(wizardState)
  assert.strictEqual(wizardState.dirty, true, "Unsaved-change dirty state must be tracked")

  assertIncludes(frontendMain, "Use Generic Form", "Wizard generic fallback must remain available")
  assertIncludes(frontendMain, "updateInspectionSafetyWarning", "Critical safety presentation must remain wired")
  assertIncludes(frontendMain, "window.inspectionSaveInProgress", "Double-submit prevention must remain wired")
  assertIncludes(frontendMain, "savedInspection.referenceId", "API errors must preserve reference IDs")
  assertIncludes(assetSetup, "assetSupportsCraneWizard", "Asset setup must use registry helper")
  assertIncludes(inspections, "assetSupportsCraneWizard", "Inspection page must use registry helper")

  assertIncludes(backendServer, "WHERE userid = $1", "Inspector identity must remain server-controlled")
  assertIncludes(backendServer, "role === \"INSPECTOR\"", "Inspector access must remain server-side")
  assertIncludes(backendServer, "role === \"VIEWER\"", "Viewer denial must remain server-side")
  assertIncludes(backendServer, "role === \"CUSTOMER\"", "Customer denial must remain server-side")
  assertIncludes(backendServer, "routePath === \"/inspections\"", "Inspection create route must remain protected server-side")
  assertIncludes(backendServer, "applyCriticalSafetyRule", "Backend critical safety authority must remain")
  assertIncludes(backendServer, "tagnumber.trim()", "Backend must trim supplied tags")
  assertIncludes(backendServer, ": null", "Backend must save blank tags as null")
  assertIncludes(backendServer, "isInspectionTagUniqueError", "Duplicate non-blank tags must remain rejected")
  assertIncludes(certificateRenderer, "certificateTagNumberDisplay", "Certificate renderer must handle null tags")

  console.log("Task 12 wizard framework regression checks passed")
})().catch(err => {
  console.error(err)
  process.exit(1)
})
