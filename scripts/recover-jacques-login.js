#!/usr/bin/env node
// Run from /var/www/atec/ATEC using an authenticated root server terminal.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const EMAIL = 'jacques@fbcranes.co.za'

function validatePassword(password, confirmation) {
  if (password !== confirmation) throw new Error('Passwords do not match. Nothing changed.')
  if (password.trim().length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Use at least 8 characters and no more than 72 UTF-8 bytes. Nothing changed.')
  }
}

async function recover({ client, bcrypt, password, backupRoot, saveBackup }) {
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '15s'")
    const { rows } = await client.query(`SELECT userid, username, email, is_active,
      password, auth_version, must_change_password
      FROM atec.tblusers WHERE userid=4 AND lower(email)=$1
        AND lower(username)='jacques jonker' FOR UPDATE`, [EMAIL])
    if (rows.length !== 1) throw new Error(`Found ${rows.length} matching accounts. No password changed; account lookup needs repair.`)
    const user = rows[0]
    if (!user.is_active) throw new Error('Your account is INACTIVE. No password changed; account activation needs review.')
    const hash = await bcrypt.hash(password, 12)
    await saveBackup(backupRoot, user)
    const changed = await client.query(`UPDATE atec.tblusers SET password=$1,
      must_change_password=false, auth_version=auth_version+1, updated_at=now()
      WHERE userid=$2 AND is_active=TRUE RETURNING password, auth_version`, [hash, user.userid])
    if (changed.rows.length !== 1 || !await bcrypt.compare(password, changed.rows[0].password) ||
        Number(changed.rows[0].auth_version) <= Number(user.auth_version)) {
      throw new Error('Password recovery verification failed. Changes rolled back.')
    }
    await client.query(`INSERT INTO atec.audit_log (user_id, action, module, record_id, details)
      VALUES ($1,'PASSWORD_RESET','users',$2,$3)`, [user.userid, String(user.userid),
      JSON.stringify({ method: 'owner-requested authenticated server recovery', account: EMAIL })])
    await client.query('COMMIT')
    return { userid: user.userid, username: user.username }
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
}

async function main() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0 ||
      fs.realpathSync(process.cwd()) !== '/var/www/atec/ATEC') {
    throw new Error('Run this as root from /var/www/atec/ATEC on the ATEC server.')
  }
  if (!process.stdin.isTTY) throw new Error('Run the saved script directly in PuTTY so password entry is private.')
  const backend = path.join(process.cwd(), 'backend')
  require(path.join(backend, 'node_modules/dotenv')).config({ path: path.join(backend, '.env'), quiet: true })
  const bcrypt = require(path.join(backend, 'node_modules/bcryptjs'))
  const { Client } = require(path.join(backend, 'node_modules/pg'))
  const client = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 10000, application_name: 'atec-owner-account-recovery' })
  await client.connect()
  try {
    const result = await client.query(`SELECT userid, username, email, is_active,
      to_jsonb(u)->>'password_changed_at' AS password_changed_at
      FROM atec.tblusers u WHERE userid=4 AND lower(email)=$1
        AND lower(username)='jacques jonker'`, [EMAIL])
    if (result.rows.length !== 1) throw new Error(`Found ${result.rows.length} matching accounts. No password changed.`)
    const user = result.rows[0]
    console.log(`Account: ${user.username} (${user.email}), active: ${user.is_active}`)
    console.log(`Last recorded password change: ${user.password_changed_at || 'not recorded'}`)
    if (!user.is_active) throw new Error('Your account is INACTIVE. No password changed; account activation needs review.')
    const { Writable } = require('node:stream')
    const { createInterface } = require('node:readline/promises')
    const muted = new Writable({ write(chunk, encoding, callback) { callback() } })
    muted.isTTY = true; muted.columns = 80
    const terminal = createInterface({ input: process.stdin, output: muted, terminal: true })
    const controller = new AbortController()
    terminal.on('SIGINT', () => controller.abort())
    let password
    try {
      process.stdout.write('New ATEC password (typing is hidden): ')
      password = await terminal.question('', { signal: controller.signal })
      process.stdout.write('\nConfirm new password: ')
      const confirmation = await terminal.question('', { signal: controller.signal })
      process.stdout.write('\n')
      validatePassword(password, confirmation)
    } finally { terminal.close() }
    const recovered = await recover({ client, bcrypt, password, backupRoot: '/root/atec-account-recovery',
      saveBackup: async (folder, account) => {
        fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
        fs.chmodSync(folder, 0o700)
        fs.writeFileSync(path.join(folder, `jacques-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`),
          JSON.stringify(account), { mode: 0o600, flag: 'wx' })
      } })
    password = null
    console.log(`SUCCESS: Password reset for ${recovered.username}. No application deployment or restart required.`)
    console.log(`Sign in with ${EMAIL} and the new password you just entered. Replace any browser-filled old password.`)
  } finally { await client.end() }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { validatePassword, recover }
