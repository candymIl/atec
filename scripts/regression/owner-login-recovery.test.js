const test = require('node:test')
const assert = require('node:assert/strict')
const bcrypt = require('../../backend/node_modules/bcryptjs')
const { recover, validatePassword } = require('../recover-jacques-login')

function fixture(options = {}) {
  const user = { userid: 5, username: 'jacques', email: 'jacques@fbcranes.co.za',
    password: 'old-hash', auth_version: 3, must_change_password: true, is_active: true, ...options.user }
  const queries = []; const backups = []
  const client = { async query(sql, args) {
    queries.push({ sql, args })
    if (sql.startsWith('SELECT')) return { rows: options.rows || [user] }
    if (sql.startsWith('UPDATE')) return { rows: [{ password: args[0], auth_version: 4 }] }
    if (sql.startsWith('INSERT') && options.auditFailure) throw new Error('Audit unavailable')
    return { rows: [] }
  } }
  return { queries, backups, user,
    run: () => recover({ client, bcrypt, password: 'Private new password 2026!', backupRoot: 'unused',
      saveBackup: async (folder, record) => { backups.push(record); if (options.backupFailure) throw new Error('Backup unavailable') } }) }
}
test('validates confirmation and bcrypt length without changing an account', () => {
  assert.throws(() => validatePassword('validpassword', 'other'))
  assert.throws(() => validatePassword('short', 'short'))
  assert.throws(() => validatePassword('é'.repeat(37), 'é'.repeat(37)))
  validatePassword('validpassword', 'validpassword')
})
test('backs up exactly one active account, hashes password, audits and commits', async () => {
  const f = fixture(); const result = await f.run()
  assert.equal(result.userid, 5); assert.equal(f.backups.length, 1)
  const update = f.queries.find(q => q.sql.startsWith('UPDATE'))
  assert.equal(update.args[1], 5)
  assert(await bcrypt.compare('Private new password 2026!', update.args[0]))
  assert(f.queries.some(q => q.sql.startsWith('INSERT')))
  assert.equal(f.queries.at(-1).sql, 'COMMIT')
})
for (const [label, options] of [['inactive', { user: { is_active: false } }],
  ['duplicate', { rows: [{ userid: 1 }, { userid: 2 }] }], ['missing', { rows: [] }],
  ['backup failure', { backupFailure: true }], ['audit failure', { auditFailure: true }]]) {
  test(`rolls back on ${label}`, async () => {
    const f = fixture(options); await assert.rejects(f.run())
    assert.equal(f.queries.at(-1).sql, 'ROLLBACK')
    assert(!f.queries.some(q => q.sql === 'COMMIT'))
  })
}
