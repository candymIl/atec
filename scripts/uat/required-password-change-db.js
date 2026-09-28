const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { Client } = require("../../backend/node_modules/pg")
require("../../backend/node_modules/dotenv").config({ path: path.resolve(__dirname, "../../backend/.env"), quiet: true })

async function main() {
  if (!["localhost", "127.0.0.1", "::1"].includes(process.env.DB_HOST) || process.env.NODE_ENV === "production") {
    throw new Error("This rollback-only test requires a local development database.")
  }
  const client = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectionTimeoutMillis: 5000 })
  await client.connect()
  const schema = `password_uat_${crypto.randomBytes(6).toString("hex")}`
  const migration = fs.readFileSync(path.resolve(__dirname, "../../database/2026-09-28-required-password-change.sql"), "utf8")
    .replace(/^BEGIN;/m, "").replace(/^COMMIT;/m, "").replaceAll("atec.", `${schema}.`)
  try {
    await client.query("BEGIN")
    await client.query(`CREATE SCHEMA ${schema}`)
    await client.query(`CREATE TABLE ${schema}.tblusers (userid integer PRIMARY KEY, role text, userlevel integer, password text, is_active boolean)`)
    await client.query(`INSERT INTO ${schema}.tblusers VALUES (1,'ADMIN',1,'old',true),(2,'CUSTOMER',5,'customer',true),(3,NULL,3,'legacy',true),(4,NULL,5,'legacy-customer',true)`)
    await client.query(migration)
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${schema}.tblusers WHERE must_change_password`)).rows[0].n, 0)
    await client.query(`UPDATE ${schema}.tblusers SET must_change_password=true, auth_version=auth_version+1 WHERE userid=1`)
    await client.query(migration)
    assert.equal((await client.query(`SELECT must_change_password FROM ${schema}.tblusers WHERE userid=1`)).rows[0].must_change_password, true)
    await client.query(`UPDATE ${schema}.tblusers SET password='new',must_change_password=false WHERE userid=1 AND password='old' AND auth_version=1`)
    const staff = (await client.query(`SELECT * FROM ${schema}.tblusers WHERE userid=1`)).rows[0]
    assert.equal(staff.auth_version, 2)
    assert.equal(staff.must_change_password, false)
    assert(staff.password_changed_at)
    assert.equal((await client.query(`UPDATE ${schema}.tblusers SET password='stale' WHERE userid=1 AND password='old' AND auth_version=1 RETURNING userid`)).rowCount, 0)
    await client.query(`UPDATE ${schema}.tblusers SET password='admin-reset' WHERE userid=1`)
    assert.equal((await client.query(`SELECT auth_version FROM ${schema}.tblusers WHERE userid=1`)).rows[0].auth_version, 3)
    await client.query(`UPDATE ${schema}.tblusers SET password='changed' WHERE userid IN (2,3,4)`)
    const versions = (await client.query(`SELECT auth_version FROM ${schema}.tblusers ORDER BY userid`)).rows.map(r=>r.auth_version)
    assert.deepEqual(versions, [3,0,1,0])
    console.log("Database migration/trigger tests passed: default-off, idempotent schema, staff password versioning, compare-and-set, legacy roles and customer exclusion. All fixtures rolled back.")
  } finally {
    await client.query("ROLLBACK")
    await client.end()
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
