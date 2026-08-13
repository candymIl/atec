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
assertIncludes(server, "notificationEmailHtml", "Customer notifications must include a professional HTML layout")
assertIncludes(server, "createNotificationReportPdfBuffer", "Customer notifications must include a detailed PDF report")
assertIncludes(server, "ASSET COMPLIANCE ATTENTION REPORT", "The attachment must have a clear customer-facing report title")
assertIncludes(server, "attentionAssets", "The report must list the affected assets rather than totals only")
assertIncludes(server, "contentType: \"application/pdf\"", "The compliance report must be attached as a PDF")
assertIncludes(server, 'const CUSTOMER_REPORT_CC = "jacques@fbcranes.co.za"', "All customer reports must copy Jacques")
assertIncludes(server, "ccRecipients: graphRecipients(options.cc)", "Microsoft Graph must preserve customer-report CC recipients")
assertIncludes(server, "cc: CUSTOMER_REPORT_CC", "Customer compliance and certificate emails must include the configured CC")
assertIncludes(server, "buildNotificationPreviewFromRow", "Manual and scheduled notifications must use the same complete report preview")
assertIncludes(server, "history_recorded: historyRecorded", "A sent email must report history storage separately")
assertIncludes(server, "Notification sent history", "Post-send history failures must be logged without falsely reporting email failure")
assertIncludes(server, "CASE WHEN $4::varchar = 'SENT'", "Notification history status must use one explicit PostgreSQL parameter type")
assertIncludes(main, "result.history_warning", "The dashboard must distinguish sent email from history-recording warnings")
assertIncludes(main, "dashboardNotificationPageSize", "The notification list must support selectable page sizes")
assertIncludes(main, "Rows per page", "The notification list must expose its page-size control")
assertIncludes(main, "setDashboardNotificationPage", "The notification list must support page navigation")
assertIncludes(main, "This is the attention list, not the complete customer register.", "The notification scope must be clear to users")
assertIncludes(style, ".dashboard-notification-pagination", "Notification pagination styles are missing")
assertIncludes(server, "getNotificationDeliveryHistory", "Task 18 must expose notification delivery history")
assertIncludes(server, 'app.get("/dashboard/notification-centre/history"', "Task 18 needs a history endpoint")
assertIncludes(server, "cardinality(d.recipients)", "History endpoint must expose recipient count")

assertIncludes(dashboard, "dashboardNotificationHistory", "Dashboard must include a notification history panel")
assertIncludes(main, "loadDashboardNotificationHistory", "Frontend must load notification history")
assertIncludes(main, "Recent Notification History", "Frontend must show a recent history title")
assertIncludes(main, "notificationHistoryCounts", "Frontend must summarize delivery counts")
assertIncludes(style, ".dashboard-notification-history", "History panel styles are missing")

assertIncludes(roadmap, "Task 17: Scheduled Automatic Notifications - Complete Locally", "Roadmap must mark Task 17 complete")
assertIncludes(roadmap, "Task 18: Notification History And Templates - Complete Locally", "Roadmap must mark Task 18 complete")
assertIncludes(docs, "Recent Notification History panel", "Notification docs must mention history visibility")
assert.strictEqual(packageJson.scripts["test:task18"], "node scripts/regression/task18-notification-history-templates.test.js")

console.log("Task 18 notification history and template regression checks passed")
