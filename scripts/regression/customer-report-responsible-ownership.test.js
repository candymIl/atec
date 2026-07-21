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

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`)
  assert(start >= 0, `${name} is missing`)

  const bodyStart = source.indexOf("{", start)
  assert(bodyStart >= 0, `${name} body is missing`)

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === "{") depth += 1
    if (char === "}") depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }

  throw new Error(`${name} body was not closed`)
}

function sourceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle)
  assert(start >= 0, `${startNeedle} is missing`)

  const end = source.indexOf(endNeedle, start)
  assert(end > start, `${endNeedle} is missing after ${startNeedle}`)

  return source.slice(start, end)
}

const server = read("backend/server.js")
const customerReportPage = read("frontend/src/pages/CustomerDetailedReport.js")
const ownershipRepairMigration = read(
  "database/2026-07-16-assign-deterministic-missing-section-responsible-persons.sql"
)
const ownershipRepairRollback = read(
  "database/2026-07-16-rollback-assign-deterministic-missing-section-responsible-persons.sql"
)
const packageJson = JSON.parse(read("package.json"))

const reportBody = sourceBetween(
  server,
  "async function getCustomerDetailedReport",
  "function drawCustomerReportPdf"
)
const scopeBody = functionBody(server, "customerScopedReportFilters")

assertIncludes(
  reportBody,
  "LEFT JOIN atec.tblsection customer_section",
  "Responsible-person report customer filters must derive ownership through sections"
)
assertIncludes(
  reportBody,
  "AND customer_section.responsibleid = $",
  "Responsible-person report customer filters must use section.responsibleid"
)
assertIncludes(
  reportBody,
  "assetWhere += ` AND sec.responsibleid = $",
  "Responsible-person report asset filters must use section.responsibleid"
)
assertIncludes(
  reportBody,
  "COUNT(DISTINCT section_person.personid) AS responsiblecount",
  "Responsible-person report counts must avoid duplicate counts when one person owns several sections"
)
assertIncludes(
  reportBody,
  "LEFT JOIN atec.tblpeople section_person\n      ON sec.responsibleid = section_person.personid",
  "Responsible-person report rows must display the section-derived person"
)
assertIncludes(
  reportBody,
  "section_person.name AS responsiblename",
  "Responsible-person report output must expose section-derived names to JSON, PDF and XLSX"
)

assert(
  !reportBody.includes("a.responsibleid"),
  "Customer Detailed Report must not use stale tblasset.responsibleid"
)
assert(
  !reportBody.includes("customer_asset.responsibleid"),
  "Customer Detailed Report customer filters must not use stale tblasset.responsibleid"
)
assert(
  !reportBody.includes("ON a.responsibleid ="),
  "Customer Detailed Report must not join people directly from assets"
)

assertIncludes(
  scopeBody,
  'req.user.role === "CUSTOMER" && req.user.clientid',
  "Customer Detailed Report must enforce backend customer scoping for customer users"
)
assertIncludes(
  scopeBody,
  'req.user.role === "CUSTOMER" && !req.user.clientid',
  "Customer users without an assigned customer must receive an empty report scope"
)
assertIncludes(
  server,
  'app.get("/reports/customer-detailed", searchLimiter',
  "Customer Detailed Report JSON route is missing"
)
assertIncludes(
  server,
  'app.get("/reports/customer-detailed.pdf", pdfLimiter',
  "Customer Detailed Report PDF route is missing"
)
assertIncludes(
  server,
  'app.get("/reports/customer-detailed.xlsx", exportLimiter',
  "Customer Detailed Report XLSX route is missing"
)
assertIncludes(
  server,
  "const report = await getCustomerDetailedReport(customerScopedReportFilters(req))",
  "Customer Detailed Report exports must use the shared report query and scope helper"
)

assertIncludes(
  customerReportPage,
  "seenResponsiblePersonIds",
  "Customer Detailed Report dropdown should defensively de-duplicate multi-section responsible people"
)
assertIncludes(
  customerReportPage,
  'params.append("responsibleid", responsibleid)',
  "Customer Detailed Report must keep a stable person ID filter value"
)

assert.strictEqual(
  packageJson.scripts["test:customer-report-responsible"],
  "node scripts/regression/customer-report-responsible-ownership.test.js"
)

assertIncludes(
  ownershipRepairMigration,
  "expected_section_count constant integer := 309",
  "Milestone 1C migration must fail safely if the deterministic candidate count changes"
)
assertIncludes(
  ownershipRepairMigration,
  "sf.active_distinct_legacy_count = 1",
  "Milestone 1C migration must only assign sections with exactly one legacy responsible person candidate"
)
assertIncludes(
  ownershipRepairMigration,
  "sec.responsibleid IS NULL",
  "Milestone 1C migration must not overwrite existing section responsible persons"
)
assertIncludes(
  ownershipRepairMigration,
  "COALESCE(p.archived, false) = false",
  "Milestone 1C migration must not assign archived responsible people"
)
assertIncludes(
  ownershipRepairMigration,
  "a.clientid IS DISTINCT FROM sec.clientid",
  "Milestone 1C migration must exclude hierarchy-conflicted assets"
)
assertIncludes(
  ownershipRepairMigration,
  "atec.responsible_person_ownership_repair_audit",
  "Milestone 1C migration must persist section-level rollback evidence"
)
assert(
  !ownershipRepairMigration.includes("UPDATE atec.tblasset"),
  "Milestone 1C migration must not update stale asset-level responsible persons"
)
assertIncludes(
  ownershipRepairRollback,
  "sec.responsibleid IS DISTINCT FROM audit.assigned_responsibleid",
  "Milestone 1C rollback must refuse to overwrite later ownership changes"
)
assertIncludes(
  ownershipRepairRollback,
  "SET responsibleid = audit.previous_responsibleid",
  "Milestone 1C rollback must restore only audited previous section ownership values"
)

console.log("Customer report responsible ownership regression checks passed.")
