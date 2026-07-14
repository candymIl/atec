const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const DEFAULT_BACKUP_ROOT = "/var/www/atec/backups"
const DEFAULT_BACKUP_MAX_AGE_HOURS = 26
const DEFAULT_BACKUP_VERIFY_MAX_AGE_HOURS = 30
const DEFAULT_RESTORE_VERIFY_MAX_AGE_HOURS = 24 * 8
const DEFAULT_DAILY_RETENTION_DAYS = 14
const DEFAULT_WEEKLY_RETENTION_WEEKS = 8
const DEFAULT_MONTHLY_RETENTION_MONTHS = 12
const DEFAULT_RESTORE_VERIFY_DB_PREFIX = "atec_restore_verify_"

function positiveNumber(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function utcTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function backupSetId(date = new Date()) {
  return `atec-${utcTimestamp(date)}`
}

function safeError(err) {
  return String(err?.message || err || "Unknown error")
    .replace(/(password|db_password|jwt_secret|smtp_pass|secret|token)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .slice(0, 300)
}

function configuredBackupRoot(env = process.env) {
  return env.ATEC_BACKUP_ROOT || env.BACKUP_ROOT || DEFAULT_BACKUP_ROOT
}

function safeResolveInside(root, candidate) {
  if (!root || !candidate) {
    throw new Error("Backup path is not configured")
  }

  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(resolvedRoot, candidate)
  const relative = path.relative(resolvedRoot, resolvedCandidate)

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Unsafe backup path outside backup root")
  }

  return resolvedCandidate
}

function isAtecBackupSetName(name) {
  return /^atec-\d{8}T?\d{6}Z?$/.test(name) || /^atec-\d{8}-\d{6}$/.test(name)
}

function manifestName() {
  return "manifest.json"
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function writeJsonAtomic(filePath, payload) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" })
  fs.renameSync(tempPath, filePath)
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256")
  const fd = fs.openSync(filePath, "r")
  const buffer = Buffer.alloc(1024 * 1024)

  try {
    let bytesRead = 0
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(fd)
  }

  return hash.digest("hex")
}

function fileRecord(root, filename) {
  if (!filename) return null
  const filePath = safeResolveInside(root, filename)
  const stat = fs.statSync(filePath)
  return {
    filename,
    sizeBytes: stat.size,
    sha256: sha256File(filePath)
  }
}

function statusTimestamp(status) {
  return status?.timestamp || status?.completedAt || status?.createdAt || null
}

function ageHours(value, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Math.round(((now.getTime() - date.getTime()) / 3600000) * 10) / 10
}

function normalizeManifest(manifest, setFolder = null) {
  return {
    backupSetId: manifest.backupSetId || manifest.setId || path.basename(setFolder || ""),
    createdAt: manifest.createdAt || manifest.created_at || null,
    status: manifest.status || "unknown",
    retentionCategory: manifest.retentionCategory || null,
    backupScriptVersion: manifest.backupScriptVersion || manifest.scriptVersion || null,
    database: manifest.database || null,
    media: manifest.media || manifest.uploads || null,
    validation: manifest.validation || { status: "not-run", timestamp: null },
    restoreVerification: manifest.restoreVerification || { status: "not-run", timestamp: null },
    retention: manifest.retention || { status: "not-run", timestamp: null },
    lastFailure: manifest.lastFailure || null,
    nextScheduledBackup: manifest.nextScheduledBackup || null,
    folderName: setFolder ? path.basename(setFolder) : null
  }
}

function loadBackupManifests(backupRoot) {
  const root = path.resolve(backupRoot)
  const manifests = []

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!isAtecBackupSetName(entry.name)) continue

    const folder = safeResolveInside(root, entry.name)
    const stat = fs.lstatSync(folder)
    if (stat.isSymbolicLink()) continue

    const manifestPath = path.join(folder, manifestName())
    if (!fs.existsSync(manifestPath)) continue

    try {
      manifests.push({
        folder,
        manifestPath,
        manifest: normalizeManifest(readJson(manifestPath), folder)
      })
    } catch (err) {
      manifests.push({
        folder,
        manifestPath,
        manifest: normalizeManifest({
          backupSetId: entry.name,
          status: "failed",
          lastFailure: safeError(err)
        }, folder)
      })
    }
  }

  return manifests.sort((a, b) => {
    const aDate = new Date(a.manifest.createdAt || 0).getTime()
    const bDate = new Date(b.manifest.createdAt || 0).getTime()
    return bDate - aDate
  })
}

function successful(manifest) {
  return manifest.status === "success" || manifest.status === "completed"
}

function fileSummary(file) {
  if (!file) return null
  return {
    filename: file.filename || null,
    sizeBytes: file.sizeBytes || file.bytes || 0,
    sha256: file.sha256 ? "recorded" : "missing"
  }
}

function checksumStatus(manifest) {
  const validation = manifest.validation || {}
  if (validation.checksumStatus) return validation.checksumStatus
  if (validation.status === "success") return "verified"
  if (validation.status === "failed") return "failed"
  return "not-run"
}

function summarizeBackupStatus(env = process.env, now = new Date()) {
  const backupRoot = configuredBackupRoot(env)
  const maxAgeHours = positiveNumber(env.BACKUP_MAX_AGE_HOURS, DEFAULT_BACKUP_MAX_AGE_HOURS, 24 * 30)
  const verifyMaxAgeHours = positiveNumber(env.BACKUP_VERIFY_MAX_AGE_HOURS, DEFAULT_BACKUP_VERIFY_MAX_AGE_HOURS, 24 * 30)
  const restoreMaxAgeHours = positiveNumber(env.RESTORE_VERIFY_MAX_AGE_HOURS, DEFAULT_RESTORE_VERIFY_MAX_AGE_HOURS, 24 * 60)
  const result = {
    accessible: false,
    status: "Unknown",
    expectedMaxAgeHours: maxAgeHours,
    latestBackupSetId: null,
    latestSuccessfulDatabaseBackupAt: null,
    latestSuccessfulMediaBackupAt: null,
    latestDatabaseBackup: null,
    latestUploadsBackup: null,
    backupAgeHours: null,
    validation: { status: "not-run", timestamp: null, ageHours: null },
    restoreVerification: { status: "not-run", timestamp: null, ageHours: null },
    checksumStatus: "not-run",
    lastBackupDurationMs: null,
    retention: { status: "not-run", timestamp: null },
    lastFailure: null,
    nextScheduledBackup: env.BACKUP_NEXT_SCHEDULED_AT || null,
    message: ""
  }

  try {
    const manifests = loadBackupManifests(backupRoot)
    result.accessible = true

    const latestSuccessful = manifests.map(item => item.manifest).find(successful)
    if (!latestSuccessful) {
      result.status = manifests.length ? "Critical" : "Unknown"
      result.message = manifests.length
        ? "Backup manifests exist, but no successful backup set was found."
        : "Backup directory is accessible, but no ATEC backup manifest was found."
      result.lastFailure = manifests[0]?.manifest?.lastFailure || null
      return result
    }

    result.latestBackupSetId = latestSuccessful.backupSetId
    result.latestSuccessfulDatabaseBackupAt = latestSuccessful.database?.createdAt || latestSuccessful.createdAt
    result.latestSuccessfulMediaBackupAt = latestSuccessful.media?.createdAt || latestSuccessful.createdAt
    result.latestDatabaseBackup = fileSummary(latestSuccessful.database)
    result.latestUploadsBackup = fileSummary(latestSuccessful.media)
    result.backupAgeHours = ageHours(result.latestSuccessfulDatabaseBackupAt, now)
    result.validation = {
      status: latestSuccessful.validation?.status || "not-run",
      timestamp: statusTimestamp(latestSuccessful.validation),
      ageHours: ageHours(statusTimestamp(latestSuccessful.validation), now)
    }
    result.restoreVerification = {
      status: latestSuccessful.restoreVerification?.status || "not-run",
      timestamp: statusTimestamp(latestSuccessful.restoreVerification),
      ageHours: ageHours(statusTimestamp(latestSuccessful.restoreVerification), now)
    }
    result.checksumStatus = checksumStatus(latestSuccessful)
    result.lastBackupDurationMs = latestSuccessful.durationMs || latestSuccessful.database?.durationMs || null
    result.retention = latestSuccessful.retention || { status: "not-run", timestamp: null }
    result.lastFailure = latestSuccessful.lastFailure || null

    const validationOld = result.validation.status !== "success" ||
      result.validation.ageHours === null ||
      result.validation.ageHours > verifyMaxAgeHours
    const restoreFailed = result.restoreVerification.status === "failed"
    const restoreOverdue = result.restoreVerification.status === "success" &&
      result.restoreVerification.ageHours !== null &&
      result.restoreVerification.ageHours > restoreMaxAgeHours

    if (
      result.backupAgeHours === null ||
      result.backupAgeHours > maxAgeHours ||
      result.checksumStatus === "failed" ||
      restoreFailed
    ) {
      result.status = "Critical"
      result.message = restoreFailed
        ? "Restore verification failed."
        : "Latest backup is missing, too old, failed validation, or has a checksum problem."
    } else if (
      result.backupAgeHours > maxAgeHours * 0.8 ||
      validationOld ||
      restoreOverdue ||
      result.restoreVerification.status === "not-run"
    ) {
      result.status = "Warning"
      result.message = "Backup exists, but validation or restore-verification evidence needs attention."
    } else {
      result.status = "Healthy"
      result.message = "Latest backup, validation, and restore-verification evidence are current."
    }
  } catch (err) {
    result.status = "Critical"
    result.message = "Backup directory is not accessible from this server."
    result.lastFailure = safeError(err)
  }

  return result
}

function assertSafeRestoreDatabaseName(name, env = process.env) {
  const value = String(name || "").trim()
  const productionNames = new Set([
    String(env.DB_NAME || "").toLowerCase(),
    "fbcranes",
    "postgres",
    "template0",
    "template1"
  ].filter(Boolean))
  const prefix = env.RESTORE_VERIFY_DB_PREFIX || DEFAULT_RESTORE_VERIFY_DB_PREFIX

  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value)) {
    throw new Error("Restore verification database name is unsafe")
  }

  if (!value.startsWith(prefix)) {
    throw new Error(`Restore verification database must start with ${prefix}`)
  }

  if (productionNames.has(value.toLowerCase())) {
    throw new Error("Refusing to use a production-like database name for restore verification")
  }

  return value
}

function retentionConfig(env = process.env) {
  return {
    dailyDays: positiveNumber(env.BACKUP_DAILY_RETENTION_DAYS, DEFAULT_DAILY_RETENTION_DAYS, 366),
    weeklyWeeks: positiveNumber(env.BACKUP_WEEKLY_RETENTION_WEEKS, DEFAULT_WEEKLY_RETENTION_WEEKS, 260),
    monthlyMonths: positiveNumber(env.BACKUP_MONTHLY_RETENTION_MONTHS, DEFAULT_MONTHLY_RETENTION_MONTHS, 120)
  }
}

function retentionCategory(createdAt, now = new Date(), config = retentionConfig()) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return "invalid"

  const ageDays = (now.getTime() - date.getTime()) / 86400000
  if (ageDays <= config.dailyDays) return "daily"
  if (ageDays <= config.weeklyWeeks * 7) return "weekly"
  if (ageDays <= config.monthlyMonths * 31) return "monthly"
  return "expired"
}

function retentionPlan(backupRoot, options = {}) {
  const now = options.now || new Date()
  const config = options.config || retentionConfig(options.env || process.env)
  const apply = Boolean(options.apply)
  const entries = loadBackupManifests(backupRoot).filter(item => successful(item.manifest))
  const newestSuccessful = entries[0]?.manifest?.backupSetId || null
  const plan = []

  for (const item of entries) {
    const category = retentionCategory(item.manifest.createdAt, now, config)
    const canDelete = category === "expired" &&
      item.manifest.backupSetId !== newestSuccessful &&
      entries.length > 1

    plan.push({
      backupSetId: item.manifest.backupSetId,
      folderName: path.basename(item.folder),
      category,
      action: canDelete ? (apply ? "delete" : "would-delete") : "retain",
      reason: canDelete ? "outside retention policy" : "newest, only successful, or still within policy"
    })
  }

  return {
    dryRun: !apply,
    newestSuccessfulBackupSetId: newestSuccessful,
    successfulBackupCount: entries.length,
    actions: plan
  }
}

module.exports = {
  DEFAULT_BACKUP_MAX_AGE_HOURS,
  DEFAULT_BACKUP_ROOT,
  DEFAULT_BACKUP_VERIFY_MAX_AGE_HOURS,
  DEFAULT_DAILY_RETENTION_DAYS,
  DEFAULT_MONTHLY_RETENTION_MONTHS,
  DEFAULT_RESTORE_VERIFY_DB_PREFIX,
  DEFAULT_RESTORE_VERIFY_MAX_AGE_HOURS,
  DEFAULT_WEEKLY_RETENTION_WEEKS,
  assertSafeRestoreDatabaseName,
  backupSetId,
  configuredBackupRoot,
  fileRecord,
  isAtecBackupSetName,
  loadBackupManifests,
  manifestName,
  retentionCategory,
  retentionConfig,
  retentionPlan,
  safeError,
  safeResolveInside,
  sha256File,
  summarizeBackupStatus,
  utcTimestamp,
  writeJsonAtomic
}
