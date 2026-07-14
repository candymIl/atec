/*
  Restore referenced asset images that were archived by media cleanup.

  Dry run is the default. Use --apply to move files back into uploads/assets.
  This script does not delete files and does not update database records.
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

const referenceColumns = [
  { table_schema: "atec", table_name: "tblasset", column_name: "media1" },
  { table_schema: "atec", table_name: "tblasset", column_name: "media2" },
  { table_schema: "atec", table_name: "tblinspection", column_name: "photo1" },
  { table_schema: "atec", table_name: "tblinspection", column_name: "photo2" },
  { table_schema: "atec", table_name: "tblinspection", column_name: "inspector_signature_image" },
  { table_schema: "atec", table_name: "tblinspectionphoto", column_name: "photo_path" },
  { table_schema: "atec", table_name: "tblusers", column_name: "usersignature" }
]

const applyChanges = process.argv.includes("--apply")
const helpRequested = process.argv.includes("--help") || process.argv.includes("-h")

const uploadsRoot = path.resolve(
  process.env.UPLOADS_PATH ||
    process.env.UPLOAD_ROOT ||
    path.join(projectRoot, "backend", "uploads")
)
const assetsRoot = path.join(uploadsRoot, "assets")
const sourceRoots = [
  path.join(assetsRoot, "_orphaned_cleanup"),
  path.join(uploadsRoot, "_media_archive", "assets")
]
const reportPath = path.join(uploadsRoot, "restore-referenced-orphaned-assets-report.txt")

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
})

function usage() {
  return [
    "Restore referenced asset images from cleanup/archive folders",
    "",
    "Dry run:",
    "  node scripts/restore-referenced-orphaned-asset-images.js",
    "  npm run media:restore-referenced:check",
    "",
    "Move referenced files back into uploads/assets:",
    "  node scripts/restore-referenced-orphaned-asset-images.js --apply",
    "  npm run media:restore-referenced"
  ].join("\n")
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`
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

async function collectReferenceKeys() {
  const keys = new Set()

  for (const column of referenceColumns) {
    const result = await pool.query(
      `
      SELECT ${quoteIdent(column.column_name)} AS value
      FROM ${quoteIdent(column.table_schema)}.${quoteIdent(column.table_name)}
      WHERE ${quoteIdent(column.column_name)} IS NOT NULL
        AND btrim(${quoteIdent(column.column_name)}::text) <> ''
      `
    )

    for (const row of result.rows) {
      for (const key of referenceKeysFromValue(row.value)) {
        keys.add(key)
      }
    }
  }

  return keys
}

function walkFiles(folderPath, files = []) {
  if (!fs.existsSync(folderPath)) return files

  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    const fullPath = path.join(folderPath, entry.name)

    if (entry.isDirectory()) {
      walkFiles(fullPath, files)
    } else if (entry.isFile() && isImageFile(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

async function main() {
  if (helpRequested) {
    console.log(usage())
    return
  }

  const referenceKeys = await collectReferenceKeys()
  const sourceFiles = sourceRoots.flatMap(folderPath => walkFiles(folderPath))
  const restored = []
  const skipped = []

  fs.mkdirSync(assetsRoot, { recursive: true })

  for (const sourcePath of sourceFiles) {
    const filename = path.basename(sourcePath)
    const normalizedTargetKey = `/uploads/assets/${filename}`.toLowerCase()
    const basenameKey = `basename:${filename.toLowerCase()}`

    if (!referenceKeys.has(normalizedTargetKey) && !referenceKeys.has(basenameKey)) {
      skipped.push({ sourcePath, reason: "not referenced" })
      continue
    }

    const destinationPath = path.join(assetsRoot, filename)
    if (fs.existsSync(destinationPath)) {
      skipped.push({ sourcePath, reason: "destination already exists" })
      continue
    }

    restored.push({ sourcePath, destinationPath })

    if (applyChanges) {
      fs.renameSync(sourcePath, destinationPath)
    }
  }

  const lines = [
    `Mode: ${applyChanges ? "APPLY" : "DRY RUN"}`,
    `Uploads root: ${uploadsRoot}`,
    `Reference keys: ${referenceKeys.size}`,
    `Candidate files: ${sourceFiles.length}`,
    `Referenced files to restore: ${restored.length}`,
    `Skipped files: ${skipped.length}`,
    "",
    "Referenced files:",
    ...restored.map(item => `- ${item.sourcePath} -> ${item.destinationPath}`),
    "",
    "Skipped files:",
    ...skipped.map(item => `- ${item.sourcePath} (${item.reason})`)
  ]

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`)
  console.log(lines.slice(0, 6).join("\n"))
  console.log(`Report: ${reportPath}`)
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
