const assert = require('node:assert/strict')
const { test } = require('node:test')
const { closeInvalidTimesheet } = require('../../backend/services/closeInvalidTimesheet')

function fixture(status = 'RETURNED', failAudit = false) {
  const calls = []
  const original = { timesheetid:7, user_id:20, status, final_normal_hours:9, final_travel_hours:1.5 }
  let persisted = {...original}, pending, released = false
  const client = {
    async query(sql, params) {
      calls.push({sql, params})
      if (sql === 'BEGIN') pending = {...persisted}
      if (sql.startsWith('SELECT')) return { rows:status === null ? [] : [{...pending}] }
      if (sql.startsWith('UPDATE')) {
        pending = {...pending, status:'CLOSED_INVALID', closed_reason:params[1], closed_by_user_id:params[2]}
        return {rows:[{...pending}]}
      }
      if (sql.startsWith('INSERT') && failAudit) throw new Error('Audit unavailable')
      if (sql === 'COMMIT') persisted = pending
      if (sql === 'ROLLBACK') pending = null
      return {rows:[]}
    },
    release() { released = true }
  }
  return { pool:{connect:async () => client}, calls, original, persisted:() => persisted, released:() => released }
}
const admin = {role:'ADMIN',user_id:1}
test('Admin closes each outstanding stage with atomic audit and unchanged hours', async () => {
  for (const status of ['DRAFT','AWAITING_EMPLOYEE','EMPLOYEE_SUBMITTED','MANAGER_APPROVED','RETURNED']) {
    const f = fixture(status)
    const result = await closeInvalidTimesheet(f.pool,admin,7,'Duplicate; correct record verified')
    assert.equal(result.status,'CLOSED_INVALID')
    assert.equal(result.final_normal_hours,9)
    assert.equal(result.final_travel_hours,1.5)
    assert.equal(result.closed_by_user_id,1)
    const audit = JSON.parse(f.calls.find(call => call.sql.startsWith('INSERT')).params[2])
    assert.equal(audit.previous_status,status)
    assert.deepEqual(audit.before,f.original)
    assert.match(f.calls[1].sql,/FOR UPDATE/)
    assert.equal(f.calls.at(-1).sql,'COMMIT')
    assert.ok(f.released())
  }
})
test('Other roles and invalid reasons cannot acquire a database connection', async () => {
  const pool = {connect:() => {throw new Error('Must not connect')}}
  for (const role of ['HR','MANAGER','INSPECTOR',null]) {
    await assert.rejects(closeInvalidTimesheet(pool,{role},7,'Duplicate'),{statusCode:403})
  }
  for (const reason of ['', 'no', 'x'.repeat(1001)]) {
    await assert.rejects(closeInvalidTimesheet(pool,admin,7,reason),{statusCode:400})
  }
})
test('Missing, payroll-accepted, exported and closed records cannot be closed', async () => {
  for (const status of [null,'HR_ACCEPTED','EXPORTED','CLOSED_INVALID']) {
    const f = fixture(status)
    await assert.rejects(closeInvalidTimesheet(f.pool,admin,7,'Duplicate'),{statusCode:status === null ? 404 : 409})
    assert.deepEqual(f.persisted(),f.original)
    assert.equal(f.calls.at(-1).sql,'ROLLBACK')
    assert.ok(f.released())
  }
})
test('Audit failure rolls the status change back', async () => {
  const f = fixture('RETURNED',true)
  await assert.rejects(closeInvalidTimesheet(f.pool,admin,7,'Duplicate'),/Audit unavailable/)
  assert.deepEqual(f.persisted(),f.original)
  assert.equal(f.calls.at(-1).sql,'ROLLBACK')
  assert.ok(f.released())
})

test('Reading or force-recalculating a closed timesheet returns its original snapshot', async () => {
  const { rebuildTimesheet } = require('../../backend/routes/workforce')
  for (const force of [false,true]) {
    const queries = []
    const sheet = {timesheetid:7,status:'CLOSED_INVALID',final_normal_hours:9,closed_reason:'Duplicate'}
    const client = {query:async sql => {
      queries.push(sql)
      assert.match(sql,/^SELECT/)
      return {rows:sql.includes('SELECT * FROM atec.tbldailytimesheet') ? [sheet] : [{normal_hours:9}]}
    }}
    const result = await rebuildTimesheet(client,20,'2026-09-01',{force})
    assert.equal(result.timesheet,sheet)
    assert.equal(result.normal_hours,9)
    assert.equal(queries.length,2)
  }
})
