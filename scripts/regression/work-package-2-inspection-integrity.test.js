const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "../..")

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8")
}

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), `${message}\nMissing: ${needle}`)
}

function sourceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle)
  assert(start >= 0, `${startNeedle} is missing`)

  const end = source.indexOf(endNeedle, start)
  assert(end > start, `${endNeedle} is missing after ${startNeedle}`)

  return source.slice(start, end)
}

const server = read("backend/server.js")
const integrity = read("backend/services/inspectionIntegrity.js")
const dashboard = read("frontend/src/pages/Dashboard.js")
const customerReport = read("frontend/src/pages/CustomerDetailedReport.js")
const packageJson = JSON.parse(read("package.json"))
const {
  deriveInspectionStatus,
  evaluateCertificateEligibility,
  evaluateInspectionCompleteness
} = require("../../backend/services/inspectionIntegrity")

assertIncludes(
  integrity,
  "function evaluateInspectionCompleteness",
  "Work Package 2 needs one inspection-completeness policy"
)
assertIncludes(
  integrity,
  "function evaluateCertificateEligibility",
  "Work Package 2 needs one certificate-eligibility policy"
)
assertIncludes(
  integrity,
  "Inspection has no result rows.",
  "Certificate eligibility must block inspections without result rows"
)
assertIncludes(
  integrity,
  "No approved criteria are configured for this equipment type and inspection type.",
  "Certificate eligibility must block equipment types without configured criteria"
)
assertIncludes(
  integrity,
  "Stored SAFE status conflicts with failed or critical criteria.",
  "SAFE/UNSAFE policy must detect contradictory failed criteria"
)
assertIncludes(
  integrity,
  "Inspector signature snapshot is missing.",
  "Certificate eligibility must block missing signature snapshots"
)
assertIncludes(
  integrity,
  "Inspector LMI snapshot is missing.",
  "Certificate eligibility must block missing LMI snapshots"
)

const inspectionCreateRoute = sourceBetween(
  server,
  'app.post("/inspections"',
  'app.get("/inspections/:testid/photos"'
)
assertIncludes(
  inspectionCreateRoute,
  "Inspection cannot be saved because this equipment type has no approved criteria configured.",
  "Inspection creation must block type 105 and other active equipment types without criteria"
)
assertIncludes(
  inspectionCreateRoute,
  "Inspection cannot be saved without result rows.",
  "Completed inspection creation must block empty result sets"
)
assertIncludes(
  inspectionCreateRoute,
  "Inspection cannot be saved because the asset customer, site or section hierarchy is incomplete.",
  "Completed inspection creation must block incomplete asset hierarchy"
)
assertIncludes(
  inspectionCreateRoute,
  "applyCriticalSafetyRule(parsedResults, criteriaResult.rows)",
  "Inspection creation must keep the critical failure UNSAFE rule"
)

const certificateRoutes = sourceBetween(
  server,
  'app.get("/inspections/:testid/certificate"',
  'app.post("/admin/email-test"'
)
assertIncludes(
  certificateRoutes,
  "certificateIsEligible(certificate)",
  "Certificate JSON, preview, PDF and email routes must use the shared eligibility decision"
)
assertIncludes(
  certificateRoutes,
  "CERTIFICATE_PDF_BLOCKED",
  "Single certificate PDF route must audit blocked certificates"
)
assertIncludes(
  certificateRoutes,
  "CERTIFICATE_EMAIL_BLOCKED",
  "Certificate email route must audit blocked certificates"
)
assertIncludes(
  certificateRoutes,
  "createSingleCertificatePdfBuffer(certificate",
  "Certificate email must use the shared certificate renderer"
)
assert(
  !certificateRoutes.includes("createCertificatePdfBuffer(certificate)"),
  "Certificate email must not use the legacy in-file PDF renderer"
)

const certificateLoader = sourceBetween(
  server,
  "async function getCertificatesData",
  "async function getCertificateData"
)
assertIncludes(
  certificateLoader,
  "certificate.certificateEligibility = evaluateCertificateEligibility(certificate)",
  "Certificate data loader must attach a shared eligibility decision"
)
assert(
  !certificateLoader.includes("certificate.results.push(...criteriaRows.map"),
  "Certificate loader must not fabricate result rows from criteria"
)

const bulkPdfRoute = sourceBetween(
  server,
  'app.get("/certificates/bulk-pdf"',
  'app.get("/certificates/count"'
)
assertIncludes(
  bulkPdfRoute,
  "blockedCertificates = certificates.filter(certificate => !certificateIsEligible(certificate))",
  "Bulk PDF route must reject blocked certificates"
)

const dashboardStats = sourceBetween(
  server,
  'app.get("/dashboard/stats"',
  'app.get("/dashboard/top-customers"'
)
assertIncludes(
  dashboardStats,
  "incompleteinspections",
  "Dashboard stats must expose incomplete inspections"
)
assertIncludes(
  dashboardStats,
  "equipmenttypeswithoutcriteria",
  "Dashboard stats must expose equipment types without criteria"
)
assertIncludes(
  dashboardStats,
  "certificateintegrityalerts",
  "Dashboard stats must expose certificate metadata integrity alerts"
)
assertIncludes(
  dashboard,
  "Incomplete Inspections",
  "Dashboard UI must display incomplete inspection counts"
)
assertIncludes(
  dashboard,
  "Types Without Criteria",
  "Dashboard UI must display equipment types without criteria"
)

const reportQuery = sourceBetween(
  server,
  "async function getCustomerDetailedReport",
  "function drawCustomerReportPdf"
)
assertIncludes(
  reportQuery,
  "visualintegritystatus",
  "Customer Detailed Report JSON must expose visual inspection integrity"
)
assertIncludes(
  reportQuery,
  "loadcertificateeligible",
  "Customer Detailed Report JSON must expose load-test certificate eligibility"
)
assertIncludes(
  reportQuery,
  "INCOMPLETE INSPECTION",
  "Customer Detailed Report must distinguish incomplete inspections"
)
assertIncludes(
  server,
  "Incomplete Inspection Assets",
  "Customer Detailed Report XLSX summary must include incomplete inspection counts"
)
assertIncludes(
  customerReport,
  "Missing Metadata",
  "Customer Detailed Report page must display missing metadata totals"
)

assert.strictEqual(
  packageJson.scripts["test:work-package-2-integrity"],
  "node scripts/regression/work-package-2-inspection-integrity.test.js"
)

const completeInspection = {
  assetid: 100,
  equiptypeid: 401,
  clientid: 1,
  sitename: "Main Site",
  sectionname: "Workshop",
  testdate: "2026-07-16",
  inspector: "Test Inspector",
  inspector_lmi_number: "LMI123",
  inspector_signature_image: "/uploads/signatures/test.png",
  status: "SAFE",
  inspectiontype: "VISUAL"
}
const criteria = [
  {
    criteriaid: 1,
    criterianame: "General condition",
    severity: "NORMAL",
    inspection_category: "PERIODIC_THOROUGH_INSPECTION"
  },
  {
    criteriaid: 2,
    criterianame: "Safe for continued operation",
    severity: "CRITICAL",
    inspection_category: "PERIODIC_THOROUGH_INSPECTION"
  }
]
const passingResults = [
  { criteriaid: 1, result: "PASS" },
  { criteriaid: 2, result: "YES" }
]

assert.strictEqual(
  evaluateInspectionCompleteness({
    inspection: completeInspection,
    results: passingResults,
    criteria
  }).complete,
  true,
  "Completeness policy must accept the certificate loader's certificate.criteria array"
)
assert.strictEqual(
  evaluateCertificateEligibility({
    inspection: completeInspection,
    results: passingResults,
    criteria: criteria.map(row => ({
      ...row,
      inspectioncategory: "VISUAL",
      inspection_category: "PERIODIC_THOROUGH_INSPECTION"
    }))
  }).eligible,
  true,
  "Certificate eligibility must use inspectioncategory, not the broad criteria category, for VISUAL/LOADTEST matching"
)
assert.strictEqual(
  evaluateCertificateEligibility({
    inspection: { ...completeInspection, inspectiontype: "VISUAL" },
    results: [{ criteriaid: 9, result: "PASS" }],
    criteria: [{
      criteriaid: 9,
      criterianame: "Proof load held",
      inspectioncategory: "LOADTEST",
      inspection_category: "PERIODIC_THOROUGH_INSPECTION"
    }]
  }).eligible,
  false,
  "Visual certificate eligibility must ignore load-test criteria even when inspection_category is periodic"
)
assert.strictEqual(
  evaluateCertificateEligibility({
    inspection: completeInspection,
    results: [],
    criteria
  }).eligible,
  false,
  "Certificate eligibility must reject inspections without result rows"
)
assert.strictEqual(
  deriveInspectionStatus(
    [{ criteriaid: 2, result: "NO" }],
    criteria,
    "SAFE"
  ),
  "NOT SAFE",
  "Critical safe-service failure must force NOT SAFE"
)
assert(
  evaluateCertificateEligibility({
    inspection: completeInspection,
    results: [{ criteriaid: 1, result: "PASS" }, { criteriaid: 2, result: "NO" }],
    criteria
  }).reasons.includes("Stored SAFE status conflicts with failed or critical criteria."),
  "SAFE inspections with failed critical criteria must be blocked"
)

console.log("Work Package 2 inspection integrity regression checks passed.")
