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

assertIncludes(server, "function getActiveResponsibleSection", "Server-side active section validator is missing")
assertIncludes(server, "JOIN atec.tblsites s", "Responsible person validation must derive site from section")
assertIncludes(server, "JOIN atec.tblclients c", "Responsible person validation must derive customer from section")
assertIncludes(server, "COALESCE(sec.archived, false) = false", "Archived sections must be rejected")
assertIncludes(server, "COALESCE(s.archived, false) = false", "Archived sites must be rejected")
assertIncludes(server, "COALESCE(c.archived, false) = false", "Archived customers must be rejected")
assertIncludes(server, "const { sectionid, name } = req.body", "Create must accept section and name only")
assertIncludes(server, "const { name, sectionid, previoussectionid } = req.body", "Update must accept section and name only")
assertIncludes(server, "[section.clientid, normalizedPersonName]", "Duplicate checks must use section-derived customer")
assertIncludes(server, "[section.clientid, id, normalizedPersonName]", "Update duplicate checks must use section-derived customer")
assertIncludes(server, "UPDATE atec.tblsection\n      SET responsibleid = $1", "Section relationship must be persisted through tblsection")
assertIncludes(server, "SET responsibleid = NULL", "Moving a person row must clear the previous section assignment")
assertIncludes(server, "crossCustomerLinks", "Cross-customer shared people must be guarded before updating")
assertIncludes(server, "linked to active sections for another customer", "Ambiguous shared people must be reported")
assertIncludes(server, "COALESCE(sec.clientid, p.clientid) AS clientid", "List response must derive customer from section when present")
assertIncludes(server, "sec.siteid", "List response must include derived site ID")
assertIncludes(server, "sec.sectionid", "List response must include section ID")
assertIncludes(server, "sec.sectionname", "List response must include section name")
assert(!/const \{ clientid, name \} = req\.body/.test(server), "Responsible-person create/update must not accept clientid as ownership input")

assertIncludes(responsiblePage, "Customer", "Responsible person table must show customer")
assertIncludes(responsiblePage, "Site", "Responsible person table must show site")
assertIncludes(responsiblePage, "Section", "Responsible person table must show section")
assertIncludes(responsiblePage, "Responsible Person", "Responsible person table must label the person column clearly")
assertIncludes(responsiblePage, "person.sitename", "Responsible person table must render site names")
assertIncludes(responsiblePage, "person.sectionname", "Responsible person table must render section names")

assertIncludes(main, "function updateResponsibleSiteOptions", "Responsible form site cascade is missing")
assertIncludes(main, "function updateResponsibleSectionOptions", "Responsible form section cascade is missing")
assertIncludes(main, "window.filterResponsibleSites", "Changing customer must refresh sites")
assertIncludes(main, "window.filterResponsibleSections", "Changing site must refresh sections")
assertIncludes(main, "document.querySelector('#responsibleSection').value", "Responsible form must submit section")
assertIncludes(main, "body: JSON.stringify({\n        sectionid,", "Create must submit section ID")
assertIncludes(main, "previoussectionid: person.sectionid || null", "Edit must carry the previous section assignment")
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
