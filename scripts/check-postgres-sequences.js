const path = require("path")

const backendDir = path.join(__dirname, "..", "backend")
const dotenv = require(path.join(backendDir, "node_modules", "dotenv"))
const { Pool } = require(path.join(backendDir, "node_modules", "pg"))

dotenv.config({ path: path.join(backendDir, ".env"), quiet: true })

const args = new Set(process.argv.slice(2))
const schemaArg = process.argv.find(arg => arg.startsWith("--schema="))
const schema = schemaArg ? schemaArg.split("=").slice(1).join("=") : process.env.DB_SCHEMA || "atec"
const jsonOutput = args.has("--json")

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

function qualifiedName(schemaName, objectName) {
  return `${quoteIdent(schemaName)}.${quoteIdent(objectName)}`
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function statusFor(row) {
  if (row.max_id === null) return "UNUSED"
  return row.sequence_next_value <= row.max_id ? "BEHIND" : "HEALTHY"
}

function pad(value, width) {
  return String(value ?? "").padEnd(width, " ")
}

function printTable(rows) {
  const headers = [
    ["status", 8],
    ["table.column", 38],
    ["sequence", 42],
    ["rows", 8],
    ["max_id", 12],
    ["last_value", 12],
    ["is_called", 10],
    ["next_now", 12],
    ["expected_next", 14]
  ]

  console.log(headers.map(([name, width]) => pad(name, width)).join("  "))
  console.log(headers.map(([, width]) => "-".repeat(width)).join("  "))

  for (const row of rows) {
    const values = [
      row.status,
      `${row.table_schema}.${row.table_name}.${row.column_name}`,
      `${row.sequence_schema}.${row.sequence_name}`,
      row.row_count,
      row.max_id ?? "-",
      row.sequence_last_value ?? "-",
      row.sequence_is_called,
      row.sequence_next_value ?? "-",
      row.expected_next_value ?? "-"
    ]

    console.log(values.map((value, index) => pad(value, headers[index][1])).join("  "))
  }
}

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: "atec-sequence-health-checker",
    max: 2,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 30000)
  })

  try {
    const { rows: sequenceColumns } = await pool.query(
      `
        SELECT
          table_ns.nspname AS table_schema,
          table_cls.relname AS table_name,
          attr.attname AS column_name,
          seq_ns.nspname AS sequence_schema,
          seq_cls.relname AS sequence_name,
          seq_info.start_value,
          seq_info.increment_by
        FROM pg_class AS seq_cls
        JOIN pg_namespace AS seq_ns
          ON seq_ns.oid = seq_cls.relnamespace
        JOIN pg_depend AS dep
          ON dep.objid = seq_cls.oid
         AND dep.deptype IN ('a', 'i')
        JOIN pg_class AS table_cls
          ON table_cls.oid = dep.refobjid
        JOIN pg_namespace AS table_ns
          ON table_ns.oid = table_cls.relnamespace
        JOIN pg_attribute AS attr
          ON attr.attrelid = table_cls.oid
         AND attr.attnum = dep.refobjsubid
        LEFT JOIN pg_sequences AS seq_info
          ON seq_info.schemaname = seq_ns.nspname
         AND seq_info.sequencename = seq_cls.relname
        WHERE seq_cls.relkind = 'S'
          AND table_ns.nspname = $1
          AND table_cls.relkind IN ('r', 'p')
        ORDER BY table_ns.nspname, table_cls.relname, attr.attnum
      `,
      [schema]
    )

    const results = []

    for (const item of sequenceColumns) {
      const tableRef = qualifiedName(item.table_schema, item.table_name)
      const columnRef = quoteIdent(item.column_name)
      const sequenceRef = qualifiedName(item.sequence_schema, item.sequence_name)

      const [{ rows: maxRows }, { rows: sequenceRows }] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::bigint AS row_count, MAX(${columnRef})::numeric AS max_id FROM ${tableRef}`
        ),
        pool.query(
          `SELECT last_value::numeric AS last_value, is_called FROM ${sequenceRef}`
        )
      ])

      const rowCount = Number(maxRows[0].row_count || 0)
      const maxId = toNumberOrNull(maxRows[0].max_id)
      const lastValue = toNumberOrNull(sequenceRows[0].last_value)
      const incrementBy = Number(item.increment_by || 1)
      const startValue = Number(item.start_value || 1)
      const isCalled = Boolean(sequenceRows[0].is_called)
      const sequenceNextValue = lastValue === null
        ? null
        : isCalled
          ? lastValue + incrementBy
          : lastValue
      const expectedNextValue = maxId === null ? startValue : maxId + incrementBy

      const result = {
        table_schema: item.table_schema,
        table_name: item.table_name,
        column_name: item.column_name,
        sequence_schema: item.sequence_schema,
        sequence_name: item.sequence_name,
        row_count: rowCount,
        max_id: maxId,
        sequence_last_value: lastValue,
        sequence_is_called: isCalled,
        sequence_next_value: sequenceNextValue,
        expected_next_value: expectedNextValue,
        increment_by: incrementBy,
        start_value: startValue
      }

      result.status = statusFor(result)
      results.push(result)
    }

    if (jsonOutput) {
      console.log(JSON.stringify({ schema, checked_at: new Date().toISOString(), sequences: results }, null, 2))
    } else {
      console.log(`ATEC PostgreSQL sequence health check`)
      console.log(`Schema: ${schema}`)
      console.log(`Checked: ${new Date().toISOString()}`)
      console.log("")
      printTable(results)
      console.log("")
      console.log(`Summary: ${results.length} checked, ${results.filter(row => row.status === "BEHIND").length} behind, ${results.filter(row => row.status === "UNUSED").length} unused.`)
    }
  } finally {
    await pool.end()
  }
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
