const assert = require("assert")
const fs = require("fs")
const path = require("path")
const {
  buildCustomerAssetHistory,
  isFailedResult
} = require("../../backend/services/customerAssetHistory")

const root = path.resolve(__dirname, "../..")
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8")
const server = read("backend/server.js")
const portal = read("frontend/src/pages/CustomerPortal.js")
const report = read("frontend/src/pages/CustomerDetailedReport.js")

assert(isFailedResult({ result: "FAIL" }))
assert(isFailedResult({ measuredvalue: "NO" }))
assert(!isFailedResult({ result: "PASS" }))

const history = buildCustomerAssetHistory(
  { assetid: 42, serialno: "SER-42" },
  [
    {
      testid: 100,
      testdate: "2026-01-01",
      inspectiontype: "VISUAL",
      status: "NOT SAFE",
      results: [{ criterianame: "Safety latch", result: "FAIL", remarks: "Latch missing" }]
    },
    {
      testid: 101,
      testdate: "2026-01-03",
      inspectiontype: "LOADTEST",
      status: "SAFE",
      results: []
    },
    {
      testid: 102,
      testdate: "2026-01-07",
      inspectiontype: "VISUAL",
      status: "SAFE",
      results: []
    },
    {
      testid: 103,
      testdate: "2026-02-01",
      inspectiontype: "LOADTEST",
      status: "NOT SAFE",
      results: []
    }
  ]
)

assert.strictEqual(history.summary.totalInspections, 4)
assert.strictEqual(history.summary.visualInspections, 2)
assert.strictEqual(history.summary.loadTests, 2)
assert.strictEqual(history.summary.resolvedFailures, 1)
assert.strictEqual(history.summary.unresolvedFailures, 1)
const visualFailure = history.events.find(event => Number(event.testid) === 100)
const loadFailure = history.events.find(event => Number(event.testid) === 103)
assert.strictEqual(Number(visualFailure.resolvedBy.testid), 102, "Visual failure must only be cleared by a later Visual inspection")
assert.strictEqual(visualFailure.resolvedBy.daysToSafe, 6)
assert.strictEqual(loadFailure.unresolved, true, "Load Test failure must remain unresolved without a later safe Load Test")

assert(server.includes('app.get("/customer-portal/assets/:id/history"'), "Customer asset history JSON route is missing")
assert(server.includes('app.get("/customer-portal/assets/:id/history.pdf"'), "Customer asset history PDF route is missing")
assert(server.includes("AND a.clientid = $2"), "Asset history must enforce logged-in customer ownership")
assert(server.includes("AND ($3::int IS NULL OR a.siteid = $3)"), "Asset history must enforce customer site scope")
assert(server.includes("AND ($5::int IS NULL OR sec.responsibleid = $5)"), "Asset history must enforce responsible-person scope")
assert(portal.includes("openCustomerAssetHistory"), "Customer Portal must expose Asset History Review")
assert(portal.includes("Download History PDF"), "Customer Asset History Review must offer a PDF download")
assert(portal.includes("Unresolved Not Safe Event"), "Customer Asset History Review must explain unresolved failures")
assert(report.includes("openCustomerAssetHistory"), "Customer Detailed Report Asset IDs must open Asset History Review")

console.log("Customer asset history regression checks passed")
