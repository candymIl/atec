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

const server = read("backend/server.js")
const main = read("frontend/src/main.js")
const responsiblePage = read("frontend/src/pages/ResponsiblePersons.js")
const customerReport = read("frontend/src/pages/CustomerDetailedReport.js")
const diagnostics = read("database/2026-07-16-responsible-person-section-ownership-diagnostics.sql")
const packageJson = JSON.parse(read("package.json"))

assertIncludes(server, "const { clientid, name } = req.body", "Create must accept customer and name")
assertIncludes(server, "const { name, clientid } = req.body", "Update must accept customer and name")
assertIncludes(server, "[clientid, normalizedPersonName]", "Create duplicate checks must be customer-scoped")
assertIncludes(server, "[clientid, id, normalizedPersonName]", "Update duplicate checks must be customer-scoped")
assertIncludes(server, "crossCustomerLinks", "Cross-customer shared people must be guarded before updating")
assertIncludes(server, "linked to active sections for another customer", "Ambiguous shared people must be reported")
assertIncludes(server, "STRING_AGG(DISTINCT s.sitename", "List response must aggregate linked site names")
assertIncludes(server, "STRING_AGG(DISTINCT sec.sectionname", "List response must aggregate linked section names")
assertIncludes(server, "GROUP BY p.personid, p.clientid", "List response must return one row per person")

assertIncludes(responsiblePage, "Customer", "Responsible person table must show customer")
assertIncludes(responsiblePage, "Site", "Responsible person table must show site")
assertIncludes(responsiblePage, "Section", "Responsible person table must show section")
assertIncludes(responsiblePage, "Responsible Person", "Responsible person table must label the person column clearly")
assertIncludes(responsiblePage, "person.sitename", "Responsible person table must render site names")
assertIncludes(responsiblePage, "person.sectionname", "Responsible person table must render section names")

assertIncludes(main, "document.querySelector('#responsibleClient').value", "Responsible form must submit customer")
assertIncludes(main, "body: JSON.stringify({\n        clientid,", "Create and update must submit customer ID")
assertIncludes(main, "(person.sitename || '').toLowerCase().includes(search)", "Search must include site names")
assertIncludes(main, "(person.sectionname || '').toLowerCase().includes(search)", "Search must include section names")
assertIncludes(main, "uniqueResponsiblePeopleForClient", "Other responsible-person consumers must de-duplicate multi-section people")
assertIncludes(customerReport, "seenResponsiblePersonIds", "Customer report responsible filter must de-duplicate multi-section people")

assertIncludes(diagnostics, "READ ONLY", "Diagnostics must be read-only")
assertIncludes(diagnostics, "People with no section relationship", "Missing section diagnostic is absent")
assertIncludes(diagnostics, "Responsible people shared across several sections", "Shared section diagnostic is absent")
assertIncludes(diagnostics, "Person stored customer disagrees with section customer", "Customer mismatch diagnostic is absent")
assertIncludes(diagnostics, "Section site/customer disagreements", "Site/customer mismatch diagnostic is absent")
assertIncludes(diagnostics, "Assets whose stored responsible person disagrees with their section responsible person", "Asset mismatch diagnostic is absent")
assertIncludes(diagnostics, "Duplicate active people by customer and normalized name", "Duplicate people diagnostic is absent")
assertIncludes(diagnostics, "Backfill strategy", "Backfill guidance is absent")
assert(!/UPDATE\s+atec\.|DELETE\s+FROM\s+atec\.|INSERT\s+INTO\s+atec\./i.test(diagnostics), "Diagnostics must not mutate data")

assert.strictEqual(
  packageJson.scripts["test:responsible-ownership"],
  "node scripts/regression/responsible-person-ownership.test.js"
)

console.log("Responsible person ownership regression checks passed.")
