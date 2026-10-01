const assert = require('node:assert/strict')
const test = require('node:test')
const bcrypt = require('../../backend/node_modules/bcryptjs')
const { createPasswordRecovery, digest, MESSAGE, INVALID } = require('../../backend/services/passwordRecovery')

function response() {
  return { statusCode: 200, status(n) { this.statusCode = n; return this },
    json(body) { this.body = body; return this }, clearCookie() {} }
}
function fixture(overrides = {}) {
  const state = { hash: null, version: 4, email: 'person@example.com', active: true, expired: false,
    issuedVersion: null, issuedEmail: null, cooldown: false, mails: [], audits: [], failures: [] }
  const pool = { async query(sql, values) {
    if (sql.includes('password_reset_requested_at = now()')) {
      if (!state.active || state.cooldown || values[1] !== state.email) return { rows: [] }
      state.hash = values[0]; state.issuedVersion = state.version; state.issuedEmail = state.email; state.cooldown = true
      return { rows: [{ userid: 1, email: state.email }] }
    }
    if (sql.includes('SET password = $1')) {
      if (!state.active || state.expired || state.hash !== values[1] || state.version !== state.issuedVersion || state.email !== state.issuedEmail) return { rows: [] }
      state.hash = null; state.password = values[0]; state.version++
      return { rows: [{ userid: 1, email: state.email }] }
    }
    if (sql.includes('password_reset_requested_at = NULL')) { state.hash = null; state.cooldown = false; return { rows: [] } }
    throw new Error('Unexpected SQL')
  } }
  const handlers = createPasswordRecovery({ pool, appUrl: 'https://example.com/atec/',
    sendEmail: async mail => { state.mails.push(mail) }, reportFailure: code => state.failures.push(code), ...overrides })
  const req = body => ({ body, logAudit: async (...args) => state.audits.push(args) })
  return { state, handlers, req }
}
async function issue(f) {
  const res = response()
  await f.handlers.request(f.req({ email: f.state.email }), res)
  assert.equal(res.body.message, MESSAGE)
  const link = f.state.mails[0].text.match(/https:\/\/\S+/)[0]
  const url = new URL(link)
  assert.equal(url.pathname, '/atec/'); assert.equal(url.search, '')
  const token = new URLSearchParams(url.hash.slice(1)).get('reset-password')
  assert.equal(f.state.hash, digest(token)); assert.notEqual(f.state.hash, token)
  return token
}
const password = 'New strong password 2026!'
test('single-use recovery hashes password, revokes sessions, audits, and sends notice without password', async () => {
  const f = fixture(); const token = await issue(f); const res = response()
  await f.handlers.reset(f.req({ token, password, confirmation: password }), res)
  assert.equal(res.statusCode, 200); assert.equal(f.state.version, 5)
  assert(await bcrypt.compare(password, f.state.password))
  assert.equal(f.state.audits[0][0], 'PASSWORD_RECOVERY_COMPLETED')
  assert(!f.state.mails[1].text.includes(password))
  const replay = response(); await f.handlers.reset(f.req({ token, password, confirmation: password }), replay)
  assert.equal(replay.statusCode, 400); assert.equal(replay.body.error, INVALID)
})
test('unknown and inactive accounts get identical response and no email; account cooldown prevents flooding', async () => {
  const f = fixture(); await issue(f)
  for (const email of ['missing@example.com', f.state.email]) {
    const res = response(); await f.handlers.request(f.req({ email }), res)
    assert.equal(res.body.message, MESSAGE)
  }
  f.state.active = false; await f.handlers.request(f.req({ email: f.state.email }), response())
  assert.equal(f.state.mails.length, 1)
})
for (const condition of ['expired', 'inactive', 'changedVersion', 'changedEmail']) {
  test(`rejects ${condition} token`, async () => {
    const f = fixture(); const token = await issue(f)
    if (condition === 'expired') f.state.expired = true
    if (condition === 'inactive') f.state.active = false
    if (condition === 'changedVersion') f.state.version++
    if (condition === 'changedEmail') f.state.email = 'other@example.com'
    const res = response(); await f.handlers.reset(f.req({ token, password, confirmation: password }), res)
    assert.equal(res.statusCode, 400); assert.equal(f.state.audits.length, 0)
  })
}
test('rejects malformed token, short/overlong passwords and mismatched confirmation without consuming link', async () => {
  const f = fixture(); const token = await issue(f)
  for (const body of [{ token: 'bad', password, confirmation: password },
    { token, password: 'short', confirmation: 'short' },
    { token, password: 'é'.repeat(37), confirmation: 'é'.repeat(37) },
    { token, password, confirmation: 'different' }]) {
    const res = response(); await f.handlers.reset(f.req(body), res); assert.equal(res.statusCode, 400)
    assert.equal(f.state.hash, digest(token))
  }
})
test('failed delivery clears token and permits retry, exposes no provider details', async () => {
  const f = fixture({ sendEmail: async () => { throw new Error('secret provider response') } })
  const res = response(); await f.handlers.request(f.req({ email: f.state.email }), res)
  assert.equal(res.body.message, MESSAGE); assert.equal(f.state.hash, null); assert.equal(f.state.cooldown, false)
  assert.deepEqual(f.state.failures, ['PASSWORD_RECOVERY_DELIVERY_FAILED'])
})
test('insecure application URL does not send recovery email', async () => {
  const f = fixture({ appUrl: 'http://example.com' })
  await f.handlers.request(f.req({ email: f.state.email }), response())
  assert.equal(f.state.mails.length, 0); assert.equal(f.state.hash, null)
})
test('public recovery HTTP endpoint enforces CSRF and rate limits without requiring a session', async () => {
  const express = require('../../backend/node_modules/express')
  const rateLimit = require('../../backend/node_modules/express-rate-limit')
  const { createCsrfProtection } = require('../../backend/middleware/security')
  const f = fixture()
  const app = express(); app.use(express.json())
  app.post('/auth/forgot-password', createCsrfProtection('https://example.com'),
    rateLimit({ windowMs: 60000, limit: 2, validate: false }),
    (req, res, next) => f.handlers.request(req, res).catch(next))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}/auth/forgot-password`
  const options = origin => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ email: 'missing@example.com' }) })
  try {
    assert.equal((await fetch(url, options())).status, 403)
    assert.equal((await fetch(url, options('https://attacker.example'))).status, 403)
    for (let i = 0; i < 2; i++) {
      const response = await fetch(url, options('https://example.com'))
      assert.equal(response.status, 200); assert.equal((await response.json()).message, MESSAGE)
    }
    assert.equal((await fetch(url, options('https://example.com'))).status, 429)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
