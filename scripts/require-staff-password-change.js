// Preview by default. Apply only after the live scope and deployment have been approved.
const path = require("node:path")
const crypto = require("node:crypto")
const { Client } = require("../backend/node_modules/pg")
require("../backend/node_modules/dotenv").config({ path: path.resolve(__dirname, "../backend/.env"), quiet: true })
const campaign = "2026-09-28-staff-password-change"
const args = process.argv.slice(2)
const value = name => args[args.indexOf(name) + 1]
const applying = args.includes("--apply")
const scopeSql = `SELECT userid, username, COALESCE(NULLIF(fullname,''),username) AS full_name,
  COALESCE(role, CASE userlevel WHEN 1 THEN 'ADMIN' WHEN 2 THEN 'MANAGER'
    WHEN 3 THEN 'INSPECTOR' WHEN 5 THEN 'CUSTOMER' ELSE 'VIEWER' END) AS role,
  auth_version, must_change_password
  FROM atec.tblusers WHERE is_active = TRUE AND clientid IS NULL
  AND COALESCE(role, CASE userlevel WHEN 1 THEN 'ADMIN' WHEN 2 THEN 'MANAGER'
    WHEN 3 THEN 'INSPECTOR' WHEN 5 THEN 'CUSTOMER' ELSE 'VIEWER' END)
    IN ('ADMIN','MANAGER','INSPECTOR','ASSISTANT','HR','VIEWER') ORDER BY userid`

async function main() {
  const actor = Number(value("--actor"))
  if (applying && (!args.includes("--expected-sha") || !/^[a-f0-9]{64}$/.test(value("--expected-sha")) || !args.includes("--actor") || !Number.isInteger(actor) || actor < 1)) {
    throw new Error("Apply requires the reviewed --expected-sha and an active administrator --actor ID.")
  }
  const db = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 5000, statement_timeout: 30000, application_name: "atec-staff-password-campaign" })
  await db.connect()
  try {
    await db.query(applying ? "BEGIN" : "BEGIN READ ONLY")
    if (applying) await db.query("LOCK TABLE atec.tblusers IN SHARE ROW EXCLUSIVE MODE")
    const previous = await db.query("SELECT count(*)::int AS count FROM atec.audit_log WHERE action = 'PASSWORD_CHANGE_REQUIRED' AND details->>'campaign' = $1", [campaign])
    if (previous.rows[0].count) {
      console.log(JSON.stringify({ campaign, alreadyActivated: true, enrolled: previous.rows[0].count }))
      await db.query("ROLLBACK")
      return
    }
    const scope = (await db.query(scopeSql)).rows
    const target = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME }
    const sha = crypto.createHash("sha256").update(JSON.stringify({ target, campaign, scope })).digest("hex")
    if (!applying) {
      console.log(JSON.stringify({ target, campaign, count: scope.length, expectedSha: sha, scope }, null, 2))
      await db.query("ROLLBACK")
      return
    }
    if (!scope.length || sha !== value("--expected-sha")) throw new Error("Staff scope changed or is empty. Preview and review again.")
    if (!scope.some(user => Number(user.userid) === actor && user.role === "ADMIN")) throw new Error("Actor must be an active internal administrator in the reviewed scope.")
    const changed = await db.query(`UPDATE atec.tblusers SET must_change_password=TRUE,
      auth_version=auth_version+1, updated_at=now() WHERE userid=ANY($1::integer[]) RETURNING userid`, [scope.map(user=>user.userid)])
    if (changed.rowCount !== scope.length) throw new Error("Unexpected changed account count")
    for (const user of scope) {
      await db.query(`INSERT INTO atec.audit_log (user_id,action,module,record_id,details)
        VALUES ($1,'PASSWORD_CHANGE_REQUIRED','users',$2,$3)`,
      [actor, String(user.userid), JSON.stringify({ campaign, scope_sha: sha, previous_auth_version: user.auth_version })])
    }
    await db.query("COMMIT")
    console.log(JSON.stringify({ campaign, activated: true, count: changed.rowCount, scopeSha: sha }))
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {})
    throw error
  } finally { await db.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
