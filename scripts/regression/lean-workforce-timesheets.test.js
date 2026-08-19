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
assert.strictEqual(calculated.double_time_hours, 0)

const sunday = splitIntervalBySchedule("2026-08-02T08:00:00+02:00", "2026-08-02T12:00:00+02:00", "WORK", schedule, new Set(), { doubleTime: true })
assert.strictEqual(sunday.normalHours, 0)
assert.strictEqual(sunday.overtimeHours, 0)
assert.strictEqual(sunday.doubleTimeHours, 4, "Sunday work must be double time")

const publicHoliday = splitIntervalBySchedule("2026-08-10T08:00:00+02:00", "2026-08-10T12:00:00+02:00", "WORK", schedule, new Set(["2026-08-10"]), { doubleTime: true })
assert.strictEqual(publicHoliday.normalHours, 0)
assert.strictEqual(publicHoliday.overtimeHours, 0)
assert.strictEqual(publicHoliday.doubleTimeHours, 4, "Public-holiday work must be double time")

const splitTravel = splitIntervalBySchedule("2026-07-27T06:00:00+02:00", "2026-07-27T08:00:00+02:00", "TRAVEL", schedule)
assert.strictEqual(splitTravel.normalHours, 1, "Travel inside the schedule must be normal travel")
assert.strictEqual(splitTravel.overtimeHours, 1, "Travel outside the schedule must be overtime travel")

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
assert.ok(routes.includes('router.put("/time-entries/:entryId"'),"Employees need a controlled correction route before submission")
assert.ok(routes.includes('router.delete("/time-entries/:entryId"'),"Employees need a controlled delete route before submission")
assert.ok((routes.match(/FOR UPDATE OF entry/g) || []).length >= 2,"Employee edit and delete must lock only the time entry, not the nullable timesheet join")
assert.ok(routes.includes("'EMPLOYEE_TIME_EDIT'"),"Employee time corrections must be audited")
assert.ok(routes.includes("'EMPLOYEE_TIME_DELETE'"),"Employee time deletions must be audited")
assert.ok(routes.includes('/timesheets/:id/action'))
assert.ok(routes.includes('/timesheets/:id/manager-edit'),"Managers need a scoped employee time review route")
assert.ok(routes.includes('/timesheets/:id/time-entries/:entryId'),"Managers need a controlled time edit route")
assert.ok(routes.includes('router.delete("/timesheets/:id/time-entries/:entryId"'),"Admin and HR need a controlled employee time deletion route")
assert.ok(routes.includes('["ADMIN","MANAGER","HR"]'),"Admin, Manager and HR correction access must be explicit")
assert.ok(routes.includes('["EMPLOYEE_SUBMITTED","MANAGER_APPROVED","RETURNED"]'),"Admin and HR must be able to correct returned and pre-HR-acceptance timesheets")
assert.ok(routes.includes("HR-accepted and exported records remain locked"),"Payroll-controlled stages must remain locked from correction")
assert.ok(routes.includes('u.manager_user_id=$${values.length} AND t.manager_user_id=$${values.length}'),"Manager edits must stay limited to assigned employees")
assert.ok(routes.includes("reason.length < 5"),"Manager time edits must require a meaningful reason")
assert.ok(routes.includes("'MANAGER_TIME_EDIT'"),"Manager changes must be written to timesheet audit history")
assert.ok(routes.includes("{ force:true }"),"Approved-stage recalculation must be explicit and controlled")
assert.ok(routes.includes('/timesheets/history'))
assert.ok(routes.includes('if (!calculation.lines.length && (!existing.rows[0] || existing.rows[0].status === "DRAFT"))'),"Opening an empty date must not create or retain a Draft timesheet")
assert.ok(routes.includes("entry.activity_date=t.timesheet_date"),"Empty-Draft removal must verify that no source time entries exist")
assert.ok(read("frontend/src/pages/Workforce.js").includes("My timesheet history"),"History heading must not claim Awaiting Employee records are already submitted")
assert.ok(read("deployment/production-migrations.json").includes("2026-08-18-remove-empty-timesheet-drafts.sql"),"Production must remove existing empty Draft timesheets")
assert.ok(routes.includes("Enter the numeric Accelo Job Number for job-related time."))
assert.ok(routes.includes("job_number_snapshot"))
assert.ok(routes.includes('"EMPLOYEE_SUBMITTED","MANAGER_APPROVED","HR_ACCEPTED","EXPORTED"'))
assert.ok(routes.includes('router.put("/schedules/:id"'),"Existing work schedules must be editable")
assert.ok(routes.includes('function canManageWorkSchedules(user)'),"Admin, Manager and HR schedule access must be explicit")
assert.ok(routes.includes('["ADMIN", "MANAGER", "HR"].includes(user?.role)'),"Managers and HR must be able to maintain work schedules")
assert.ok(routes.includes('manager_user_id=$2 AND COALESCE(is_active,true)=true'),"Manager schedule access must stay limited to assigned active employees")
assert.ok(routes.includes('work_schedule_scope === "true"'),"The schedule employee list must support Manager assignment scoping")
assert.ok(routes.includes("s.effective_from::text AS effective_from"),"Schedule dates must not shift through UTC serialization")
assert.ok(routes.includes("manager_user_id=EXCLUDED.manager_user_id"),"Timesheet rebuilds must refresh the current approving Manager")
assert.ok((routes.match(/t\.timesheet_date::text AS timesheet_date/g) || []).length >= 2,"Approval and history dates must not shift through UTC serialization")
assert.ok(server.includes("status IN ('DRAFT','AWAITING_EMPLOYEE','EMPLOYEE_SUBMITTED','RETURNED')"),"Changing an employee Manager must realign open timesheets")
assert.ok(server.includes("SET manager_user_id = $1, updated_at = now()"),"Open timesheet Manager reassignment must be explicit")
assert.ok(frontend.includes("Schedule history"),"Work Schedules must display saved history")
assert.ok(frontend.includes("work_schedule_scope=true"),"The Work Schedules page must request a role-scoped employee list")
assert.ok(read("frontend/src/main.js").includes("'work-schedules': ['ADMIN', 'MANAGER', 'HR']"),"Managers and HR must see the Work Schedules page")
assert.ok(frontend.includes("scheduleFridayStart"),"Friday rules must be editable separately")
assert.ok(frontend.includes("Weekly normal paid hours"),"Work Schedules must show the calculated weekly paid hours")
assert.ok(frontend.includes("updateScheduleHours()"),"Schedule totals must refresh while working hours are edited")
assert.ok(routes.includes('/job-cards/:id/accelo-readiness'))
assert.ok(routes.includes('An Inspection Job Card must have at least one linked certificate.'),"Inspection completion packages must require a certificate")
assert.ok(routes.includes('Missing certificates for Job Card equipment'),"Inspection readiness must reconcile selected equipment to certificates")
assert.ok(routes.includes('/job-cards/:id/accelo-send'))
assert.ok(routes.includes("createJobCardPdfBuffer"))
assert.ok(routes.includes("createCertificatePdfBuffer"))
assert.ok(routes.includes("20 * 1024 * 1024"))
assert.ok(frontend.includes("My Day"))
assert.ok(frontend.includes("editMyTimeEntry"),"My Day must expose time correction controls")
assert.ok(frontend.includes("deleteMyTimeEntry"),"My Day must expose time deletion controls")
assert.ok(frontend.includes("Returned by reviewer"),"Returned timesheets must show the review reason")
assert.ok(frontend.includes("HR Time Dashboard"))
assert.ok(frontend.includes("My timesheet history"))
assert.ok(frontend.includes("workforce-entry-disclosure"),"The optional time-entry form must have a clear expandable action")
assert.ok(frontend.includes("Click here to display the time-entry form"),"The collapsed action must explain that it opens the entry form")
assert.ok(frontend.includes("Add time to this day"),"The time-entry submit action must state what it does")
assert.ok(frontend.includes("Timesheet History & Reports"))
assert.ok(frontend.includes("Correct entries"),"The approval queue must expose controlled time correction")
assert.ok(frontend.includes("saveEmployeeTimeEdit"),"Manager time changes must be saved from the approval workflow")
assert.ok(frontend.includes("deleteEmployeeTimeEntry"),"Admin and HR must be able to remove incorrect duplicate employee entries")
assert.ok(frontend.includes("Delete duplicate"),"The correction editor must clearly expose controlled duplicate removal")
assert.ok(frontend.includes("Required audit reason"),"The edit form must request an audit reason")
assert.ok(frontend.includes("timeJobNumber"))
assert.ok(read("frontend/src/main.js").includes("Accelo Completion Package"))
assert.ok(server.includes("Accelo Job Number is required"))
assert.ok(manifest.migrations.includes("2026-07-30-lean-workforce-timesheets.sql"))
assert.ok(manifest.migrations.includes("2026-07-30-inspection-snapshot-runtime-permissions.sql"))
assert.ok(snapshotPermissions.includes("GRANT SELECT, INSERT, UPDATE, DELETE"))

console.log("LEAN workforce and timesheet regression checks passed.")
