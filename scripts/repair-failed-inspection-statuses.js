const path = require("path")

const backendDir = path.join(__dirname, "..", "backend")
const dotenv = require(path.join(backendDir, "node_modules", "dotenv"))
const { Pool } = require(path.join(backendDir, "node_modules", "pg"))

dotenv.config({ path: path.join(backendDir, ".env"), quiet: true })

const testIdArg = process.argv.find(arg => arg.startsWith("--testid="))
const testid = testIdArg ? Number(testIdArg.split("=").slice(1).join("=")) : null

if (testIdArg && (!Number.isInteger(testid) || testid <= 0)) {
  console.error("Use --testid=<positive number> when limiting the repair to one certificate.")
  process.exit(1)
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
})

async function main() {
  const values = []
  const testIdFilter = testid ? "AND i.testid = $1" : ""
  if (testid) values.push(testid)

  const result = await pool.query(
    `
    UPDATE atec.tblinspection i
    SET status = 'NOT SAFE'
    WHERE COALESCE(i.status, '') <> 'NOT SAFE'
      ${testIdFilter}
      AND EXISTS (
        SELECT 1
        FROM atec.tblinspectionresult r
        WHERE r.testid = i.testid
          AND (
            UPPER(TRIM(COALESCE(r.result, ''))) IN ('FAIL', 'NO', 'NOT SAFE', 'UNSAFE')
            OR UPPER(TRIM(COALESCE(r.measuredvalue, ''))) IN ('FAIL', 'NO', 'NOT SAFE', 'UNSAFE')
          )
      )
    RETURNING i.testid, i.assetid, i.inspectiontype, i.status
    `,
    values
  )

  if (!result.rows.length) {
    console.log("No inspection statuses needed repair.")
    return
  }

  console.log(`Repaired ${result.rows.length} inspection status row(s):`)
  for (const row of result.rows) {
    console.log(`${row.testid} ${row.inspectiontype || "-"} asset ${row.assetid || "-"} -> ${row.status}`)
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
