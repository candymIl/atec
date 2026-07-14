/*
  ATEC orphaned media cleanup

  What this script does:
  - Scans uploads/assets, uploads/inspections, and uploads/signatures.
  - Reads all known and discovered upload/image path columns in the atec schema.
  - Reports files that are confidently unused.
  - Archives unused files only when --archive or --move is explicitly used.

  Safety:
  - Dry run is the default.
  - Nothing is permanently deleted.
  - No database records are changed.
  - Archive mode moves files into uploads/_media_archive and preserves folder structure.
  - If reference collection is incomplete or a file is uncertain, the file is kept in place.

  Usage from the ATEC project folder:
    node scripts/cleanup-orphaned-asset-images.js
    node scripts/cleanup-orphaned-asset-images.js --archive

  NPM usage:
    npm run media:scan
    npm run media:archive
*/

const fs = require("fs")
const path = require("path")

const dotenv = require("../backend/node_modules/dotenv")
const { Pool } = require("../backend/node_modules/pg")

const projectRoot = path.resolve(__dirname, "..")
dotenv.config({
  path: path.join(projectRoot, "backend", ".env"),
  quiet: true
})

const imageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".svg"
])

const uploadColumnNamePattern = /(photo|media|image|signature|upload|file|path|url|uri)/i
const forcedReferenceColumns = [
  { table_schema: "atec", table_name: "tblasset", column_name: "media1" },
  { table_schema: "atec", table_name: "tblasset", column_name: "media2" },
  { table_schema: "atec", table_name: "tblinspection", column_name: "photo1" },
  { table_schema: "atec", table_name: "tblinspection", column_name: "photo2" },
  { table_schema: "atec", table_name: "tblinspection", column_name: "inspector_signature_image" },
  { table_schema: "atec", table_name: "tblinspectionphoto", column_name: "photo_path" },
  { table_schema: "atec", table_name: "tblusers", column_name: "usersignature" }
]

const archiveRequested =
  process.argv.includes("--archive") ||
  process.argv.includes("--move")
const dryRun = !archiveRequested
const helpRequested = process.argv.includes("--help") || process.argv.includes("-h")

const uploadsRoot = path.resolve(
  process.env.UPLOADS_PATH ||
    process.env.UPLOAD_ROOT ||
    path.join(projectRoot, "backend", "uploads")
)
const mediaFolders = ["assets", "inspections", "signatures"]
const archiveRoot = path.join(uploadsRoot, "_media_archive")
const legacyArchiveFolderNames = new Set(["_orphaned_cleanup", "_media_archive"])
const reportPath = path.join(uploadsRoot, "media-cleanup-report.txt")
const archiveLogPath = path.join(uploadsRoot, "media-cleanup-archive.log")

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
})

function usage() {
  return [
    "ATEC orphaned media cleanup",
    "",
    "Dry run, no files moved:",
    "  node scripts/cleanup-orphaned-asset-images.js",
    "  npm run media:scan",
    "",
    "Archive confidently unused files:",
    "  node scripts/cleanup-orphaned-asset-images.js --archive",
    "  npm run media:archive"
  ].join("\n")
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = Number(bytes) || 0
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

function timestamp() {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
}

function safeRelativePath(fullPath) {
  return path.relative(uploadsRoot, fullPath).replace(/\\/g, "/")
}

function isImageFile(filename) {
  return imageExtensions.has(path.extname(filename).toLowerCase())
}

function normalizeUploadValue(value) {
  if (!value) return null

  const raw = String(value).trim()
  if (!raw) return null

  let cleaned = raw.replace(/\\/g, "/").split("?")[0].split("#")[0].trim()

  if (/^https?:\/\//i.test(cleaned)) {
    try {
      cleaned = new URL(cleaned).pathname
    } catch {
      return null
    }
  }

  const uploadsIndex = cleaned.toLowerCase().indexOf("/uploads/")
  if (uploadsIndex >= 0) {
    cleaned = cleaned.slice(uploadsIndex)
  } else if (cleaned.toLowerCase().startsWith("uploads/")) {
    cleaned = `/${cleaned}`
  } else if (cleaned.toLowerCase().startsWith("assets/")) {
    cleaned = `/uploads/${cleaned}`
  } else if (!cleaned.includes("/") && isImageFile(cleaned)) {
    cleaned = `/uploads/assets/${cleaned}`
  } else {
    return null
  }

  const normalized = path.posix.normalize(cleaned)
  if (!normalized.startsWith("/uploads/") || normalized.includes("/../")) {
    return null
  }

  return normalized.toLowerCase()
}

function referenceKeysFromValue(value) {
  const normalized = normalizeUploadValue(value)
  if (!normalized) return []

  const keys = new Set([normalized])
  const basename = path.posix.basename(normalized)
  if (basename) keys.add(`basename:${basename}`)

  return [...keys]
}

function fileReferenceKeys(file) {
  const relativePath = safeRelativePath(file.fullPath).toLowerCase()
  const uploadsPath = `/uploads/${relativePath}`.replace(/\/+/g, "/")
  const keys = new Set([uploadsPath])
  keys.add(`basename:${path.basename(relativePath)}`)
  return keys
}

function uniqueDestinationPath(destinationPath) {
  const parsed = path.parse(destinationPath)
  let candidate = destinationPath
  let counter = 1

  while (fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`)
    counter += 1
  }

  return candidate
}

function scanMediaFiles() {
  const files = []
  const skipped = []

  for (const folderName of mediaFolders) {
    const folderPath = path.join(uploadsRoot, folderName)

    if (!fs.existsSync(folderPath)) {
      skipped.push({
        path: `${folderName}/`,
        reason: "folder does not exist"
      })
      continue
    }

    walkMediaFolder(folderPath, files, skipped)
  }

  return { files, skipped }
}

function walkMediaFolder(folderPath, files, skipped) {
  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    const fullPath = path.join(folderPath, entry.name)
    const relativePath = safeRelativePath(fullPath)

    if (entry.isDirectory()) {
      if (legacyArchiveFolderNames.has(entry.name)) {
        skipped.push({ path: `${relativePath}/`, reason: "archive folder skipped" })
        continue
      }

      walkMediaFolder(fullPath, files, skipped)
      continue
    }

    if (!entry.isFile()) {
      skipped.push({ path: relativePath, reason: "not a regular file" })
      continue
    }

    if (!isImageFile(entry.name)) {
      skipped.push({ path: relativePath, reason: "not an image file" })
      continue
    }

    const stat = fs.statSync(fullPath)
    files.push({
      fullPath,
      relativePath,
      size: stat.size
    })
  }
}

function columnKey(column) {
  return `${column.table_schema}.${column.table_name}.${column.column_name}`
}

async function discoverReferenceColumns() {
  const discovered = await pool.query(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'atec'
      AND data_type IN ('text', 'character varying', 'character')
    ORDER BY table_schema, table_name, ordinal_position
  `)

  const forcedKeys = new Set(forcedReferenceColumns.map(column => columnKey(column)))
  const columns = new Map()

  for (const column of discovered.rows) {
    if (forcedKeys.has(columnKey(column)) || uploadColumnNamePattern.test(column.column_name)) {
      columns.set(columnKey(column), column)
    }
  }

  return [...columns.values()]
}

async function collectReferenceKeys(columns) {
  const referenceKeys = new Set()
  const scannedColumns = []
  const uncertainColumns = []

  for (const column of columns) {
    try {
      const tableRef = `${quoteIdent(column.table_schema)}.${quoteIdent(column.table_name)}`
      const columnRef = quoteIdent(column.column_name)
      const result = await pool.query(`
        SELECT ${columnRef} AS value
        FROM ${tableRef}
        WHERE ${columnRef} IS NOT NULL
          AND btrim(${columnRef}::text) <> ''
      `)

      let matchedValues = 0
      for (const row of result.rows) {
        const keys = referenceKeysFromValue(row.value)
        if (keys.length) matchedValues += 1
        for (const key of keys) referenceKeys.add(key)
      }

      scannedColumns.push({
        ...column,
        rows: result.rows.length,
        matchedValues
      })
    } catch (err) {
      uncertainColumns.push({
        ...column,
        error: err.message
      })
    }
  }

  return { referenceKeys, scannedColumns, uncertainColumns }
}

function classifyFiles(files, referenceKeys, referenceCollectionComplete) {
  const linkedFiles = []
  const orphanedFiles = []
  const uncertainFiles = []

  for (const file of files) {
    const keys = fileReferenceKeys(file)
    const matched = [...keys].some(key => referenceKeys.has(key))

    if (matched) {
      linkedFiles.push(file)
    } else if (!referenceCollectionComplete) {
      uncertainFiles.push({
        ...file,
        uncertaintyReason: "database reference scan was incomplete"
      })
    } else {
      orphanedFiles.push(file)
    }
  }

  return { linkedFiles, orphanedFiles, uncertainFiles }
}

function buildReport({
  scannedColumns,
  uncertainColumns,
  referenceKeys,
  files,
  skipped,
  linkedFiles,
  orphanedFiles,
  uncertainFiles,
  archiveResults,
  diskSpaceMoved
}) {
  const orphanedDiskSpace = orphanedFiles.reduce((total, file) => total + file.size, 0)
  const lines = [
    "ATEC Orphaned Media Cleanup Report",
    "==================================",
    `Generated: ${timestamp()}`,
    `Mode: ${dryRun ? "DRY RUN - no files moved" : "ARCHIVE - unused files moved"}`,
    "",
    `Uploads folder: ${uploadsRoot}`,
    `Archive folder: ${archiveRoot}`,
    "",
    "Safety:",
    "- No files are permanently deleted.",
    "- No database records are updated.",
    "- Files are archived only when confidently unreferenced.",
    "- Uncertain files are left in place.",
    "",
    "Summary:",
    `- Media files scanned: ${files.length}`,
    `- Linked files kept: ${linkedFiles.length}`,
    `- Confidently unused files: ${orphanedFiles.length}`,
    `- Uncertain files kept: ${uncertainFiles.length}`,
    `- Skipped non-media/archive entries: ${skipped.length}`,
    `- Database columns scanned: ${scannedColumns.length}`,
    `- Database columns with scan errors: ${uncertainColumns.length}`,
    `- Unique database reference keys: ${referenceKeys.size}`,
    `- Disk space ${dryRun ? "that would be archived" : "archived"}: ${formatBytes(dryRun ? orphanedDiskSpace : diskSpaceMoved)}`,
    "",
    "Database Columns Scanned:"
  ]

  for (const column of scannedColumns) {
    lines.push(`- ${columnKey(column)} (${column.rows} values, ${column.matchedValues} upload refs)`)
  }

  if (uncertainColumns.length) {
    lines.push("", "Database Columns Not Fully Scanned:")
    for (const column of uncertainColumns) {
      lines.push(`- ${columnKey(column)}: ${column.error}`)
    }
  }

  lines.push("", "Confidently Unused Files:")
  if (!orphanedFiles.length) lines.push("None")
  for (const file of orphanedFiles) {
    lines.push(`- ${file.relativePath} (${formatBytes(file.size)})`)
  }

  if (uncertainFiles.length) {
    lines.push("", "Uncertain Files Kept In Place:")
    for (const file of uncertainFiles) {
      lines.push(`- ${file.relativePath} (${formatBytes(file.size)}): ${file.uncertaintyReason}`)
    }
  }

  if (skipped.length) {
    lines.push("", "Skipped Entries:")
    for (const item of skipped) {
      lines.push(`- ${item.path}: ${item.reason}`)
    }
  }

  if (archiveResults.length) {
    lines.push("", "Archive Results:")
    for (const item of archiveResults) {
      lines.push(`- ${item.status}: ${item.from} -> ${item.to || "-"}`)
    }
  }

  return `${lines.join("\n")}\n`
}

function buildConsoleSummary({
  files,
  linkedFiles,
  orphanedFiles,
  uncertainFiles,
  uncertainColumns,
  movedCount,
  diskSpaceMoved
}) {
  const orphanedDiskSpace = orphanedFiles.reduce((total, file) => total + file.size, 0)

  return [
    "ATEC Orphaned Media Cleanup",
    "===========================",
    `Mode: ${dryRun ? "DRY RUN - no files moved" : "ARCHIVE - unused files moved"}`,
    `Uploads folder: ${uploadsRoot}`,
    "",
    `Media files scanned: ${files.length}`,
    `Linked files kept: ${linkedFiles.length}`,
    `Confidently unused files: ${orphanedFiles.length}`,
    `Uncertain files kept: ${uncertainFiles.length}`,
    `Database columns with scan errors: ${uncertainColumns.length}`,
    `Files archived: ${movedCount}`,
    dryRun
      ? `Disk space that would be archived: ${formatBytes(orphanedDiskSpace)}`
      : `Disk space archived: ${formatBytes(diskSpaceMoved)}`,
    "",
    `Report: ${reportPath}`,
    `Archive log: ${archiveLogPath}`
  ].join("\n")
}

function archiveUnusedFiles(orphanedFiles) {
  const archiveResults = []
  let movedCount = 0
  let diskSpaceMoved = 0

  for (const file of orphanedFiles) {
    const destinationPath = uniqueDestinationPath(path.join(archiveRoot, file.relativePath))

    try {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
      fs.renameSync(file.fullPath, destinationPath)
      movedCount += 1
      diskSpaceMoved += file.size
      archiveResults.push({
        status: "ARCHIVED",
        from: file.fullPath,
        to: destinationPath
      })
    } catch (err) {
      archiveResults.push({
        status: `KEPT - ${err.message}`,
        from: file.fullPath,
        to: destinationPath
      })
    }
  }

  return { archiveResults, movedCount, diskSpaceMoved }
}

async function main() {
  if (helpRequested) {
    console.log(usage())
    return
  }

  fs.mkdirSync(uploadsRoot, { recursive: true })

  const columns = await discoverReferenceColumns()
  const { referenceKeys, scannedColumns, uncertainColumns } = await collectReferenceKeys(columns)
  const referenceCollectionComplete = uncertainColumns.length === 0
  const { files, skipped } = scanMediaFiles()
  const { linkedFiles, orphanedFiles, uncertainFiles } = classifyFiles(
    files,
    referenceKeys,
    referenceCollectionComplete
  )

  let archiveResults = []
  let movedCount = 0
  let diskSpaceMoved = 0

  const preArchiveReport = buildReport({
    scannedColumns,
    uncertainColumns,
    referenceKeys,
    files,
    skipped,
    linkedFiles,
    orphanedFiles,
    uncertainFiles,
    archiveResults,
    diskSpaceMoved
  })

  fs.writeFileSync(reportPath, preArchiveReport, "utf8")

  if (!dryRun) {
    const result = archiveUnusedFiles(orphanedFiles)
    archiveResults = result.archiveResults
    movedCount = result.movedCount
    diskSpaceMoved = result.diskSpaceMoved
  }

  const finalReport = buildReport({
    scannedColumns,
    uncertainColumns,
    referenceKeys,
    files,
    skipped,
    linkedFiles,
    orphanedFiles,
    uncertainFiles,
    archiveResults,
    diskSpaceMoved
  })

  fs.writeFileSync(archiveLogPath, finalReport, "utf8")

  console.log(buildConsoleSummary({
    files,
    linkedFiles,
    orphanedFiles,
    uncertainFiles,
    uncertainColumns,
    movedCount,
    diskSpaceMoved
  }))
}

main()
  .catch(err => {
    console.error(`Cleanup failed: ${err.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => {})
  })
