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
const migration = read("database/2026-07-20-task17-scheduled-notification-deliveries.sql")
const productionMigrations = read("deployment/production-migrations.json")
const productionContract = read("deployment/production-schema-contract.json")
const packageJson = JSON.parse(read("package.json"))

assertIncludes(server, "notificationSchedulerConfig", "Task 17 needs scheduler configuration")
assertIncludes(server, "NOTIFICATION_AUTO_SEND_ENABLED", "Scheduler must be controlled by an environment switch")
assertIncludes(server, "runScheduledNotificationDelivery", "Task 17 needs an automatic notification runner")
assertIncludes(server, "startNotificationScheduler", "Task 17 needs to start the scheduler with the backend")
assertIncludes(server, 'app.get("/dashboard/notification-centre/scheduler"', "Dashboard needs scheduler status endpoint")
assertIncludes(server, 'app.post("/dashboard/notification-centre/scheduler/run"', "Dashboard needs manual scheduled-run endpoint")
assertIncludes(server, "recordNotificationDelivery", "Notification deliveries must be recorded")
assertIncludes(server, "last_notification_sent_at", "Notification rows must expose last sent date")
assertIncludes(server, "automatic_notification_ready", "Notification rows must expose automatic readiness")
assertIncludes(server, "SEND_NOTIFICATION_AUTOMATIC", "Automatic sends must be audit logged")
assertIncludes(server, "NOTIFICATION_AUTO_SEND_COOLDOWN_HOURS", "Automatic sends must have duplicate-send protection")

assertIncludes(dashboard, "dashboardNotificationScheduler", "Dashboard must include scheduler status area")
assertIncludes(dashboard, "runDashboardNotificationScheduler", "Dashboard must offer a manual scheduled check")
assertIncludes(main, "loadDashboardNotificationScheduler", "Frontend must load scheduler status")
assertIncludes(main, "runDashboardNotificationScheduler", "Frontend must call the scheduled-run endpoint")
assertIncludes(main, "dashboardNotificationFilterRows", "Notification Centre must support heading filters")
assertIncludes(main, "dashboardNotifications", "Notification Centre must support sortable headings")
assertIncludes(main, "clearDashboardNotificationFilters", "Notification Centre must allow filters to be cleared")
assertIncludes(main, "Last Sent", "Notification table must show last sent state")
assertIncludes(main, "Automatic Ready", "CSV export must include automatic readiness")
assertIncludes(style, ".notification-scheduler-status", "Scheduler status styles are missing")
assertIncludes(style, ".dashboard-notification-filter-row", "Notification Centre filter row styles are missing")

assertIncludes(migration, "CREATE TABLE IF NOT EXISTS atec.tblnotificationdelivery", "Task 17 migration must create delivery history")
assertIncludes(migration, "delivery_type IN ('MANUAL', 'AUTOMATIC')", "Delivery history must distinguish manual and automatic sends")
assertIncludes(migration, "idx_tblnotificationdelivery_customer_site_sent", "Delivery history needs lookup index")
assertIncludes(productionMigrations, "2026-07-20-task17-scheduled-notification-deliveries.sql", "Production migration manifest must include Task 17")
assertIncludes(productionContract, "tblnotificationdelivery", "Production schema contract must require Task 17 delivery history")

assertIncludes(roadmap, "Task 16: Email And Notifications - Complete Locally", "Roadmap must keep Task 16 complete")
assertIncludes(roadmap, "Task 17: Scheduled Automatic Notifications - Complete Locally", "Roadmap must mark Task 17 complete")
assertIncludes(docs, "Scheduled Automatic Notifications", "Notification docs must describe scheduled sending")
assertIncludes(docs, "NOTIFICATION_AUTO_SEND_ENABLED=false", "Docs must show automatic sending starts off")
assert.strictEqual(packageJson.scripts["test:task17"], "node scripts/regression/task17-scheduled-notifications.test.js")

console.log("Task 17 scheduled notification regression checks passed")
