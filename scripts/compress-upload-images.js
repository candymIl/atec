/*
  ATEC upload image compressor

  What this script does:
  - Scans existing upload folders for large images.
  - Resizes images to fit within a maximum width/height.
  - Re-saves images at a controlled quality to save disk space.
  - Does not change filenames or database references.

  Safety:
  - DRY RUN is the default. Nothing is changed unless --apply is used.
  - The _orphaned_cleanup folder is skipped.
  - Signatures are skipped by default so inspector signatures remain untouched.

  Usage from the ATEC project folder:
    node scripts/compress-upload-images.js
    node scripts/compress-upload-images.js --apply
    node scripts/compress-upload-images.js --apply --include-signatures

  Optional environment values in backend/.env:
    UPLOAD_IMAGE_MAX_WIDTH=1600
    UPLOAD_IMAGE_MAX_HEIGHT=1600
    UPLOAD_IMAGE_QUALITY=72
*/

const fs = require("fs")
const path = require("path")

const dotenv = require("../backend/node_modules/dotenv")
const sharp = require("../backend/node_modules/sharp")

const projectRoot = path.resolve(__dirname, "..")
dotenv.config({
  path: path.join(projectRoot, "backend", ".env"),
  quiet: true
})

const applyChanges = process.argv.includes("--apply")
const includeSignatures = process.argv.includes("--include-signatures")
const maxWidth = Number(process.env.UPLOAD_IMAGE_MAX_WIDTH || 1600)
const maxHeight = Number(process.env.UPLOAD_IMAGE_MAX_HEIGHT || 1600)
const quality = Number(process.env.UPLOAD_IMAGE_QUALITY || 72)
const minBytes = Number(process.env.UPLOAD_COMPRESS_MIN_BYTES || 500 * 1024)

const uploadsRoot = path.resolve(
  process.env.UPLOADS_PATH ||
    process.env.UPLOAD_ROOT ||
    path.join(projectRoot, "backend", "uploads")
)
const reportPath = path.join(
  uploadsRoot,
  `compression-report-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`
)

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"])
const skippedFolderNames = new Set(["_orphaned_cleanup"])
if (!includeSignatures) skippedFolderNames.add("signatures")

function walkImages(folder, results = []) {
  if (!fs.existsSync(folder)) return results

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name)

    if (entry.isDirectory()) {
      if (!skippedFolderNames.has(entry.name)) walkImages(fullPath, results)
      continue
    }

    if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath)
    }
  }

  return results
}

function formatBytes(bytes) {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

async function compressImage(filePath) {
  const before = fs.statSync(filePath).size
  const metadata = await sharp(filePath).metadata()
  const oversized =
    (metadata.width || 0) > maxWidth ||
    (metadata.height || 0) > maxHeight ||
    before > minBytes

  if (!oversized) {
    return { filePath, before, after: before, skipped: true, reason: "already small enough" }
  }

  const ext = path.extname(filePath).toLowerCase()
  const tempPath = `${filePath}.compressing`
  let pipeline = sharp(filePath)
    .rotate()
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: "inside",
      withoutEnlargement: true
    })

  if (ext === ".png") {
    pipeline = pipeline.png({ compressionLevel: 9, palette: true })
  } else if (ext === ".webp") {
    pipeline = pipeline.webp({ quality })
  } else {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true })
  }

  if (!applyChanges) {
    return { filePath, before, after: null, skipped: false, reason: "dry run candidate" }
  }

  await pipeline.toFile(tempPath)
  const after = fs.statSync(tempPath).size

  if (after >= before) {
    fs.rmSync(tempPath, { force: true })
    return { filePath, before, after, skipped: true, reason: "compressed file was not smaller" }
  }

  fs.rmSync(filePath, { force: true })
  fs.renameSync(tempPath, filePath)
  return { filePath, before, after, skipped: false, reason: "compressed" }
}

async function main() {
  const files = walkImages(uploadsRoot)
  const lines = [
    "ATEC upload image compression report",
    `Mode: ${applyChanges ? "APPLY CHANGES" : "DRY RUN"}`,
    `Uploads folder: ${uploadsRoot}`,
    `Max size: ${maxWidth}x${maxHeight}`,
    `Quality: ${quality}`,
    `Minimum file size checked: ${formatBytes(minBytes)}`,
    `Generated: ${new Date().toISOString()}`,
    ""
  ]

  let candidates = 0
  let compressed = 0
  let skipped = 0
  let beforeTotal = 0
  let afterTotal = 0

  for (const filePath of files) {
    try {
      const result = await compressImage(filePath)
      beforeTotal += result.before
      if (result.after) afterTotal += result.after

      const relativePath = path.relative(uploadsRoot, filePath)
      if (result.skipped) {
        skipped += 1
        lines.push(`SKIP  ${relativePath} | ${formatBytes(result.before)} | ${result.reason}`)
      } else {
        candidates += 1
        if (applyChanges) compressed += 1
        const afterText = result.after ? ` -> ${formatBytes(result.after)}` : ""
        lines.push(`WORK  ${relativePath} | ${formatBytes(result.before)}${afterText} | ${result.reason}`)
      }
    } catch (err) {
      skipped += 1
      lines.push(`ERROR ${path.relative(uploadsRoot, filePath)} | ${err.message}`)
    }
  }

  const savedBytes = applyChanges ? beforeTotal - afterTotal : 0
  lines.push("")
  lines.push(`Total images scanned: ${files.length}`)
  lines.push(`Compression candidates: ${candidates}`)
  lines.push(`Images compressed: ${compressed}`)
  lines.push(`Images skipped/errors: ${skipped}`)
  lines.push(`Total original size scanned: ${formatBytes(beforeTotal)}`)
  if (applyChanges) lines.push(`Estimated disk space saved: ${formatBytes(savedBytes)}`)

  fs.mkdirSync(uploadsRoot, { recursive: true })
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8")

  console.log(lines.slice(-7).join("\n"))
  console.log(`Report written to: ${reportPath}`)
  if (!applyChanges) {
    console.log("Dry run only. Run again with --apply to compress files.")
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
