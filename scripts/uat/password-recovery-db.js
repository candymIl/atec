const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { Client } = require('../../backend/node_modules/pg')
const { createPasswordRecovery } = require('../../backend/services/passwordRecovery')
require('../../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../../backend/.env'), quiet: true })

async function main() {
  if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST) || process.env.NODE_ENV === 'production') {
    throw new Error('This rollback-only test requires a local development database.')
  }
  const client = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectionTimeoutMillis: 5000 })
  await client.connect()
  const schema = `recovery_uat_${crypto.randomBytes(6).toString('hex')}`
  const pool = { query: (sql, values) => client.query(sql.replaceAll('atec.', `${schema}.`), values) }
  const mails = []
  const recovery = createPasswordRecovery({ pool, appUrl: 'https://example.com/', sendEmail: async mail => mails.push(mail),
    reportFailure: code => { throw new Error(code) } })
  const res = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this }, json(body) { this.body = body }, clearCookie() {} })
  const req = body => ({ body, logAudit: async () => {} })
  const read = async () => (await client.query(`SELECT * FROM ${schema}.tblusers WHERE userid=1`)).rows[0]
  async function issue() {
    await client.query(`UPDATE ${schema}.tblusers SET password_reset_requested_at=NULL WHERE userid=1`)
    const n = mails.length
    await recovery.request(req({ email: 'person@example.com' }), res())
    assert.equal(mails.length, n + 1)
    const link = mails.at(-1).text.match(/https:\/\/\S+/)[0]
    return new URLSearchParams(new URL(link).hash.slice(1)).get('reset-password')
  }
  const password = 'Database checked password 2026!'
  const reset = token => recovery.reset(req({ token, password, confirmation: password }), res())
  try {
    await client.query('BEGIN')
    await client.query(`CREATE SCHEMA ${schema}`)
    await client.query(`CREATE TABLE ${schema}.tblusers (userid integer PRIMARY KEY, role text, userlevel integer,
      password text, is_active boolean, email text, updated_at timestamptz)`)
    await client.query(`INSERT INTO ${schema}.tblusers VALUES (1,'ADMIN',1,'old',true,'person@example.com',now())`)
    for (const file of ['2026-09-28-required-password-change.sql', '2026-10-01-password-recovery.sql', '2026-10-01-password-recovery.sql']) {
      const sql = fs.readFileSync(path.resolve(__dirname, '../../database', file), 'utf8')
        .replace(/^BEGIN;/m, '').replace(/^COMMIT;/m, '').replaceAll('atec.', `${schema}.`)
      await client.query(sql)
    }
    let token = await issue()
    await reset(token)
    assert.equal((await read()).auth_version, 1)
    assert.equal((await read()).password_reset_hash, null)
    await reset(token)
    assert.equal((await read()).auth_version, 1)
    await client.query(`UPDATE ${schema}.tblusers SET role='CUSTOMER', userlevel=5 WHERE userid=1`)
    token = await issue(); await reset(token)
    assert.equal((await read()).auth_version, 2)
    token = await issue()
    await client.query(`UPDATE ${schema}.tblusers SET password='customer-admin-reset' WHERE userid=1`)
    await reset(token); assert.equal((await read()).password, 'customer-admin-reset')
    token = await issue()
    await client.query(`UPDATE ${schema}.tblusers SET password_reset_expires_at=now()-interval '1 minute' WHERE userid=1`)
    await reset(token); assert.equal((await read()).auth_version, 2)
    token = await issue()
    await client.query(`UPDATE ${schema}.tblusers SET role='ADMIN',password='admin-reset' WHERE userid=1`)
    await reset(token); assert.equal((await read()).password, 'admin-reset')
    token = await issue()
    await client.query(`UPDATE ${schema}.tblusers SET email='changed@example.com' WHERE userid=1`)
    await reset(token); assert.equal((await read()).password, 'admin-reset')
    console.log('PostgreSQL recovery checks passed: idempotent migration, atomic token consumption, replay/expiry denial, staff and customer revocation, admin reset and email-change invalidation. All fixtures rolled back.')
  } finally { await client.query('ROLLBACK'); await client.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
