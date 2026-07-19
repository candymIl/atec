const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")
const {
  summarizeBackupStatus
} = require("./backupStatus")

const DEFAULT_BACKUP_ROOT = "/var/www/atec/backups"
const DEFAULT_BACKUP_MAX_AGE_HOURS = 26
const DEFAULT_DISK_WARNING_PERCENT = 85
const DEFAULT_DISK_CRITICAL_PERCENT = 95
const DEFAULT_MEMORY_WARNING_PERCENT = 90

function positiveNumber(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function isoOrNull(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function runGit(projectRoot, args) {
  try {
    return execFileSync("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500
    }).trim()
  } catch (err) {
    return null
  }
}

function getGitInfo(projectRoot) {
  const commit = runGit(projectRoot, ["rev-parse", "HEAD"])
  const branch = runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
  const latestLocalCommit = runGit(projectRoot, ["rev-parse", "HEAD"])
  const status = runGit(projectRoot, ["status", "--porcelain"])

  return {
    available: Boolean(commit),
    commit: commit || "unavailable",
    branch: branch || "unavailable",
    latestLocalCommit: latestLocalCommit || "unavailable",
    workingTreeClean: status === null ? null : status.length === 0,
    status: commit
      ? (status && status.length ? "working tree has local changes" : "current locally")
      : "unverified"
  }
}

function fileInfo(folder, entry) {
  const fullPath = path.join(folder, entry)
  const stat = fs.statSync(fullPath)
  return stat.isFile()
    ? {
        filename: entry,
        modifiedAt: stat.mtime,
        sizeBytes: stat.size
      }
    : null
}

function newest(files) {
  return files
    .filter(Boolean)
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())[0] || null
}

function backupKind(filename) {
  const lower = filename.toLowerCase()
  if (/uploads|media|photos/.test(lower) && /\.(zip|tar|tgz|gz|7z)$/i.test(lower)) {
    return "uploads"
  }

  if (/\.(dump|backup|sql|sql\.gz|dump\.gz)$/i.test(lower)) {
    return "database"
  }

  return null
}

function getFlatFileBackupStatus(backupRoot, maxAgeHours, now = new Date()) {
  const entries = fs.readdirSync(backupRoot)
  const files = entries
    .map(entry => {
      try {
        return fileInfo(backupRoot, entry)
      } catch (err) {
        return null
      }
    })
    .filter(Boolean)

  const latestDatabaseBackup = newest(files.filter(file => backupKind(file.filename) === "database"))
  const latestUploadsBackup = newest(files.filter(file => backupKind(file.filename) === "uploads"))

  if (!latestDatabaseBackup) return null

  const ageHours = (now.getTime() - latestDatabaseBackup.modifiedAt.getTime()) / 3600000
  const withinExpectedAge = ageHours <= maxAgeHours

  return {
    directoryConfigured: backupRoot ? "configured" : "default",
    accessible: true,
    status: withinExpectedAge ? "Current" : "Overdue",
    expectedMaxAgeHours: maxAgeHours,
    latestBackupSetId: null,
    latestSuccessfulDatabaseBackupAt: latestDatabaseBackup.modifiedAt.toISOString(),
    latestSuccessfulMediaBackupAt: latestUploadsBackup?.modifiedAt.toISOString() || null,
    latestDatabaseBackup: {
      filename: latestDatabaseBackup.filename,
      modifiedAt: latestDatabaseBackup.modifiedAt.toISOString(),
      sizeBytes: latestDatabaseBackup.sizeBytes,
      ageHours: Math.round(ageHours * 10) / 10,
      withinExpectedAge
    },
    latestUploadsBackup: latestUploadsBackup
      ? {
          filename: latestUploadsBackup.filename,
          modifiedAt: latestUploadsBackup.modifiedAt.toISOString(),
          sizeBytes: latestUploadsBackup.sizeBytes
        }
      : null,
    backupAgeHours: Math.round(ageHours * 10) / 10,
    validation: { status: "not-run", timestamp: null, ageHours: null },
    restoreVerification: { status: "not-run", timestamp: null, ageHours: null },
    checksumStatus: "not-run",
    message: withinExpectedAge
      ? "Latest database backup is within the expected age (legacy flat-file format)."
      : "Latest database backup is older than the expected maximum age."
  }
}

function getBackupStatus(env = process.env, now = new Date()) {
  const backupRoot = env.ATEC_BACKUP_ROOT || env.BACKUP_ROOT || DEFAULT_BACKUP_ROOT
  const maxAgeHours = positiveNumber(
    env.BACKUP_MAX_AGE_HOURS,
    DEFAULT_BACKUP_MAX_AGE_HOURS,
    24 * 30
  )
  const manifestStatus = summarizeBackupStatus(env, now)
  let flatFileStatus = null

  try {
    flatFileStatus = getFlatFileBackupStatus(backupRoot, maxAgeHours, now)
  } catch (err) {
    flatFileStatus = null
  }

  const manifestBackupAt = new Date(manifestStatus.latestSuccessfulDatabaseBackupAt || 0).getTime()
  const flatFileBackupAt = new Date(flatFileStatus?.latestSuccessfulDatabaseBackupAt || 0).getTime()

  // Production may still use the original cron jobs, which write .dump and
  // media archives directly into the backup root. Do not let an older
  // manifest-based set hide a newer successful flat-file backup.
  if (flatFileStatus && flatFileBackupAt > manifestBackupAt) {
    return flatFileStatus
  }

  if (manifestStatus.latestBackupSetId || (manifestStatus.accessible && manifestStatus.status === "Critical")) {
    return {
      ...manifestStatus,
      directoryConfigured: backupRoot ? "configured" : "default",
      latestDatabaseBackup: manifestStatus.latestDatabaseBackup
        ? {
            ...manifestStatus.latestDatabaseBackup,
            modifiedAt: manifestStatus.latestSuccessfulDatabaseBackupAt,
            ageHours: manifestStatus.backupAgeHours,
            withinExpectedAge: manifestStatus.backupAgeHours !== null && manifestStatus.backupAgeHours <= maxAgeHours
          }
        : null,
      latestUploadsBackup: manifestStatus.latestUploadsBackup
        ? {
            ...manifestStatus.latestUploadsBackup,
            modifiedAt: manifestStatus.latestSuccessfulMediaBackupAt
          }
        : null
    }
  }

  if (flatFileStatus) return flatFileStatus

  const result = {
    directoryConfigured: backupRoot ? "configured" : "default",
    accessible: false,
    status: "Unknown",
    expectedMaxAgeHours: maxAgeHours,
    latestDatabaseBackup: null,
    latestUploadsBackup: null,
    message: ""
  }

  try {
    const entries = fs.readdirSync(backupRoot)
    const files = entries
      .map(entry => {
        try {
          return fileInfo(backupRoot, entry)
        } catch (err) {
          return null
        }
      })
      .filter(Boolean)

    result.accessible = true
    result.latestDatabaseBackup = newest(files.filter(file => backupKind(file.filename) === "database"))
    result.latestUploadsBackup = newest(files.filter(file => backupKind(file.filename) === "uploads"))

    if (result.latestDatabaseBackup) {
      const ageHours = (now.getTime() - result.latestDatabaseBackup.modifiedAt.getTime()) / 3600000
      result.latestDatabaseBackup = {
        filename: result.latestDatabaseBackup.filename,
        modifiedAt: result.latestDatabaseBackup.modifiedAt.toISOString(),
        sizeBytes: result.latestDatabaseBackup.sizeBytes,
        ageHours: Math.round(ageHours * 10) / 10,
        withinExpectedAge: ageHours <= maxAgeHours
      }
      result.status = result.latestDatabaseBackup.withinExpectedAge ? "Current" : "Overdue"
      result.message = result.latestDatabaseBackup.withinExpectedAge
        ? "Latest database backup is within the expected age."
        : "Latest database backup is older than the expected maximum age."
    } else {
      result.status = "Unknown"
      result.message = files.length
        ? "Backup directory is accessible, but no database backup file was found."
        : "Backup directory is accessible, but it is empty."
    }

    if (result.latestUploadsBackup) {
      result.latestUploadsBackup = {
        filename: result.latestUploadsBackup.filename,
        modifiedAt: result.latestUploadsBackup.modifiedAt.toISOString(),
        sizeBytes: result.latestUploadsBackup.sizeBytes
      }
    }
  } catch (err) {
    result.message = "Backup directory is not accessible from this server."
  }

  return result
}

function getDiskUsage(env = process.env, projectRoot = process.cwd()) {
  const warningPercent = positiveNumber(
    env.DISK_WARNING_PERCENT,
    DEFAULT_DISK_WARNING_PERCENT,
    100
  )
  const criticalPercent = positiveNumber(
    env.DISK_CRITICAL_PERCENT,
    DEFAULT_DISK_CRITICAL_PERCENT,
    100
  )
  const candidates = [
    env.ATEC_BACKUP_ROOT,
    env.BACKUP_ROOT,
    DEFAULT_BACKUP_ROOT,
    projectRoot
  ].filter(Boolean)
  const targetPath = candidates.find(candidate => {
    try {
      return fs.existsSync(candidate)
    } catch (err) {
      return false
    }
  }) || projectRoot

  try {
    const stats = fs.statfsSync(targetPath)
    const totalBytes = stats.blocks * stats.bsize
    const availableBytes = stats.bavail * stats.bsize
    const usedBytes = Math.max(0, totalBytes - availableBytes)
    const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0
    const status = usedPercent >= criticalPercent
      ? "Critical"
      : usedPercent >= warningPercent
        ? "Low space"
        : "Healthy"

    return {
      status,
      checkedPathLabel: targetPath === projectRoot ? "application filesystem" : "backup filesystem",
      totalBytes,
      availableBytes,
      usedBytes,
      usedPercent: Math.round(usedPercent * 10) / 10,
      thresholds: {
        warningPercent,
        criticalPercent
      }
    }
  } catch (err) {
    return {
      status: "Unknown",
      checkedPathLabel: "unavailable",
      totalBytes: null,
      availableBytes: null,
      usedBytes: null,
      usedPercent: null,
      thresholds: {
        warningPercent,
        criticalPercent
      }
    }
  }
}

function getMemoryStatus(env = process.env) {
  const warningPercent = positiveNumber(
    env.MEMORY_WARNING_PERCENT,
    DEFAULT_MEMORY_WARNING_PERCENT,
    100
  )
  const totalBytes = os.totalmem()
  const freeBytes = os.freemem()
  const usedPercent = totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : 0

  return {
    status: usedPercent >= warningPercent ? "Warning" : "Healthy",
    totalBytes,
    freeBytes,
    usedPercent: Math.round(usedPercent * 10) / 10,
    thresholdWarningPercent: warningPercent
  }
}

function getServerInfo(port, env = process.env) {
  const memory = getMemoryStatus(env)

  return {
    status: memory.status,
    platform: os.platform(),
    hostname: os.hostname(),
    processId: process.pid,
    processMemory: process.memoryUsage(),
    systemMemory: {
      totalBytes: memory.totalBytes,
      freeBytes: memory.freeBytes,
      usedPercent: memory.usedPercent,
      status: memory.status,
      thresholdWarningPercent: memory.thresholdWarningPercent
    },
    systemUptimeSeconds: Math.round(os.uptime()),
    cpuLoadAverage: os.loadavg(),
    applicationUptimeSeconds: Math.round(process.uptime()),
    configuredPort: String(port || env.PORT || 5000)
  }
}

async function getDatabaseInfo(pool, env = process.env) {
  const startedAt = Date.now()
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        version() AS postgres_version
    `)
    const elapsedMs = Date.now() - startedAt

    return {
      status: "Connected",
      databaseName: result.rows[0]?.database_name || env.DB_NAME || "unknown",
      schemaName: env.DB_SCHEMA || "atec",
      postgresVersion: result.rows[0]?.postgres_version || "unknown",
      responseTimeMs: elapsedMs,
      pool: {
        max: pool.options?.max || null,
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      }
    }
  } catch (err) {
    return {
      status: "Failed",
      databaseName: env.DB_NAME || "unknown",
      schemaName: env.DB_SCHEMA || "atec",
      postgresVersion: "unavailable",
      responseTimeMs: null,
      pool: {
        max: pool.options?.max || null,
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      },
      message: "Database health check failed."
    }
  }
}

function deploymentStatus(gitInfo, env = process.env) {
  const frontendBuildId = env.FRONTEND_BUILD_ID || env.VITE_BUILD_ID || "unavailable"
  const backendBuildId = env.BUILD_ID || gitInfo.commit
  const identifiersMatch = frontendBuildId !== "unavailable" &&
    backendBuildId !== "unavailable" &&
    frontendBuildId === backendBuildId

  return {
    status: gitInfo.available ? "Current locally" : "Unverified",
    runningGitCommit: gitInfo.commit,
    latestLocalGitCommit: gitInfo.latestLocalCommit,
    gitBranch: gitInfo.branch,
    workingTreeClean: gitInfo.workingTreeClean,
    frontendBuildIdentifier: frontendBuildId,
    backendBuildIdentifier: backendBuildId,
    identifiersMatch
  }
}

function overallStatus({ database, backup, disk, server, deployment }) {
  if (database.status !== "Connected") return "Warning"
  if (disk.status === "Critical") return "Warning"
  if (backup.status === "Overdue") return "Warning"
  if (server.status === "Warning") return "Warning"
  if (deployment.status === "Unverified") return "Warning"
  return "Healthy"
}

function safePerformanceInfo(performance = null) {
  if (!performance) {
    return {
      checkedAt: new Date().toISOString(),
      slowRequestThresholdMs: null,
      totalRequests: 0,
      slowRequests: 0,
      recentRequestCount: 0,
      recentSlowRequestCount: 0,
      recentAverageMs: 0,
      recentMaxMs: 0,
      lastSlowRequest: null
    }
  }

  return {
    checkedAt: performance.checkedAt,
    slowRequestThresholdMs: performance.slowRequestThresholdMs,
    totalRequests: performance.totalRequests,
    slowRequests: performance.slowRequests,
    recentRequestCount: performance.recentRequestCount,
    recentSlowRequestCount: performance.recentSlowRequestCount,
    recentAverageMs: performance.recentAverageMs,
    recentMaxMs: performance.recentMaxMs,
    lastSlowRequest: performance.lastSlowRequest
      ? {
          method: performance.lastSlowRequest.method,
          route: performance.lastSlowRequest.route,
          status: performance.lastSlowRequest.status,
          elapsedMs: performance.lastSlowRequest.elapsedMs,
          at: performance.lastSlowRequest.at
        }
      : null
  }
}

function safePdfInfo(pdf = null) {
  return {
    concurrency: pdf?.concurrency ?? null,
    maxBulkCertificates: pdf?.maxBulkCertificates ?? null,
    active: pdf?.active ?? 0,
    queued: pdf?.queued ?? 0,
    completed: pdf?.completed ?? 0,
    failed: pdf?.failed ?? 0
  }
}

async function buildSystemInfo(options = {}) {
  const {
    pool,
    performance = null,
    pdf = null,
    projectRoot = path.resolve(__dirname, "..", ".."),
    env = process.env,
    startedAt = new Date(),
    port = env.PORT || 5000,
    appVersion = "1.0.0",
    activeUsers = { windowMinutes: 10, count: 0, users: [] }
  } = options

  const git = getGitInfo(projectRoot)
  const database = await getDatabaseInfo(pool, env)
  const backup = getBackupStatus(env)
  const disk = getDiskUsage(env, projectRoot)
  const server = getServerInfo(port, env)
  const deployment = deploymentStatus(git, env)
  const application = {
    name: "ATEC",
    version: appVersion,
    gitCommit: git.commit,
    gitBranch: git.branch,
    buildOrDeploymentDate: isoOrNull(env.BUILD_DATE || env.DEPLOYED_AT) || "unavailable",
    backendStartTime: isoOrNull(startedAt),
    backendUptimeSeconds: Math.round((Date.now() - new Date(startedAt).getTime()) / 1000),
    nodeVersion: process.version,
    environment: env.NODE_ENV || "development"
  }

  return {
    checkedAt: new Date().toISOString(),
    overallStatus: overallStatus({ database, backup, disk, server, deployment }),
    thresholds: {
      backupMaxAgeHours: backup.expectedMaxAgeHours,
      diskWarningPercent: disk.thresholds.warningPercent,
      diskCriticalPercent: disk.thresholds.criticalPercent,
      memoryWarningPercent: server.systemMemory.thresholdWarningPercent
    },
    application,
    database,
    server,
    disk,
    backup,
    deployment,
    performance: safePerformanceInfo(performance),
    pdf: safePdfInfo(pdf),
    activeUsers
  }
}

module.exports = {
  DEFAULT_BACKUP_MAX_AGE_HOURS,
  DEFAULT_BACKUP_ROOT,
  DEFAULT_DISK_CRITICAL_PERCENT,
  DEFAULT_DISK_WARNING_PERCENT,
  DEFAULT_MEMORY_WARNING_PERCENT,
  backupKind,
  buildSystemInfo,
  deploymentStatus,
  getBackupStatus,
  getDiskUsage,
  getGitInfo,
  getMemoryStatus,
  overallStatus,
  positiveNumber,
  safePerformanceInfo,
  safePdfInfo
}
