// Run only against a new disposable PostgreSQL cluster on localhost:55439.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('../../backend/node_modules/pg')
const { closeInvalidTimesheet } = require('../../backend/services/closeInvalidTimesheet')
const pool = new Pool({host:'127.0.0.1',port:55439,user:'postgres',database:'postgres'})
async function main() {
  await pool.query(`CREATE SCHEMA atec;
    CREATE TABLE atec.tblusers(userid integer PRIMARY KEY);
    INSERT INTO atec.tblusers VALUES(1),(2);
    CREATE TABLE atec.tbldailytimesheet(timesheetid integer PRIMARY KEY,user_id integer,timesheet_date date,
      status text,final_normal_hours numeric,updated_at timestamptz,
      CONSTRAINT chk_tbldailytimesheet_status CHECK(status IN ('RETURNED','HR_ACCEPTED','EXPORTED')));
    CREATE TABLE atec.tbltimeentry(timeentryid integer PRIMARY KEY,user_id integer,activity_date date);
    CREATE TABLE atec.tbltimesheetaudit(timesheetid integer,actor_user_id integer,action text,details jsonb);
    INSERT INTO atec.tbldailytimesheet VALUES(1,2,'2026-09-01','RETURNED',9,now()),(2,2,'2026-09-02','HR_ACCEPTED',8,now());
    INSERT INTO atec.tbltimeentry VALUES(1,2,'2026-09-01');`)
  const migration = fs.readFileSync(path.join(__dirname,'../../database/2026-09-29-close-invalid-timesheets.sql'),'utf8')
  await pool.query(migration)
  await pool.query(migration) // Deployment rerun must be safe.
  const admin = {role:'ADMIN',user_id:1}
  const results = await Promise.allSettled([
    closeInvalidTimesheet(pool,admin,1,'Duplicate record verified'),
    closeInvalidTimesheet(pool,admin,1,'Duplicate record verified')
  ])
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1)
  assert.equal(results.find(r => r.status === 'rejected').reason.statusCode,409)
  const {rows:[record]} = await pool.query('SELECT * FROM atec.tbldailytimesheet WHERE timesheetid=1')
  assert.equal(record.status,'CLOSED_INVALID')
  assert.equal(Number(record.final_normal_hours),9)
  assert.ok(record.closed_at)
  assert.equal((await pool.query('SELECT * FROM atec.tbltimesheetaudit')).rowCount,1)
  assert.equal((await pool.query('SELECT * FROM atec.tbltimeentry')).rowCount,1)
  for (const sql of [
    "UPDATE atec.tbldailytimesheet SET status='RETURNED' WHERE timesheetid=1",
    'DELETE FROM atec.tbldailytimesheet WHERE timesheetid=1',
    'DELETE FROM atec.tbltimeentry WHERE timeentryid=1',
    "UPDATE atec.tbltimeentry SET activity_date='2026-09-03' WHERE timeentryid=1",
    "INSERT INTO atec.tbltimeentry VALUES(2,2,'2026-09-01')"
  ]) await assert.rejects(pool.query(sql), /closed as invalid/i)
  await assert.rejects(closeInvalidTimesheet(pool,admin,2,'Incorrect record'),{statusCode:409})
  assert.equal((await pool.query("SELECT * FROM atec.tbldailytimesheet WHERE status IN ('HR_ACCEPTED','EXPORTED')")).rowCount,1)
  // Force an audit failure and prove PostgreSQL rolls back the status update.
  await pool.query("INSERT INTO atec.tbldailytimesheet(timesheetid,user_id,timesheet_date,status) VALUES(3,2,'2026-09-03','RETURNED'); ALTER TABLE atec.tbltimesheetaudit ADD CONSTRAINT test_audit_failure CHECK(timesheetid<>3)")
  await assert.rejects(closeInvalidTimesheet(pool,admin,3,'Test audit rollback'), /test_audit_failure/)
  assert.equal((await pool.query('SELECT status FROM atec.tbldailytimesheet WHERE timesheetid=3')).rows[0].status,'RETURNED')
  console.log('Disposable PostgreSQL checks passed: migration rerun, concurrent closure, read-only guards, payroll exclusion, original entries and audit rollback.')
}
main().catch(error => { console.error(error.message); process.exitCode=1 }).finally(() => pool.end())
