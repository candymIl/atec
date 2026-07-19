const fs = require("fs")
const path = require("path")
const dotenv = require("../backend/node_modules/dotenv")

dotenv.config({ path: path.join(__dirname, "../backend/.env"), override: true })

const pool = require("../backend/db")

async function main() {
  const migrationPath = path.join(
    __dirname,
    "../database/2026-07-18-task16-customer-notification-preferences.sql"
  )
  const sql = fs.readFileSync(migrationPath, "utf8")
  const expectedColumns = [
    "notify_expiring_certificates",
    "notify_overdue_assets",
    "notify_failed_assets",
    "notify_visit_exceptions",
    "notification_lead_days"
  ]

  await pool.query(sql)

  const result = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
      AND column_name = ANY($3)
    ORDER BY column_name
    `,
    ["atec", "tblclients", expectedColumns]
  )

  const appliedColumns = result.rows.map(row => row.column_name)
  const missingColumns = expectedColumns.filter(column => !appliedColumns.includes(column))

  if (missingColumns.length > 0) {
    throw new Error(`Migration did not create columns: ${missingColumns.join(", ")}`)
  }

  console.log(`Task 16 migration applied: ${appliedColumns.join(", ")}`)
}

main()
  .catch(err => {
    console.error(err.message)
    process.exitCode = 1
  })
  .finally(() => pool.end())
