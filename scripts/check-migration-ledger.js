const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const rootDir = path.join(__dirname, "..")
const backendDir = path.join(rootDir, "backend")
const databaseDir = path.join(rootDir, "database")

const dotenv = require(path.join(backendDir, "node_modules", "dotenv"))
const { Pool } = require(path.join(backendDir, "node_modules", "pg"))

dotenv.config({ path: path.join(backendDir, ".env"), quiet: true })

const args = new Set(process.argv.slice(2))
const schemaArg = process.argv.find(arg => arg.startsWith("--schema="))
const schema = schemaArg ? schemaArg.split("=").slice(1).join("=") : process.env.DB_SCHEMA || "atec"
const jsonOutput = args.has("--json")

function checksumFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
}

function pad(value, width) {
  return String(value ?? "").padEnd(width, " ")
}

function migrationFiles() {
  return fs
    .readdirSync(databaseDir)
    .filter(file => file.toLowerCase().endsWith(".sql"))
    .sort()
    .map(file => ({
      migration_name: file,
      checksum: checksumFile(path.join(databaseDir, file))
    }))
}

function statusFor(file, ledgerMissing, ledgerRow) {
  if (ledgerMissing) return "LEDGER MISSING"
  if (!ledgerRow) return "UNTRACKED"
  if (ledgerRow.checksum !== file.checksum) {
    if (String(ledgerRow.notes || "").startsWith("Production baseline:")) {
      return "BASELINE DRIFT"
    }
    return "CHECKSUM MISMATCH"
  }
  return "TRACKED"
}

function printTable(rows) {
  const headers = [
    ["status", 20],
    ["migration", 72],
    ["checksum", 64],
    ["applied_at", 24],
    ["notes", 48]
  ]

  console.log(headers.map(([name, width]) => pad(name, width)).join("  "))
  console.log(headers.map(([, width]) => "-".repeat(width)).join("  "))

  for (const row of rows) {
    const values = [
      row.status,
      row.migration_name,
      row.checksum,
      row.applied_at || "",
      row.notes || ""
    ]

    console.log(values.map((value, index) => pad(value, headers[index][1])).join("  "))
  }
}

async function main() {
  const files = migrationFiles()
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: "atec-migration-ledger-checker",
    max: 1,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 30000)
  })

  try {
    const ledgerExistsResult = await pool.query(
      `
        SELECT to_regclass($1) IS NOT NULL AS exists
      `,
      [`${schema}.schema_migrations`]
    )

    const ledgerMissing = !ledgerExistsResult.rows[0].exists
    let ledgerRows = new Map()

    if (!ledgerMissing) {
      const result = await pool.query(
        `
          SELECT
            migration_name,
            checksum,
            applied_at,
            applied_by,
            notes
          FROM ${quoteIdent(schema)}.schema_migrations
          ORDER BY migration_name
        `
      )

      ledgerRows = new Map(result.rows.map(row => [row.migration_name, row]))
    }

    const report = files.map(file => {
      const ledgerRow = ledgerRows.get(file.migration_name)
      return {
        ...file,
        status: statusFor(file, ledgerMissing, ledgerRow),
        applied_at: ledgerRow?.applied_at ? new Date(ledgerRow.applied_at).toISOString() : null,
        applied_by: ledgerRow?.applied_by || null,
        notes: ledgerRow?.notes || null
      }
    })

    const extraLedgerRows = [...ledgerRows.values()]
      .filter(row => !files.some(file => file.migration_name === row.migration_name))
      .map(row => ({
        migration_name: row.migration_name,
        checksum: row.checksum,
        status: "TRACKED FILE MISSING",
        applied_at: row.applied_at ? new Date(row.applied_at).toISOString() : null,
        applied_by: row.applied_by || null,
        notes: row.notes || null
      }))

    const combinedReport = [...report, ...extraLedgerRows]

    if (jsonOutput) {
      console.log(JSON.stringify({ schema, ledger_missing: ledgerMissing, migrations: combinedReport }, null, 2))
    } else {
      console.log("ATEC migration ledger check")
      console.log(`Schema: ${schema}`)
      console.log(`Ledger: ${ledgerMissing ? "MISSING" : `${schema}.schema_migrations`}`)
      console.log("")
      printTable(combinedReport)
      console.log("")
      console.log(
        `Summary: ${combinedReport.filter(row => row.status === "TRACKED").length} tracked, ` +
        `${combinedReport.filter(row => row.status === "BASELINE DRIFT").length} baseline drift, ` +
        `${combinedReport.filter(row => row.status === "UNTRACKED").length} untracked, ` +
        `${combinedReport.filter(row => row.status === "CHECKSUM MISMATCH").length} checksum mismatch, ` +
        `${combinedReport.filter(row => row.status === "LEDGER MISSING").length} ledger missing.`
      )
    }
  } finally {
    await pool.end()
  }
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
