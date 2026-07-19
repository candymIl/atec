const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const rootDir = path.join(__dirname, "..")
const backendDir = path.join(rootDir, "backend")
const databaseDir = path.join(rootDir, "database")
const manifestPath = path.join(rootDir, "deployment", "production-migrations.json")

const dotenv = require(path.join(backendDir, "node_modules", "dotenv"))
const { Client } = require(path.join(backendDir, "node_modules", "pg"))

dotenv.config({ path: path.join(backendDir, ".env"), quiet: true })

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

function checksum(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex")
}

function transactionBody(contents) {
  return contents
    .replace(/^\s*BEGIN\s*;\s*/i, "")
    .replace(/\s*COMMIT\s*;\s*$/i, "")
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  const schema = process.env.DB_SCHEMA || manifest.schema || "atec"
  const schemaIdent = quoteIdent(schema)
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: "atec-production-migrator",
    statement_timeout: Number(process.env.DB_MIGRATION_TIMEOUT_MS || 120000),
    query_timeout: Number(process.env.DB_MIGRATION_TIMEOUT_MS || 120000)
  })

  await client.connect()
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ${schemaIdent}.schema_migrations (
      migration_name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by text NOT NULL DEFAULT current_user,
      notes text
    )`)

    for (const migrationName of manifest.migrations) {
      if (path.basename(migrationName) !== migrationName || !migrationName.endsWith(".sql")) {
        throw new Error(`Invalid production migration name: ${migrationName}`)
      }

      const migrationPath = path.join(databaseDir, migrationName)
      const contents = fs.readFileSync(migrationPath, "utf8")
      const fileChecksum = checksum(contents)
      const tracked = await client.query(
        `SELECT checksum FROM ${schemaIdent}.schema_migrations WHERE migration_name = $1`,
        [migrationName]
      )

      if (tracked.rows[0]) {
        if (tracked.rows[0].checksum !== fileChecksum) {
          throw new Error(`Checksum mismatch for already-applied migration ${migrationName}`)
        }
        console.log(`Already applied: ${migrationName}`)
        continue
      }

      console.log(`Applying: ${migrationName}`)
      await client.query("BEGIN")
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('atec-production-migrations'))")
        await client.query(transactionBody(contents))
        await client.query(
          `INSERT INTO ${schemaIdent}.schema_migrations (migration_name, checksum, notes)
           VALUES ($1, $2, 'Applied by deployment automation')`,
          [migrationName, fileChecksum]
        )
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
      console.log(`Applied successfully: ${migrationName}`)
    }
  } finally {
    await client.end()
  }
}

main().catch(error => {
  console.error(`ERROR: Production migration failed: ${error.message || error}`)
  process.exitCode = 1
})
