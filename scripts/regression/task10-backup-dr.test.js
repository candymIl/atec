const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")

const {
  assertSafeRestoreDatabaseName,
  backupSetId,
  retentionPlan,
  safeResolveInside,
  summarizeBackupStatus,
  writeJsonAtomic
} = require("../../backend/services/backupStatus")
const { buildSystemInfo, getBackupStatus } = require("../../backend/services/systemInfo")
const { applyRetention, parseArgs } = require("../atec-backup")

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`))
}

function writeManifest(root, folderName, manifest) {
  const folder = path.join(root, folderName)
  fs.mkdirSync(folder, { recursive: true })
  writeJsonAtomic(path.join(folder, "manifest.json"), manifest)
  return folder
}

function successfulManifest(id, createdAt, overrides = {}) {
  return {
    backupSetId: id,
    createdAt,
    status: "success",
    database: {
      filename: `fbcranes-${id}.dump`,
      sizeBytes: 1234,
      sha256: "abc",
      createdAt
    },
    media: {
      filename: `media-${id}.tar.gz`,
      sizeBytes: 5678,
      sha256: "def",
      createdAt
    },
    validation: {
      status: "success",
      timestamp: createdAt,
      checksumStatus: "verified"
    },
    restoreVerification: {
      status: "success",
      timestamp: createdAt
    },
    retention: {
      status: "not-run",
      timestamp: null
    },
    ...overrides
  }
}

async function main() {
  const root = tempDir("atec-task10")
  const now = new Date("2026-07-14T10:00:00.000Z")
  const currentId = "atec-20260714T080000Z"
  writeManifest(root, currentId, successfulManifest(currentId, "2026-07-14T08:00:00.000Z"))

  const healthy = summarizeBackupStatus({
    ATEC_BACKUP_ROOT: root,
    BACKUP_MAX_AGE_HOURS: "26",
    BACKUP_VERIFY_MAX_AGE_HOURS: "30",
    RESTORE_VERIFY_MAX_AGE_HOURS: "192"
  }, now)
  assert.strictEqual(healthy.status, "Healthy")
  assert.strictEqual(healthy.latestBackupSetId, currentId)
  assert.strictEqual(healthy.checksumStatus, "verified")
  assert.strictEqual(healthy.latestDatabaseBackup.sizeBytes, 1234)
  assert.strictEqual(healthy.latestUploadsBackup.sizeBytes, 5678)

  const failedRoot = tempDir("atec-task10-failed")
  writeManifest(failedRoot, "atec-20260714T070000Z", {
    backupSetId: "atec-20260714T070000Z",
    createdAt: "2026-07-14T07:00:00.000Z",
    status: "failed",
    lastFailure: "pg_dump failed"
  })
  const failedStatus = summarizeBackupStatus({ ATEC_BACKUP_ROOT: failedRoot }, now)
  assert.strictEqual(failedStatus.status, "Critical")
  assert.match(failedStatus.message, /no successful backup/i)

  const oldRoot = tempDir("atec-task10-old")
  writeManifest(oldRoot, "atec-20260710T080000Z", successfulManifest(
    "atec-20260710T080000Z",
    "2026-07-10T08:00:00.000Z"
  ))
  const oldStatus = summarizeBackupStatus({ ATEC_BACKUP_ROOT: oldRoot, BACKUP_MAX_AGE_HOURS: "26" }, now)
  assert.strictEqual(oldStatus.status, "Critical")

  const mixedRoot = tempDir("atec-task10-mixed")
  writeManifest(mixedRoot, "atec-20260714T080000Z", successfulManifest(
    "atec-20260714T080000Z",
    "2026-07-14T08:00:00.000Z"
  ))
  const newerFlatDump = path.join(mixedRoot, "fbcranes-20260718-2200.dump")
  const newerFlatMedia = path.join(mixedRoot, "uploads-20260718-2215.tar.gz")
  fs.writeFileSync(newerFlatDump, "database backup")
  fs.writeFileSync(newerFlatMedia, "media backup")
  const newerTime = new Date("2026-07-18T20:00:00.000Z")
  fs.utimesSync(newerFlatDump, newerTime, newerTime)
  fs.utimesSync(newerFlatMedia, newerTime, newerTime)
  const mixedStatus = getBackupStatus(
    { ATEC_BACKUP_ROOT: mixedRoot, BACKUP_MAX_AGE_HOURS: "26" },
    new Date("2026-07-19T10:00:00.000Z")
  )
  assert.strictEqual(mixedStatus.status, "Current")
  assert.strictEqual(mixedStatus.latestDatabaseBackup.filename, "fbcranes-20260718-2200.dump")
  assert.match(mixedStatus.message, /legacy flat-file format/i)

  const restoreFailedRoot = tempDir("atec-task10-restore-failed")
  writeManifest(restoreFailedRoot, "atec-20260714T060000Z", successfulManifest(
    "atec-20260714T060000Z",
    "2026-07-14T06:00:00.000Z",
    { restoreVerification: { status: "failed", timestamp: "2026-07-14T07:00:00.000Z" } }
  ))
  assert.strictEqual(summarizeBackupStatus({ ATEC_BACKUP_ROOT: restoreFailedRoot }, now).status, "Critical")

  const incompleteRoot = tempDir("atec-task10-incomplete")
  fs.mkdirSync(path.join(incompleteRoot, "atec-20260714T080000Z"))
  fs.writeFileSync(path.join(incompleteRoot, "atec-20260714T080000Z", "fbcranes.dump.tmp"), "partial")
  const incomplete = summarizeBackupStatus({ ATEC_BACKUP_ROOT: incompleteRoot }, now)
  assert.notStrictEqual(incomplete.status, "Healthy")

  assert.throws(() => safeResolveInside(root, "../outside.dump"), /outside backup root/)
  assert.throws(() => assertSafeRestoreDatabaseName("fbcranes", { DB_NAME: "fbcranes" }), /must start|production/i)
  assert.throws(() => assertSafeRestoreDatabaseName("atec_restore_test", { RESTORE_VERIFY_DB_PREFIX: "atec_restore_verify_" }), /must start/)
  assert.strictEqual(
    assertSafeRestoreDatabaseName("atec_restore_verify_20260714", { DB_NAME: "fbcranes", RESTORE_VERIFY_DB_PREFIX: "atec_restore_verify_" }),
    "atec_restore_verify_20260714"
  )

  const retentionRoot = tempDir("atec-task10-retention")
  const newestId = "atec-20260714T080000Z"
  const expiredId = "atec-20240101T080000Z"
  writeManifest(retentionRoot, newestId, successfulManifest(newestId, "2026-07-14T08:00:00.000Z"))
  writeManifest(retentionRoot, expiredId, successfulManifest(expiredId, "2024-01-01T08:00:00.000Z"))
  const dryPlan = retentionPlan(retentionRoot, { now })
  assert.strictEqual(dryPlan.dryRun, true)
  assert(dryPlan.actions.some(action => action.backupSetId === expiredId && action.action === "would-delete"))
  assert(dryPlan.actions.some(action => action.backupSetId === newestId && action.action === "retain"))

  const onlyRoot = tempDir("atec-task10-only")
  writeManifest(onlyRoot, expiredId, successfulManifest(expiredId, "2024-01-01T08:00:00.000Z"))
  const onlyPlan = retentionPlan(onlyRoot, { now })
  assert.strictEqual(onlyPlan.actions[0].action, "retain")

  assert.deepStrictEqual(parseArgs(["backup:retention"]).apply, undefined)
  assert.deepStrictEqual(
    parseArgs([
      "backup:restore-verify",
      "--database=atec_restore_verify_manual",
      "--skip-create"
    ]),
    {
      _: ["backup:restore-verify"],
      database: "atec_restore_verify_manual",
      "skip-create": true
    }
  )
  process.env.ATEC_BACKUP_ROOT = onlyRoot
  const appliedDryRun = applyRetention({})
  assert.strictEqual(appliedDryRun.dryRun, true)

  const fakePool = {
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    async query() {
      return { rows: [{ database_name: "fbcranes", postgres_version: "PostgreSQL test" }] }
    }
  }
  const systemInfo = await buildSystemInfo({
    pool: fakePool,
    projectRoot: tempDir("atec-task10-git"),
    env: {
      ATEC_BACKUP_ROOT: root,
      DB_NAME: "fbcranes",
      DB_SCHEMA: "atec",
      DB_PASSWORD: "do-not-leak",
      JWT_SECRET: "do-not-leak",
      SMTP_PASS: "do-not-leak"
    }
  })
  const serialized = JSON.stringify(systemInfo)
  assert(!serialized.includes("do-not-leak"))
  assert(!serialized.includes(root))
  assert.strictEqual(systemInfo.backup.latestBackupSetId, currentId)

  const serverSource = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "server.js"), "utf8")
  const backupSource = fs.readFileSync(path.join(__dirname, "..", "atec-backup.js"), "utf8")
  assert(serverSource.indexOf('app.use(requireAuth)') < serverSource.indexOf('app.get("/admin/system-info"'))
  assert(serverSource.includes('if (req.user.role !== "ADMIN")'))
  assert(serverSource.includes('app.get("/health"'))
  assert(backupSource.includes('...(skipCreate ? ["--clean", "--if-exists"] : [])'))

  const docs = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "backup-and-disaster-recovery.md"), "utf8")
  assert(docs.includes("RESTORE_VERIFY_DB_PREFIX"))
  assert(docs.includes("--skip-create"))
  assert(docs.includes("--database="))
  assert(docs.includes("Offsite Copy"))
  assert(docs.includes("Full Server Loss Runbook"))

  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(failedRoot, { recursive: true, force: true })
  fs.rmSync(oldRoot, { recursive: true, force: true })
  fs.rmSync(mixedRoot, { recursive: true, force: true })
  fs.rmSync(restoreFailedRoot, { recursive: true, force: true })
  fs.rmSync(incompleteRoot, { recursive: true, force: true })
  fs.rmSync(retentionRoot, { recursive: true, force: true })
  fs.rmSync(onlyRoot, { recursive: true, force: true })

  console.log("Task 10 backup and disaster recovery regression checks passed.")
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
