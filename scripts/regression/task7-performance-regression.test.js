const assert = require("assert")
const fs = require("fs")
const path = require("path")

function parsePositiveInteger(value, fallback, max = fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function deriveTimeouts(env = {}) {
  const requestTimeoutMs = parsePositiveInteger(env.REQUEST_TIMEOUT_MS, 180000, 900000)
  const headersTimeoutMs = Math.max(
    parsePositiveInteger(env.HEADERS_TIMEOUT_MS, Math.max(requestTimeoutMs + 5000, 65000), 905000),
    requestTimeoutMs + 1000
  )
  const keepAliveTimeoutMs = Math.min(
    parsePositiveInteger(env.KEEP_ALIVE_TIMEOUT_MS, 65000, 300000),
    headersTimeoutMs - 1000
  )

  return { requestTimeoutMs, headersTimeoutMs, keepAliveTimeoutMs }
}

function clampPage(requestedPage, total, limit) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  return Math.min(parsePositiveInteger(requestedPage, 1, 100000), totalPages)
}

function allowedSortKey(allowlist, requested, fallback) {
  return Object.prototype.hasOwnProperty.call(allowlist, requested) ? requested : fallback
}

function dashboardSummaryCacheKey(user = {}) {
  return `${user.role || ""}:${user.clientid || ""}`
}

const certificateSortColumns = {
  testid: "i.testid",
  tagnumber: "i.tagnumber",
  clientname: "c.clientname",
  sitename: "s.sitename",
  description: "a.description",
  serialno: "a.serialno",
  inspectiontype: "i.inspectiontype",
  testdate: "i.testdate",
  status: "i.status",
  inspector: "COALESCE(i.inspector_name, i.inspector)"
}

const customerReportSortColumns = {
  clientname: "clientname",
  assetid: "assetid",
  assettagno: "assettagno",
  serialno: "serialno",
  sitename: "sitename",
  sectionname: "sectionname",
  responsiblename: "responsiblename",
  equipmenttype: "equipmenttype",
  description: "description",
  latestinspectiondate: "latestinspectiondate",
  visualtestdate: "visualtestdate",
  visualstatus: "visualstatus",
  loadtestdate: "loadtestdate",
  loadstatus: "loadstatus",
  reportstatus: "reportstatus"
}

assert.strictEqual(parsePositiveInteger("25", 10, 250), 25)
assert.strictEqual(parsePositiveInteger("999", 10, 250), 250)
assert.strictEqual(parsePositiveInteger("-1", 10, 250), 10)
assert.strictEqual(parsePositiveInteger("not-a-number", 10, 250), 10)

assert.deepStrictEqual(deriveTimeouts({}), {
  requestTimeoutMs: 180000,
  headersTimeoutMs: 185000,
  keepAliveTimeoutMs: 65000
})

assert.deepStrictEqual(deriveTimeouts({
  REQUEST_TIMEOUT_MS: "bad",
  HEADERS_TIMEOUT_MS: "1",
  KEEP_ALIVE_TIMEOUT_MS: "bad"
}), {
  requestTimeoutMs: 180000,
  headersTimeoutMs: 181000,
  keepAliveTimeoutMs: 65000
})

assert.strictEqual(clampPage(1, 51, 25), 1)
assert.strictEqual(clampPage(2, 51, 25), 2)
assert.strictEqual(clampPage(99, 51, 25), 3)
assert.strictEqual(clampPage("bad", 51, 25), 1)
assert.strictEqual(clampPage(99, 0, 25), 1)

assert.strictEqual(allowedSortKey(certificateSortColumns, "testdate", "testid"), "testdate")
assert.strictEqual(allowedSortKey(certificateSortColumns, "testid desc; drop table x", "testid"), "testid")
assert.strictEqual(allowedSortKey(customerReportSortColumns, "clientname", "latestinspectiondate"), "clientname")
assert.strictEqual(allowedSortKey(customerReportSortColumns, "clientname;select", "latestinspectiondate"), "latestinspectiondate")

assert.strictEqual(dashboardSummaryCacheKey({ role: "CUSTOMER", clientid: 12 }), "CUSTOMER:12")
assert.strictEqual(dashboardSummaryCacheKey({ role: "VIEWER", clientid: 12 }), "VIEWER:12")
assert.notStrictEqual(
  dashboardSummaryCacheKey({ role: "CUSTOMER", clientid: 12 }),
  dashboardSummaryCacheKey({ role: "CUSTOMER", clientid: 13 })
)
assert.notStrictEqual(
  dashboardSummaryCacheKey({ role: "CUSTOMER", clientid: 12 }),
  dashboardSummaryCacheKey({ role: "MANAGER", clientid: 12 })
)

const serverSource = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "server.js"), "utf8")
const reportPageSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "CustomerDetailedReport.js"),
  "utf8"
)
assert(serverSource.includes("const certificateSearchSortColumns = {"))
assert(serverSource.includes("const customerReportSortColumns = {"))
assert(!serverSource.includes("${req.query.sortKey}"))
assert(serverSource.includes("Promise.allSettled(["))
assert(serverSource.includes('req.path.endsWith(".xlsx")'))
assert(/function updateCustomerReportLinks\(\) \{\s+const query = getCustomerReportQuery\(\)/.test(reportPageSource))
assert(/async function loadCustomerDetailedReport\(\) \{[\s\S]+const query = getCustomerReportQuery\(\{ includePagination: true \}\)/.test(reportPageSource))

console.log("Task 7 performance regression checks passed.")
