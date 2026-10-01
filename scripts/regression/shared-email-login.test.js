const assert = require('node:assert/strict')
const test = require('node:test')
const { selectLoginUser } = require('../../backend/services/loginIdentity')
const jacques = { user_id: 4, username: 'Jacques Jonker', email: 'jacques@fbcranes.co.za', is_active: true }
const kobus = { user_id: 16, username: 'Kobus Le Grange', email: jacques.email, is_active: true }
test('shared email never chooses an arbitrary employee, regardless of row order', () => {
  for (const rows of [[jacques, kobus], [kobus, jacques]]) assert.equal(selectLoginUser(rows, jacques.email), null)
})
test('each employee can sign in using their own case-insensitive username', () => {
  assert.equal(selectLoginUser([kobus, jacques], ' JACQUES JONKER '), jacques)
  assert.equal(selectLoginUser([jacques, kobus], 'Kobus Le Grange'), kobus)
})
test('unique active email remains supported; inactive matches cannot overshadow it', () => {
  assert.equal(selectLoginUser([jacques], jacques.email), jacques)
  assert.equal(selectLoginUser([{ ...kobus, is_active: false }, jacques], jacques.email), jacques)
  assert.equal(selectLoginUser([{ ...jacques, is_active: false }], jacques.email), null)
})
test('exact username takes precedence over other users contact addresses', () => {
  const customer = { username: jacques.email, email: jacques.email, is_active: true }
  assert.equal(selectLoginUser([jacques, kobus, customer], jacques.email), customer)
  const inactive = { ...customer, is_active: false }
  assert.equal(selectLoginUser([jacques, inactive], jacques.email), inactive)
})
test('duplicate usernames fail closed, even when passwords would match', () => {
  assert.equal(selectLoginUser([jacques, { ...jacques, user_id: 99 }], jacques.username), null)
})
test('real login HTTP handler refuses shared email and authenticates the intended username', async () => {
  const fs = require('node:fs')
  const vm = require('node:vm')
  const express = require('../../backend/node_modules/express')
  const bcrypt = require('../../backend/node_modules/bcryptjs')
  const app = express(); app.use(express.json())
  app.use((req, res, next) => { req.logAudit = async () => {}; next() })
  const password = 'Same password used by both!'
  const hash = await bcrypt.hash(password, 4)
  const users = [{ ...kobus, password_hash: hash }, { ...jacques, password_hash: hash }]
  const pool = { async query(sql, args) {
    if (sql.includes('SELECT')) {
      const key = args[0].toLowerCase()
      return { rows: users.filter(user => user.username.toLowerCase() === key || user.email.toLowerCase() === key) }
    }
    return { rows: [] }
  } }
  const source = fs.readFileSync(require('node:path').resolve(__dirname, '../../backend/server.js'), 'utf8')
  const route = source.slice(source.indexOf('app.post("/auth/login"'), source.indexOf('app.post("/public/demonstration-request"'))
  vm.runInNewContext(route, { app, pool, bcrypt, selectLoginUser,
    csrfProtection: (req, res, next) => next(), loginLimiter: (req, res, next) => next(),
    asyncRoute: fn => (req, res, next) => fn(req, res).catch(next),
    publicUser: user => ({ user_id: user.user_id, username: user.username }),
    recordActiveUser: () => {}, signAuthToken: user => `user-${user.user_id}`, authCookieOptions: () => ({ path: '/' }) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const login = username => fetch(`http://127.0.0.1:${server.address().port}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  try {
    const ambiguous = await login(jacques.email)
    assert.equal(ambiguous.status, 401); assert(!ambiguous.headers.get('set-cookie'))
    for (const user of [jacques, kobus]) {
      const response = await login(user.username)
      assert.equal(response.status, 200)
      assert.equal((await response.json()).user.user_id, user.user_id)
      assert(response.headers.get('set-cookie').includes(`user-${user.user_id}`))
    }
  } finally { await new Promise(resolve => server.close(resolve)) }
})
