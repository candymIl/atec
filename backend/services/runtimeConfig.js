const path = require("path")

function positiveInteger(value, fallback, max = fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function boundedPercent(value, fallback) {
  return positiveInteger(value, fallback, 100)
}

function dbPoolConfig(env = process.env) {
  return {
    max: positiveInteger(env.DB_POOL_MAX, 15, 100),
    idleTimeoutMillis: positiveInteger(env.DB_IDLE_TIMEOUT_MS, 30000, 10 * 60 * 1000),
    connectionTimeoutMillis: positiveInteger(env.DB_CONNECTION_TIMEOUT_MS, 5000, 60000),
    statement_timeout: positiveInteger(env.DB_STATEMENT_TIMEOUT_MS, 30000, 10 * 60 * 1000),
    query_timeout: positiveInteger(env.DB_QUERY_TIMEOUT_MS, 30000, 10 * 60 * 1000)
  }
}

function resolveUploadRoot({
  env = process.env,
  projectRoot = path.resolve(__dirname, "..", ".."),
  backendRoot = path.resolve(__dirname, "..")
} = {}) {
  const configured = String(env.UPLOAD_ROOT || env.UPLOADS_PATH || "").trim()
  const resolved = path.resolve(configured || path.join(backendRoot, "uploads"))
  const workspace = path.resolve(projectRoot)
  const insideWorkspace =
    resolved === workspace ||
    resolved.startsWith(workspace + path.sep)

  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    if (!configured) {
      throw new Error("UPLOAD_ROOT is required in production")
    }

    if (insideWorkspace) {
      throw new Error("UPLOAD_ROOT must be outside the application source tree in production")
    }
  }

  return {
    path: resolved,
    configured: Boolean(configured),
    insideWorkspace
  }
}

function uploadProcessingConfig(env = process.env) {
  return {
    maxWidth: positiveInteger(env.UPLOAD_IMAGE_MAX_WIDTH, 1600, 6000),
    maxHeight: positiveInteger(env.UPLOAD_IMAGE_MAX_HEIGHT, 1600, 6000),
    quality: boundedPercent(env.UPLOAD_IMAGE_QUALITY, 72),
    compressMinBytes: positiveInteger(env.UPLOAD_COMPRESS_MIN_BYTES, 512000, 100 * 1024 * 1024),
    concurrency: positiveInteger(env.UPLOAD_COMPRESSION_CONCURRENCY, 2, 8)
  }
}

function pdfConfig(env = process.env) {
  return {
    concurrency: positiveInteger(env.PDF_CONCURRENCY, 1, 4),
    bulkMaxCertificates: Math.max(500, positiveInteger(env.BULK_PDF_MAX_CERTIFICATES, 500, 500)),
    reportExportMaxRows: positiveInteger(env.REPORT_EXPORT_MAX_ROWS, 10000, 100000)
  }
}

module.exports = {
  boundedPercent,
  dbPoolConfig,
  pdfConfig,
  positiveInteger,
  resolveUploadRoot,
  uploadProcessingConfig
}
