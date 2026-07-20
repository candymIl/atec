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

assertIncludes(server, "notificationAttentionLines", "Task 18 must build readable attention lines for notification emails")
assertIncludes(server, "Items needing attention:", "Task 18 email body must have a clear attention section")
assertIncludes(server, "getNotificationDeliveryHistory", "Task 18 must expose notification delivery history")
assertIncludes(server, 'app.get("/dashboard/notification-centre/history"', "Task 18 needs a history endpoint")
assertIncludes(server, "cardinality(d.recipients)", "History endpoint must expose recipient count")

assertIncludes(dashboard, "dashboardNotificationHistory", "Dashboard must include a notification history panel")
assertIncludes(main, "loadDashboardNotificationHistory", "Frontend must load notification history")
assertIncludes(main, "Recent Notification History", "Frontend must show a recent history title")
assertIncludes(main, "notificationHistoryCounts", "Frontend must summarize delivery counts")
assertIncludes(style, ".dashboard-notification-history", "History panel styles are missing")

assertIncludes(roadmap, "Task 17: Scheduled Automatic Notifications - Complete Locally", "Roadmap must mark Task 17 complete")
assertIncludes(roadmap, "Task 18: Notification History And Templates - In Progress Locally", "Roadmap must mark Task 18 in progress")
assertIncludes(docs, "Recent Notification History panel", "Notification docs must mention history visibility")
assert.strictEqual(packageJson.scripts["test:task18"], "node scripts/regression/task18-notification-history-templates.test.js")

console.log("Task 18 notification history and template regression checks passed")
