const path = require("path")

const projectRoot = path.resolve(__dirname, "..", "..")
const backendRoot = path.join(projectRoot, "backend")
const dotenv = require(path.join(backendRoot, "node_modules", "dotenv"))
const { Client } = require(path.join(backendRoot, "node_modules", "pg"))
const { rebuildTimesheet, loadAcceloReadiness } = require(path.join(backendRoot, "routes", "workforce"))

dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true })

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: "atec-lean-workforce-database-uat"
  })
  await client.connect()
  try {
    await client.query("BEGIN")
    const user = await client.query(`SELECT userid FROM atec.tblusers
      WHERE COALESCE(is_active,true)=true AND role IN ('ADMIN','MANAGER','INSPECTOR','ASSISTANT')
      ORDER BY userid LIMIT 1`)
    if (!user.rows[0]) throw new Error("No active workforce user is available for UAT.")
    const result = await rebuildTimesheet(client, user.rows[0].userid, "2026-07-30")
    if (!result.timesheet?.timesheetid) throw new Error("Timesheet header was not created.")
    const inspectionLink = await client.query(`
      SELECT j.jobcardid
      FROM atec.tblasset a
      LEFT JOIN atec.tbljobcard j
        ON j.clientid=a.clientid AND j.customer_reference=$2
      WHERE a.assetid=$1
      ORDER BY j.updated_at DESC NULLS LAST,j.jobcardid DESC
      LIMIT 1`, [40802, "11959"])
    const inspectionColumn = await client.query(`SELECT 1 FROM information_schema.columns
      WHERE table_schema='atec' AND table_name='tblinspection' AND column_name='jobcardid'`)
    if (!inspectionColumn.rows[0]) throw new Error("Inspection Job Card link column is missing.")
    console.log(`Inspection link query passed${inspectionLink.rows[0]?.jobcardid ? ` for Job Card ${inspectionLink.rows[0].jobcardid}` : " with no matching Job Card"}.`)
    const latestInspection = await client.query(`SELECT testid,job_number,jobcardid,status
      FROM atec.tblinspection WHERE assetid=$1 ORDER BY testid DESC LIMIT 1`, [40802])
    if (latestInspection.rows[0]) {
      console.log(`Latest asset 40802 inspection: ${latestInspection.rows[0].testid}, Job ${latestInspection.rows[0].job_number}, status ${latestInspection.rows[0].status}.`)
    }
    const requestedInspection = await client.query(`SELECT testid,job_number,jobcardid,status,testdate
      FROM atec.tblinspection WHERE assetid=$1 AND job_number=$2 ORDER BY testid DESC LIMIT 1`, [40802, "11959"])
    console.log(`Asset 40802 / Job 11959: ${requestedInspection.rows[0] ? `inspection ${requestedInspection.rows[0].testid}` : "not stored"}.`)
    const requestedInspectionCount = await client.query(`SELECT count(*)::int AS count
      FROM atec.tblinspection WHERE assetid=$1 AND job_number=$2`, [40802, "11959"])
    console.log(`Asset 40802 / Job 11959 matching records: ${requestedInspectionCount.rows[0].count}.`)
    const snapshotPermission = await client.query(`SELECT current_user,
      pg_get_userbyid(c.relowner) AS table_owner,
      has_table_privilege(current_user,'atec.tblinspectioncriteriasnapshot','SELECT,INSERT,UPDATE,DELETE') AS can_write
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='atec' AND c.relname='tblinspectioncriteriasnapshot'`)
    console.log("Snapshot permissions:", snapshotPermission.rows[0])

    const hierarchy = await client.query(`SELECT a.clientid,a.siteid FROM atec.tblasset a
      WHERE a.clientid IS NOT NULL AND a.siteid IS NOT NULL ORDER BY a.assetid LIMIT 1`)
    if (!hierarchy.rows[0]) throw new Error("No customer/site hierarchy is available for Accelo readiness UAT.")
    const nextId = await client.query("SELECT COALESCE(MAX(userid),0)+1 AS firstid FROM atec.tblusers")
    const technicianId = Number(nextId.rows[0].firstid)
    const assistantId = technicianId + 1
    for (const [userid,username,role,userlevel] of [
      [technicianId,`uat-tech-${technicianId}`,"INSPECTOR",3],
      [assistantId,`uat-assistant-${assistantId}`,"ASSISTANT",7]
    ]) {
      await client.query(`INSERT INTO atec.tblusers(userid,username,password,fullname,userlevel,role,is_active)
        VALUES($1,$2,'rollback-only-uat',$3,$4,$5,true)`, [userid,username,username,userlevel,role])
    }
    const job = await client.query(`INSERT INTO atec.tbljobcard
      (jobcard_reference,clientid,siteid,created_by_user_id,assigned_to_user_id,status,customer_reference)
      VALUES('JC-UAT-LEAN',$1,$2,$3,$3,'APPROVED','11927') RETURNING jobcardid`, [
      hierarchy.rows[0].clientid,hierarchy.rows[0].siteid,technicianId
    ])
    for (const [userId,crewRole] of [[technicianId,"LEAD_TECHNICIAN"],[assistantId,"ASSISTANT"]]) {
      await client.query(`INSERT INTO atec.tbljobcardcrew(jobcardid,user_id,crew_role,included_in_time)
        VALUES($1,$2,$3,true)`, [job.rows[0].jobcardid,userId,crewRole])
      const entry = await client.query(`INSERT INTO atec.tbltimeentry
        (user_id,jobcardid,activity_date,activity_type,started_at,ended_at,source)
        VALUES($1,$2,'2026-07-30','WORK','2026-07-30 07:00+02','2026-07-30 16:00+02','JOB_CARD')
        RETURNING timeentryid`, [userId,job.rows[0].jobcardid])
      const sheet = await client.query(`INSERT INTO atec.tbldailytimesheet
        (user_id,timesheet_date,status,manager_user_id,final_normal_hours)
        VALUES($1,'2026-07-30','MANAGER_APPROVED',$2,9) RETURNING timesheetid`, [userId,technicianId])
      await client.query(`INSERT INTO atec.tbldailytimesheetline
        (timesheetid,timeentryid,task_number,activity_type,started_at,ended_at,normal_hours)
        VALUES($1,$2,1,'WORK','2026-07-30 07:00+02','2026-07-30 16:00+02',9)`, [
        sheet.rows[0].timesheetid,entry.rows[0].timeentryid
      ])
    }
    const readyPackage = await loadAcceloReadiness(client,job.rows[0].jobcardid)
    if (!readyPackage.ready || readyPackage.recipient !== "job+11927@fb-cranes.accelo.com" || readyPackage.timesheets.length !== 2) {
      throw new Error(`Accelo readiness UAT failed: ${JSON.stringify(readyPackage.issues)}`)
    }
    await client.query(`UPDATE atec.tbldailytimesheet SET status='EMPLOYEE_SUBMITTED'
      WHERE user_id=$1 AND timesheet_date='2026-07-30'`, [assistantId])
    const blockedPackage = await loadAcceloReadiness(client,job.rows[0].jobcardid)
    if (blockedPackage.ready || !blockedPackage.issues.some(issue => issue.includes("awaiting approval"))) {
      throw new Error("Accelo readiness did not block an unapproved assistant timesheet.")
    }
    console.log("Accelo multi-role readiness UAT passed without sending email.")
    await client.query("ROLLBACK")
    console.log("LEAN workforce database-backed UAT passed in a rollback-only transaction.")
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
