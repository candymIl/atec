const fs = require("fs")
const path = require("path")

const rootDir = path.join(__dirname, "..")
const backendDir = path.join(rootDir, "backend")
const contractPath = path.join(rootDir, "deployment", "production-schema-contract.json")

const dotenv = require(path.join(backendDir, "node_modules", "dotenv"))
const { Pool } = require(path.join(backendDir, "node_modules", "pg"))

dotenv.config({ path: path.join(backendDir, ".env"), quiet: true })

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

async function main() {
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"))
  const schema = process.env.DB_SCHEMA || contract.schema || "atec"
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: "atec-production-schema-check",
    max: 1,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 30000)
  })

  try {
    const result = await pool.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = $1`,
      [schema]
    )
    const columnsByTable = new Map()
    for (const row of result.rows) {
      if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set())
      columnsByTable.get(row.table_name).add(row.column_name)
    }

    const failures = []
    for (const requirement of contract.requirements) {
      const available = columnsByTable.get(requirement.table)
      const missingColumns = requirement.columns.filter(column => !available?.has(column))
      if (missingColumns.length) failures.push({ ...requirement, missingColumns })
    }

    if (failures.length) {
      console.error("ERROR: Production database schema is not compatible with this release.")
      for (const failure of failures) {
        console.error(`- ${quoteIdent(schema)}.${quoteIdent(failure.table)} missing: ${failure.missingColumns.join(", ")}`)
        console.error(`  Required migration: database/${failure.migration}`)
      }
      console.error("Deployment stopped before the backend restart. Apply the listed migrations, rerun this check, then deploy again.")
      process.exitCode = 1
      return
    }

    console.log(`Production schema check passed (${contract.requirements.length} requirements).`)
  } finally {
    await pool.end()
  }
}

main().catch(error => {
  console.error(`ERROR: Production schema check could not complete: ${error.message || error}`)
  process.exitCode = 1
})
