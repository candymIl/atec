const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ruleConfig, localDate, reminderMessage, preview, runReminders } = require('../../backend/services/complianceExpiryReminders')

const enabled = { COMPLIANCE_EXPIRY_REMINDERS_ENABLED: 'true', MAIL_FROM: 'atec@example.test' }
const now = new Date('2026-09-28T05:00:00Z')
const document = { compliancedocumentid: 4, title: 'Letter of Good Standing', expiry_date: '2026-09-30', reference_number: 'Policy 205810', phase: 'DAYS_7' }

function fixture({ locked = true, claimError = false, sendError = false, documents = [document] } = {}) {
  const events = []
  const db = {
    async query(sql, params) {
      events.push({ sql, params })
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked }] }
      if (sql.includes('SELECT d.compliancedocumentid')) return { rows: documents }
      if (sql.includes('INSERT INTO')) {
        if (claimError) throw new Error('reservation failed')
        return { rows: [{ reminderid: 12 }] }
      }
      return { rows: [] }
    },
    release() { events.push({ release: true }) }
  }
  const pool = { connect: async () => db, query: db.query }
  const sendEmail = async email => {
    events.push({ email })
    if (sendError) throw new Error('delivery outcome unknown')
  }
  return { events, pool, sendEmail, env: enabled, now }
}

test('rule defaults to disabled and the requested recipient', () => {
  assert.equal(ruleConfig({}).enabled, false)
  assert.equal(ruleConfig({}).recipient, 'chene@fbcranes.co.za')
  assert.deepEqual(ruleConfig({}).reminderDays, [60, 30, 14, 7])
})
test('South African date changes at local midnight', () => {
  assert.equal(localDate(new Date('2026-09-30T22:00:00Z')), '2026-10-01')
})
test('wording distinguishes approaching, same-day, and expired certificates', () => {
  assert.match(reminderMessage(document, '2026-09-28').text, /expires in 2 day/)
  assert.match(reminderMessage(document, '2026-09-30').text, /expires today/)
  assert.match(reminderMessage(document, '2026-10-01').text, /expired 1 day/)
})
test('disabled rule does not access database or mail', async () => {
  assert.deepEqual(await runReminders({ env: {}, now }), { skipped: 'disabled' })
})
test('no sends before 07:00 SAST', async () => {
  assert.deepEqual(await runReminders({ env: enabled, now: new Date('2026-09-28T04:59:00Z') }), { skipped: 'before 07:00 SAST' })
})
test('another worker holding lock prevents sending and releases connection', async () => {
  const f = fixture({ locked: false })
  assert.equal((await runReminders(f)).skipped, 'another worker is running')
  assert.equal(f.events.some(e => e.email), false)
  assert.equal(f.events.at(-1).release, true)
})
test('reservation must succeed before any email is sent', async () => {
  const f = fixture({ claimError: true })
  await assert.rejects(runReminders(f), /reservation failed/)
  assert.equal(f.events.some(e => e.email), false)
  assert.equal(f.events.at(-1).release, true)
})
test('successful send is to Chene only and records persistent delivery after sending', async () => {
  const f = fixture()
  assert.deepEqual(await runReminders(f), { sent: 1 })
  const sendIndex = f.events.findIndex(e => e.email)
  assert.match(f.events[sendIndex - 1].sql, /INSERT INTO/)
  assert.match(f.events[sendIndex + 1].sql, /UPDATE.*status = 'SENT'/)
  assert.equal(f.events[sendIndex].email.to, 'chene@fbcranes.co.za')
  assert.equal(f.events[sendIndex].email.cc, undefined)
  assert.equal(f.events.at(-1).release, true)
})
test('ambiguous delivery does not get marked sent or automatically retried in the run', async () => {
  const f = fixture({ sendError: true })
  await assert.rejects(runReminders(f), /outcome unknown/)
  assert.equal(f.events.filter(e => e.email).length, 1)
  assert.equal(f.events.some(e => e.sql?.startsWith('UPDATE')), false)
  assert.equal(f.events.at(-1).release, true)
})
test('preview does not send or reserve deliveries', async () => {
  const f = fixture()
  const result = await preview(f.pool, {}, now)
  assert.equal(result.enabled, false)
  assert.equal(result.documents.length, 1)
  assert.equal(f.events.length, 1)
  assert.match(f.events[0].sql, /SELECT/)
})
test('no eligible documents produces no mail', async () => {
  const f = fixture({ documents: [] })
  assert.deepEqual(await runReminders(f), { sent: 0 })
  assert.equal(f.events.some(e => e.email), false)
})
