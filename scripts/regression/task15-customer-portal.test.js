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
const portal = read("frontend/src/pages/CustomerPortal.js")
const style = read("frontend/src/style.css")
const roadmap = read("docs/next-roadmap-tasks-13-16.md")
const packageJson = JSON.parse(read("package.json"))

assertIncludes(server, 'app.get("/customer-portal/summary", requireAuth', "Customer portal summary route must be authenticated")
assertIncludes(server, 'app.get("/customer-portal/assets", requireAuth', "Customer portal asset route must be authenticated")
assertIncludes(server, 'req.user.role !== "CUSTOMER"', "Customer portal summary route must be customer-only")
assertIncludes(server, "const effectiveClientId = req.user.clientid", "Customer portal must derive client scope from logged-in user")
assertIncludes(server, "WHERE clientid = $1", "Customer lookup must be scoped by client ID")
assertIncludes(server, "WHERE a.clientid = $1", "Certificate summary must be scoped by customer asset ownership")
assertIncludes(server, "WHERE v.clientid = $1", "Visit summary must be scoped by customer visit ownership")
assertIncludes(server, "COALESCE(a.archived, false) = false", "Customer portal assets must exclude archived assets")
assertIncludes(server, "asset_status = $", "Customer portal assets must support status filtering")
assertIncludes(server, "recentCertificates", "Portal summary must expose recent certificates")

assertIncludes(main, "portal: ['CUSTOMER']", "Portal page access must be customer-only")
assertIncludes(main, "renderCustomerPortal", "Customer portal renderer must be imported")
assertIncludes(main, "currentUser.role === 'CUSTOMER' ? 'portal' : 'dashboard'", "Customer login must land on portal")
assertIncludes(main, "menuButton('portal', 'Customer Portal'", "Customer Portal navigation item is missing")
assertIncludes(main, 'case "portal":', "Portal route restore case is missing")

assertIncludes(portal, "/customer-portal/summary", "Portal page must call the scoped summary endpoint")
assertIncludes(portal, "/customer-portal/assets", "Portal page must call the scoped asset endpoint")
assertIncludes(portal, "showCertificateSearch()", "Portal must link to certificates")
assertIncludes(portal, "showCustomerDetailedReport({ autoLoad: true })", "Portal must link to auto-loaded detailed reports")
assertIncludes(portal, "Recent Certificates", "Portal must show recent certificates")
assertIncludes(portal, "Visit Outstanding", "Portal must show visit context")
assertIncludes(portal, "portalAssetSearch", "Portal asset search control is missing")
assertIncludes(portal, "portalAssetStatus", "Portal asset status filter is missing")
assertIncludes(portal, "visual_testid", "Portal assets must link visual certificates")
assertIncludes(portal, "loadtest_testid", "Portal assets must link load-test certificates")

assertIncludes(style, ".customer-portal-page", "Portal page styles are missing")
assertIncludes(style, ".portal-metric-grid", "Portal metric grid styles are missing")
assertIncludes(style, ".portal-certificate-table", "Portal certificate table styles are missing")
assertIncludes(style, ".portal-asset-filters", "Portal asset filter styles are missing")
assertIncludes(style, ".portal-asset-table", "Portal asset table styles are missing")

assertIncludes(roadmap, "Task 15: Customer Portal - In Progress Locally", "Roadmap must mark Task 15 in progress locally")
assert.strictEqual(packageJson.scripts["test:task15"], "node scripts/regression/task15-customer-portal.test.js")

console.log("Task 15 customer portal regression checks passed")
