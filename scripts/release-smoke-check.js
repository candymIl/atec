const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const backendRoot = path.join(root, "backend")
const dotenv = require(path.join(backendRoot, "node_modules", "dotenv"))
const { Client } = require(path.join(backendRoot, "node_modules", "pg"))
const { resolveUploadRoot } = require(path.join(backendRoot, "services", "runtimeConfig"))
const { summarizeBackupStatus } = require(path.join(backendRoot, "services", "backupStatus"))

dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true })

const checks = []

function record(name, status, detail) {
  checks.push({ name, status, detail })
}

function configured(name) {
  return Boolean(String(process.env[name] || "").trim())
}

function chromiumCandidates() {
  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome"
  ].filter(Boolean)
}

async function checkDatabase() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: "atec-release-smoke-check",
    statement_timeout: 10000,
    query_timeout: 10000
  })

  try {
    await client.connect()
    const result = await client.query(
      "SELECT current_database() AS database_name, to_regnamespace($1) IS NOT NULL AS schema_exists",
      [process.env.DB_SCHEMA || "atec"]
    )
    const row = result.rows[0]
    record(
      "database",
      row.schema_exists ? "PASS" : "FAIL",
      row.schema_exists
        ? `Connected to ${row.database_name}; schema exists`
        : `Connected to ${row.database_name}; schema is missing`
    )
  } catch (error) {
    record("database", "FAIL", error.message)
  } finally {
    await client.end().catch(() => {})
  }
}

async function checkBackend() {
  const port = Number(process.env.PORT || 5000)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`)
    const body = await response.text()
    record(
      "backend",
      response.ok && /ATEC backend is running/i.test(body) ? "PASS" : "FAIL",
      `HTTP ${response.status}`
    )
  } catch (error) {
    record("backend", "FAIL", error.message)
  }
}

function checkUploads() {
  try {
    const storage = resolveUploadRoot({
      env: process.env,
      projectRoot: root,
      backendRoot
    })
    const exists = fs.existsSync(storage.path)
    const expected = ["assets", "inspections", "signatures", "job-cards"]
    const missing = expected.filter(folder => !fs.existsSync(path.join(storage.path, folder)))
    const healthy = exists && !storage.insideWorkspace && missing.length === 0
    record(
      "uploads",
      healthy ? "PASS" : "FAIL",
      healthy
        ? "External upload root and expected folders are present"
        : `exists=${exists}; insideWorkspace=${storage.insideWorkspace}; missing=${missing.join(",") || "none"}`
    )
  } catch (error) {
    record("uploads", "FAIL", error.message)
  }
}

function checkBackup() {
  try {
    const status = summarizeBackupStatus(process.env)
    record(
      "backup",
      status.status === "Healthy" ? "PASS" : "FAIL",
      `${status.status}: ${status.message}`
    )
  } catch (error) {
    record("backup", "FAIL", error.message)
  }
}

function checkSmtp() {
  const provider = String(process.env.MAIL_PROVIDER || "smtp").trim().toLowerCase()
  const required = provider === "graph"
    ? ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_SENDER"]
    : ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"]
  const missing = required.filter(name => !configured(name))
  record(
    "mail-config",
    missing.length === 0 ? "PASS" : "FAIL",
    missing.length === 0
      ? `${provider} settings are present; use npm run mail:verify to test authentication`
      : `Missing ${missing.join(", ")}`
  )
}

function checkPdfBrowser() {
  const executable = chromiumCandidates().find(candidate => fs.existsSync(candidate))
  record(
    "pdf-browser",
    executable ? "PASS" : "FAIL",
    executable ? `Browser engine found: ${path.basename(executable)}` : "No Chrome/Edge/Chromium executable found"
  )
}

async function main() {
  checkUploads()
  checkBackup()
  checkSmtp()
  checkPdfBrowser()
  await checkDatabase()
  await checkBackend()

  console.log("ATEC release smoke check")
  console.table(checks)

  const failures = checks.filter(check => check.status === "FAIL")
  if (failures.length > 0) {
    process.exitCode = 1
    console.error(`Smoke check failed: ${failures.map(check => check.name).join(", ")}`)
    return
  }

  console.log("All release smoke checks passed.")
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
