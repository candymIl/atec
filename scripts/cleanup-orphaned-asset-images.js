/*
  ATEC orphaned asset image cleanup

  What this script does:
  - Reads atec.tblasset.media1 and atec.tblasset.media2.
  - Scans the assets upload folder for image files.
  - Finds image files that are not linked to any asset.
  - Creates a report before moving anything.
  - Moves orphaned images into _orphaned_cleanup only when DRY_RUN is false.

  Safety:
  - DRY_RUN is true by default.
  - Nothing is permanently deleted.
  - The _orphaned_cleanup folder is never scanned or moved.
  - Only image files are considered for moving.

  Usage from the ATEC project folder:
    node scripts/cleanup-orphaned-asset-images.js
    node scripts/cleanup-orphaned-asset-images.js --move

  Optional environment overrides:
    DRY_RUN=true
    DRY_RUN=false
    ASSETS_UPLOAD_DIR=D:\Projects\ATEC\backend\uploads\assets
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
  ".tiff"
])

const cliMoveRequested = process.argv.includes("--move")
const dryRunFromEnv = String(process.env.DRY_RUN || "").trim().toLowerCase()
const dryRun = cliMoveRequested
  ? false
  : dryRunFromEnv === "false"
    ? false
    : true

const uploadsRoot = path.resolve(
  process.env.UPLOADS_PATH || path.join(projectRoot, "backend", "uploads")
)
const assetsDir = path.resolve(
  process.env.ASSETS_UPLOAD_DIR || path.join(uploadsRoot, "assets")
)
const orphanDir = path.join(assetsDir, "_orphaned_cleanup")
const reportPath = path.join(assetsDir, "orphaned-images-report.txt")
const movedLogPath = path.join(assetsDir, "orphaned-images-moved.log")

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
})

function normalizeLinkedPhotoName(value) {
  if (!value) return ""

  const cleaned = String(value)
    .trim()
    .replace(/\\/g, "/")
    .split("?")[0]
    .split("#")[0]

  return path.posix.basename(cleaned).trim().toLowerCase()
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

function uniqueDestinationPath(destinationFolder, filename) {
  const parsed = path.parse(filename)
  let candidate = path.join(destinationFolder, filename)
  let counter = 1

  while (fs.existsSync(candidate)) {
    candidate = path.join(destinationFolder, `${parsed.name}-${counter}${parsed.ext}`)
    counter += 1
  }

  return candidate
}

async function getLinkedAssetPhotoNames() {
  const result = await pool.query(`
    SELECT media1, media2
    FROM atec.tblasset
    WHERE COALESCE(media1, '') <> ''
       OR COALESCE(media2, '') <> ''
  `)

  const linked = new Set()

  for (const row of result.rows) {
    const media1 = normalizeLinkedPhotoName(row.media1)
    const media2 = normalizeLinkedPhotoName(row.media2)

    if (media1) linked.add(media1)
    if (media2) linked.add(media2)
  }

  return linked
}

function scanAssetImageFiles() {
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Assets upload folder does not exist: ${assetsDir}`)
  }

  const entries = fs.readdirSync(assetsDir, { withFileTypes: true })
  const imageFiles = []
  let totalFiles = 0
  let skippedNonImage = 0
  let skippedFolders = 0

  for (const entry of entries) {
    if (entry.name === "_orphaned_cleanup") {
      skippedFolders += 1
      continue
    }

    if (!entry.isFile()) {
      skippedFolders += 1
      continue
    }

    totalFiles += 1
    const extension = path.extname(entry.name).toLowerCase()

    if (!imageExtensions.has(extension)) {
      skippedNonImage += 1
      continue
    }

    const fullPath = path.join(assetsDir, entry.name)
    const stat = fs.statSync(fullPath)

    imageFiles.push({
      filename: entry.name,
      key: entry.name.toLowerCase(),
      fullPath,
      size: stat.size
    })
  }

  return {
    totalFiles,
    imageFiles,
    skippedNonImage,
    skippedFolders
  }
}

function buildReport({
  linkedPhotos,
  totalFiles,
  imageFiles,
  orphanedFiles,
  skippedLinked,
  skippedNonImage,
  skippedFolders,
  movedCount,
  diskSpaceMoved,
  moveResults
}) {
  const lines = [
    "ATEC Orphaned Asset Images Report",
    "==================================",
    `Generated: ${timestamp()}`,
    `Mode: ${dryRun ? "DRY RUN - no files moved" : "MOVE - orphaned files moved"}`,
    "",
    `Assets folder: ${assetsDir}`,
    `Orphan cleanup folder: ${orphanDir}`,
    "",
    `Total files found in /uploads/assets/: ${totalFiles}`,
    `Total image files found in /uploads/assets/: ${imageFiles.length}`,
    `Total linked photos in database: ${linkedPhotos.size}`,
    `Total orphaned photos found: ${orphanedFiles.length}`,
    `Total photos moved: ${movedCount}`,
    `Total photos skipped: ${skippedLinked + skippedNonImage + skippedFolders}`,
    `Total disk space moved: ${formatBytes(diskSpaceMoved)}`,
    "",
    `Skipped linked photos: ${skippedLinked}`,
    `Skipped non-image files: ${skippedNonImage}`,
    `Skipped folders/excluded folders: ${skippedFolders}`,
    "",
    "Orphaned photos:",
    orphanedFiles.length ? "" : "None"
  ]

  for (const file of orphanedFiles) {
    lines.push(`- ${file.filename} (${formatBytes(file.size)})`)
  }

  if (moveResults.length) {
    lines.push("", "Move results:")

    for (const item of moveResults) {
      lines.push(`- ${item.status}: ${item.from} -> ${item.to || "-"}`)
    }
  }

  return `${lines.join("\n")}\n`
}

function buildConsoleSummary({
  linkedPhotos,
  totalFiles,
  imageFiles,
  orphanedFiles,
  skippedLinked,
  skippedNonImage,
  skippedFolders,
  movedCount,
  diskSpaceMoved
}) {
  const orphanedDiskSpace = orphanedFiles.reduce((total, file) => total + file.size, 0)

  return [
    "ATEC Orphaned Asset Images Cleanup",
    "==================================",
    `Mode: ${dryRun ? "DRY RUN - no files moved" : "MOVE - orphaned files moved"}`,
    `Assets folder: ${assetsDir}`,
    "",
    `Total files found in /uploads/assets/: ${totalFiles}`,
    `Total image files found in /uploads/assets/: ${imageFiles.length}`,
    `Total linked photos in database: ${linkedPhotos.size}`,
    `Total orphaned photos found: ${orphanedFiles.length}`,
    `Total photos moved: ${movedCount}`,
    `Total photos skipped: ${skippedLinked + skippedNonImage + skippedFolders}`,
    `Total disk space moved: ${formatBytes(diskSpaceMoved)}`,
    dryRun ? `Total disk space that would move: ${formatBytes(orphanedDiskSpace)}` : "",
    "",
    `Full report: ${reportPath}`,
    `Move log: ${movedLogPath}`
  ].filter(Boolean).join("\n")
}

async function main() {
  fs.mkdirSync(assetsDir, { recursive: true })
  fs.mkdirSync(orphanDir, { recursive: true })

  const linkedPhotos = await getLinkedAssetPhotoNames()
  const { totalFiles, imageFiles, skippedNonImage, skippedFolders } = scanAssetImageFiles()
  const orphanedFiles = imageFiles.filter(file => !linkedPhotos.has(file.key))
  const skippedLinked = imageFiles.length - orphanedFiles.length
  const moveResults = []
  let movedCount = 0
  let diskSpaceMoved = 0

  const preMoveReport = buildReport({
    linkedPhotos,
    totalFiles,
    imageFiles,
    orphanedFiles,
    skippedLinked,
    skippedNonImage,
    skippedFolders,
    movedCount,
    diskSpaceMoved,
    moveResults
  })

  fs.writeFileSync(reportPath, preMoveReport, "utf8")

  if (!dryRun) {
    for (const file of orphanedFiles) {
      const destinationPath = uniqueDestinationPath(orphanDir, file.filename)

      try {
        fs.renameSync(file.fullPath, destinationPath)
        movedCount += 1
        diskSpaceMoved += file.size
        moveResults.push({
          status: "MOVED",
          from: file.fullPath,
          to: destinationPath
        })
      } catch (err) {
        moveResults.push({
          status: `SKIPPED - ${err.message}`,
          from: file.fullPath,
          to: destinationPath
        })
      }
    }
  }

  const movedLog = buildReport({
    linkedPhotos,
    totalFiles,
    imageFiles,
    orphanedFiles,
    skippedLinked,
    skippedNonImage,
    skippedFolders,
    movedCount,
    diskSpaceMoved,
    moveResults
  })

  fs.writeFileSync(movedLogPath, movedLog, "utf8")

  console.log(buildConsoleSummary({
    linkedPhotos,
    totalFiles,
    imageFiles,
    orphanedFiles,
    skippedLinked,
    skippedNonImage,
    skippedFolders,
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
