const crypto = require("crypto")
const path = require("path")

const projectRoot = path.resolve(__dirname, "..", "..")
const backendRoot = path.join(projectRoot, "backend")
const dotenv = require(path.join(backendRoot, "node_modules", "dotenv"))
const bcrypt = require(path.join(backendRoot, "node_modules", "bcryptjs"))
const { Client } = require(path.join(backendRoot, "node_modules", "pg"))

dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true })

function isLocalHost(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host || "").toLowerCase())
}

function temporaryPassword(label) {
  return `${label}-${crypto.randomBytes(8).toString("base64url")}!7`
}

async function ensureUser(client, { username, aliases = [], fullName, role, employeeNumber, managerUserId }) {
  const existing = await client.query(
    "SELECT userid,username,role FROM atec.tblusers WHERE lower(username)=ANY($1::text[]) ORDER BY userid LIMIT 1",
    [[username,...aliases].map(value => value.toLowerCase())]
  )
  if (existing.rows[0]) {
    const result = await client.query(`UPDATE atec.tblusers SET username=$2,fullname=$3,role=$4,userlevel=$5,is_active=true,
      manager_user_id=$6,employee_number=$7 WHERE userid=$1
      RETURNING userid,username,role,employee_number`, [
      existing.rows[0].userid,username,fullName,role,role === "HR" ? 6 : 7,managerUserId || null,employeeNumber
    ])
    return { user:result.rows[0],password:null,created:false }
  }
  const password = temporaryPassword(role === "HR" ? "HR" : "Assistant")
  const passwordHash = await bcrypt.hash(password,12)
  const result = await client.query(`INSERT INTO atec.tblusers
    (userid,username,password,fullname,userlevel,role,is_active,manager_user_id,employee_number)
    VALUES((SELECT COALESCE(MAX(userid),0)+1 FROM atec.tblusers),$1,$2,$3,$4,$5,true,$6,$7)
    RETURNING userid,username,role,employee_number`, [
    username,passwordHash,fullName,role === "HR" ? 6 : 7,role,managerUserId || null,employeeNumber
  ])
  return { user:result.rows[0],password,created:true }
}

async function ensureStandardSchedule(client, employeeUserId, createdByUserId) {
  const existing = await client.query(`SELECT scheduleid FROM atec.tblworkschedule
    WHERE employee_user_id=$1 AND effective_to IS NULL ORDER BY effective_from DESC,scheduleid DESC LIMIT 1`,
  [employeeUserId])
  const schedule = existing.rows[0]
    ? await client.query(`UPDATE atec.tblworkschedule SET schedule_name='Standard 06:30 schedule',
        travel_treatment='SPLIT_BY_SCHEDULE',rounding_minutes=1 WHERE scheduleid=$1 RETURNING scheduleid`,
      [existing.rows[0].scheduleid])
    : await client.query(`INSERT INTO atec.tblworkschedule
        (schedule_name,employee_user_id,effective_from,travel_treatment,rounding_minutes,created_by_user_id)
        VALUES('Standard 06:30 schedule', $1, '2026-07-01', 'SPLIT_BY_SCHEDULE', 1, $2)
        RETURNING scheduleid`, [employeeUserId,createdByUserId])
  await client.query("DELETE FROM atec.tblworkscheduleday WHERE scheduleid=$1",[schedule.rows[0].scheduleid])
  for (let weekday=1; weekday<=5; weekday += 1) {
    await client.query(`INSERT INTO atec.tblworkscheduleday
      (scheduleid,weekday,normal_start,normal_end,unpaid_break_minutes,is_overtime_day)
      VALUES($1,$2,'06:30',CASE WHEN $2=5 THEN '13:30'::time ELSE '16:30'::time END,
        CASE WHEN $2=5 THEN 0 ELSE 30 END,false)`, [schedule.rows[0].scheduleid,weekday])
  }
  return schedule.rows[0].scheduleid
}

async function main() {
  if (!isLocalHost(process.env.DB_HOST) || process.env.NODE_ENV === "production") {
    throw new Error("Refusing to restore workforce users outside a local development database.")
  }
  const client = new Client({
    host:process.env.DB_HOST,
    port:Number(process.env.DB_PORT || 5432),
    database:process.env.DB_NAME,
    user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,
    application_name:"atec-workforce-local-restore"
  })
  await client.connect()
  try {
    await client.query("BEGIN")
    const admin = await client.query(`SELECT userid,COALESCE(NULLIF(fullname,''),username) AS name
      FROM atec.tblusers WHERE role='ADMIN' AND COALESCE(is_active,true)=true
      ORDER BY CASE WHEN lower(username) LIKE 'jacques%' THEN 0 ELSE 1 END,userid LIMIT 1`)
    if (!admin.rows[0]) throw new Error("No active local administrator is available for workforce ownership.")
    await client.query(`UPDATE atec.tblusers SET username='01Manager-Archived-' || userid,
      fullname='01Manager (Archived ' || userid || ')'
      WHERE role='MANAGER' AND COALESCE(is_active,false)=false AND lower(trim(username))='01manager'`)
    const managerRename = await client.query(`UPDATE atec.tblusers SET username='01Manager',fullname='01Manager'
      WHERE role='MANAGER' AND COALESCE(is_active,true)=true AND lower(trim(username)) IN ('manager','01manager')
      RETURNING userid,username,role`)
    const assistant = await ensureUser(client,{
      username:"01Assistant",aliases:["Assistant"],fullName:"01Assistant",role:"ASSISTANT",employeeNumber:"AST-001",
      managerUserId:admin.rows[0].userid
    })
    const hr = await ensureUser(client,{
      username:"01HR",aliases:["HR"],fullName:"01HR",role:"HR",employeeNumber:"HR-001",
      managerUserId:null
    })
    const employees = await client.query(`SELECT userid,COALESCE(NULLIF(fullname,''),username) AS employee_name
      FROM atec.tblusers WHERE COALESCE(is_active,true)=true AND role IN ('ADMIN','MANAGER','INSPECTOR','ASSISTANT','HR')
      ORDER BY employee_name`)
    const schedules = []
    for (const employee of employees.rows) {
      schedules.push({
        user_id:employee.userid,
        employee_name:employee.employee_name,
        schedule_id:await ensureStandardSchedule(client,employee.userid,admin.rows[0].userid)
      })
    }
    await client.query("COMMIT")
    console.log(JSON.stringify({
      database:process.env.DB_NAME,
      manager:admin.rows[0],
      generic_manager:managerRename.rows[0] || null,
      assistant:{...assistant.user,created:assistant.created,temporary_password:assistant.password},
      hr:{...hr.user,created:hr.created,temporary_password:hr.password},
      standard_schedules:schedules,
      recovered_timesheet_rows:0,
      recovery_note:"No deleted workforce backup was available; no payroll hours were invented."
    },null,2))
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
