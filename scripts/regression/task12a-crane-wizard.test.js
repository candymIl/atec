const fs = require("fs")
const path = require("path")
const assert = require("assert")

const root = path.resolve(__dirname, "..", "..")

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8")
}

function assertIncludes(file, text, message) {
  assert(file.includes(text), message || `Expected source to include ${text}`)
}

const frontendMain = read("frontend/src/main.js")
const assetSetup = read("frontend/src/pages/AssetSetup.js")
const inspections = read("frontend/src/pages/Inspections.js")
const wizardRegistry = read("frontend/src/inspectionWizard/wizardRegistry.js")
const craneWizardConfig = read("frontend/src/inspectionWizard/configurations/craneWizardConfig.js")
const wizardReview = read("frontend/src/inspectionWizard/WizardReview.js")
const backendServer = read("backend/server.js")
const craneDocs = read("docs/crane-inspection-wizard.md")
const craneCriteriaMigration = read("database/2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql")
const optionalTagMigration = read("database/2026-07-15-task12a-optional-inspection-tag.sql")

for (const id of ["401", "402", "404", "406"]) {
  assertIncludes(craneWizardConfig, `"${id}"`, `Crane wizard must detect equipment type ${id}`)
  assertIncludes(craneDocs, `| ${id} |`, `Docs must list supported equipment type ${id}`)
}
assertIncludes(assetSetup, "assetSupportsCraneWizard", "Asset setup must expose crane wizard through the registry")
assertIncludes(inspections, "assetSupportsCraneWizard", "Inspection list must expose crane wizard through the registry")

assertIncludes(frontendMain, "function renderCraneWizard(", "Crane wizard renderer is missing")
assertIncludes(craneWizardConfig, "getCriteriaSection", "Dynamic crane criteria grouping is missing")
assertIncludes(wizardRegistry, "resolveInspectionWizard", "Wizard registry resolver is missing")
assertIncludes(frontendMain, "startInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}', 'generic')", "Generic fallback action is missing")
assertIncludes(frontendMain, "validateCraneWizardStep", "Step validation is missing")
assertIncludes(frontendMain, "window.inspectionSaveInProgress", "Double-submit protection is missing")
assertIncludes(frontendMain, "Number.isFinite(Number(measuredValue))", "Numeric measurement validation is missing")
assertIncludes(frontendMain, "craneIntendedTestLoad", "Manual intended test-load capture is missing")
assertIncludes(frontendMain, "craneActualTestLoad", "Actual applied load capture is missing")
assertIncludes(frontendMain, "craneInspectorDeclaration", "Inspector declaration is missing")
assertIncludes(frontendMain, "craneSubmitConfirmed", "Review confirmation is missing")
assertIncludes(frontendMain, "inspectionPhotos", "Inspection photo reuse is missing")
assertIncludes(frontendMain, "Inspection Tag No <span class=\"optional-label\">(Optional)</span>", "Crane wizard tag number must be labelled optional")
assert(!frontendMain.includes("Enter the inspection tag number before continuing."), "Crane wizard must not require inspection tag number")
assertIncludes(wizardReview, "Not Issued", "Crane wizard review must display a blank tag as Not Issued")
assertIncludes(frontendMain, "savedInspection.referenceId", "Inspection save errors must show server reference IDs")

assertIncludes(frontendMain, "Use Generic Form", "Crane wizard must keep the internal generic form fallback")
assert(!assetSetup.includes("Generic Inspect"), "Asset setup must not show a separate generic visual button for crane wizard assets")
assert(!assetSetup.includes("Generic Load Test"), "Asset setup must not show a separate generic load-test button for crane wizard assets")
assert(!inspections.includes("Generic Inspection"), "Inspection page must not show a separate generic visual button for crane wizard assets")
assert(!inspections.includes("Generic Load Test"), "Inspection page must not show a separate generic load-test button for crane wizard assets")

assertIncludes(backendServer, "function applyCriticalSafetyRule", "Backend critical safety rule is missing")
assertIncludes(backendServer, "WHERE userid = $1", "Backend must use logged-in inspector identity")
assertIncludes(backendServer, "inspector_signature_image", "Signature capture must remain backend-driven")
assertIncludes(backendServer, "BEGIN", "Inspection save must remain transactional")
assertIncludes(backendServer, "COMMIT", "Inspection save must commit transactionally")
assertIncludes(backendServer, "ROLLBACK", "Inspection save must roll back on error")
assertIncludes(backendServer, "lastinspectionvaliddate", "Quick details must expose previous certificate expiry")
assertIncludes(backendServer, "et.equipgroupid", "Single asset lookups must expose equipment group for wizard/photo decisions")
assertIncludes(backendServer, "tagnumber.trim()", "Backend must preserve supplied inspection tag values")
assertIncludes(backendServer, ": null", "Backend must continue saving blank inspection tags as null")
assertIncludes(backendServer, "certificateTagNumberDisplay", "Certificates must render blank inspection tags explicitly")
assertIncludes(backendServer, "isInspectionTagNotNullError", "Backend must report unapplied optional-tag migration clearly")
assertIncludes(backendServer, "isInspectionTagUniqueError", "Backend must preserve duplicate inspection-tag validation")
assertIncludes(backendServer, "logSafeError(\"Inspection save\"", "Inspection save errors must be traceable in server logs")
assertIncludes(backendServer, "certificate.results.every(row => isCertificateSafeServiceRow(row))", "Load-test certificates must fall back to equipment criteria when only the safe-service row was saved")
assertIncludes(backendServer, "category === \"LOADTEST\"", "Load-test certificate fallback must use load-test criteria")
assertIncludes(read("backend/services/certificateRenderer.js"), "certificateTagNumberDisplay", "Rendered certificate service must render blank inspection tags explicitly")
assertIncludes(optionalTagMigration, "ALTER COLUMN tagnumber DROP NOT NULL", "Optional tag migration must make inspection tag nullable")
assertIncludes(optionalTagMigration, "Read-only audit", "Optional tag migration must document its audit query")

assertIncludes(craneCriteriaMigration, "target_equipment_types(equiptypeid)", "Crane criteria migration target type audit is missing")
assertIncludes(craneCriteriaMigration, "'CRITICAL'", "Crane critical criteria configuration is missing")
assertIncludes(craneCriteriaMigration, "tblinspectionphoto", "Inspection photo configuration is missing")

console.log("Task 12A crane wizard regression checks passed")
