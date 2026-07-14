#!/usr/bin/env node
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")

require("../backend/node_modules/dotenv").config({
  path: path.join(__dirname, "..", "backend", ".env"),
  quiet: true
})

const {
  assertSafeRestoreDatabaseName,
  backupSetId,
  configuredBackupRoot,
  fileRecord,
  loadBackupManifests,
  manifestName,
  retentionPlan,
  safeError,
  safeResolveInside,
  summarizeBackupStatus,
  writeJsonAtomic
} = require("../backend/services/backupStatus")

const SCRIPT_VERSION = "task10-v1"

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) {
      args._.push(arg)
      continue
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2)
    if (inlineValue !== undefined) {
      args[key] = inlineValue
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[key] = argv[index + 1]
      index += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function ensureDir(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
}

function withLock(name, fn) {
  const root = configuredBackupRoot()
  const lockRoot = process.env.BACKUP_LOCK_DIR || path.join(root, ".locks")
  ensureDir(lockRoot)
  const lockPath = path.join(lockRoot, `${name}.lock`)

  let fd
  try {
    fd = fs.openSync(lockPath, "wx")
    fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`)
  } catch (err) {
    throw new Error(`Another ${name} job appears to be running`)
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (fd !== undefined) fs.closeSync(fd)
      fs.rmSync(lockPath, { force: true })
    })
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
      ...options
    })
    let stderr = ""

    child.stderr.on("data", chunk => {
      stderr += chunk.toString()
    })

    child.on("error", reject)
    child.on("close", code => {
      const durationMs = Date.now() - startedAt
      if (code === 0) {
        resolve({ code, durationMs })
      } else {
        reject(new Error(`${command} failed with exit code ${code}: ${safeError(stderr)}`))
      }
    })
  })
}

function backupRoot() {
  const root = configuredBackupRoot()
  ensureDir(root)
  return root
}

function createSetFolder(setId) {
  if (!/^atec-[A-Za-z0-9TZ-]+$/.test(setId)) {
    throw new Error("Unsafe backup set ID")
  }
  const folder = safeResolveInside(backupRoot(), setId)
  ensureDir(folder)
  return folder
}

function readManifest(folder) {
  return JSON.parse(fs.readFileSync(path.join(folder, manifestName()), "utf8"))
}

function writeManifest(folder, manifest) {
  writeJsonAtomic(path.join(folder, manifestName()), manifest)
}

function initialManifest(setId) {
  return {
    backupSetId: setId,
    createdAt: new Date().toISOString(),
    status: "running",
    backupScriptVersion: SCRIPT_VERSION,
    database: null,
    media: null,
    validation: { status: "not-run", timestamp: null },
    restoreVerification: { status: "not-run", timestamp: null },
    retention: { status: "not-run", timestamp: null },
    lastFailure: null
  }
}

async function backupDatabase(args = {}) {
  return withLock("database-backup", async () => {
    const setId = args.setId || backupSetId()
    const folder = createSetFolder(setId)
    const manifestPath = path.join(folder, manifestName())
    const manifest = fs.existsSync(manifestPath) ? readManifest(folder) : initialManifest(setId)
    const dbName = process.env.DB_NAME
    const dbHost = process.env.DB_HOST || "127.0.0.1"
    const dbPort = process.env.DB_PORT || "5432"
    const dbUser = process.env.DB_USER

    if (!dbName || !dbUser) {
      throw new Error("DB_NAME and DB_USER are required for database backup")
    }

    const filename = `${dbName}-${setId}.dump`
    const tempFilename = `${filename}.tmp`
    const finalPath = safeResolveInside(folder, filename)
    const tempPath = safeResolveInside(folder, tempFilename)
    const startedAt = Date.now()

    if (fs.existsSync(finalPath)) throw new Error(`Refusing to overwrite existing backup ${filename}`)
    fs.rmSync(tempPath, { force: true })

    try {
      const result = await runCommand("pg_dump", [
        `--host=${dbHost}`,
        `--port=${dbPort}`,
        `--username=${dbUser}`,
        "--format=custom",
        "--blobs",
        `--file=${tempPath}`,
        dbName
      ])
      fs.renameSync(tempPath, finalPath)
      const record = fileRecord(folder, filename)
      manifest.database = {
        ...record,
        databaseName: dbName,
        createdAt: new Date().toISOString(),
        durationMs: result.durationMs
      }
      manifest.status = manifest.media ? "success" : "partial"
      manifest.durationMs = Date.now() - startedAt
      manifest.lastFailure = null
      writeManifest(folder, manifest)
      return { success: true, backupSetId: setId, database: manifest.database }
    } catch (err) {
      fs.rmSync(tempPath, { force: true })
      manifest.status = "failed"
      manifest.lastFailure = safeError(err)
      manifest.durationMs = Date.now() - startedAt
      writeManifest(folder, manifest)
      throw err
    }
  })
}

async function backupMedia(args = {}) {
  return withLock("media-backup", async () => {
    const setId = args.setId || backupSetId()
    const folder = createSetFolder(setId)
    const manifestPath = path.join(folder, manifestName())
    const manifest = fs.existsSync(manifestPath) ? readManifest(folder) : initialManifest(setId)
    const mediaRoot = process.env.BACKUP_MEDIA_ROOT ||
      process.env.UPLOAD_ROOT ||
      process.env.UPLOADS_PATH ||
      path.join(__dirname, "..", "backend", "uploads")
    const filename = `media-${setId}.tar.gz`
    const tempFilename = `${filename}.tmp`
    const finalPath = safeResolveInside(folder, filename)
    const tempPath = safeResolveInside(folder, tempFilename)
    const startedAt = Date.now()

    if (!fs.existsSync(mediaRoot)) {
      throw new Error("Media backup root does not exist")
    }
    if (fs.existsSync(finalPath)) throw new Error(`Refusing to overwrite existing backup ${filename}`)
    fs.rmSync(tempPath, { force: true })

    try {
      const result = await runCommand("tar", [
        "--exclude=*.tmp",
        "--exclude=*.log",
        "--exclude=*.zip",
        "--exclude=*.tar",
        "--exclude=*.tar.gz",
        "--exclude=node_modules",
        "--exclude=dist",
        "--exclude=.git",
        "--exclude=archive",
        "-czf",
        tempPath,
        "-C",
        mediaRoot,
        "."
      ])
      fs.renameSync(tempPath, finalPath)
      const record = fileRecord(folder, filename)
      manifest.media = {
        ...record,
        createdAt: new Date().toISOString(),
        durationMs: result.durationMs
      }
      manifest.status = manifest.database ? "success" : "partial"
      manifest.durationMs = Date.now() - startedAt
      manifest.lastFailure = null
      writeManifest(folder, manifest)
      return { success: true, backupSetId: setId, media: manifest.media }
    } catch (err) {
      fs.rmSync(tempPath, { force: true })
      manifest.status = "failed"
      manifest.lastFailure = safeError(err)
      manifest.durationMs = Date.now() - startedAt
      writeManifest(folder, manifest)
      throw err
    }
  })
}

function latestManifestFolder() {
  const manifests = loadBackupManifests(backupRoot())
  const latest = manifests.find(item => item.manifest.status === "success" || item.manifest.status === "completed")
  if (!latest) throw new Error("No successful backup manifest found")
  return latest.folder
}

async function createBackupSet() {
  const setId = backupSetId()
  await backupDatabase({ setId })
  await backupMedia({ setId })
  return validateBackup({ setId })
}

async function validateBackup(args = {}) {
  return withLock("backup-validation", async () => {
    const folder = args.setId ? safeResolveInside(backupRoot(), args.setId) : latestManifestFolder()
    const manifest = readManifest(folder)
    const errors = []

    try {
      if (!manifest.database?.filename) errors.push("database backup missing from manifest")
      if (!manifest.media?.filename) errors.push("media backup missing from manifest")

      for (const key of ["database", "media"]) {
        if (!manifest[key]?.filename) continue
        const record = fileRecord(folder, manifest[key].filename)
        if (record.sizeBytes <= 0) errors.push(`${key} backup is empty`)
        if (manifest[key].sha256 && manifest[key].sha256 !== record.sha256) {
          errors.push(`${key} backup checksum mismatch`)
        }
        manifest[key].sizeBytes = record.sizeBytes
        manifest[key].sha256 = record.sha256
      }

      if (manifest.database?.filename) {
        await runCommand("pg_restore", ["--list", safeResolveInside(folder, manifest.database.filename)])
      }

      if (manifest.media?.filename) {
        await runCommand("tar", ["-tzf", safeResolveInside(folder, manifest.media.filename)])
      }

      if (errors.length) throw new Error(errors.join("; "))

      manifest.validation = {
        status: "success",
        timestamp: new Date().toISOString(),
        checksumStatus: "verified"
      }
      manifest.status = manifest.database && manifest.media ? "success" : "partial"
      manifest.lastFailure = null
      writeManifest(folder, manifest)
      return { success: true, backupSetId: manifest.backupSetId, validation: manifest.validation }
    } catch (err) {
      manifest.validation = {
        status: "failed",
        timestamp: new Date().toISOString(),
        checksumStatus: errors.some(error => /checksum/i.test(error)) ? "failed" : "not-verified",
        error: safeError(err)
      }
      manifest.lastFailure = safeError(err)
      writeManifest(folder, manifest)
      throw err
    }
  })
}

async function restoreVerify(args = {}) {
  return withLock("restore-verification", async () => {
    if (String(process.env.RESTORE_VERIFY_ENABLED || "false").toLowerCase() !== "true" && !args.force) {
      throw new Error("Restore verification is disabled. Set RESTORE_VERIFY_ENABLED=true for the verification host.")
    }

    const folder = args.setId ? safeResolveInside(backupRoot(), args.setId) : latestManifestFolder()
    const manifest = readManifest(folder)
    const dbPrefix = process.env.RESTORE_VERIFY_DB_PREFIX || "atec_restore_verify_"
    const dbName = assertSafeRestoreDatabaseName(`${dbPrefix}${Date.now()}`, process.env)
    const dbHost = process.env.DB_HOST || "127.0.0.1"
    const dbPort = process.env.DB_PORT || "5432"
    const dbUser = process.env.DB_USER
    const dumpPath = safeResolveInside(folder, manifest.database?.filename || "")
    const rowCounts = {}

    if (!dbUser) throw new Error("DB_USER is required for restore verification")

    try {
      await runCommand("createdb", [`--host=${dbHost}`, `--port=${dbPort}`, `--username=${dbUser}`, dbName])
      await runCommand("pg_restore", [
        `--host=${dbHost}`,
        `--port=${dbPort}`,
        `--username=${dbUser}`,
        `--dbname=${dbName}`,
        "--no-owner",
        dumpPath
      ])

      const tables = ["tblasset", "tblinspection", "tblinspectionresult", "tblequiptype", "tblusers"]
      for (const table of tables) {
        await runCommand("psql", [
          `--host=${dbHost}`,
          `--port=${dbPort}`,
          `--username=${dbUser}`,
          `--dbname=${dbName}`,
          "--tuples-only",
          "--no-align",
          `--command=SELECT count(*) FROM atec.${table};`
        ])
        rowCounts[table] = "queried"
      }

      manifest.restoreVerification = {
        status: "success",
        timestamp: new Date().toISOString(),
        databaseName: dbName.replace(/\d+$/, "[timestamp]"),
        rowCounts
      }
      manifest.lastFailure = null
      writeManifest(folder, manifest)
      return { success: true, backupSetId: manifest.backupSetId, restoreVerification: manifest.restoreVerification }
    } catch (err) {
      manifest.restoreVerification = {
        status: "failed",
        timestamp: new Date().toISOString(),
        error: safeError(err)
      }
      manifest.lastFailure = safeError(err)
      writeManifest(folder, manifest)
      throw err
    } finally {
      await runCommand("dropdb", [
        "--if-exists",
        `--host=${dbHost}`,
        `--port=${dbPort}`,
        `--username=${dbUser}`,
        dbName
      ]).catch(() => {})
    }
  })
}

function applyRetention(args = {}) {
  const root = backupRoot()
  const apply = Boolean(args.apply)
  const plan = retentionPlan(root, { apply })

  if (apply) {
    for (const action of plan.actions) {
      if (action.action !== "delete") continue
      const folder = safeResolveInside(root, action.folderName)
      if (!fs.existsSync(path.join(folder, manifestName()))) {
        throw new Error(`Refusing to delete backup without manifest: ${action.folderName}`)
      }
      fs.rmSync(folder, { recursive: true, force: false })
    }
  }

  return plan
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0] || "status"
  const commandArgs = { setId: args.set, apply: args.apply, force: args.force }

  const handlers = {
    "backup:database": () => backupDatabase(commandArgs),
    "backup:media": () => backupMedia(commandArgs),
    "backup:create": () => createBackupSet(),
    "backup:validate": () => validateBackup(commandArgs),
    "backup:restore-verify": () => restoreVerify(commandArgs),
    "backup:retention": () => applyRetention(commandArgs),
    "backup:status": () => summarizeBackupStatus(process.env),
    status: () => summarizeBackupStatus(process.env)
  }

  if (!handlers[command]) {
    throw new Error(`Unknown backup command: ${command}`)
  }

  printJson(await handlers[command]())
}

if (require.main === module) {
  main().catch(err => {
    printJson({
      success: false,
      hostname: os.hostname(),
      error: safeError(err)
    })
    process.exit(1)
  })
}

module.exports = {
  applyRetention,
  assertSafeRestoreDatabaseName,
  backupDatabase,
  backupMedia,
  createBackupSet,
  parseArgs,
  restoreVerify,
  validateBackup
}
