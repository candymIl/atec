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
const dashboard = read("frontend/src/pages/Dashboard.js")
const style = read("frontend/src/style.css")
const roadmap = read("docs/next-roadmap-tasks-13-16.md")
const docs = read("docs/email-and-notifications.md")
const packageJson = JSON.parse(read("package.json"))

assertIncludes(server, "async function getNotificationCentreRows(req)", "Task 16 needs a notification centre data builder")
assertIncludes(server, 'app.get("/dashboard/notification-centre"', "Task 16 needs a notification centre endpoint")
assertIncludes(server, "task14VisitTablesAvailable", "Task 16 must tolerate missing Task 14 visit tables")
assertIncludes(server, "portal_recipients", "Task 16 must expose customer portal recipient readiness")
assertIncludes(server, "expiring_certificates", "Task 16 must expose certificate expiry counts")
assertIncludes(server, "unresolved_visit_items", "Task 16 must expose visit exception counts")
assertIncludes(server, "notificationCentre", "Dashboard summary cache must include notification rows")

assertIncludes(dashboard, "Notification Centre", "Dashboard must show the notification centre panel")
assertIncludes(dashboard, "dashboardNotificationCentre", "Dashboard must include a notification centre target")
assertIncludes(main, "loadDashboardNotificationCentre", "Frontend must load notification centre rows")
assertIncludes(main, "exportDashboardNotifications", "Frontend must export notification centre rows")
assertIncludes(main, "Email sending is not switched on in this slice.", "Task 16 slice must make email status clear")
assertIncludes(style, ".dashboard-notification-centre", "Notification centre styles are missing")
assertIncludes(style, ".notification-recipient.ready", "Recipient readiness styles are missing")

assertIncludes(roadmap, "Task 15: Customer Portal - Complete Locally", "Roadmap must mark Task 15 complete")
assertIncludes(roadmap, "Task 16: Email And Notifications - In Progress Locally", "Roadmap must mark Task 16 in progress")
assertIncludes(docs, "Automatic email sending", "Task 16 docs must state email sending is not yet included")
assert.strictEqual(packageJson.scripts["test:task16"], "node scripts/regression/task16-email-notifications.test.js")

console.log("Task 16 email and notification regression checks passed")
