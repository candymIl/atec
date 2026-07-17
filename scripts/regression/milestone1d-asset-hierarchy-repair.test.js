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

const migration = read("database/2026-07-16-repair-deterministic-asset-hierarchy-inconsistencies.sql")
const rollback = read("database/2026-07-16-rollback-repair-deterministic-asset-hierarchy-inconsistencies.sql")
const diagnostics = read("database/2026-07-16-asset-hierarchy-repair-diagnostics.sql")
const customerReportRegression = read("scripts/regression/customer-report-responsible-ownership.test.js")
const task14Regression = read("scripts/regression/task14-onsite-visit-coverage.test.js")
const packageJson = JSON.parse(read("package.json"))

assertIncludes(migration, "current_database() <> 'fbcranes'", "Migration must guard the approved database target")
assertIncludes(migration, "to_regnamespace('atec')", "Migration must guard the atec schema")
assertIncludes(migration, "expected_count constant integer := 6", "Migration must assert the reviewed deterministic candidate count")
assertIncludes(migration, "CREATE TEMP TABLE _m1d_expected_candidates", "Migration must embed the reviewed candidate set")
assertIncludes(migration, "CREATE TEMP TABLE _m1d_recalculated_candidates", "Migration must recalculate candidates at execution time")
assertIncludes(migration, "JOIN atec.tblsection sec", "Valid section must be authoritative for asset hierarchy repair")
assertIncludes(migration, "JOIN atec.tblsites section_site", "Selected section site must exist")
assertIncludes(migration, "JOIN atec.tblclients section_client", "Selected section customer must exist")
assertIncludes(migration, "sec.clientid IS NOT DISTINCT FROM section_site.clientid", "Section and site customers must agree")
assertIncludes(migration, "a.clientid IS NOT DISTINCT FROM sec.clientid", "Category C must retain the section customer")
assertIncludes(migration, "a.siteid IS DISTINCT FROM sec.siteid", "Category C repair must target site mismatches only")
assertIncludes(migration, "unexpected_rows", "Migration must refuse newly discovered unreviewed candidates")
assertIncludes(migration, "missing_expected_rows", "Migration must refuse missing reviewed candidates")
assertIncludes(migration, "invalid_parent_rows", "Migration must reject missing or archived parent records")
assertIncludes(migration, "Category C candidates may only correct duplicated siteid", "Migration must prevent broader Category C field drift")
assertIncludes(migration, "atec.asset_hierarchy_repair_audit", "Migration must persist exact rollback evidence")
assertIncludes(migration, "previous_clientid", "Audit must capture previous customer")
assertIncludes(migration, "previous_siteid", "Audit must capture previous site")
assertIncludes(migration, "previous_sectionid", "Audit must capture previous section")
assertIncludes(migration, "previous_responsibleid", "Audit must capture Responsible Person for no-change verification")
assertIncludes(migration, "previous_assettagno", "Audit must capture tag value for no-change verification")
assertIncludes(migration, "UPDATE atec.tblasset a", "Migration must update assets only")
assertIncludes(migration, "clientid = c.proposed_clientid", "Migration may update only approved hierarchy columns")
assertIncludes(migration, "siteid = c.proposed_siteid", "Migration may update only approved hierarchy columns")
assertIncludes(migration, "sectionid = c.proposed_sectionid", "Migration may update only approved hierarchy columns")
assertIncludes(migration, "a.responsibleid IS NOT DISTINCT FROM c.previous_responsibleid", "Migration must not change Responsible Person fields")
assertIncludes(migration, "a.clientid IS DISTINCT FROM s.clientid", "Postcondition must validate asset customer equals site customer")
assertIncludes(migration, "a.siteid IS DISTINCT FROM sec.siteid", "Postcondition must validate asset site equals section site")
assertIncludes(migration, "a.clientid IS DISTINCT FROM sec.clientid", "Postcondition must validate asset customer equals section customer")

assert(!/UPDATE\s+atec\.tblsection/i.test(migration), "Migration must not update sections")
assert(!/UPDATE\s+atec\.tblsites/i.test(migration), "Migration must not update sites")
assert(!/UPDATE\s+atec\.tblclients/i.test(migration), "Migration must not update customers")
assert(!/UPDATE\s+atec\.tblinspection/i.test(migration), "Migration must not update inspections")
assert(!/UPDATE\s+atec\.tblpeople/i.test(migration), "Migration must not update people")
assert(!/responsibleid\s*=\s*c\./i.test(migration), "Migration must not assign Responsible Person values")
assert(!/assettagno\s*=|tagno\s*=/i.test(migration), "Migration must not update asset tag values")
assert(!/ILIKE|similarity|levenshtein|soundex|lower\(.*sectionname/i.test(migration), "Migration must not rely on name similarity")

assertIncludes(rollback, "atec.asset_hierarchy_repair_audit", "Rollback must use audit table")
assertIncludes(rollback, "clientid = audit.previous_clientid", "Rollback must restore previous customer")
assertIncludes(rollback, "siteid = audit.previous_siteid", "Rollback must restore previous site")
assertIncludes(rollback, "sectionid = audit.previous_sectionid", "Rollback must restore previous section")
assertIncludes(rollback, "a.responsibleid IS DISTINCT FROM audit.previous_responsibleid", "Rollback must refuse if Responsible Person drifted")
assert(!/WHERE\s+.*sectionid IS NULL/i.test(rollback), "Rollback must not recalculate broad current conditions")

assertIncludes(diagnostics, "READ ONLY", "Diagnostics must be read-only")
assertIncludes(diagnostics, "Manual-review queue", "Diagnostics must produce unresolved manual-review records")
assertIncludes(diagnostics, "recommended_business_question", "Manual-review queue must include business questions")
assertIncludes(diagnostics, "risk_level", "Manual-review queue must include risk level")
assert(!/UPDATE\s+atec\.|DELETE\s+FROM\s+atec\.|INSERT\s+INTO\s+atec\./i.test(diagnostics), "Diagnostics must not mutate data")

assertIncludes(
  customerReportRegression,
  "Customer Detailed Report must not use stale tblasset.responsibleid",
  "Responsible Person ownership must remain section-derived"
)
assertIncludes(
  task14Regression,
  "COALESCE(a.archived, false) = false",
  "Onsite visit active hierarchy filtering regression must remain available"
)

assert.strictEqual(
  packageJson.scripts["test:milestone1d-hierarchy"],
  "node scripts/regression/milestone1d-asset-hierarchy-repair.test.js"
)

console.log("Milestone 1D asset hierarchy repair regression checks passed.")
