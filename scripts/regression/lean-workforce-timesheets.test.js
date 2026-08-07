const assert = require("assert")
const fs = require("fs")
const path = require("path")
const { calculateTimeEntries, splitIntervalBySchedule } = require("../../backend/services/workforceTime")

const root = path.resolve(__dirname, "..", "..")
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8")

const schedule = {
  schedule_name: "Day shift",
  rounding_minutes: 1,
  travel_treatment: "SPLIT_BY_SCHEDULE",
  days: {
    1: { normal_start: "07:00", normal_end: "16:00", is_overtime_day: false }
  }
}

const split = splitIntervalBySchedule("2026-07-27T06:00:00+02:00", "2026-07-27T17:00:00+02:00", "WORK", schedule)
assert.strictEqual(split.normalHours, 9)
assert.strictEqual(split.overtimeHours, 2)

const calculated = calculateTimeEntries([
  { timeentryid: 1, activity_type: "WORK", started_at: "2026-07-27T07:00:00+02:00", ended_at: "2026-07-27T16:00:00+02:00" },
  { timeentryid: 2, activity_type: "BREAK", started_at: "2026-07-27T12:00:00+02:00", ended_at: "2026-07-27T12:30:00+02:00" }
], schedule)
assert.strictEqual(calculated.normal_hours, 8.5, "Only a recorded break is deducted")
assert.strictEqual(calculated.overtime_hours, 0)

const agreedSchedule = {
  schedule_name: "Standard 06:30 schedule",
  rounding_minutes: 1,
  travel_treatment: "SPLIT_BY_SCHEDULE",
  days: {
    1: { normal_start:"06:30",normal_end:"16:30",unpaid_break_minutes:30,is_overtime_day:false },
    5: { normal_start:"06:30",normal_end:"13:30",unpaid_break_minutes:0,is_overtime_day:false }
  }
}
const mondayShift = calculateTimeEntries([
  { timeentryid:3,activity_type:"WORK",started_at:"2026-07-27T06:30:00+02:00",ended_at:"2026-07-27T16:30:00+02:00" }
],agreedSchedule)
assert.strictEqual(mondayShift.normal_hours,9.5,"Monday-Thursday must deduct the scheduled 30-minute lunch")
assert.strictEqual(mondayShift.automatic_break_hours,0.5)
const fridayShift = calculateTimeEntries([
  { timeentryid:4,activity_type:"WORK",started_at:"2026-07-31T06:30:00+02:00",ended_at:"2026-07-31T13:30:00+02:00" }
],agreedSchedule)
assert.strictEqual(fridayShift.normal_hours,7,"Friday has no lunch deduction")

const holiday = splitIntervalBySchedule(
  "2026-07-27T07:00:00+02:00",
  "2026-07-27T10:00:00+02:00",
  "WORK",
  schedule,
  new Set(["2026-07-27"])
)
assert.strictEqual(holiday.normalHours, 0)
assert.strictEqual(holiday.overtimeHours, 3)

const migration = read("database/2026-07-30-lean-workforce-timesheets.sql")
const routes = read("backend/routes/workforce.js")
const frontend = read("frontend/src/pages/Workforce.js")
const server = read("backend/server.js")
const manifest = JSON.parse(read("deployment/production-migrations.json"))
const snapshotPermissions = read("database/2026-07-30-inspection-snapshot-runtime-permissions.sql")

for (const table of ["tbljobcardcrew","tbltimeentry","tbldailytimesheet","tbltimesheetaudit","tblaccelodelivery"]) {
  assert.ok(migration.includes(table), `Migration must create ${table}`)
}
assert.ok(routes.includes('/job-cards/:id/copy-timeline'))
assert.ok(routes.includes('/timesheets/:date/submit'))
assert.ok(routes.includes('/timesheets/:id/action'))
assert.ok(routes.includes('/timesheets/:id/manager-edit'),"Managers need a scoped employee time review route")
assert.ok(routes.includes('/timesheets/:id/time-entries/:entryId'),"Managers need a controlled time edit route")
assert.ok(routes.includes('u.manager_user_id=$${values.length} AND t.manager_user_id=$${values.length}'),"Manager edits must stay limited to assigned employees")
assert.ok(routes.includes("reason.length < 5"),"Manager time edits must require a meaningful reason")
assert.ok(routes.includes("'MANAGER_TIME_EDIT'"),"Manager changes must be written to timesheet audit history")
assert.ok(routes.includes("{ force:true }"),"Approved-stage recalculation must be explicit and controlled")
assert.ok(routes.includes('/timesheets/history'))
assert.ok(routes.includes("Enter the numeric Accelo Job Number for job-related time."))
assert.ok(routes.includes("job_number_snapshot"))
assert.ok(routes.includes('"EMPLOYEE_SUBMITTED","MANAGER_APPROVED","HR_ACCEPTED","EXPORTED"'))
assert.ok(routes.includes('router.put("/schedules/:id"'),"Existing work schedules must be editable")
assert.ok(routes.includes("s.effective_from::text AS effective_from"),"Schedule dates must not shift through UTC serialization")
assert.ok(frontend.includes("Schedule history"),"Work Schedules must display saved history")
assert.ok(frontend.includes("scheduleFridayStart"),"Friday rules must be editable separately")
assert.ok(routes.includes('/job-cards/:id/accelo-readiness'))
assert.ok(routes.includes('/job-cards/:id/accelo-send'))
assert.ok(routes.includes("createJobCardPdfBuffer"))
assert.ok(routes.includes("createCertificatePdfBuffer"))
assert.ok(routes.includes("20 * 1024 * 1024"))
assert.ok(frontend.includes("My Day"))
assert.ok(frontend.includes("HR Time Dashboard"))
assert.ok(frontend.includes("My submitted timesheet history"))
assert.ok(frontend.includes("Timesheet History & Reports"))
assert.ok(frontend.includes("Edit times"),"The Manager approval queue must expose controlled time editing")
assert.ok(frontend.includes("saveEmployeeTimeEdit"),"Manager time changes must be saved from the approval workflow")
assert.ok(frontend.includes("Required audit reason"),"The edit form must request an audit reason")
assert.ok(frontend.includes("timeJobNumber"))
assert.ok(read("frontend/src/main.js").includes("Accelo Completion Package"))
assert.ok(server.includes("Accelo Job Number is required"))
assert.ok(manifest.migrations.includes("2026-07-30-lean-workforce-timesheets.sql"))
assert.ok(manifest.migrations.includes("2026-07-30-inspection-snapshot-runtime-permissions.sql"))
assert.ok(snapshotPermissions.includes("GRANT SELECT, INSERT, UPDATE, DELETE"))

console.log("LEAN workforce and timesheet regression checks passed.")
