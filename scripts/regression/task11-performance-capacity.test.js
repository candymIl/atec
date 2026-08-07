const assert = require("assert")
const fs = require("fs")
const path = require("path")
const testRoot = path.resolve(__dirname, "..", "..")

const {
  dbPoolConfig,
  pdfConfig,
  positiveInteger,
  resolveUploadRoot,
  uploadProcessingConfig
} = require("../../backend/services/runtimeConfig")
const {
  safePerformanceInfo,
  safePdfInfo
} = require("../../backend/services/systemInfo")

assert.strictEqual(positiveInteger("25", 10, 250), 25)
assert.strictEqual(positiveInteger("999", 10, 250), 250)
assert.strictEqual(positiveInteger("-1", 10, 250), 10)
assert.strictEqual(positiveInteger("bad", 10, 250), 10)

assert.deepStrictEqual(dbPoolConfig({
  DB_POOL_MAX: "bad",
  DB_IDLE_TIMEOUT_MS: "-1",
  DB_CONNECTION_TIMEOUT_MS: "9999999",
  DB_STATEMENT_TIMEOUT_MS: "abc",
  DB_QUERY_TIMEOUT_MS: "0"
}), {
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 60000,
  statement_timeout: 30000,
  query_timeout: 30000
})

assert.deepStrictEqual(pdfConfig({
  PDF_CONCURRENCY: "99",
  BULK_PDF_MAX_CERTIFICATES: "9999",
  REPORT_EXPORT_MAX_ROWS: "9999999"
}), {
  concurrency: 4,
  bulkMaxCertificates: 100,
  reportExportMaxRows: 100000
})

assert.deepStrictEqual(pdfConfig({
  BULK_PDF_MAX_CERTIFICATES: "50"
}), {
  concurrency: 1,
  bulkMaxCertificates: 50,
  reportExportMaxRows: 10000
})

assert.deepStrictEqual(pdfConfig({}), {
  concurrency: 1,
  bulkMaxCertificates: 100,
  reportExportMaxRows: 10000
})

assert.deepStrictEqual(uploadProcessingConfig({
  UPLOAD_IMAGE_MAX_WIDTH: "99999",
  UPLOAD_IMAGE_MAX_HEIGHT: "0",
  UPLOAD_IMAGE_QUALITY: "120",
  UPLOAD_COMPRESS_MIN_BYTES: "bad",
  UPLOAD_COMPRESSION_CONCURRENCY: "99"
}), {
  maxWidth: 6000,
  maxHeight: 1600,
  quality: 100,
  compressMinBytes: 512000,
  concurrency: 8
})

const developmentUploadRoot = resolveUploadRoot({
  env: { NODE_ENV: "development" },
  projectRoot: path.join(testRoot, "project"),
  backendRoot: path.join(testRoot, "project", "backend")
})
assert.strictEqual(developmentUploadRoot.configured, false)
assert.strictEqual(developmentUploadRoot.insideWorkspace, true)
assert.strictEqual(
  developmentUploadRoot.path,
  path.resolve(testRoot, "project", "backend", "uploads")
)

const productionUploadRoot = resolveUploadRoot({
  env: { NODE_ENV: "production", UPLOAD_ROOT: path.join(testRoot, "atec-data", "uploads") },
  projectRoot: path.join(testRoot, "project"),
  backendRoot: path.join(testRoot, "project", "backend")
})
assert.strictEqual(productionUploadRoot.configured, true)
assert.strictEqual(productionUploadRoot.insideWorkspace, false)

assert.throws(
  () => resolveUploadRoot({
    env: { NODE_ENV: "production" },
    projectRoot: path.join(testRoot, "project"),
    backendRoot: path.join(testRoot, "project", "backend")
  }),
  /UPLOAD_ROOT is required in production/
)

assert.throws(
  () => resolveUploadRoot({
    env: {
      NODE_ENV: "production",
      UPLOAD_ROOT: path.join(testRoot, "project", "backend", "uploads")
    },
    projectRoot: path.join(testRoot, "project"),
    backendRoot: path.join(testRoot, "project", "backend")
  }),
  /outside the application source tree/
)

const safePerf = safePerformanceInfo({
  checkedAt: "2026-07-14T10:00:00.000Z",
  slowRequestThresholdMs: 2000,
  totalRequests: 10,
  slowRequests: 1,
  recentRequestCount: 10,
  recentSlowRequestCount: 1,
  recentAverageMs: 50,
  recentMaxMs: 2500,
  lastSlowRequest: {
    method: "GET",
    route: "/assets",
    status: 200,
    elapsedMs: 2500,
    at: "2026-07-14T10:00:00.000Z",
    password: "must-not-leak",
    body: "must-not-leak"
  }
})
assert(!JSON.stringify(safePerf).includes("must-not-leak"))
assert.strictEqual(safePerf.lastSlowRequest.route, "/assets")

assert.deepStrictEqual(safePdfInfo({
  concurrency: 1,
  maxBulkCertificates: 50,
  active: 1,
  queued: 2,
  completed: 3,
  failed: 4
}), {
  concurrency: 1,
  maxBulkCertificates: 50,
  active: 1,
  queued: 2,
  completed: 3,
  failed: 4
})

const serverSource = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "server.js"), "utf8")
const dbSource = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "db.js"), "utf8")
const systemSource = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "services", "systemInfo.js"), "utf8")
const assetPageSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "pages", "AssetSetup.js"), "utf8")
const mainSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "main.js"), "utf8")
const certificateRendererSource = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "services", "certificateRenderer.js"), "utf8")
const certificatePageSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "pages", "Certificates.js"), "utf8")
const customerReportSource = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "pages", "CustomerDetailedReport.js"), "utf8")
const indexSource = fs.readFileSync(path.join(__dirname, "..", "..", "database", "2026-07-14-task11-performance-capacity-indexes.sql"), "utf8")

assert(serverSource.includes('const defaultFrontendOrigin = process.env.NODE_ENV === "production"\n  ? "https://www.atecinspections.co.za"'))
assert(serverSource.includes('process.env.PUBLIC_BASE_PATH || "/"'))
assert(serverSource.includes("function recordRequestPerformance(req, res, elapsedMs)"))
assert(serverSource.includes("console.warn(\"SLOW_REQUEST\", entry)"))
assert(!/SLOW_REQUEST[\s\S]{0,300}req\.body/.test(serverSource))
assert(!/SLOW_REQUEST[\s\S]{0,300}cookie/i.test(serverSource))

assert(dbSource.includes("dbPoolConfig(process.env)"))
assert(dbSource.includes('pool.on("error"'))
assert(systemSource.includes("safePerformanceInfo"))
assert(systemSource.includes("safePdfInfo"))

assert(serverSource.includes("const assetSortColumns = {"))
assert(serverSource.includes("assetSearchColumns[searchBy]"))
assert(serverSource.includes("parsePositiveInteger(req.query.limit, 25, 250)"))
assert(serverSource.includes("certificateSearchSortColumns[req.query.sortKey]"))
assert(serverSource.includes("customerReportSortColumns[options.sortKey]"))
assert(!serverSource.includes("${req.query.sortKey}"))

assert(serverSource.includes('req.user.role === "CUSTOMER"'))
assert(serverSource.includes("req.user.clientid"))
assert(serverSource.includes("report.assets.length > reportExportMaxRows"))
assert(serverSource.includes("certificates.length > bulkPdfMaxCertificates"))
assert(serverSource.includes("runQueuedPdfJob"))
assert(serverSource.includes("uploadRuntimeConfig.compressMinBytes"))
assert(serverSource.includes("Promise.all(batch.map(file => compressUploadedPhoto(file)))"))

assert(assetPageSource.includes("serverPaged"))
assert(mainSource.includes("filterAssetsDebounced"))
assert(mainSource.includes("assetSearchTimer = setTimeout"))
assert(customerReportSource.includes("currentReportPage = 1"))
assert(certificateRendererSource.includes('return inspection.inspectiontype !== "LOADTEST" &&\n    String(inspection.equipgroupid || "") === "400"'))
assert(certificatePageSource.includes('return inspection.inspectiontype !== "LOADTEST" &&\n    String(inspection.equipgroupid || "") === "400"'))

assert(serverSource.indexOf('app.use(requireAuth)') < serverSource.indexOf('app.get("/admin/system-info"'))
assert(serverSource.includes('if (req.user.role !== "ADMIN")'))

assert(indexSource.includes("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblinspection_asset_type_testdate_testid"))
assert(indexSource.includes("EXPLAIN (ANALYZE, BUFFERS)"))
assert(!/BEGIN;|COMMIT;/.test(indexSource))

console.log("Task 11 performance and capacity regression checks passed.")
