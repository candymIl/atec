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
const backendServer = read("backend/server.js")
const craneDocs = read("docs/crane-inspection-wizard.md")
const craneCriteriaMigration = read("database/2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql")

for (const id of ["401", "402", "404", "406"]) {
  assertIncludes(frontendMain, `"${id}"`, `Crane wizard must detect equipment type ${id}`)
  assertIncludes(assetSetup, `'${id}'`, `Asset setup must expose crane wizard for ${id}`)
  assertIncludes(inspections, `'${id}'`, `Inspection list must expose crane wizard for ${id}`)
  assertIncludes(craneDocs, `| ${id} |`, `Docs must list supported equipment type ${id}`)
}

assertIncludes(frontendMain, "function renderCraneWizard(", "Crane wizard renderer is missing")
assertIncludes(frontendMain, "function getCraneWizardSection(", "Dynamic crane criteria grouping is missing")
assertIncludes(frontendMain, "startInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}', 'generic')", "Generic fallback action is missing")
assertIncludes(frontendMain, "validateCraneWizardStep", "Step validation is missing")
assertIncludes(frontendMain, "window.inspectionSaveInProgress", "Double-submit protection is missing")
assertIncludes(frontendMain, "Number.isFinite(Number(measuredValue))", "Numeric measurement validation is missing")
assertIncludes(frontendMain, "craneIntendedTestLoad", "Manual intended test-load capture is missing")
assertIncludes(frontendMain, "craneActualTestLoad", "Actual applied load capture is missing")
assertIncludes(frontendMain, "craneInspectorDeclaration", "Inspector declaration is missing")
assertIncludes(frontendMain, "craneSubmitConfirmed", "Review confirmation is missing")
assertIncludes(frontendMain, "inspectionPhotos", "Inspection photo reuse is missing")

assertIncludes(assetSetup, "Generic Inspect", "Asset setup generic visual fallback is missing")
assertIncludes(assetSetup, "Generic Load Test", "Asset setup generic load-test fallback is missing")
assertIncludes(inspections, "Generic Inspection", "Inspection page generic visual fallback is missing")
assertIncludes(inspections, "Generic Load Test", "Inspection page generic load-test fallback is missing")

assertIncludes(backendServer, "function applyCriticalSafetyRule", "Backend critical safety rule is missing")
assertIncludes(backendServer, "WHERE userid = $1", "Backend must use logged-in inspector identity")
assertIncludes(backendServer, "inspector_signature_image", "Signature capture must remain backend-driven")
assertIncludes(backendServer, "BEGIN", "Inspection save must remain transactional")
assertIncludes(backendServer, "COMMIT", "Inspection save must commit transactionally")
assertIncludes(backendServer, "ROLLBACK", "Inspection save must roll back on error")
assertIncludes(backendServer, "lastinspectionvaliddate", "Quick details must expose previous certificate expiry")
assertIncludes(backendServer, "et.equipgroupid", "Single asset lookups must expose equipment group for wizard/photo decisions")

assertIncludes(craneCriteriaMigration, "target_equipment_types(equiptypeid)", "Crane criteria migration target type audit is missing")
assertIncludes(craneCriteriaMigration, "'CRITICAL'", "Crane critical criteria configuration is missing")
assertIncludes(craneCriteriaMigration, "tblinspectionphoto", "Inspection photo configuration is missing")

console.log("Task 12A crane wizard regression checks passed")
