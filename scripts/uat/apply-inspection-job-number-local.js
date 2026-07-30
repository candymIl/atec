const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const projectRoot = path.resolve(__dirname, "..", "..")
const backendRoot = path.join(projectRoot, "backend")
const dotenv = require(path.join(backendRoot, "node_modules", "dotenv"))
const { Client } = require(path.join(backendRoot, "node_modules", "pg"))

dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true })

const migrationName = "2026-07-30-inspection-job-number.sql"
const migrationContents = fs.readFileSync(path.join(projectRoot, "database", migrationName), "utf8")
const migrationSql = migrationContents
  .replace(/^\s*BEGIN\s*;\s*/i, "")
  .replace(/\s*COMMIT\s*;\s*$/i, "")
const migrationChecksum = crypto.createHash("sha256").update(migrationContents).digest("hex")

function isLocalHost(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host || "").toLowerCase())
}

async function main() {
  if (!isLocalHost(process.env.DB_HOST) || process.env.NODE_ENV === "production") {
    throw new Error("Refusing to apply the inspection Job Number migration outside a local development database.")
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: "atec-inspection-job-number-local-uat"
  })

  await client.connect()
  try {
    await client.query("BEGIN")
    await client.query(migrationSql)
    await client.query(
      `INSERT INTO atec.schema_migrations (migration_name, checksum, notes)
       VALUES ($1, $2, 'Applied for local inspection Job Number UAT')
       ON CONFLICT (migration_name) DO UPDATE
       SET checksum=EXCLUDED.checksum, notes=EXCLUDED.notes`,
      [migrationName, migrationChecksum]
    )
    await client.query("COMMIT")
    console.log("Local inspection Job Number migration applied and recorded.")
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
