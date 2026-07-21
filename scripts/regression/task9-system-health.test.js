const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")

const {
  buildSystemInfo,
  getBackupStatus,
  getDiskUsage,
  getGitInfo,
  positiveNumber
} = require("../../backend/services/systemInfo")

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`))
}

function writeFileWithMtime(folder, filename, content, mtime) {
  const filePath = path.join(folder, filename)
  fs.writeFileSync(filePath, content)
  fs.utimesSync(filePath, mtime, mtime)
  return filePath
}

async function main() {
  const now = new Date()
  const backupDir = makeTempDir("atec-task9-backups")
  const staleBackupDir = makeTempDir("atec-task9-stale-backups")
  const emptyBackupDir = makeTempDir("atec-task9-empty-backups")
  const notGitDir = makeTempDir("atec-task9-no-git")

  writeFileWithMtime(
    backupDir,
    "fbcranes-20260714.dump",
    "database-backup",
    new Date(now.getTime() - 90 * 60 * 1000)
  )
  writeFileWithMtime(
    backupDir,
    "uploads-20260714.zip",
    "uploads-backup",
    new Date(now.getTime() - 75 * 60 * 1000)
  )
  writeFileWithMtime(
    staleBackupDir,
    "fbcranes-20260710.dump",
    "old-database-backup",
    new Date(now.getTime() - 96 * 60 * 60 * 1000)
  )

  const currentBackup = getBackupStatus({
    ATEC_BACKUP_ROOT: backupDir,
    BACKUP_MAX_AGE_HOURS: "26"
  }, now)
  assert.strictEqual(currentBackup.accessible, true)
  assert.strictEqual(currentBackup.status, "Current")
  assert.strictEqual(currentBackup.latestDatabaseBackup.filename, "fbcranes-20260714.dump")
  assert.strictEqual(currentBackup.latestDatabaseBackup.withinExpectedAge, true)
  assert.strictEqual(currentBackup.latestUploadsBackup.filename, "uploads-20260714.zip")

  const staleBackup = getBackupStatus({
    ATEC_BACKUP_ROOT: staleBackupDir,
    BACKUP_MAX_AGE_HOURS: "26"
  }, now)
  assert.strictEqual(staleBackup.status, "Overdue")
  assert.strictEqual(staleBackup.latestDatabaseBackup.withinExpectedAge, false)

  const emptyBackup = getBackupStatus({
    ATEC_BACKUP_ROOT: emptyBackupDir
  }, now)
  assert.strictEqual(emptyBackup.accessible, true)
  assert.strictEqual(emptyBackup.status, "Unknown")
  assert.match(emptyBackup.message, /empty/)

  const missingBackup = getBackupStatus({
    ATEC_BACKUP_ROOT: path.join(emptyBackupDir, "missing")
  }, now)
  assert.strictEqual(missingBackup.accessible, false)
  assert.strictEqual(missingBackup.status, "Unknown")

  const noGit = getGitInfo(notGitDir)
  assert.strictEqual(noGit.available, false)
  assert.strictEqual(noGit.commit, "unavailable")
  assert.strictEqual(noGit.workingTreeClean, null)

  assert.strictEqual(positiveNumber("12", 1, 20), 12)
  assert.strictEqual(positiveNumber("bad", 7, 20), 7)
  assert.strictEqual(positiveNumber("-5", 7, 20), 7)
  assert.strictEqual(positiveNumber("500", 7, 20), 20)

  const diskWarning = getDiskUsage({
    ATEC_BACKUP_ROOT: backupDir,
    DISK_WARNING_PERCENT: "0.1",
    DISK_CRITICAL_PERCENT: "99.9"
  }, notGitDir)
  assert(["Healthy", "Low space"].includes(diskWarning.status))

  const diskCritical = getDiskUsage({
    ATEC_BACKUP_ROOT: backupDir,
    DISK_WARNING_PERCENT: "0.1",
    DISK_CRITICAL_PERCENT: "0.1"
  }, notGitDir)
  assert.strictEqual(diskCritical.status, "Critical")

  const fakePool = {
    totalCount: 3,
    idleCount: 2,
    waitingCount: 0,
    async query() {
      return {
        rows: [{
          database_name: "fbcranes",
          postgres_version: "PostgreSQL test"
        }]
      }
    }
  }

  const payload = await buildSystemInfo({
    pool: fakePool,
    projectRoot: notGitDir,
    env: {
      NODE_ENV: "test",
      DB_NAME: "fbcranes",
      DB_SCHEMA: "atec",
      DB_PASSWORD: "should-not-appear",
      JWT_SECRET: "should-not-appear",
      SMTP_PASS: "should-not-appear",
      ATEC_BACKUP_ROOT: backupDir,
      BACKUP_MAX_AGE_HOURS: "72",
      BUILD_DATE: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    },
    startedAt: new Date(now.getTime() - 60 * 60 * 1000),
    port: 5000,
    appVersion: "1.0.0"
  })

  assert.strictEqual(payload.database.status, "Connected")
  assert.strictEqual(payload.database.databaseName, "fbcranes")
  assert.strictEqual(payload.database.schemaName, "atec")
  assert.strictEqual(payload.backup.status, "Current")
  assert.strictEqual(payload.deployment.status, "Unverified")
  const serialized = JSON.stringify(payload)
  assert(!serialized.includes("should-not-appear"))
  assert(!serialized.includes(backupDir))

  const failingPool = {
    totalCount: 1,
    idleCount: 0,
    waitingCount: 0,
    async query() {
      throw new Error("database unavailable")
    }
  }
  const failedPayload = await buildSystemInfo({
    pool: failingPool,
    projectRoot: notGitDir,
    env: { DB_NAME: "fbcranes", DB_SCHEMA: "atec", ATEC_BACKUP_ROOT: backupDir },
    startedAt: new Date(),
    port: 5000
  })
  assert.strictEqual(failedPayload.database.status, "Failed")

  const serverSource = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "server.js"), "utf8")
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "main.js"), "utf8")
  assert(serverSource.includes('app.get("/health"'))
  assert(serverSource.includes('app.get("/admin/system-info"'))
  assert(serverSource.indexOf('app.use(requireAuth)') < serverSource.indexOf('app.get("/admin/system-info"'))
  assert(serverSource.includes('if (req.user.role !== "ADMIN")'))
  assert(mainSource.includes("'system-health': ['ADMIN']"))
  assert(mainSource.includes("System Health"))
  assert(mainSource.includes("showSystemHealth"))

  fs.rmSync(backupDir, { recursive: true, force: true })
  fs.rmSync(staleBackupDir, { recursive: true, force: true })
  fs.rmSync(emptyBackupDir, { recursive: true, force: true })
  fs.rmSync(notGitDir, { recursive: true, force: true })

  console.log("Task 9 system health regression checks passed.")
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
