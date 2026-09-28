// Opt-in integration check: temporary tables only; no application data or mail.
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
require('../../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../../backend/.env'), quiet: true })
const { Client } = require('../../backend/node_modules/pg')
const { dueDocuments, ruleConfig, localDate, runReminders } = require('../../backend/services/complianceExpiryReminders')

async function main() {
  assert(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST), 'Only local PostgreSQL is allowed')
  const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT || 5432, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectionTimeoutMillis: 5000 })
  await db.connect()
  try {
    await db.query('BEGIN')
    await db.query(`CREATE TEMP TABLE tblcompliancedocument (
      compliancedocumentid BIGINT PRIMARY KEY, title TEXT, reference_number TEXT,
      issuing_authority TEXT, expiry_date DATE, status TEXT)`)
    const migration = fs.readFileSync(path.join(__dirname, '../../database/2026-09-28-compliance-expiry-reminders.sql'), 'utf8')
      .replace(/BEGIN;|COMMIT;/g, '').replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE IF NOT EXISTS')
      .replace(/atec\./g, '')
    await db.query(migration)
    const today = localDate()
    await db.query(`INSERT INTO tblcompliancedocument
      SELECT id, 'Certificate ' || id, 'Ref', 'Issuer', $1::date + days, status
      FROM (VALUES (1,60,'PUBLISHED'), (2,61,'PUBLISHED'), (3,0,'PUBLISHED'),
        (4,-1,'PUBLISHED'), (5,1,'DRAFT'), (6,-1,'ARCHIVED'), (7,NULL,'PUBLISHED'),
        (8,30,'PUBLISHED'), (9,-3,'PUBLISHED'), (10,-5,'PUBLISHED'),
        (11,14,'PUBLISHED'), (12,7,'PUBLISHED'), (13,59,'PUBLISHED'),
        (14,29,'PUBLISHED'), (15,13,'PUBLISHED'), (16,6,'PUBLISHED'),
        (17,30,'PUBLISHED'), (18,7,'DRAFT'), (19,14,'ARCHIVED')) AS t(id,days,status)`, [today])
    await db.query(`INSERT INTO tblcomplianceexpiryreminder
      (compliancedocumentid, expiry_date, recipient, phase, status, sent_at)
      SELECT compliancedocumentid, expiry_date, 'chene@fbcranes.co.za',
        CASE WHEN compliancedocumentid = 10 THEN 'EXPIRED'
          WHEN compliancedocumentid = 8 THEN 'DAYS_30' ELSE 'DAYS_60' END,
        CASE WHEN compliancedocumentid = 10 THEN 'PENDING' ELSE 'SENT' END, now()
      FROM tblcompliancedocument WHERE compliancedocumentid IN (8,9,10,17)`)
    const adapter = {
      query: (sql, params) => db.query(sql.replace(/atec\.tbl/g, 'pg_temp.tbl'), params),
      release() {}
    }
    assert.deepEqual((await dueDocuments(adapter, ruleConfig({}), today)).map(d => Number(d.compliancedocumentid)).sort((a,b) => a-b), [1,4,9,11,12,17])
    const emails = []
    const options = { pool: { connect: async () => adapter }, env: { COMPLIANCE_EXPIRY_REMINDERS_ENABLED: 'true' },
      now: new Date(`${today}T12:00:00Z`), sendEmail: async email => emails.push(email) }
    assert.deepEqual(await runReminders(options), { sent: 6 })
    assert.deepEqual(await runReminders(options), { sent: 0 })
    assert.equal(emails.length, 6)
    await db.query("UPDATE tblcomplianceexpiryreminder SET sent_at = now() - interval '8 days' WHERE status = 'SENT'")
    assert.equal((await dueDocuments(adapter, ruleConfig({}), today)).length, 0)
    // A previous milestone must not prevent the next one for the same expiry date.
    const thirtyDaysLater = new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10)
    const later = await dueDocuments(adapter, ruleConfig({}), thirtyDaysLater)
    assert.equal(later.find(d => Number(d.compliancedocumentid) === 1).phase, 'DAYS_30')
    assert.equal(later.some(d => Number(d.compliancedocumentid) === 4), false)
    console.log('PostgreSQL passed: exact 60/30/14/7 milestones, next milestone eligibility, one expired alert, exclusions, pending suppression and no weekly repeats. No mail sent.')
  } finally {
    await db.query('ROLLBACK')
    await db.end()
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
