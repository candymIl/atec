const fs = require("fs")
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const cookieParser = require("cookie-parser")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const bcrypt = require("bcryptjs")
const crypto = require("crypto")
const pool = require("./db");
require("dotenv").config({ override: true });
const app = express();
const backendStartedAt = new Date()
const multer = require("multer");
const path = require("path");
const { pathToFileURL } = require("url");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const QRCode = require("qrcode");
const nodemailer = require("nodemailer");
const puppeteer = require("puppeteer-core");
const sharp = require("sharp");
const {
  createBulkCertificatesPdfBuffer: createRenderedBulkCertificatesPdfBuffer,
  createSingleCertificatePdfBuffer,
  renderSingleCertificatePreviewHtml
} = require("./services/certificateRenderer");
const {
  evaluateCertificateEligibility
} = require("./services/inspectionIntegrity")
const { buildSystemInfo } = require("./services/systemInfo")
const { pdfConfig, positiveInteger, uploadProcessingConfig } = require("./services/runtimeConfig")
const backendPackage = require("./package.json")
const {
  asyncRoute,
  auditLogger,
  authCookieOptions,
  createCsrfProtection,
  errorHandler,
  isSafeUpload,
  logSafeError,
  publicUser,
  requireAuth,
  sanitizeFilename,
  signAuthToken,
  validatePassword,
  validateUploadedImages
} = require("./middleware/security")

const defaultFrontendOrigin = process.env.NODE_ENV === "production"
  ? "https://www.atecinspections.co.za"
  : "http://localhost:5174,http://localhost:5173,http://127.0.0.1:5174,http://127.0.0.1:5173"
const uploadsRoot = path.resolve(
  process.env.UPLOAD_ROOT ||
  process.env.UPLOADS_PATH ||
  path.join(__dirname, "uploads")
)
const publicBasePath = (process.env.PUBLIC_BASE_PATH || "/").replace(/\/+$/, "")
const slowRequestMs = positiveInteger(process.env.SLOW_REQUEST_MS, 2000, 60000)
const pdfRuntimeConfig = pdfConfig(process.env)
const uploadRuntimeConfig = uploadProcessingConfig(process.env)
const pdfConcurrency = pdfRuntimeConfig.concurrency
const bulkPdfMaxCertificates = pdfRuntimeConfig.bulkMaxCertificates
const reportExportMaxRows = pdfRuntimeConfig.reportExportMaxRows
const uploadCompressionConcurrency = uploadRuntimeConfig.concurrency
const requestTimeoutMs = parsePositiveInteger(process.env.REQUEST_TIMEOUT_MS, 900000, 900000)
const headersTimeoutMs = Math.max(
  parsePositiveInteger(process.env.HEADERS_TIMEOUT_MS, Math.max(requestTimeoutMs + 5000, 65000), 905000),
  requestTimeoutMs + 1000
)
const keepAliveTimeoutMs = Math.min(
  parsePositiveInteger(process.env.KEEP_ALIVE_TIMEOUT_MS, 65000, 300000),
  headersTimeoutMs - 1000
)
const allowedOrigins = (process.env.FRONTEND_ORIGIN || defaultFrontendOrigin)
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean)
const csrfProtection = createCsrfProtection(allowedOrigins.join(","))
const trustProxy = process.env.TRUST_PROXY || (process.env.NODE_ENV === "production" ? "1" : "")

const pdfQueueMetrics = {
  active: 0,
  queued: 0,
  completed: 0,
  failed: 0
}
const pendingPdfJobs = []
const requestPerformanceMetrics = {
  totalRequests: 0,
  slowRequests: 0,
  recentWindow: [],
  lastSlowRequest: null
}

function parsePositiveInteger(value, fallback, max = fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function parseRateLimitEnv(name, fallback, max) {
  return parsePositiveInteger(process.env[name], fallback, max)
}

function rateLimitMessage(profile) {
  return { error: `Too many ${profile} requests. Please wait a moment and try again.` }
}

function runQueuedPdfJob(job) {
  return new Promise((resolve, reject) => {
    pendingPdfJobs.push({ job, resolve, reject })
    pdfQueueMetrics.queued = pendingPdfJobs.length
    drainPdfQueue()
  })
}

function drainPdfQueue() {
  while (pdfQueueMetrics.active < pdfConcurrency && pendingPdfJobs.length) {
    const nextJob = pendingPdfJobs.shift()
    pdfQueueMetrics.queued = pendingPdfJobs.length
    pdfQueueMetrics.active += 1

    Promise.resolve()
      .then(nextJob.job)
      .then(result => {
        pdfQueueMetrics.completed += 1
        nextJob.resolve(result)
      })
      .catch(err => {
        pdfQueueMetrics.failed += 1
        nextJob.reject(err)
      })
      .finally(() => {
        pdfQueueMetrics.active -= 1
        pdfQueueMetrics.queued = pendingPdfJobs.length
        drainPdfQueue()
      })
  }
}

if (trustProxy) {
  app.set("trust proxy", trustProxy === "true" ? 1 : trustProxy)
}

app.use((req, res, next) => {
  const prefixes = [
    process.env.BACKEND_API_PREFIX,
    publicBasePath ? `${publicBasePath}/api` : "",
    "/api"
  ].filter(Boolean)

  for (const prefix of prefixes) {
    if (req.url === prefix || req.url.startsWith(`${prefix}/`)) {
      req.url = req.url.slice(prefix.length) || "/"
      return next()
    }
  }

  if (publicBasePath && (req.url === `${publicBasePath}/uploads` || req.url.startsWith(`${publicBasePath}/uploads/`))) {
    req.url = req.url.slice(publicBasePath.length) || "/"
  }

  return next()
})

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression({
  filter: (req, res) => {
    if (req.path.endsWith(".pdf") || req.path.endsWith(".xlsx") || req.path.startsWith("/uploads")) {
      return false
    }

    return compression.filter(req, res)
  }
}))
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    return callback(new Error("Origin not allowed by CORS"))
  },
  credentials: true
}));
app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || "1mb"
}));
app.use(cookieParser());

const logAudit = auditLogger(pool)
const activeUserWindowMs = Number(process.env.ACTIVE_USER_WINDOW_MS || 10 * 60 * 1000)
const activeUsers = new Map()

app.use((req, res, next) => {
  req.logAudit = (...args) => logAudit(req, ...args)
  next()
})

function activeUserRouteLabel(req) {
  const cleanPath = String(req.originalUrl || req.path || "")
    .split("?")[0]
    .replace(/\/\d+(?=\/|$)/g, "/:id")

  return `${req.method} ${cleanPath || "/"}`
}

function recordActiveUser(req) {
  if (!req.user?.user_id || req.path === "/health") return

  activeUsers.set(String(req.user.user_id), {
    user_id: req.user.user_id,
    username: req.user.username || "",
    full_name: req.user.full_name || req.user.username || "",
    role: req.user.role || "",
    clientid: req.user.clientid || null,
    lastSeenAt: new Date().toISOString(),
    lastRoute: activeUserRouteLabel(req)
  })
}

function trackActiveUser(req, res, next) {
  recordActiveUser(req)
  next()
}

function forgetActiveUser(userId) {
  if (userId === null || userId === undefined) return
  activeUsers.delete(String(userId))
}

function activeUserSummary(now = new Date()) {
  const cutoff = now.getTime() - activeUserWindowMs

  for (const [userId, user] of activeUsers.entries()) {
    if (new Date(user.lastSeenAt).getTime() < cutoff) {
      activeUsers.delete(userId)
    }
  }

  return {
    windowMinutes: Math.round(activeUserWindowMs / 60000),
    count: activeUsers.size,
    users: [...activeUsers.values()]
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
  }
}

function requestRouteLabel(req) {
  if (req.route?.path) {
    return `${req.baseUrl || ""}${req.route.path}`
  }

  const cleanPath = String(req.path || req.originalUrl || "")
    .split("?")[0]
    .replace(/\/\d+(?=\/|$)/g, "/:id")

  return cleanPath || "/"
}

function recordRequestPerformance(req, res, elapsedMs) {
  if (req.path === "/health") return

  const entry = {
    method: req.method,
    route: requestRouteLabel(req),
    status: res.statusCode,
    elapsedMs,
    at: new Date().toISOString()
  }

  requestPerformanceMetrics.totalRequests += 1
  requestPerformanceMetrics.recentWindow.push(entry)

  if (requestPerformanceMetrics.recentWindow.length > 100) {
    requestPerformanceMetrics.recentWindow.shift()
  }

  if (elapsedMs >= slowRequestMs) {
    requestPerformanceMetrics.slowRequests += 1
    requestPerformanceMetrics.lastSlowRequest = entry
    console.warn("SLOW_REQUEST", entry)
  }
}

function performanceSummary() {
  const recent = requestPerformanceMetrics.recentWindow
  const slowRecent = recent.filter(entry => entry.elapsedMs >= slowRequestMs)
  const durations = recent.map(entry => entry.elapsedMs)
  const averageMs = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : 0
  const maxMs = durations.length ? Math.max(...durations) : 0

  return {
    checkedAt: new Date().toISOString(),
    slowRequestThresholdMs: slowRequestMs,
    totalRequests: requestPerformanceMetrics.totalRequests,
    slowRequests: requestPerformanceMetrics.slowRequests,
    recentRequestCount: recent.length,
    recentSlowRequestCount: slowRecent.length,
    recentAverageMs: averageMs,
    recentMaxMs: maxMs,
    lastSlowRequest: requestPerformanceMetrics.lastSlowRequest
  }
}

app.use((req, res, next) => {
  const startedAt = Date.now()

  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt
    recordRequestPerformance(req, res, elapsedMs)
  })

  next()
})

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let folder = path.join(uploadsRoot, "assets")

    if (file.fieldname === "signature") {
      folder = path.join(uploadsRoot, "signatures")
    }

    if (file.fieldname === "inspectionPhotos") {
      folder = path.join(uploadsRoot, "inspections")
    }

    fs.mkdirSync(folder, { recursive: true })
    cb(null, folder);
  },
  filename: function (req, file, cb) {
    cb(null, sanitizeFilename(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    if (!isSafeUpload(file)) {
      const error = new Error("Only JPG, PNG and WebP images are allowed")
      error.statusCode = 400
      return cb(error)
    }

    return cb(null, true)
  }
});

function flattenUploadFiles(files) {
  if (!files) return []
  if (Array.isArray(files)) return files
  return Object.values(files).flat()
}

async function compressUploadedPhoto(file) {
  if (!file?.path || file.fieldname === "signature") return

  const stat = fs.statSync(file.path)
  if (stat.size < uploadRuntimeConfig.compressMinBytes) return

  const targetPath = file.path.replace(/\.[^.]+$/, ".jpg")
  const tempPath = `${targetPath}.tmp`

  await sharp(file.path)
    .rotate()
    .resize({
      width: uploadRuntimeConfig.maxWidth,
      height: uploadRuntimeConfig.maxHeight,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: uploadRuntimeConfig.quality,
      mozjpeg: true
    })
    .toFile(tempPath)

  if (targetPath === file.path) {
    fs.rmSync(file.path, { force: true })
    fs.renameSync(tempPath, targetPath)
  } else {
    fs.renameSync(tempPath, targetPath)
    fs.rmSync(file.path, { force: true })
  }

  file.path = targetPath
  file.filename = path.basename(targetPath)
  file.mimetype = "image/jpeg"
}

async function compressUploadedPhotos(req, res, next) {
  const files = [
    ...(req.file ? [req.file] : []),
    ...flattenUploadFiles(req.files)
  ]

  try {
    for (let index = 0; index < files.length; index += uploadCompressionConcurrency) {
      const batch = files.slice(index, index + uploadCompressionConcurrency)
      await Promise.all(batch.map(file => compressUploadedPhoto(file)))
    }

    next()
  } catch (err) {
    removeUploadedFiles(files)
    next(err)
  }
}

app.get("/", (req, res) => {
  res.send("ATEC backend is running");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" })
})

const loginLimiter = rateLimit({
  windowMs: parseRateLimitEnv("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000, 60 * 60 * 1000),
  limit: parseRateLimitEnv("AUTH_RATE_LIMIT", 10, 100),
  message: rateLimitMessage("login"),
  standardHeaders: true,
  legacyHeaders: false
})

const searchLimiter = rateLimit({
  windowMs: parseRateLimitEnv("SEARCH_RATE_LIMIT_WINDOW_MS", 60 * 1000, 15 * 60 * 1000),
  limit: parseRateLimitEnv("SEARCH_RATE_LIMIT", 120, 1000),
  message: rateLimitMessage("search"),
  standardHeaders: true,
  legacyHeaders: false
})

const uploadLimiter = rateLimit({
  windowMs: parseRateLimitEnv("UPLOAD_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000, 60 * 60 * 1000),
  limit: parseRateLimitEnv("UPLOAD_RATE_LIMIT", 60, 300),
  message: rateLimitMessage("upload"),
  standardHeaders: true,
  legacyHeaders: false
})

const pdfLimiter = rateLimit({
  windowMs: parseRateLimitEnv("PDF_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000, 60 * 60 * 1000),
  limit: parseRateLimitEnv("PDF_RATE_LIMIT", 40, 300),
  message: rateLimitMessage("PDF/export"),
  standardHeaders: true,
  legacyHeaders: false
})

const exportLimiter = rateLimit({
  windowMs: parseRateLimitEnv("EXPORT_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000, 60 * 60 * 1000),
  limit: parseRateLimitEnv("EXPORT_RATE_LIMIT", 60, 300),
  message: rateLimitMessage("export"),
  standardHeaders: true,
  legacyHeaders: false
})

const emailLimiter = rateLimit({
  windowMs: parseRateLimitEnv("EMAIL_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000, 60 * 60 * 1000),
  limit: parseRateLimitEnv("EMAIL_RATE_LIMIT", 30, 200),
  message: rateLimitMessage("email"),
  standardHeaders: true,
  legacyHeaders: false
})

function roleToUserLevel(role) {
  return {
    ADMIN: 1,
    MANAGER: 2,
    INSPECTOR: 3,
    VIEWER: 4,
    CUSTOMER: 5
  }[role] || 5
}

function validRoles() {
  return ["ADMIN", "MANAGER", "INSPECTOR", "VIEWER", "CUSTOMER"]
}

function canManageAllUsers(user) {
  return user?.role === "ADMIN"
}

function canManageCustomerPortalUsers(user) {
  return ["ADMIN", "MANAGER"].includes(user?.role)
}

const INSPECTION_PHOTO_TYPES = new Set([
  "GENERAL",
  "DEFECT",
  "REPAIR",
  "LOAD_TEST",
  "NAMEPLATE",
  "HOOK",
  "WIRE_ROPE",
  "STRUCTURE",
  "ELECTRICAL"
])

function makeAssetQrCode(assetid) {
  return `ATEC-ASSET-${assetid}`
}

function generateNfcToken() {
  return `nfc_${crypto.randomBytes(24).toString("base64url")}`
}

function isValidNfcToken(token) {
  return /^nfc_[A-Za-z0-9_-]{32,64}$/.test(String(token || ""))
}

function maskLookupToken(token) {
  const value = String(token || "")
  if (value.length <= 12) return "masked"
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function nfcUrlForToken(token) {
  const appUrl = (process.env.PUBLIC_APP_URL || "https://www.fbcranes.co.za/atec").replace(/\/$/, "")
  return `${appUrl}/?nfc=${encodeURIComponent(token)}`
}

async function createUniqueNfcToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateNfcToken()
    const existing = await pool.query(
      "SELECT 1 FROM atec.tblasset WHERE nfc_token = $1 LIMIT 1",
      [token]
    )
    if (existing.rows.length === 0) return token
  }
  throw new Error("Unable to generate unique NFC token")
}

const VISIT_ACTIVE_STATUSES = ["DRAFT", "OPEN", "PAUSED", "RECONCILIATION_REQUIRED"]
const VISIT_SCOPES = ["VISUAL", "LOADTEST", "COMBINED", "SURVEY"]
const VISIT_RESOLVED_STATUSES = [
  "COMPLETED",
  "NOT_FOUND",
  "OUT_OF_SERVICE",
  "REMOVED_FROM_SITE",
  "INACCESSIBLE",
  "DEFERRED",
  "CUSTOMER_CONFIRMED_REMOVED",
  "DUPLICATE_RECORD",
  "NOT_REQUIRED",
  "OTHER"
]
const VISIT_COMMENT_REQUIRED_STATUSES = new Set(
  VISIT_RESOLVED_STATUSES.filter(status => status !== "COMPLETED")
)

function canCreateOrCloseVisit(user) {
  return ["ADMIN", "MANAGER"].includes(user?.role)
}

function canWorkVisit(user) {
  return ["ADMIN", "MANAGER", "INSPECTOR"].includes(user?.role)
}

function normalizeVisitScope(value) {
  const scope = String(value || "COMBINED").toUpperCase()
  return VISIT_SCOPES.includes(scope) ? scope : "COMBINED"
}

function normalizeVisitStatus(value, fallback = "DRAFT") {
  const status = String(value || fallback).toUpperCase()
  return ["DRAFT", "OPEN", "PAUSED", "RECONCILIATION_REQUIRED", "COMPLETED", "CANCELLED"].includes(status)
    ? status
    : fallback
}

function normalizeVisitCreationStatus(value) {
  const status = normalizeVisitStatus(value, "DRAFT")
  return ["DRAFT", "OPEN"].includes(status) ? status : "DRAFT"
}

function normalizeVisitDisposition(value) {
  const status = String(value || "OUTSTANDING").toUpperCase()
  return ["OUTSTANDING", ...VISIT_RESOLVED_STATUSES].includes(status) ? status : "OUTSTANDING"
}

function activeVisitStatusSql(alias = "v") {
  return `${alias}.visit_status = ANY($1::text[])`
}

function visitScopeMatchesInspectionSql(scopeAlias = "v.visit_type") {
  return `(
    ${scopeAlias} = 'COMBINED'
    OR (${scopeAlias} = 'VISUAL' AND $3 = 'VISUAL')
    OR (${scopeAlias} = 'LOADTEST' AND $3 = 'LOADTEST')
  )`
}

function requiredScopeForDue(visualDue, loadDue) {
  if (visualDue && loadDue) return "BOTH"
  if (visualDue) return "VISUAL"
  if (loadDue) return "LOADTEST"
  return "NONE"
}

function dueReasonForAsset(visualDue, loadDue, visualOverdue, loadOverdue) {
  const parts = []
  if (visualDue) parts.push(visualOverdue ? "Visual overdue" : "Visual due")
  if (loadDue) parts.push(loadOverdue ? "Load test overdue" : "Load test due")
  return parts.join("; ") || "Not due"
}

function assetSupportsLoadTestSql(assetAlias = "a") {
  return `EXISTS (
    SELECT 1
    FROM atec.tblequiptype load_et
    WHERE load_et.equiptypeid = ${assetAlias}.equiptypeid
      AND (
        load_et.equipgroupid::text IN ('100', '400', '500')
        OR EXISTS (
          SELECT 1
          FROM atec.tblequiptypecriteria load_criteria
          WHERE load_criteria.equiptypeid = ${assetAlias}.equiptypeid
            AND UPPER(COALESCE(load_criteria.inspectioncategory, '')) = 'LOADTEST'
            AND COALESCE(load_criteria.active, true) = true
        )
      )
  )`
}

function resolveUploadFilePath(uploadPath) {
  if (!uploadPath) return null

  const rawPath = String(uploadPath).trim().replace(/\\/g, "/")
  const uploadRelativePath = rawPath
    .replace(/^\/?uploads\//, "")
    .replace(/^\/+/, "")
  const assetRelativePath = uploadRelativePath.includes("/")
    ? uploadRelativePath
    : `assets/${uploadRelativePath}`
  const normalizedPath = path.posix.normalize(
    assetRelativePath
  )

  if (
    !normalizedPath ||
    normalizedPath.startsWith("../") ||
    normalizedPath === ".." ||
    path.posix.isAbsolute(normalizedPath)
  ) {
    return null
  }

  const fullPath = path.resolve(uploadsRoot, normalizedPath)

  return fullPath.startsWith(uploadsRoot + path.sep) ? fullPath : null
}

async function deleteUploadFileIfUnreferenced(uploadPath) {
  const fullPath = resolveUploadFilePath(uploadPath)

  if (!fullPath) return

  const referenceResult = await pool.query(
    `
    SELECT
      (
        SELECT COUNT(*) FROM atec.tblasset
        WHERE $1 IN (media1, media2)
      )
      +
      (
        SELECT COUNT(*) FROM atec.tblinspection
        WHERE $1 IN (photo1, photo2, inspector_signature_image)
      )
      +
      (
        SELECT COUNT(*) FROM atec.tblinspectionphoto
        WHERE photo_path = $1
      ) AS references
    `,
    [uploadPath]
  )

  if (Number(referenceResult.rows[0]?.references || 0) > 0) return

  fs.unlink(fullPath, err => {
    if (err && err.code !== "ENOENT") {
      console.error("Failed to remove upload file", err.message)
    }
  })
}

function removeUploadedFiles(files = []) {
  const uploadedFiles = Array.isArray(files)
    ? files
    : Object.values(files || {}).flat()

  uploadedFiles.forEach(file => {
    if (file?.path) {
      fs.unlink(file.path, err => {
        if (err && err.code !== "ENOENT") {
          console.error("Failed to remove rejected upload file", err.message)
        }
      })
    }
  })
}

async function getInspectionPhotoAccess(testid) {
  const result = await pool.query(
    `
    SELECT
      i.testid,
      i.assetid,
      i.inspector_user_id,
      a.clientid
    FROM atec.tblinspection i
    LEFT JOIN atec.tblasset a
      ON i.assetid = a.assetid
    WHERE i.testid = $1
    `,
    [testid]
  )

  return result.rows[0] || null
}

function canManageInspectionPhoto(user, inspection) {
  if (!user || !inspection) return false
  if (user.role === "ADMIN") return true

  return user.role === "INSPECTOR" &&
    String(inspection.inspector_user_id || "") === String(user.user_id || "")
}

function canReadInspectionPhoto(user, inspection) {
  if (!user || !inspection) return false
  if (user.role !== "CUSTOMER") return true

  return String(inspection.clientid || "") === String(user.clientid || "")
}

async function ensureAssetQrCode(asset) {
  const existingCode = String(asset?.qrcode || "").trim()

  if (existingCode) {
    return { ...asset, qrcode: existingCode }
  }

  const qrcode = makeAssetQrCode(asset.assetid)
  await pool.query(
    "UPDATE atec.tblasset SET qrcode = $1 WHERE assetid = $2",
    [qrcode, asset.assetid]
  )

  return { ...asset, qrcode }
}

function normalizeCriteriaResultType(value, fieldtype = "") {
  const resultType = String(value || "").toUpperCase()

  if (["PASS_FAIL", "MEASURED", "YES_NO"].includes(resultType)) {
    return resultType
  }

  return String(fieldtype || "").toUpperCase() === "NUMBER"
    ? "MEASURED"
    : "PASS_FAIL"
}

function isSafeForContinuedOperation(name) {
  const normalized = String(name || "").trim().toUpperCase()
  return normalized === "SAFE FOR CONTINUED OPERATION" ||
    normalized === "SAFE FOR SERVICE"
}

function isCriticalFailure(resultRow, criteriaRow) {
  if (String(criteriaRow?.severity || "").toUpperCase() !== "CRITICAL") {
    return false
  }

  return isFailedInspectionResult(resultRow)
}

function isFailedInspectionResult(resultRow) {
  const result = String(resultRow?.result || "").trim().toUpperCase()
  const measuredValue = String(resultRow?.measuredvalue || "").trim().toUpperCase()

  return ["FAIL", "NO", "NOT SAFE", "UNSAFE"].includes(result) ||
    ["FAIL", "NO", "NOT SAFE", "UNSAFE"].includes(measuredValue)
}

function blankToNull(value) {
  return value === "" || value === undefined ? null : value
}

function truncateDbText(value, maxLength = 255) {
  const text = String(value || "")
  if (text.length <= maxLength) return text

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`
}

function pushAvailableColumn(columns, availableColumns, column, value) {
  if (availableColumns.has(column)) {
    columns.push([column, value])
  }
}

function normalizeAssetLookupValue(value) {
  return String(value || "").trim().toLowerCase()
}

async function getActiveResponsibleSection(client, sectionid) {
  const result = await client.query(
    `
    SELECT
      sec.sectionid,
      sec.siteid,
      sec.clientid,
      sec.responsibleid,
      sec.sectionname,
      s.sitename,
      c.clientname
    FROM atec.tblsection sec
    JOIN atec.tblsites s
      ON sec.siteid = s.siteid
     AND sec.clientid = s.clientid
    JOIN atec.tblclients c
      ON sec.clientid = c.clientid
    WHERE sec.sectionid = $1
      AND COALESCE(sec.archived, false) = false
      AND COALESCE(s.archived, false) = false
      AND COALESCE(c.archived, false) = false
    LIMIT 1
    `,
    [sectionid]
  )

  return result.rows[0] || null
}

async function getActiveResponsiblePersonForClient(client, { personid, clientid }) {
  if (!personid || !clientid) return null

  const result = await client.query(
    `
    SELECT personid, clientid, name
    FROM atec.tblpeople
    WHERE personid = $1
      AND clientid = $2
      AND COALESCE(archived, false) = false
    LIMIT 1
    `,
    [personid, clientid]
  )

  return result.rows[0] || null
}

async function customerUserSiteBelongsToClient(client, { siteid, clientid }) {
  if (!siteid) return true

  const result = await client.query(
    `
    SELECT 1
    FROM atec.tblsites
    WHERE siteid = $1
      AND clientid = $2
      AND COALESCE(archived, false) = false
    LIMIT 1
    `,
    [siteid, clientid]
  )

  return result.rows.length > 0
}

async function resolveCustomerPortalScope(user) {
  const emailName = String(user?.email || user?.username || "").split("@")[0]
  const normalizedEmailName = emailName.replace(/[^a-z0-9]/gi, "").toLowerCase()

  if (!user?.clientid || !normalizedEmailName) {
    return { responsibleid: null, siteid: user?.siteid || null, sectionid: user?.sectionid || null }
  }

  const result = await pool.query(
    `
    SELECT personid
    FROM atec.tblpeople
    WHERE clientid = $1
      AND COALESCE(archived, false) = false
      AND lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) = $2
    LIMIT 2
    `,
    [user.clientid, normalizedEmailName]
  )

  if (result.rows.length === 1) {
    return { responsibleid: result.rows[0].personid, siteid: null, sectionid: null }
  }

  return { responsibleid: null, siteid: user.siteid || null, sectionid: user.sectionid || null }
}

async function getActiveVisitLocation(client, { clientid, siteid, sectionid = null }) {
  if (!clientid || !siteid) return null

  const result = await client.query(
    `
    SELECT
      c.clientid,
      s.siteid,
      sec.sectionid
    FROM atec.tblclients c
    JOIN atec.tblsites s
      ON s.clientid = c.clientid
    LEFT JOIN atec.tblsection sec
      ON sec.sectionid = $3::int
     AND sec.siteid = s.siteid
     AND sec.clientid = c.clientid
    WHERE c.clientid = $1
      AND s.siteid = $2
      AND COALESCE(c.archived, false) = false
      AND COALESCE(s.archived, false) = false
      AND (
        $3::int IS NULL OR (
          sec.sectionid IS NOT NULL
          AND COALESCE(sec.archived, false) = false
        )
      )
    LIMIT 1
    `,
    [clientid, siteid, sectionid || null]
  )

  return result.rows[0] || null
}

function isDuplicateActiveClientSerialError(err) {
  return err?.code === "23505" &&
    (
      err.constraint === "uq_tblasset_active_client_serial" ||
      String(err.message || "").includes("uq_tblasset_active_client_serial") ||
      String(err.detail || "").includes("uq_tblasset_active_client_serial")
    )
}

function isDuplicateActiveMasterDataError(err) {
  if (err?.code !== "23505") return null

  const text = `${err.constraint || ""} ${err.message || ""} ${err.detail || ""}`

  if (text.includes("uq_tblsites_active_client_name")) return "site"
  if (text.includes("uq_tblsection_active_client_site_name")) return "section"
  if (text.includes("uq_tblsection_active_client_name")) return "section"
  if (text.includes("uq_tblpeople_active_client_name")) return "responsiblePerson"

  return null
}

function isInspectionTagNotNullError(err) {
  return err?.code === "23502" &&
    (
      err.column === "tagnumber" ||
      String(err.message || "").toLowerCase().includes("tagnumber")
    )
}

function isInspectionTagUniqueError(err) {
  if (err?.code !== "23505") return false

  const text = `${err.constraint || ""} ${err.message || ""} ${err.detail || ""}`.toLowerCase()
  return text.includes("tagnumber")
}

function isInspectionSchemaMissingError(err) {
  if (!["42703", "42P01", "23502"].includes(err?.code)) return false

  const text = `${err.table || ""} ${err.column || ""} ${err.constraint || ""} ${err.message || ""} ${err.detail || ""}`.toLowerCase()
  return [
    "tblinspectionphoto",
    "inspectionfrequency",
    "inspector_user_id",
    "inspector_name",
    "inspector_lmi_number",
    "inspector_signature_image",
    "resulttype",
    "inspection_category",
    "severity"
  ].some(name => text.includes(name))
}

async function getExistingColumnSet(tableName, columnNames) {
  const result = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'atec'
      AND table_name = $1
      AND column_name = ANY($2::text[])
    `,
    [tableName, columnNames]
  )

  return new Set(result.rows.map(row => row.column_name))
}

function optionalColumnSql(columns, alias, columnName, fallbackSql, outputName = columnName) {
  return columns.has(columnName)
    ? `${alias}.${columnName}`
    : `${fallbackSql} AS ${outputName}`
}

function duplicateAssetResponse(res, duplicateType, duplicateAssetId) {
  const message = duplicateType === "serial"
    ? "Serial number already exists for this customer."
    : duplicateType === "assetTag"
      ? "Asset tag number already exists for this customer."
      : "Duplicate asset found for this customer."

  return res.status(409).json({
    error: message,
    duplicateAssetId: duplicateAssetId || null
  })
}

function duplicateMasterDataResponse(res, duplicateType, duplicateId) {
  const message = duplicateType === "site"
    ? "Site name already exists for this customer."
    : duplicateType === "section"
      ? "Section name already exists for this customer."
      : duplicateType === "responsiblePerson"
        ? "Responsible person already exists for this customer."
        : "Duplicate record already exists for this customer."

  return res.status(409).json({
    error: message,
    duplicateId: duplicateId || null
  })
}

function applyCriticalSafetyRule(results, criteriaRows) {
  const criteriaById = new Map(
    criteriaRows.map(row => [String(row.criteriaid), row])
  )

  const criticalFailures = results.filter(row =>
    isCriticalFailure(row, criteriaById.get(String(row.criteriaid)))
  )

  if (criticalFailures.length === 0) {
    return {
      results,
      status: null,
      criticalFailures
    }
  }

  const safeCriteria = criteriaRows.find(row =>
    isSafeForContinuedOperation(row.criterianame || row.criteriadescription)
  )

  if (safeCriteria) {
    const existingSafeRow = results.find(row =>
      String(row.criteriaid) === String(safeCriteria.criteriaid)
    )

    if (existingSafeRow) {
      existingSafeRow.result = "NO"
      existingSafeRow.measuredvalue = "NO"
      existingSafeRow.remarks =
        existingSafeRow.remarks ||
        "Automatically marked NOT SAFE because a critical criterion failed."
    } else {
      results.push({
        criteriaid: safeCriteria.criteriaid,
        criterianame: safeCriteria.criterianame || safeCriteria.criteriadescription,
        assetvalue: null,
        measuredvalue: "NO",
        result: "NO",
        remarks: "Automatically marked NOT SAFE because a critical criterion failed."
      })
    }
  }

  return {
    results,
    status: "NOT SAFE",
    criticalFailures
  }
}

function getSafeContinuationStatus(results, criteriaRows) {
  if (results.some(isFailedInspectionResult)) return "NOT SAFE"

  const criteriaById = new Map(
    criteriaRows.map(row => [String(row.criteriaid), row])
  )

  const safeRow = results.find(row => {
    const criteria = criteriaById.get(String(row.criteriaid))
    return isSafeForContinuedOperation(
      criteria?.criterianame ||
      criteria?.criteriadescription ||
      row?.criterianame
    )
  })

  if (!safeRow) return null

  const result = String(safeRow.result || safeRow.measuredvalue || "").trim().toUpperCase()

  if (["NO", "FAIL", "NOT SAFE", "UNSAFE"].includes(result)) return "NOT SAFE"
  if (["YES", "PASS", "SAFE"].includes(result)) return "SAFE"

  return null
}

async function ensureTblUsersHaveIds() {
  await pool.query(`
    WITH numbered AS (
      SELECT
        ctid,
        ROW_NUMBER() OVER (
          ORDER BY COALESCE(NULLIF(fullname, ''), username, email, ctid::text)
        ) AS row_number
      FROM atec.tblusers
      WHERE userid IS NULL
    ),
    base AS (
      SELECT COALESCE(MAX(userid), 0) AS max_userid
      FROM atec.tblusers
    )
    UPDATE atec.tblusers users
    SET userid = base.max_userid + numbered.row_number,
        updated_at = now()
    FROM numbered, base
    WHERE users.ctid = numbered.ctid
  `)
}

app.post("/auth/login", csrfProtection, loginLimiter, asyncRoute(async (req, res) => {
  const username = String(req.body.username || "").trim()
  const password = String(req.body.password || "")

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" })
  }

  const result = await pool.query(
    `
    SELECT
      userid AS user_id,
      username,
      email,
      password AS password_hash,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      COALESCE(
        role,
        CASE
          WHEN userlevel = 1 THEN 'ADMIN'
          WHEN userlevel = 2 THEN 'MANAGER'
          WHEN userlevel = 3 THEN 'INSPECTOR'
          WHEN userlevel = 4 THEN 'VIEWER'
          WHEN userlevel = 5 THEN 'CUSTOMER'
          ELSE 'VIEWER'
        END
      ) AS role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active
    FROM atec.tblusers
    WHERE LOWER(username) = LOWER($1)
       OR LOWER(COALESCE(email, '')) = LOWER($1)
    LIMIT 1
    `,
    [username]
  )

  const user = result.rows[0]
  const isValid = user
    ? await bcrypt.compare(password, user.password_hash)
    : false

  if (!user || !isValid || !user.is_active) {
    return res.status(401).json({ error: "Invalid username or password" })
  }

  await pool.query(
    "UPDATE atec.tblusers SET last_login_at = now() WHERE userid = $1",
    [user.user_id]
  )

  req.user = publicUser(user)
  await req.logAudit("LOGIN", "auth", user.user_id)
  recordActiveUser(req)

  res.cookie("atec_session", signAuthToken(user), authCookieOptions())
  res.json({ user: publicUser(user) })
}))

app.post("/auth/logout", requireAuth, csrfProtection, asyncRoute(async (req, res) => {
  if (req.user?.user_id) {
    await req.logAudit("LOGOUT", "auth", req.user.user_id)
    forgetActiveUser(req.user.user_id)
  }

  res.clearCookie("atec_session", authCookieOptions())
  res.json({ success: true })
}))

app.get("/auth/me", requireAuth, trackActiveUser, (req, res) => {
  res.json({ user: req.user })
})

app.get("/customer-portal/summary", requireAuth, trackActiveUser, asyncRoute(async (req, res) => {
  if (req.user.role !== "CUSTOMER") {
    return res.status(403).json({ error: "Access denied" })
  }

  const effectiveClientId = req.user.clientid
  const portalScope = await resolveCustomerPortalScope(req.user)
  const effectiveResponsibleId = portalScope.responsibleid
  const effectiveSiteId = portalScope.siteid
  const effectiveSectionId = portalScope.sectionid

  if (!effectiveClientId) {
    return res.status(400).json({ error: "No customer is linked to this user." })
  }

  const customerResult = await pool.query(
    `
    SELECT clientid, clientname, clientaddr
    FROM atec.tblclients
    WHERE clientid = $1
      AND COALESCE(archived, false) = false
    LIMIT 1
    `,
    [effectiveClientId]
  )

  if (customerResult.rows.length === 0) {
    return res.status(404).json({ error: "Customer not found" })
  }

  const assetSummary = await pool.query(
    `
    WITH customer_assets AS (
      SELECT assetid, siteid, equiptypeid, ${assetSupportsLoadTestSql("a")} AS supports_load_test
      FROM atec.tblasset a
      WHERE clientid = $1
        AND COALESCE(archived, false) = false
        AND ($2::int IS NULL OR siteid = $2)
        AND ($3::int IS NULL OR sectionid = $3)
        AND ($4::int IS NULL OR responsibleid = $4)
    ),
    latest_visual AS (
      SELECT DISTINCT ON (i.assetid)
        i.assetid,
        i.testdate,
        i.validdate,
        ${effectiveInspectionStatusSql} AS status
      FROM atec.tblinspection i
      JOIN customer_assets a ON a.assetid = i.assetid
      WHERE i.inspectiontype = 'VISUAL'
      ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
    ),
    latest_load AS (
      SELECT DISTINCT ON (i.assetid)
        i.assetid,
        i.testdate,
        i.validdate,
        ${effectiveInspectionStatusSql} AS status
      FROM atec.tblinspection i
      JOIN customer_assets a ON a.assetid = i.assetid
      WHERE i.inspectiontype = 'LOADTEST'
      ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
    )
    SELECT
      count(DISTINCT a.assetid)::int AS active_assets,
      count(DISTINCT a.siteid)::int AS active_sites,
      count(*) FILTER (WHERE latest_visual.assetid IS NULL)::int AS no_visual_assets,
      count(*) FILTER (WHERE a.supports_load_test AND latest_load.assetid IS NULL)::int AS no_loadtest_assets,
      count(*) FILTER (WHERE latest_visual.validdate < CURRENT_DATE)::int AS visual_overdue_assets,
      count(*) FILTER (WHERE a.supports_load_test AND latest_load.validdate < CURRENT_DATE)::int AS loadtest_overdue_assets,
      count(*) FILTER (
        WHERE latest_visual.status = 'NOT SAFE'
           OR latest_load.status = 'NOT SAFE'
      )::int AS not_safe_assets
    FROM customer_assets a
    LEFT JOIN latest_visual ON latest_visual.assetid = a.assetid
    LEFT JOIN latest_load ON latest_load.assetid = a.assetid
    `,
    [effectiveClientId, effectiveSiteId, effectiveSectionId, effectiveResponsibleId]
  )

  const certificateSummary = await pool.query(
    `
    SELECT
      count(*)::int AS total_certificates,
      count(*) FILTER (WHERE ${effectiveInspectionStatusSql} = 'SAFE')::int AS safe_certificates,
      count(*) FILTER (WHERE ${effectiveInspectionStatusSql} = 'NOT SAFE')::int AS not_safe_certificates,
      count(*) FILTER (WHERE i.validdate < CURRENT_DATE)::int AS expired_certificates,
      count(*) FILTER (
        WHERE i.validdate >= CURRENT_DATE
          AND i.validdate <= CURRENT_DATE + INTERVAL '30 days'
      )::int AS expiring_soon_certificates
    FROM atec.tblinspection i
    JOIN atec.tblasset a ON a.assetid = i.assetid
    WHERE a.clientid = $1
      AND ($2::int IS NULL OR a.siteid = $2)
      AND ($3::int IS NULL OR a.sectionid = $3)
      AND ($4::int IS NULL OR a.responsibleid = $4)
    `,
    [effectiveClientId, effectiveSiteId, effectiveSectionId, effectiveResponsibleId]
  )

  const recentCertificates = await pool.query(
    `
    SELECT
      i.testid,
      TO_CHAR(i.testdate, 'YYYY-MM-DD') AS testdate,
      TO_CHAR(i.validdate, 'YYYY-MM-DD') AS validdate,
      i.inspectiontype,
      ${effectiveInspectionStatusSql} AS status,
      a.assetid,
      a.assettagno,
      a.serialno,
      a.description,
      s.sitename,
      sec.sectionname
    FROM atec.tblinspection i
    JOIN atec.tblasset a ON a.assetid = i.assetid
    LEFT JOIN atec.tblsites s ON s.siteid = a.siteid
    LEFT JOIN atec.tblsection sec ON sec.sectionid = a.sectionid
    WHERE a.clientid = $1
      AND ($2::int IS NULL OR a.siteid = $2)
      AND ($3::int IS NULL OR a.sectionid = $3)
      AND ($4::int IS NULL OR a.responsibleid = $4)
    ORDER BY i.testdate DESC NULLS LAST, i.testid DESC
    LIMIT 8
    `,
    [effectiveClientId, effectiveSiteId, effectiveSectionId, effectiveResponsibleId]
  )

  let visitSummary = {
    active_visits: 0,
    outstanding_visit_assets: 0,
    recently_completed_visits: 0
  }

  const visitTables = await pool.query(
    `
    SELECT to_regclass('atec.tblinspectionvisit') AS visit_table,
           to_regclass('atec.tblinspectionvisitasset') AS visit_asset_table
    `
  )

  if (visitTables.rows[0]?.visit_table && visitTables.rows[0]?.visit_asset_table) {
    const visits = await pool.query(
      `
      SELECT
        count(*) FILTER (WHERE v.visit_status IN ('OPEN','PAUSED','RECONCILIATION_REQUIRED'))::int AS active_visits,
        count(va.visitassetid) FILTER (
          WHERE v.visit_status IN ('OPEN','PAUSED','RECONCILIATION_REQUIRED')
            AND va.reconciliation_status = 'OUTSTANDING'
        )::int AS outstanding_visit_assets,
        count(DISTINCT v.visitid) FILTER (
          WHERE v.visit_status = 'COMPLETED'
            AND v.actual_completion_at >= now() - INTERVAL '30 days'
        )::int AS recently_completed_visits
      FROM atec.tblinspectionvisit v
      LEFT JOIN atec.tblinspectionvisitasset va ON va.visitid = v.visitid
      WHERE v.clientid = $1
        AND ($2::int IS NULL OR v.siteid = $2)
      `,
      [effectiveClientId, effectiveSiteId]
    )

    visitSummary = visits.rows[0] || visitSummary
  }

  res.json({
    customer: customerResult.rows[0],
    assetSummary: assetSummary.rows[0] || {},
    certificateSummary: certificateSummary.rows[0] || {},
    visitSummary,
    recentCertificates: recentCertificates.rows
  })
}))

app.get("/customer-portal/assets", requireAuth, trackActiveUser, asyncRoute(async (req, res) => {
  if (req.user.role !== "CUSTOMER") {
    return res.status(403).json({ error: "Access denied" })
  }

  const effectiveClientId = req.user.clientid

  if (!effectiveClientId) {
    return res.status(400).json({ error: "No customer is linked to this user." })
  }

  const requestedPage = parsePositiveInteger(req.query.page, 1, 100000)
  const limit = parsePositiveInteger(req.query.limit, 25, 100)
  const search = String(req.query.search || "").trim()
  const siteid = String(req.query.siteid || "").trim()
  const sectionid = String(req.query.sectionid || "").trim()
  const status = String(req.query.status || "").trim().toUpperCase()
  const values = [effectiveClientId]
  const filters = ["a.clientid = $1", "COALESCE(a.archived, false) = false"]
  const portalScope = await resolveCustomerPortalScope(req.user)

  if (portalScope.responsibleid) {
    values.push(portalScope.responsibleid)
    filters.push(`a.responsibleid = $${values.length}`)
  }

  if (portalScope.siteid) {
    values.push(portalScope.siteid)
    filters.push(`a.siteid = $${values.length}`)
  }

  if (portalScope.sectionid) {
    values.push(portalScope.sectionid)
    filters.push(`a.sectionid = $${values.length}`)
  }

  if (search) {
    values.push(`%${search}%`)
    filters.push(`(
      CAST(a.assetid AS text) ILIKE $${values.length}
      OR COALESCE(a.assettagno, '') ILIKE $${values.length}
      OR COALESCE(a.serialno, '') ILIKE $${values.length}
      OR COALESCE(a.description, '') ILIKE $${values.length}
      OR COALESCE(et.description, '') ILIKE $${values.length}
      OR COALESCE(s.sitename, '') ILIKE $${values.length}
      OR COALESCE(sec.sectionname, '') ILIKE $${values.length}
    )`)
  }

  if (siteid) {
    values.push(siteid)
    filters.push(`a.siteid = $${values.length}`)
  }

  if (sectionid) {
    values.push(sectionid)
    filters.push(`a.sectionid = $${values.length}`)
  }

  if (["OK", "NOT SAFE", "VISUAL OVERDUE", "LOAD TEST OVERDUE", "NO VISUAL", "NO LOAD TEST"].includes(status)) {
    values.push(status)
    filters.push(`asset_status = $${values.length}`)
  }

  const whereSql = filters.join(" AND ")
  const countValues = [...values]
  const assetRowsSql = `
    WITH latest_visual AS (
      SELECT DISTINCT ON (i.assetid)
        i.assetid,
        i.testid,
        i.testdate,
        i.validdate,
        ${effectiveInspectionStatusSql} AS status
      FROM atec.tblinspection i
      WHERE i.inspectiontype = 'VISUAL'
      ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
    ),
    latest_load AS (
      SELECT DISTINCT ON (i.assetid)
        i.assetid,
        i.testid,
        i.testdate,
        i.validdate,
        ${effectiveInspectionStatusSql} AS status
      FROM atec.tblinspection i
      WHERE i.inspectiontype = 'LOADTEST'
      ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
    ),
    scoped_assets AS (
      SELECT
        a.assetid,
        a.clientid,
        a.archived,
        a.assettagno,
        a.serialno,
        a.description,
        a.siteid,
        a.sectionid,
        a.responsibleid,
        et.description AS equipmenttype,
        s.sitename,
        sec.sectionname,
        lv.testid AS visual_testid,
        TO_CHAR(lv.testdate, 'YYYY-MM-DD') AS visual_testdate,
        TO_CHAR(lv.validdate, 'YYYY-MM-DD') AS visual_validdate,
        lv.status AS visual_status,
        ll.testid AS loadtest_testid,
        TO_CHAR(ll.testdate, 'YYYY-MM-DD') AS loadtest_testdate,
        TO_CHAR(ll.validdate, 'YYYY-MM-DD') AS loadtest_validdate,
        ll.status AS loadtest_status,
        CASE
          WHEN lv.status = 'NOT SAFE' OR ll.status = 'NOT SAFE' THEN 'NOT SAFE'
          WHEN lv.assetid IS NULL THEN 'NO VISUAL'
          WHEN ${assetSupportsLoadTestSql("a")} AND ll.assetid IS NULL THEN 'NO LOAD TEST'
          WHEN lv.validdate < CURRENT_DATE THEN 'VISUAL OVERDUE'
          WHEN ${assetSupportsLoadTestSql("a")} AND ll.validdate < CURRENT_DATE THEN 'LOAD TEST OVERDUE'
          ELSE 'OK'
        END AS asset_status
      FROM atec.tblasset a
      LEFT JOIN atec.tblequiptype et ON et.equiptypeid = a.equiptypeid
      LEFT JOIN atec.tblsites s ON s.siteid = a.siteid
      LEFT JOIN atec.tblsection sec ON sec.sectionid = a.sectionid
      LEFT JOIN latest_visual lv ON lv.assetid = a.assetid
      LEFT JOIN latest_load ll ON ll.assetid = a.assetid
    )
    SELECT *
    FROM scoped_assets a
    WHERE ${whereSql}
  `

  const countResult = await pool.query(
    `SELECT count(*)::int AS total FROM (${assetRowsSql}) counted_assets`,
    countValues
  )

  const total = Number(countResult.rows[0]?.total || 0)
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const boundedPage = Math.min(requestedPage, totalPages)
  const offset = (boundedPage - 1) * limit
  const pagedValues = [...values, limit, offset]
  const limitParam = `$${pagedValues.length - 1}`
  const offsetParam = `$${pagedValues.length}`

  const result = await pool.query(
    `
    ${assetRowsSql}
    ORDER BY sitename NULLS LAST, sectionname NULLS LAST, assettagno NULLS LAST, assetid
    LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    pagedValues
  )

  res.json({
    rows: result.rows,
    page: boundedPage,
    limit,
    total,
    totalPages
  })
}))

function isSetupMaintenanceRoute(method, routePath) {
  if (!["POST", "PUT"].includes(method)) return false

  return [
    /^\/customers$/,
    /^\/customers\/[^/]+$/,
    /^\/sites$/,
    /^\/sites\/[^/]+$/,
    /^\/sections$/,
    /^\/sections\/[^/]+$/,
    /^\/responsible-persons$/,
    /^\/responsible-persons\/[^/]+$/,
    /^\/assets$/,
    /^\/assets\/[^/]+$/,
    /^\/assets\/[^/]+\/photos$/
  ].some(pattern => pattern.test(routePath))
}

function authorizeRequest(req, res, next) {
  const role = req.user?.role
  const method = req.method
  const routePath = req.path

  if (role === "ADMIN") return next()

  const isRead = method === "GET"
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method)

  if (
    routePath === "/users/me" &&
    ["GET", "PUT"].includes(method)
  ) {
    return next()
  }

  if (routePath.startsWith("/users/me/signature")) return next()

  if (role === "MANAGER") {
    if (isSetupMaintenanceRoute(method, routePath)) {
      return next()
    }

    if (
      method === "PUT" &&
      /^\/assets\/[^/]+\/(archive|unarchive|move|allocate)$/.test(routePath)
    ) {
      return next()
    }

    if (
      ["POST", "PUT", "DELETE"].includes(method) &&
      /^\/assets\/[^/]+\/nfc/.test(routePath)
    ) {
      return next()
    }

    if (method === "POST" && /^\/certificates\/[^/]+\/email$/.test(routePath)) {
      return next()
    }

    if (method === "DELETE" && /^\/certificates\/[^/]+$/.test(routePath)) {
      return next()
    }

    if (method === "POST" && (
      routePath === "/dashboard/notification-centre/send" ||
      routePath === "/dashboard/notification-centre/scheduler/run"
    )) {
      return next()
    }

    if (
      (
        (method === "GET" && routePath === "/users") ||
        (method === "POST" && routePath === "/users" && req.body?.role === "CUSTOMER") ||
        (method === "PUT" && /^\/users\/[^/]+$/.test(routePath)) ||
        (method === "POST" && /^\/users\/[^/]+\/reset-password$/.test(routePath))
      )
    ) {
      return next()
    }

    if (["POST", "PUT"].includes(method) && routePath.startsWith("/she/")) {
      return next()
    }

    if (routePath.startsWith("/inspection-visits")) {
      return next()
    }

    if (
      method === "POST" &&
      (
        routePath === "/inspections" ||
        /^\/inspections\/[^/]+\/results$/.test(routePath) ||
        /^\/inspections\/[^/]+\/photos$/.test(routePath) ||
        routePath === "/inspection-results"
      )
    ) {
      return next()
    }

    if (
      isRead &&
      (
        routePath.startsWith("/customers") ||
        routePath.startsWith("/sites") ||
        routePath.startsWith("/sections") ||
        routePath.startsWith("/responsible-persons") ||
        routePath.startsWith("/assets") ||
        routePath.startsWith("/inspections") ||
        routePath.startsWith("/inspection-results") ||
        routePath.startsWith("/certificates") ||
        routePath.includes("/certificate") ||
        routePath.startsWith("/reports") ||
        routePath.startsWith("/dashboard") ||
        routePath.startsWith("/equipment-types") ||
        routePath.startsWith("/equipment-type-criteria") ||
        routePath.startsWith("/inspection-photos") ||
        routePath.startsWith("/inspection-visits") ||
        routePath.startsWith("/she/")
      )
    ) {
      return next()
    }

    return res.status(403).json({ error: "Access denied" })
  }

  if (role === "VIEWER") {
    if (method === "POST" && /^\/certificates\/[^/]+\/email$/.test(routePath)) {
      return next()
    }

    if (
      isRead &&
      (
        routePath === "/customers" ||
        routePath === "/sites" ||
        routePath === "/sections" ||
        routePath === "/responsible-persons" ||
        routePath.startsWith("/assets") ||
        routePath.startsWith("/certificates") ||
        routePath.includes("/certificate") ||
        routePath.startsWith("/reports/customer-detailed") ||
        routePath.startsWith("/dashboard") ||
        routePath.startsWith("/inspection-photos") ||
        routePath === "/equipment-types" ||
        routePath.startsWith("/she/")
      )
    ) {
      return next()
    }

    return res.status(403).json({ error: "Access denied" })
  }

  if (role === "CUSTOMER") {
    if (method === "POST" && /^\/certificates\/[^/]+\/email$/.test(routePath)) {
      return next()
    }

    if (
      isRead &&
      (
        routePath.startsWith("/customer-portal") ||
        routePath.startsWith("/certificates") ||
        routePath.includes("/certificate") ||
        routePath.startsWith("/reports/customer-detailed")
      )
    ) {
      return next()
    }

    return res.status(403).json({ error: "Access denied" })
  }

  if (role === "INSPECTOR") {
    if (isSetupMaintenanceRoute(method, routePath)) {
      return next()
    }

    if (method === "DELETE" && /^\/certificates\/[^/]+$/.test(routePath)) {
      return next()
    }

    if (
      isRead &&
      (
        routePath.startsWith("/customers") ||
        routePath.startsWith("/sites") ||
        routePath.startsWith("/sections") ||
        routePath.startsWith("/responsible-persons") ||
        routePath.startsWith("/assets") ||
        routePath.startsWith("/equipment-types") ||
        routePath.startsWith("/equipment-type-criteria") ||
        routePath.startsWith("/inspections") ||
        routePath.startsWith("/inspection-results") ||
        routePath.startsWith("/inspection-photos") ||
        routePath.startsWith("/certificates") ||
        routePath.includes("/certificate") ||
        routePath.startsWith("/dashboard") ||
        routePath === "/auth/me" ||
        routePath.startsWith("/she/")
      )
    ) {
      return next()
    }

    if (
      method === "POST" &&
      (
        routePath === "/inspections" ||
        /^\/inspections\/[^/]+\/results$/.test(routePath) ||
        /^\/inspections\/[^/]+\/photos$/.test(routePath) ||
        /^\/certificates\/[^/]+\/email$/.test(routePath) ||
        routePath === "/she/risk-assessments"
      )
    ) {
      return next()
    }

    if (
      routePath.startsWith("/inspection-visits") &&
      ["GET", "POST", "PUT"].includes(method)
    ) {
      return next()
    }

    if (method === "PUT" && /^\/she\/risk-assessments\/[^/]+/.test(routePath)) {
      return next()
    }

    if (
      ["PUT", "DELETE"].includes(method) &&
      /^\/inspection-photos\/[^/]+$/.test(routePath)
    ) {
      return next()
    }

    return res.status(403).json({ error: "Access denied" })
  }

  return res.status(403).json({ error: "Access denied" })
}

async function enforceInspectorInspectionOwnership(req, res, next) {
  if (req.user?.role !== "INSPECTOR") {
    return next()
  }

  if (req.method !== "POST" || !/^\/inspections\/[^/]+\/results$/.test(req.path)) {
    return next()
  }

  const testid = req.params.testid || req.path.split("/")[2]
  const inspectionResult = await pool.query(
    `
    SELECT inspector_user_id
    FROM atec.tblinspection
    WHERE testid = $1
    `,
    [testid]
  )

  if (inspectionResult.rows.length === 0) {
    return res.status(404).json({ error: "Inspection not found" })
  }

  if (String(inspectionResult.rows[0].inspector_user_id || "") !== String(req.user.user_id)) {
    return res.status(403).json({
      error: "Inspectors may only update inspections created under their own login"
    })
  }

  return next()
}

async function authorizeUploadRequest(req, res, next) {
  if (req.user?.role !== "CUSTOMER") {
    return next()
  }

  if (!req.user.clientid) {
    return res.status(403).json({ error: "Access denied" })
  }

  let uploadPath

  try {
    uploadPath = `/uploads${decodeURIComponent(req.path || "")}`.replace(/\\/g, "/")
  } catch (err) {
    return res.status(400).json({ error: "Invalid file path" })
  }

  const normalizedPath = path.posix.normalize(uploadPath)

  if (!normalizedPath.startsWith("/uploads/") || normalizedPath.includes("/../")) {
    return res.status(400).json({ error: "Invalid file path" })
  }

  const uploadBasename = path.posix.basename(normalizedPath)

  const accessResult = await pool.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM atec.tblasset a
      WHERE a.clientid = $1
        AND ($2 IN (a.media1, a.media2) OR $3 IN (a.media1, a.media2))

      UNION ALL

      SELECT 1
      FROM atec.tblinspection i
      JOIN atec.tblasset a
        ON i.assetid = a.assetid
      WHERE a.clientid = $1
        AND ($2 IN (i.photo1, i.photo2, i.inspector_signature_image) OR $3 IN (i.photo1, i.photo2, i.inspector_signature_image))

      UNION ALL

      SELECT 1
      FROM atec.tblinspectionphoto p
      JOIN atec.tblasset a
        ON p.assetid = a.assetid
      WHERE a.clientid = $1
        AND (p.photo_path = $2 OR p.photo_path = $3)
    ) AS allowed
    `,
    [req.user.clientid, normalizedPath, uploadBasename]
  )

  if (!accessResult.rows[0]?.allowed) {
    return res.status(403).json({ error: "Access denied" })
  }

  return next()
}

app.use("/uploads", requireAuth, trackActiveUser, asyncRoute(authorizeUploadRequest), express.static(uploadsRoot));
app.use(requireAuth)
app.use(trackActiveUser)
app.use(csrfProtection)
app.use(authorizeRequest)
app.use(asyncRoute(enforceInspectorInspectionOwnership))

function getDirectorySizeBytes(folderPath) {
  let total = 0

  if (!fs.existsSync(folderPath)) return total

  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    const entryPath = path.join(folderPath, entry.name)

    if (entry.isDirectory()) {
      total += getDirectorySizeBytes(entryPath)
    } else if (entry.isFile()) {
      total += fs.statSync(entryPath).size
    }
  }

  return total
}

app.get("/admin/system-health", asyncRoute(async (req, res) => {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Access denied" })
  }

  const dbSize = await pool.query("SELECT pg_database_size(current_database()) AS bytes")

  res.json({
    uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    database: {
      sizeBytes: Number(dbSize.rows[0]?.bytes || 0),
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      }
    },
    uploads: {
      root: uploadsRoot,
      sizeBytes: getDirectorySizeBytes(uploadsRoot)
    },
    pdf: {
      concurrency: pdfConcurrency,
      maxBulkCertificates: bulkPdfMaxCertificates,
      ...pdfQueueMetrics
    },
    performance: performanceSummary()
  })
}))

app.get("/admin/system-info", asyncRoute(async (req, res) => {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Access denied" })
  }

  res.json(await buildSystemInfo({
    pool,
    performance: performanceSummary(),
    pdf: {
      concurrency: pdfConcurrency,
      maxBulkCertificates: bulkPdfMaxCertificates,
      ...pdfQueueMetrics
    },
    projectRoot: path.join(__dirname, ".."),
    startedAt: backendStartedAt,
    port: PORT,
    appVersion: backendPackage.version,
    activeUsers: activeUserSummary()
  }))
}))

app.use((req, res, next) => {
  const methodAction = {
    POST: "CREATE",
    PUT: "UPDATE",
    PATCH: "UPDATE",
    DELETE: "DELETE"
  }[req.method]

  if (!methodAction) return next()

  res.on("finish", () => {
    if (res.statusCode >= 400) return

    const module = req.path.split("/").filter(Boolean)[0] || "api"
    const recordId =
      req.params.id ||
      req.params.testid ||
      req.params.assetid ||
      req.body?.assetid ||
      null

    logAudit(req, methodAction, module, recordId, {
      method: req.method,
      path: req.path
    })
  })

  next()
})

app.get("/users", asyncRoute(async (req, res) => {
  await ensureTblUsersHaveIds()

  const values = []
  let roleFilterSql = ""
  if (!canManageAllUsers(req.user)) {
    values.push("CUSTOMER")
    roleFilterSql = `
      WHERE COALESCE(
        role,
        CASE WHEN userlevel = 5 THEN 'CUSTOMER' ELSE 'VIEWER' END
      ) = $1
    `
  }

  const result = await pool.query(
    `
    SELECT
      userid AS user_id,
      username,
      email,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      COALESCE(
        role,
        CASE
          WHEN userlevel = 1 THEN 'ADMIN'
          WHEN userlevel = 2 THEN 'MANAGER'
          WHEN userlevel = 3 THEN 'INSPECTOR'
          WHEN userlevel = 4 THEN 'VIEWER'
          WHEN userlevel = 5 THEN 'CUSTOMER'
          ELSE 'VIEWER'
        END
      ) AS role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active,
      created_at,
      last_login_at
    FROM atec.tblusers
    ${roleFilterSql}
    ORDER BY COALESCE(NULLIF(fullname, ''), username), username
    `,
    values
  )

  res.json(result.rows)
}))

app.get("/users/me", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `
    SELECT
      userid AS user_id,
      username,
      email,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      COALESCE(
        role,
        CASE
          WHEN userlevel = 1 THEN 'ADMIN'
          WHEN userlevel = 2 THEN 'MANAGER'
          WHEN userlevel = 3 THEN 'INSPECTOR'
          WHEN userlevel = 4 THEN 'VIEWER'
          WHEN userlevel = 5 THEN 'CUSTOMER'
          ELSE 'VIEWER'
        END
      ) AS role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active
    FROM atec.tblusers
    WHERE userid = $1
    `,
    [req.user.user_id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "User profile not found" })
  }

  res.json({ user: result.rows[0] })
}))

app.put("/users/me", asyncRoute(async (req, res) => {
  const fullName = String(req.body?.full_name || "").trim()
  const email = String(req.body?.email || "").trim()
  const lmiNumber = String(req.body?.lmi_number || "").trim()

  if (!fullName) {
    return res.status(400).json({ error: "Full name is required" })
  }

  if (email && !isValidEmailAddress(email)) {
    return res.status(400).json({ error: "Enter a valid email address" })
  }

  const result = await pool.query(
    `
    UPDATE atec.tblusers
    SET
      fullname = $1,
      email = NULLIF($2, ''),
      lmi_no = NULLIF($3, ''),
      updated_at = now()
    WHERE userid = $4
    RETURNING
      userid AS user_id,
      username,
      email,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active
    `,
    [fullName, email, lmiNumber, req.user.user_id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "User profile not found" })
  }

  res.cookie("atec_session", signAuthToken(result.rows[0]), authCookieOptions())

  await req.logAudit("UPDATE_PROFILE", "users", req.user.user_id)
  res.json({ user: result.rows[0] })
}))

app.post("/users", asyncRoute(async (req, res) => {
  const {
    username,
    email,
    password,
    full_name,
    role,
    lmi_number,
    clientid,
    siteid,
    sectionid,
    is_active
  } = req.body
  const trimmedEmail = String(email || "").trim()
  const trimmedUsername = String(username || "").trim()
  const effectiveUsername = role === "CUSTOMER" ? trimmedEmail : trimmedUsername

  if (!effectiveUsername || !password || !full_name || !role) {
    return res.status(400).json({ error: "Username, password, full name and role are required" })
  }

  const passwordValidation = validatePassword(password)
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: passwordValidation.message })
  }

  if (!validRoles().includes(role)) {
    return res.status(400).json({ error: "Invalid role" })
  }

  if (!canManageAllUsers(req.user) && role !== "CUSTOMER") {
    return res.status(403).json({ error: "Managers can only create customer portal users" })
  }

  if (trimmedEmail && !isValidEmailAddress(trimmedEmail)) {
    return res.status(400).json({ error: "Enter a valid email address" })
  }

  if (role === "CUSTOMER" && !trimmedEmail) {
    return res.status(400).json({ error: "Customer portal users must use their email address as the username" })
  }

  if (role === "CUSTOMER" && !clientid) {
    return res.status(400).json({ error: "Customer portal users must be linked to a customer" })
  }

  if (role === "CUSTOMER" && !(await customerUserSiteBelongsToClient(pool, { siteid, clientid }))) {
    return res.status(400).json({ error: "The selected site does not belong to this customer" })
  }

  const passwordHash = await bcrypt.hash(String(password), 12)

  const result = await pool.query(
    `
    INSERT INTO atec.tblusers
      (userid, username, email, password, fullname, userlevel, role, lmi_no, clientid, siteid, sectionid, is_active)
    VALUES
      ((SELECT COALESCE(MAX(userid), 0) + 1 FROM atec.tblusers), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, true))
    RETURNING
      userid AS user_id,
      username,
      email,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active
    `,
    [
      effectiveUsername,
      trimmedEmail || null,
      passwordHash,
      String(full_name).trim(),
      roleToUserLevel(role),
      role,
      role === "CUSTOMER" ? null : (lmi_number ? String(lmi_number).trim() : null),
      role === "CUSTOMER" ? clientid || null : null,
      role === "CUSTOMER" ? siteid || null : null,
      null,
      is_active
    ]
  )

  await req.logAudit("CREATE", "users", result.rows[0].user_id)
  res.status(201).json(result.rows[0])
}))

app.put("/users/:id", asyncRoute(async (req, res) => {
  const {
    email,
    password,
    full_name,
    role,
    lmi_number,
    clientid,
    siteid,
    sectionid,
    is_active
  } = req.body
  const trimmedEmail = String(email || "").trim()

  if (!full_name || !role) {
    return res.status(400).json({ error: "Full name and role are required" })
  }

  if (!validRoles().includes(role)) {
    return res.status(400).json({ error: "Invalid role" })
  }

  if (!canManageAllUsers(req.user)) {
    const target = await pool.query(
      `
      SELECT
        COALESCE(
          role,
          CASE
            WHEN userlevel = 1 THEN 'ADMIN'
            WHEN userlevel = 2 THEN 'MANAGER'
            WHEN userlevel = 3 THEN 'INSPECTOR'
            WHEN userlevel = 4 THEN 'VIEWER'
            WHEN userlevel = 5 THEN 'CUSTOMER'
            ELSE 'VIEWER'
          END
        ) AS role
      FROM atec.tblusers
      WHERE userid = $1
      `,
      [req.params.id]
    )

    if (target.rows.length === 0) {
      return res.status(404).json({ error: "User not found" })
    }

    if (target.rows[0].role !== "CUSTOMER" || role !== "CUSTOMER") {
      return res.status(403).json({ error: "Managers can only edit customer portal users" })
    }
  }

  if (trimmedEmail && !isValidEmailAddress(trimmedEmail)) {
    return res.status(400).json({ error: "Enter a valid email address" })
  }

  if (role === "CUSTOMER" && !trimmedEmail) {
    return res.status(400).json({ error: "Customer portal users must use their email address as the username" })
  }

  if (role === "CUSTOMER" && !clientid) {
    return res.status(400).json({ error: "Customer portal users must be linked to a customer" })
  }

  if (role === "CUSTOMER" && !(await customerUserSiteBelongsToClient(pool, { siteid, clientid }))) {
    return res.status(400).json({ error: "The selected site does not belong to this customer" })
  }

  const params = [
    trimmedEmail || null,
    String(full_name).trim(),
    roleToUserLevel(role),
    role,
    role === "CUSTOMER" ? null : (lmi_number ? String(lmi_number).trim() : null),
    role === "CUSTOMER" ? clientid || null : null,
    role === "CUSTOMER" ? siteid || null : null,
    null,
    is_active === false ? false : true,
    req.params.id
  ]

  let passwordSql = ""
  if (password !== undefined && password !== null && String(password).length > 0) {
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.message })
    }

    params.push(await bcrypt.hash(String(password), 12))
    passwordSql = `, password = $${params.length}`
  }

  const result = await pool.query(
    `
    UPDATE atec.tblusers
    SET
      username = CASE WHEN $4 = 'CUSTOMER' THEN $1 ELSE username END,
      email = $1,
      fullname = $2,
      userlevel = $3,
      role = $4,
      lmi_no = $5,
      clientid = $6,
      siteid = $7,
      sectionid = $8,
      is_active = $9,
      updated_at = now()
      ${passwordSql}
    WHERE userid = $10
    RETURNING
      userid AS user_id,
      username,
      email,
      COALESCE(NULLIF(fullname, ''), username) AS full_name,
      role,
      lmi_no AS lmi_number,
      usersignature AS signature_image,
      clientid,
      siteid,
      sectionid,
      is_active
    `,
    params
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "User not found" })
  }

  await req.logAudit("UPDATE", "users", req.params.id)
  res.json(result.rows[0])
}))

app.delete("/users/:id", asyncRoute(async (req, res) => {
  if (String(req.params.id) === String(req.user.user_id)) {
    return res.status(400).json({ error: "You cannot delete your own logged-in user" })
  }

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const userResult = await client.query(
      `SELECT userid AS user_id, username, email, is_active
       FROM atec.tblusers
       WHERE userid = $1
       FOR UPDATE`,
      [req.params.id]
    )

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "User not found" })
    }

    if (userResult.rows[0].is_active) {
      await client.query("ROLLBACK")
      return res.status(409).json({ error: "Deactivate this user before permanently deleting the account." })
    }

    const foreignKeys = await client.query(`
      SELECT ns.nspname AS table_schema, rel.relname AS table_name, att.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY key(attnum, ord) ON true
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = key.attnum
      WHERE con.contype = 'f'
        AND con.confrelid = 'atec.tblusers'::regclass
    `)

    const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`
    const linkedRecords = []
    for (const foreignKey of foreignKeys.rows) {
      const countResult = await client.query(
        `SELECT count(*)::int AS count
         FROM ${quoteIdentifier(foreignKey.table_schema)}.${quoteIdentifier(foreignKey.table_name)}
         WHERE ${quoteIdentifier(foreignKey.column_name)} = $1`,
        [req.params.id]
      )
      if (countResult.rows[0].count > 0) {
        linkedRecords.push({ table: foreignKey.table_name, count: countResult.rows[0].count })
      }
    }

    if (linkedRecords.length > 0) {
      await client.query("ROLLBACK")
      return res.status(409).json({
        error: "This user has historical records and must remain inactive.",
        linked_records: linkedRecords
      })
    }

    await client.query("DELETE FROM atec.tblusers WHERE userid = $1", [req.params.id])
    await client.query("COMMIT")
    await req.logAudit("PURGE", "users", req.params.id, { username: userResult.rows[0].username })
    res.json({ success: true, permanently_deleted: true, user: userResult.rows[0] })
  } catch (error) {
    await client.query("ROLLBACK")
    if (error.code === "23503") {
      return res.status(409).json({ error: "This user has historical records and must remain inactive." })
    }
    throw error
  } finally {
    client.release()
  }
}))

app.post("/users/me/signature",
  uploadLimiter,
  upload.single("signature"),
  validateUploadedImages,
  asyncRoute(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Signature image is required" })
    }

    const signatureImage = `/uploads/signatures/${req.file.filename}`
    const result = await pool.query(
      `
      UPDATE atec.tblusers
      SET usersignature = $1, updated_at = now()
      WHERE userid = $2
      RETURNING
        userid AS user_id,
        username,
        email,
        COALESCE(NULLIF(fullname, ''), username) AS full_name,
        role,
        lmi_no AS lmi_number,
        usersignature AS signature_image,
        clientid,
        siteid,
        sectionid,
        is_active
      `,
      [signatureImage, req.user.user_id]
    )

    await req.logAudit("SIGNATURE_CHANGE", "users", req.user.user_id)
    res.cookie("atec_session", signAuthToken(result.rows[0]), authCookieOptions())
    res.json({ user: result.rows[0] })
  })
)

app.post("/users/:id/signature",
  uploadLimiter,
  upload.single("signature"),
  validateUploadedImages,
  asyncRoute(async (req, res) => {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Only admins can change user signatures" })
    }

    if (!req.file) {
      return res.status(400).json({ error: "Signature image is required" })
    }

    const signatureImage = `/uploads/signatures/${req.file.filename}`
    const result = await pool.query(
      `
      UPDATE atec.tblusers
      SET usersignature = $1, updated_at = now()
      WHERE userid = $2
      RETURNING
        userid AS user_id,
        username,
        email,
        COALESCE(NULLIF(fullname, ''), username) AS full_name,
        role,
        lmi_no AS lmi_number,
        usersignature AS signature_image,
        clientid,
        siteid,
        sectionid,
        is_active
      `,
      [signatureImage, req.params.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" })
    }

    await req.logAudit("SIGNATURE_CHANGE", "users", req.params.id)
    res.json({ user: result.rows[0] })
  })
)

app.post("/users/:id/reset-password", asyncRoute(async (req, res) => {
  if (!canManageCustomerPortalUsers(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  if (!canManageAllUsers(req.user)) {
    const target = await pool.query(
      `
      SELECT
        COALESCE(
          role,
          CASE
            WHEN userlevel = 1 THEN 'ADMIN'
            WHEN userlevel = 2 THEN 'MANAGER'
            WHEN userlevel = 3 THEN 'INSPECTOR'
            WHEN userlevel = 4 THEN 'VIEWER'
            WHEN userlevel = 5 THEN 'CUSTOMER'
            ELSE 'VIEWER'
          END
        ) AS role
      FROM atec.tblusers
      WHERE userid = $1
      `,
      [req.params.id]
    )

    if (target.rows.length === 0) {
      return res.status(404).json({ error: "User not found" })
    }

    if (target.rows[0].role !== "CUSTOMER") {
      return res.status(403).json({ error: "Managers can only reset customer portal user passwords" })
    }
  }

  const password = String(req.body.password || "")
  const passwordValidation = validatePassword(password)
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: passwordValidation.message })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const result = await pool.query(
    `
    UPDATE atec.tblusers
    SET password = $1,
        updated_at = now()
    WHERE userid = $2
    RETURNING userid AS user_id
    `,
    [passwordHash, req.params.id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "User not found" })
  }

  await req.logAudit("PASSWORD_RESET", "users", req.params.id)
  res.json({ success: true })
}))

app.get("/customers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM atec.tblclients
      ORDER BY clientname
    `)

    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.post("/customers", async (req, res) => {
  try {
    const clientname = String(req.body.clientname || "").trim();
    const clientaddr = String(req.body.clientaddr || "").trim();
    const notificationLeadDays = Math.max(0, Number(req.body.notification_lead_days ?? 30) || 30)

    if (!clientname || !clientaddr) {
      return res.status(400).json({ error: "Customer name and registered or head-office address are required" });
    }

    const result = await pool.query(
      `INSERT INTO atec.tblclients (
         clientname,
         clientaddr,
         notify_expiring_certificates,
         notify_overdue_assets,
         notify_failed_assets,
         notify_visit_exceptions,
         notification_lead_days
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        clientname,
        clientaddr,
        req.body.notify_expiring_certificates !== false,
        req.body.notify_overdue_assets !== false,
        req.body.notify_failed_assets !== false,
        req.body.notify_visit_exceptions !== false,
        notificationLeadDays
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/customers/:id/archive", async (req, res) => {
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    const { id } = req.params

    await client.query(
      `UPDATE atec.tblclients SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblsites SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblsection SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblpeople SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblasset SET archived = true WHERE clientid = $1`,
      [id]
    )

    await client.query("COMMIT")

    res.json({ success: true })
  } catch (err) {
    await client.query("ROLLBACK")
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  } finally {
    client.release()
  }
})

app.put("/customers/:id/unarchive", async (req, res) => {
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    const { id } = req.params

    await client.query(
      `UPDATE atec.tblclients SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblsites SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblsection SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblpeople SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query(
      `UPDATE atec.tblasset SET archived = false WHERE clientid = $1`,
      [id]
    )

    await client.query("COMMIT")

    res.json({ success: true })
  } catch (err) {
    await client.query("ROLLBACK")
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  } finally {
    client.release()
  }
})

app.put("/customers/:id", async (req, res) => {

  try {

    const { id } = req.params

    const clientname = String(req.body.clientname || "").trim()
    const clientaddr = String(req.body.clientaddr || "").trim()
    const notificationLeadDays = Math.max(0, Number(req.body.notification_lead_days ?? 30) || 30)

    if (!clientname || !clientaddr) {
      return res.status(400).json({ error: "Customer name and registered or head-office address are required" })
    }

    const result = await pool.query(
      `
      UPDATE atec.tblclients
      SET
        clientname = $1,
        clientaddr = $2,
        notify_expiring_certificates = COALESCE($3, notify_expiring_certificates),
        notify_overdue_assets = COALESCE($4, notify_overdue_assets),
        notify_failed_assets = COALESCE($5, notify_failed_assets),
        notify_visit_exceptions = COALESCE($6, notify_visit_exceptions),
        notification_lead_days = COALESCE($7, notification_lead_days)
      WHERE clientid = $8
      RETURNING *
      `,
      [
        clientname,
        clientaddr,
        typeof req.body.notify_expiring_certificates === "boolean" ? req.body.notify_expiring_certificates : null,
        typeof req.body.notify_overdue_assets === "boolean" ? req.body.notify_overdue_assets : null,
        typeof req.body.notify_failed_assets === "boolean" ? req.body.notify_failed_assets : null,
        typeof req.body.notify_visit_exceptions === "boolean" ? req.body.notify_visit_exceptions : null,
        req.body.notification_lead_days === undefined ? null : notificationLeadDays,
        id
      ]
    )

    const [topCustomersResult, topEquipmentResult] = await Promise.all([
      pool.query(`
        SELECT
          c.clientname,
          COUNT(DISTINCT s.siteid)::int AS sites,
          COUNT(a.assetid)::int AS assets
        FROM atec.tblclients c
        LEFT JOIN atec.tblsites s
          ON c.clientid = s.clientid
        LEFT JOIN atec.tblasset a
          ON c.clientid = a.clientid
          AND COALESCE(a.archived, false) = false
        GROUP BY c.clientid, c.clientname
        ORDER BY COUNT(a.assetid) DESC, c.clientname ASC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          COALESCE(et.description, 'Unknown') AS equipmenttype,
          COUNT(a.assetid)::int AS total
        FROM atec.tblasset a
        LEFT JOIN atec.tblequiptype et
          ON a.equiptypeid = et.equiptypeid
        WHERE COALESCE(a.archived, false) = false
        GROUP BY COALESCE(et.description, 'Unknown')
        ORDER BY COUNT(a.assetid) DESC, COALESCE(et.description, 'Unknown') ASC
        LIMIT 10
      `)
    ])

    res.json({
      ...result.rows[0],
      topcustomers: topCustomersResult.rows,
      topequipment: topEquipmentResult.rows
    })

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }

})

app.get("/sites", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.siteid,
        s.clientid,
        s.sitename,
        COALESCE(s.archived, false) AS archived,
        c.clientname
      FROM atec.tblsites s
      LEFT JOIN atec.tblclients c
        ON s.clientid = c.clientid
      ORDER BY c.clientname, s.sitename
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.post("/sites", async (req, res) => {
  try {
    const { clientid, sitename } = req.body;
    const normalizedSiteName = normalizeAssetLookupValue(sitename)

    if (normalizedSiteName) {
      const duplicateCheck = await pool.query(
        `
        SELECT siteid
        FROM atec.tblsites
        WHERE clientid = $1
          AND lower(trim(sitename)) = $2
          AND COALESCE(archived, false) = false
        LIMIT 1
        `,
        [clientid, normalizedSiteName]
      )

      if (duplicateCheck.rows.length > 0) {
        return duplicateMasterDataResponse(res, "site", duplicateCheck.rows[0].siteid)
      }
    }

    const result = await pool.query(
      `INSERT INTO atec.tblsites (clientid, sitename)
       VALUES ($1, $2)
       RETURNING *`,
      [clientid, sitename]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    const duplicateType = isDuplicateActiveMasterDataError(err)
    if (duplicateType) return duplicateMasterDataResponse(res, duplicateType)

    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/sites/:id", async (req, res) => {
  try {

    const { id } = req.params
    const { sitename } = req.body
    const normalizedSiteName = normalizeAssetLookupValue(sitename)

    if (normalizedSiteName) {
      const duplicateCheck = await pool.query(
        `
        SELECT other.siteid
        FROM atec.tblsites current_site
        JOIN atec.tblsites other
          ON other.clientid = current_site.clientid
        WHERE current_site.siteid = $1
          AND other.siteid <> $1
          AND lower(trim(other.sitename)) = $2
          AND COALESCE(other.archived, false) = false
        LIMIT 1
        `,
        [id, normalizedSiteName]
      )

      if (duplicateCheck.rows.length > 0) {
        return duplicateMasterDataResponse(res, "site", duplicateCheck.rows[0].siteid)
      }
    }

    const result = await pool.query(
      `
      UPDATE atec.tblsites
      SET sitename = $1
      WHERE siteid = $2
      RETURNING *
      `,
      [
        sitename,
        id
      ]
    )

    const [topCustomersResult, topEquipmentResult] = await Promise.all([
      pool.query(`
        SELECT
          c.clientname,
          COUNT(DISTINCT s.siteid)::int AS sites,
          COUNT(a.assetid)::int AS assets
        FROM atec.tblclients c
        LEFT JOIN atec.tblsites s
          ON c.clientid = s.clientid
        LEFT JOIN atec.tblasset a
          ON c.clientid = a.clientid
          AND COALESCE(a.archived, false) = false
        GROUP BY c.clientid, c.clientname
        ORDER BY COUNT(a.assetid) DESC, c.clientname ASC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          COALESCE(et.description, 'Unknown') AS equipmenttype,
          COUNT(a.assetid)::int AS total
        FROM atec.tblasset a
        LEFT JOIN atec.tblequiptype et
          ON a.equiptypeid = et.equiptypeid
        WHERE COALESCE(a.archived, false) = false
        GROUP BY COALESCE(et.description, 'Unknown')
        ORDER BY COUNT(a.assetid) DESC, COALESCE(et.description, 'Unknown') ASC
        LIMIT 10
      `)
    ])

    res.json({
      ...result.rows[0],
      topcustomers: topCustomersResult.rows,
      topequipment: topEquipmentResult.rows
    })

  } catch (err) {

    console.error(err)
    const duplicateType = isDuplicateActiveMasterDataError(err)
    if (duplicateType) return duplicateMasterDataResponse(res, duplicateType)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

app.put("/sites/:id/archive", async (req, res) => {
  try {
    const { id } = req.params

    const activeAssets = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM atec.tblasset
      WHERE siteid = $1
        AND COALESCE(archived, false) = false
      `,
      [id]
    )

    if (activeAssets.rows[0].count > 0) {
      return res.status(400).json({
        error: "This site has active assets. Move or archive the assets first."
      })
    }

    const result = await pool.query(
      `
      UPDATE atec.tblsites
      SET archived = true
      WHERE siteid = $1
      RETURNING *
      `,
      [id]
    )

    const [topCustomersResult, topEquipmentResult] = await Promise.all([
      pool.query(`
        SELECT
          c.clientname,
          COUNT(DISTINCT s.siteid)::int AS sites,
          COUNT(a.assetid)::int AS assets
        FROM atec.tblclients c
        LEFT JOIN atec.tblsites s ON c.clientid = s.clientid
        LEFT JOIN atec.tblasset a
          ON c.clientid = a.clientid
          AND COALESCE(a.archived, false) = false
        GROUP BY c.clientid, c.clientname
        ORDER BY COUNT(a.assetid) DESC, c.clientname ASC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          COALESCE(et.description, 'Unknown') AS equipmenttype,
          COUNT(a.assetid)::int AS total
        FROM atec.tblasset a
        LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
        WHERE COALESCE(a.archived, false) = false
        GROUP BY COALESCE(et.description, 'Unknown')
        ORDER BY COUNT(a.assetid) DESC, COALESCE(et.description, 'Unknown') ASC
        LIMIT 10
      `)
    ])

    res.json({
      ...result.rows[0],
      topcustomers: topCustomersResult.rows,
      topequipment: topEquipmentResult.rows
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.put("/sites/:id/unarchive", async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `
      UPDATE atec.tblsites
      SET archived = false
      WHERE siteid = $1
      RETURNING *
      `,
      [id]
    )

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

const assetSortColumns = {
  assetid: "a.assetid",
  assettagno: "a.assettagno",
  serialno: "COALESCE(NULLIF(a.serialno, ''), a.hoistserialno)",
  hoistserialno: "a.hoistserialno",
  clientname: "c.clientname",
  sitename: "s.sitename",
  sectionname: "sec.sectionname",
  responsiblename: "p.name",
  equipmenttype: "et.description",
  description: "a.description",
  qrcode: "a.qrcode"
}

const assetSearchColumns = {
  assetid: "a.assetid::text",
  assettagno: "a.assettagno",
  serialno: "COALESCE(a.serialno, a.hoistserialno)",
  hoistserialno: "a.hoistserialno",
  clientname: "c.clientname",
  sitename: "s.sitename",
  sectionname: "sec.sectionname",
  responsiblename: "p.name",
  equipmenttype: "et.description",
  description: "a.description",
  qrcode: "a.qrcode"
}

async function getPagedAssets(req, defaultSortKey = "assetid", defaultSortDirection = "desc") {
  const page = parsePositiveInteger(req.query.page, 1, 100000)
  const limit = parsePositiveInteger(req.query.limit, 25, 250)
  const offset = (page - 1) * limit
  const search = String(req.query.search || "").trim()
  const searchBy = String(req.query.searchBy || "all")
  const archiveMode = String(req.query.archiveMode || "active").toLowerCase()
  const sortKey = assetSortColumns[req.query.sortKey] ? req.query.sortKey : defaultSortKey
  const sortDirection = String(req.query.sortDir || defaultSortDirection).toLowerCase() === "asc" ? "ASC" : "DESC"
  const values = []
  const where = []

  if (archiveMode === "archived") {
    where.push("COALESCE(a.archived, false) = true")
  } else if (archiveMode !== "all") {
    where.push("COALESCE(a.archived, false) = false")
  }

  if (req.user.role === "CUSTOMER") {
    if (!req.user.clientid) {
      return { rows: [], total: 0, page, limit }
    }

    values.push(req.user.clientid)
    where.push(`a.clientid = $${values.length}`)
  }

  if (search) {
    values.push(`%${search.toLowerCase()}%`)
    const searchParam = `$${values.length}`

    if (searchBy !== "all" && assetSearchColumns[searchBy]) {
      where.push(`LOWER(COALESCE(${assetSearchColumns[searchBy]}, '')) LIKE ${searchParam}`)
    } else {
      where.push(`(
        LOWER(COALESCE(a.assetid::text, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(a.assettagno, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(a.serialno, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(a.hoistserialno, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(a.qrcode, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(a.description, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(c.clientname, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(s.sitename, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(sec.sectionname, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(p.name, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(et.description, '')) LIKE ${searchParam}
      )`)
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const orderSql = sortKey === "client_section_serial"
    ? [
        `c.clientname ${sortDirection} NULLS LAST`,
        `sec.sectionname ${sortDirection} NULLS LAST`,
        `COALESCE(NULLIF(a.serialno, ''), a.hoistserialno) ${sortDirection} NULLS LAST`
      ].join(", ")
    : `${assetSortColumns[sortKey] || assetSortColumns.assetid} ${sortDirection} NULLS LAST`

  const countResult = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM atec.tblasset a
    LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
    LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
    LEFT JOIN atec.tblpeople p ON a.responsibleid = p.personid
    LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
    ${whereSql}
    `,
    values
  )

  values.push(limit, offset)
  const limitParam = `$${values.length - 1}`
  const offsetParam = `$${values.length}`

  const result = await pool.query(
    `
    SELECT
      a.assetid,
      a.clientid,
      a.siteid,
      a.sectionid,
      a.responsibleid,
      a.equiptypeid,
      a.serialno,
      a.assettagno,
      a.manufacturer,
      a.description,
      a.wll,
      a.heightoflift,
      a.numberofchainfalls,
      a.oemtophooksize,
      a.oembottomhooksize,
      a.loadchaindiameter,
      a.effectivelength,
      a.span,
      a.permissibledeflection,
      a.hooksize,
      a.steelwireropemm,
      a.hoistdescription,
      a.hoistserialno,
      a.auxhoistdescription,
      a.auxhoistserialno,
      a.auxhoistwll,
      a.auxhoisthooksize,
      a.auxhoistropemm,
      a.media1,
      a.media2,
      a.qrcode,
      a.manufactdate,
      a.archived,
      c.clientname,
      s.sitename,
      sec.sectionname,
      et.description AS equipmenttype,
      et.equipgroupid
    FROM atec.tblasset a
    LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
    LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
    LEFT JOIN atec.tblpeople p ON a.responsibleid = p.personid
    LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
    ${whereSql}
    ORDER BY ${orderSql}, a.assetid DESC
    LIMIT ${limitParam}
    OFFSET ${offsetParam}
    `,
    values
  )

  return {
    rows: result.rows,
    total: countResult.rows[0]?.total || 0,
    page,
    limit
  }
}

app.get("/assets", searchLimiter, async (req, res) => {
  try {
    res.json(await getPagedAssets(req, "assetid", "desc"))
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/inspections/assets", searchLimiter, async (req, res) => {
  try {
    res.json(await getPagedAssets(req, "client_section_serial", "asc"))
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/assets/qr/:code", searchLimiter, async (req, res) => {
  try {
    const code = String(req.params.code || "").trim()

    if (!code) {
      return res.status(400).json({ error: "QR code is required" })
    }

    const result = await pool.query(
      `
      SELECT
        a.*,
        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype,
        et.equipgroupid
      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      WHERE COALESCE(a.archived, false) = false
        AND (
          LOWER(COALESCE(a.qrcode, '')) = LOWER($1)
          OR CAST(a.assetid AS text) = $1
          OR LOWER('ATEC-ASSET-' || a.assetid) = LOWER($1)
          OR LOWER(COALESCE(a.assettagno, '')) = LOWER($1)
          OR LOWER(COALESCE(a.serialno, '')) = LOWER($1)
          OR LOWER(COALESCE(a.hoistserialno, '')) = LOWER($1)
          OR LOWER(COALESCE(a.auxhoistserialno, '')) = LOWER($1)
        )
      LIMIT 1
      `,
      [code]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" })
    }

    const asset = await ensureAssetQrCode(result.rows[0])
    res.json(asset)
  } catch (err) {
    console.error("QR asset lookup error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/assets/nfc/:token", searchLimiter, asyncRoute(async (req, res) => {
  const token = String(req.params.token || "").trim()

  if (!isValidNfcToken(token)) {
    await req.logAudit("NFC_SCAN_DENIED", "assets", null, { reason: "invalid_format" })
    return res.status(404).json({ error: "Asset tag not found" })
  }

  const result = await pool.query(
    `
    SELECT
      a.assetid,
      a.equiptypeid,
      a.serialno,
      a.assettagno,
      a.manufacturer,
      a.description,
      a.media1,
      a.media2,
      a.qrcode,
      a.manufactdate,
      a.archived,
      a.nfc_token,
      a.nfc_enabled,
      a.nfc_issued_at,
      a.nfc_revoked_at,
      a.nfc_last_scanned_at,
      a.nfc_scan_count,

      (
        SELECT i.testdate
        FROM atec.tblinspection i
        WHERE i.assetid = a.assetid
          AND i.inspectiontype = 'VISUAL'
        ORDER BY i.testdate DESC, i.testid DESC
        LIMIT 1
      ) AS lastvisualdate,

      (
        SELECT i.status
        FROM atec.tblinspection i
        WHERE i.assetid = a.assetid
          AND i.inspectiontype = 'VISUAL'
        ORDER BY i.testdate DESC, i.testid DESC
        LIMIT 1
      ) AS lastvisualstatus,

      (
        SELECT i.validdate
        FROM atec.tblinspection i
        WHERE i.assetid = a.assetid
          AND i.inspectiontype = 'VISUAL'
        ORDER BY i.testdate DESC, i.testid DESC
        LIMIT 1
      ) AS lastvisualvaliddate,

      (
        SELECT i.testdate
        FROM atec.tblinspection i
        WHERE i.assetid = a.assetid
          AND i.inspectiontype = 'LOADTEST'
        ORDER BY i.testdate DESC, i.testid DESC
        LIMIT 1
      ) AS lastloadtestdate,

      (
        SELECT i.status
        FROM atec.tblinspection i
        WHERE i.assetid = a.assetid
          AND i.inspectiontype = 'LOADTEST'
        ORDER BY i.testdate DESC, i.testid DESC
        LIMIT 1
      ) AS lastloadteststatus,

      (
        SELECT i.validdate
        FROM atec.tblinspection i
        WHERE i.assetid = a.assetid
          AND i.inspectiontype = 'LOADTEST'
        ORDER BY i.testdate DESC, i.testid DESC
        LIMIT 1
      ) AS lastloadtestvaliddate,

      c.clientname,
      s.sitename,
      sec.sectionname,
      p.name AS responsiblename,
      et.description AS equipmenttype,
      et.equipgroupid
    FROM atec.tblasset a
    LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
    LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
    LEFT JOIN atec.tblpeople p ON a.responsibleid = p.personid
    LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
    WHERE a.nfc_token = $1
    LIMIT 1
    `,
    [token]
  )

  const asset = result.rows[0]

  if (!asset || !asset.nfc_enabled || asset.nfc_revoked_at) {
    await req.logAudit("NFC_SCAN_DENIED", "assets", asset?.assetid || null, {
      reason: asset ? "revoked_or_disabled" : "not_found",
      token: maskLookupToken(token)
    })
    return res.status(404).json({ error: "Asset tag not found" })
  }

  await pool.query(
    `
    UPDATE atec.tblasset
    SET nfc_last_scanned_at = now(),
        nfc_scan_count = COALESCE(nfc_scan_count, 0) + 1
    WHERE assetid = $1
    `,
    [asset.assetid]
  )

  await req.logAudit(
    asset.archived ? "NFC_ARCHIVED_ASSET_TAPPED" : "NFC_SCAN",
    "assets",
    asset.assetid,
    { token: maskLookupToken(token) }
  )

  res.json({
    ...asset,
    nfc_url: nfcUrlForToken(token),
    nfc_token: undefined
  })
}))

app.get("/assets/:id/nfc", asyncRoute(async (req, res) => {
  if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const { id } = req.params
  const assetOptionalColumns = await getExistingColumnSet("tblasset", [
    "nfc_token",
    "nfc_enabled",
    "nfc_issued_at",
    "nfc_revoked_at",
    "nfc_last_scanned_at",
    "nfc_scan_count"
  ])
  const result = await pool.query(
    `
    SELECT
      a.assetid,
      ${optionalColumnSql(assetOptionalColumns, "a", "nfc_token", "NULL")},
      ${optionalColumnSql(assetOptionalColumns, "a", "nfc_enabled", "false")},
      ${optionalColumnSql(assetOptionalColumns, "a", "nfc_issued_at", "NULL")},
      ${optionalColumnSql(assetOptionalColumns, "a", "nfc_revoked_at", "NULL")},
      ${optionalColumnSql(assetOptionalColumns, "a", "nfc_last_scanned_at", "NULL")},
      ${optionalColumnSql(assetOptionalColumns, "a", "nfc_scan_count", "0")}
    FROM atec.tblasset a
    WHERE a.assetid = $1
    `,
    [id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Asset not found" })
  }

  const asset = result.rows[0]
  res.json({
    nfc_enabled: Boolean(asset.nfc_enabled && asset.nfc_token && !asset.nfc_revoked_at),
    nfc_issued_at: asset.nfc_issued_at,
    nfc_revoked_at: asset.nfc_revoked_at,
    nfc_last_scanned_at: asset.nfc_last_scanned_at,
    nfc_scan_count: Number(asset.nfc_scan_count || 0),
    nfc_url: asset.nfc_token && !asset.nfc_revoked_at ? nfcUrlForToken(asset.nfc_token) : null
  })
}))

app.post("/assets/:id/nfc", asyncRoute(async (req, res) => {
  if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const { id } = req.params
  const existing = await pool.query(
    "SELECT assetid, nfc_token, nfc_revoked_at FROM atec.tblasset WHERE assetid = $1",
    [id]
  )

  if (existing.rows.length === 0) {
    return res.status(404).json({ error: "Asset not found" })
  }

  const asset = existing.rows[0]
  const token = asset.nfc_token && !asset.nfc_revoked_at
    ? asset.nfc_token
    : await createUniqueNfcToken()

  const result = await pool.query(
    `
    UPDATE atec.tblasset
    SET nfc_token = $1,
        nfc_enabled = true,
        nfc_issued_at = COALESCE(nfc_issued_at, now()),
        nfc_revoked_at = NULL
    WHERE assetid = $2
    RETURNING assetid, nfc_token, nfc_enabled, nfc_issued_at, nfc_revoked_at,
      nfc_last_scanned_at, nfc_scan_count
    `,
    [token, id]
  )

  await req.logAudit("NFC_TOKEN_ISSUED", "assets", id, { token: maskLookupToken(token) })

  res.json({
    ...result.rows[0],
    nfc_token: undefined,
    nfc_url: nfcUrlForToken(token)
  })
}))

app.put("/assets/:id/nfc/rotate", asyncRoute(async (req, res) => {
  if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const { id } = req.params
  const token = await createUniqueNfcToken()
  const result = await pool.query(
    `
    UPDATE atec.tblasset
    SET nfc_token = $1,
        nfc_enabled = true,
        nfc_issued_at = now(),
        nfc_revoked_at = NULL,
        nfc_last_scanned_at = NULL,
        nfc_scan_count = 0
    WHERE assetid = $2
    RETURNING assetid, nfc_token, nfc_enabled, nfc_issued_at, nfc_revoked_at,
      nfc_last_scanned_at, nfc_scan_count
    `,
    [token, id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Asset not found" })
  }

  await req.logAudit("NFC_TOKEN_ROTATED", "assets", id, { token: maskLookupToken(token) })

  res.json({
    ...result.rows[0],
    nfc_token: undefined,
    nfc_url: nfcUrlForToken(token)
  })
}))

app.delete("/assets/:id/nfc", asyncRoute(async (req, res) => {
  if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const { id } = req.params
  const result = await pool.query(
    `
    UPDATE atec.tblasset
    SET nfc_enabled = false,
        nfc_revoked_at = now()
    WHERE assetid = $1
    RETURNING assetid, nfc_token, nfc_enabled, nfc_issued_at, nfc_revoked_at,
      nfc_last_scanned_at, nfc_scan_count
    `,
    [id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Asset not found" })
  }

  await req.logAudit("NFC_TOKEN_REVOKED", "assets", id, {
    token: maskLookupToken(result.rows[0].nfc_token)
  })

  res.json({
    ...result.rows[0],
    nfc_token: undefined,
    nfc_url: null
  })
}))

app.get("/assets/:id/qr-label.pdf", pdfLimiter, async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      `
      SELECT
        a.*,
        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype
      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      WHERE a.assetid = $1
      LIMIT 1
      `,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" })
    }

    const asset = await ensureAssetQrCode(result.rows[0])
    const appUrl = (process.env.PUBLIC_APP_URL || "https://www.fbcranes.co.za/atec").replace(/\/$/, "")
    const latestInspectionResult = await pool.query(
      `
      SELECT DISTINCT ON (inspectiontype)
        inspectiontype,
        testid,
        testdate,
        validdate,
        status
      FROM atec.tblinspection
      WHERE assetid = $1
        AND inspectiontype IN ('VISUAL', 'LOADTEST')
      ORDER BY inspectiontype, testdate DESC, testid DESC
      `,
      [asset.assetid]
    )
    const latestByType = Object.fromEntries(
      latestInspectionResult.rows.map(row => [row.inspectiontype, row])
    )
    const latestOverall = latestInspectionResult.rows
      .slice()
      .sort((a, b) =>
        new Date(b.testdate || 0) - new Date(a.testdate || 0) ||
        Number(b.testid || 0) - Number(a.testid || 0)
      )[0]
    const visualInspection = latestByType.VISUAL || null
    const loadTest = latestByType.LOADTEST || null
    const assetStatus = latestOverall?.status || "-"
    const visualPdfUrl = visualInspection
      ? `${appUrl}/api/inspections/${visualInspection.testid}/certificate.pdf`
      : ""
    const loadPdfUrl = loadTest
      ? `${appUrl}/api/inspections/${loadTest.testid}/certificate.pdf`
      : ""
    const lookupUrl = `${appUrl}/?qr=${encodeURIComponent(asset.qrcode)}`
    const qrPayload = [
      "ATEC ASSET LABEL",
      `Website: ${appUrl}`,
      "Landline: 011 902 3271",
      `Asset ID: ${asset.assetid}`,
      `Asset Tag: ${asset.assettagno || "-"}`,
      `Serial No: ${asset.serialno || "-"}`,
      `Equipment: ${asset.equipmenttype || "-"}`,
      `Status: ${assetStatus}`,
      `Last Inspection Date: ${formatPdfDate(visualInspection?.testdate) || "-"}`,
      `Next Inspection Date: ${formatPdfDate(visualInspection?.validdate) || "-"}`,
      `Inspection PDF: ${visualPdfUrl || "-"}`,
      `Last Load Test Date: ${formatPdfDate(loadTest?.testdate) || "-"}`,
      `Next Load Test Date: ${formatPdfDate(loadTest?.validdate) || "-"}`,
      `Load Test PDF: ${loadPdfUrl || "-"}`,
      `Lookup: ${lookupUrl}`
    ].join("\n")

    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 360
    })
    const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64")

    const doc = new PDFDocument({
      size: "A4",
      margin: 28,
      info: {
        Title: `ATEC QR Label ${asset.assetid}`
      }
    })

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="asset-${asset.assetid}-qr-label.pdf"`
    )

    doc.pipe(res)

    const labelX = 42
    const labelY = 44
    const labelWidth = doc.page.width - (labelX * 2)
    const labelHeight = 620
    const innerPad = 26
    const qrSize = 160
    const qrX = labelX + innerPad
    const qrY = labelY + 108
    const detailX = qrX + qrSize + 42
    const detailWidth = labelX + labelWidth - detailX - innerPad
    const footerY = labelY + labelHeight - 46

    doc
      .roundedRect(labelX, labelY, labelWidth, labelHeight, 8)
      .lineWidth(1.2)
      .strokeColor("#1f3f66")
      .stroke()

    doc
      .font("Helvetica-Bold")
      .fontSize(24)
      .fillColor("#123a63")
      .text("ATEC ASSET LABEL", labelX + innerPad, labelY + 24, {
        width: labelWidth - (innerPad * 2)
      })

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#475569")
      .text("Scan this QR code for asset status, inspection dates and certificate PDF links.", labelX + innerPad, labelY + 62, {
        width: labelWidth - (innerPad * 2)
      })

    doc.image(qrBuffer, qrX, qrY, {
      fit: [qrSize, qrSize]
    })

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#111827")
      .text(asset.qrcode, qrX, qrY + qrSize + 14, {
        width: qrSize,
        align: "center"
      })

    const rows = [
      ["Asset ID", asset.assetid],
      ["Asset Tag", asset.assettagno || "-"],
      ["Serial No", asset.serialno || "-"],
      ["Equipment", asset.equipmenttype || "-"],
      ["Client", asset.clientname || "-"],
      ["Site", asset.sitename || "-"],
      ["Section", asset.sectionname || "-"],
      ["Status", assetStatus],
      ["Last Inspection", formatPdfDate(visualInspection?.testdate) || "-"],
      ["Next Inspection", formatPdfDate(visualInspection?.validdate) || "-"],
      ["Last Load Test", formatPdfDate(loadTest?.testdate) || "-"],
      ["Next Load Test", formatPdfDate(loadTest?.validdate) || "-"]
    ]

    let detailY = qrY
    rows.forEach(([label, value]) => {
      const displayValue = String(value || "-")
      const labelHeight = doc
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .heightOfString(String(label).toUpperCase(), { width: detailWidth })
      const valueHeight = doc
        .font("Helvetica-Bold")
        .fontSize(11.5)
        .heightOfString(displayValue, { width: detailWidth })
      const rowHeight = Math.max(26, labelHeight + valueHeight + 8)

      doc
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .fillColor("#64748b")
        .text(String(label).toUpperCase(), detailX, detailY, {
          width: detailWidth,
          lineBreak: false
        })

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(String(label).toLowerCase() === "status" && assetStatus === "NOT SAFE" ? "#b91c1c" : "#0f2742")
        .text(displayValue, detailX, detailY + 11, {
          width: detailWidth,
          lineGap: 0
        })

      detailY += rowHeight
    })

    const linkY = Math.max(qrY + qrSize + 42, detailY + 8)
    const linkWidth = labelWidth - (innerPad * 2)
    const linkRows = [
      ["Website", appUrl],
      ["Landline", "011 902 3271"],
      ["Inspection PDF", visualPdfUrl || "No inspection PDF yet"],
      ["Load Test PDF", loadPdfUrl || "No load test PDF yet"]
    ]

    let currentLinkY = linkY
    linkRows.forEach(([label, value]) => {
      doc
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor("#64748b")
        .text(`${label}:`, labelX + innerPad, currentLinkY, {
          width: 76,
          lineBreak: false
        })

      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#0f2742")
        .text(String(value), labelX + innerPad + 82, currentLinkY, {
          width: linkWidth - 82,
          lineGap: 0
        })

      currentLinkY += Math.max(12, doc.heightOfString(String(value), {
        width: linkWidth - 82
      }) + 4)
    })

    doc
      .moveTo(labelX + innerPad, footerY)
      .lineTo(labelX + labelWidth - innerPad, footerY)
      .lineWidth(0.8)
      .strokeColor("#cbd5e1")
      .stroke()

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#475569")
      .text("FB Cranes Inspection Platform | www.fbcranes.co.za/atec | 011 902 3271", labelX + innerPad, footerY + 12, {
        width: labelWidth - (innerPad * 2),
        align: "center"
      })

    await req.logAudit("GENERATE_QR_LABEL", "assets", asset.assetid, {
      qrcode: asset.qrcode
    })

    doc.end()
  } catch (err) {
    console.error("QR label PDF error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/assets/:id/quick-details", searchLimiter, async (req, res) => {
  try {
    const { id } = req.params
    const assetOptionalColumns = await getExistingColumnSet("tblasset", [
      "nfc_enabled",
      "nfc_issued_at",
      "nfc_revoked_at",
      "nfc_last_scanned_at",
      "nfc_scan_count"
    ])
    const inspectionOptionalColumns = await getExistingColumnSet("tblinspection", [
      "inspector",
      "inspector_name"
    ])
    const lastInspectorSql = inspectionOptionalColumns.has("inspector_name") && inspectionOptionalColumns.has("inspector")
      ? "COALESCE(i.inspector_name, i.inspector)"
      : inspectionOptionalColumns.has("inspector_name")
        ? "i.inspector_name"
        : inspectionOptionalColumns.has("inspector")
          ? "i.inspector"
          : "NULL"

    const result = await pool.query(`
      SELECT 
        a.assetid,
        a.equiptypeid,
        a.serialno,
        a.assettagno,
        a.manufacturer,
        a.description,
        a.media1,
        a.media2,
        a.qrcode,
        a.manufactdate,
        a.archived,
        ${optionalColumnSql(assetOptionalColumns, "a", "nfc_enabled", "false")},
        ${optionalColumnSql(assetOptionalColumns, "a", "nfc_issued_at", "NULL")},
        ${optionalColumnSql(assetOptionalColumns, "a", "nfc_revoked_at", "NULL")},
        ${optionalColumnSql(assetOptionalColumns, "a", "nfc_last_scanned_at", "NULL")},
        ${optionalColumnSql(assetOptionalColumns, "a", "nfc_scan_count", "0")},

        (
          SELECT i.testdate
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'VISUAL'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastvisualdate,

        (
          SELECT i.status
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'VISUAL'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastvisualstatus,

        (
          SELECT i.validdate
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'VISUAL'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastvisualvaliddate,

        (
          SELECT i.tagnumber
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'VISUAL'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastvisualtag,

        (
          SELECT i.testdate
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'LOADTEST'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastloadtestdate,

        (
          SELECT i.status
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'LOADTEST'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastloadteststatus,

        (
          SELECT i.validdate
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'LOADTEST'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastloadtestvaliddate,

        (
          SELECT i.tagnumber
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
            AND i.inspectiontype = 'LOADTEST'
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastloadtesttag,

        (
          SELECT i.testdate
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspectiondate,

        (
          SELECT i.status
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspectionstatus,

        (
          SELECT i.validdate
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspectionvaliddate,

        (
          SELECT i.inspectiontype
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspectiontype,

        (
          SELECT i.tagnumber
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspectiontag,

        (
          SELECT ${lastInspectorSql}
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspector,

        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype,
        et.equipgroupid

      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      WHERE a.assetid = $1
      LIMIT 1
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" })
    }

    res.json(result.rows[0])

  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/assets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        a.*,
        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype,
        et.equipgroupid
      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      WHERE a.assetid = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});


app.post("/assets", async (req, res) => {
  try {
    const {
      serialno,
      clientid,
      siteid,
      sectionid,
      responsibleid,
      equiptypeid,
      manufacturer,
      description,
      assettagno,
      manufactdate,
      wll,
      heightoflift,
      numberofchainfalls,
      oemtophooksize,
      oembottomhooksize,
      loadchaindiameter,
      effectivelength,
      span,
      permissibledeflection,
      hooksize,
      steelwireropemm,
      hoistdescription,
      hoistserialno,
      auxhoistdescription,
      auxhoistserialno,
      auxhoistwll,
      auxhoisthooksize,
      auxhoistropemm
    } = req.body;

    const normalizedSerialNo = normalizeAssetLookupValue(serialno)
    const normalizedAssetTagNo = normalizeAssetLookupValue(assettagno)

    const duplicateCheck = await pool.query(
        `
        SELECT
          assetid,
          CASE
            WHEN $2 <> '' AND LOWER(TRIM(serialno)) = $2 THEN 'serial'
            WHEN $3 <> '' AND LOWER(TRIM(assettagno)) = $3 THEN 'assetTag'
            ELSE 'asset'
          END AS duplicatetype
        FROM atec.tblasset
        WHERE clientid = $1
          AND COALESCE(archived, false) = false
          AND (
            ($2 <> '' AND LOWER(TRIM(serialno)) = $2)
            OR ($3 <> '' AND LOWER(TRIM(assettagno)) = $3)
          )
        LIMIT 1
        `,
        [
          clientid,
          normalizedSerialNo,
          normalizedAssetTagNo
        ]
      )

      if (duplicateCheck.rows.length > 0) {
        return duplicateAssetResponse(
          res,
          duplicateCheck.rows[0].duplicatetype,
          duplicateCheck.rows[0].assetid
        )
      }

    const result = await pool.query(
      `INSERT INTO atec.tblasset
       (
        serialno,
        clientid,
        siteid,
        sectionid,
        responsibleid,
        equiptypeid,
        manufacturer,
        description,
        assettagno,
        manufactdate,
        wll,
        heightoflift,
        numberofchainfalls,
        oemtophooksize,
        oembottomhooksize,
        loadchaindiameter,
        effectivelength,
        span,
        permissibledeflection,
        hooksize,
        steelwireropemm,
        hoistdescription,
        hoistserialno,
        auxhoistdescription,
        auxhoistserialno,
        auxhoistwll,
        auxhoisthooksize,
        auxhoistropemm
       )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      RETURNING *`,
        [
        serialno,
        clientid,
        siteid,
        sectionid,
        responsibleid,
        equiptypeid,
        manufacturer,
        description,
        assettagno,
        blankToNull(manufactdate),
        blankToNull(wll),
        blankToNull(heightoflift),
        blankToNull(numberofchainfalls),
        blankToNull(oemtophooksize),
        blankToNull(oembottomhooksize),
        blankToNull(loadchaindiameter),
        blankToNull(effectivelength),
        blankToNull(span),
        blankToNull(permissibledeflection),
        blankToNull(hooksize),
        blankToNull(steelwireropemm),
        hoistdescription,
        hoistserialno,
        auxhoistdescription,
        auxhoistserialno,
        auxhoistwll,
        auxhoisthooksize,
        auxhoistropemm
      ]
    );

    const createdAsset = result.rows[0]
    const qrResult = await pool.query(
      `
      UPDATE atec.tblasset
      SET qrcode = $1
      WHERE assetid = $2
      RETURNING *
      `,
      [makeAssetQrCode(createdAsset.assetid), createdAsset.assetid]
    )

    res.json(qrResult.rows[0]);
  } catch (err) {
    if (isDuplicateActiveClientSerialError(err)) {
      return duplicateAssetResponse(res, "serial")
    }

    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/assets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      serialno,
      assettagno,
      equiptypeid,
      manufacturer,
      manufactdate,
      description,
      wll,
      heightoflift,
      numberofchainfalls,
      oemtophooksize,
      oembottomhooksize,
      loadchaindiameter,
      effectivelength,
      span,
      permissibledeflection,
      hooksize,
      steelwireropemm,
      hoistdescription,
      hoistserialno,
      auxhoistdescription,
      auxhoistserialno,
      auxhoistwll,
      auxhoisthooksize,
      auxhoistropemm
    } = req.body;

    const normalizedSerialNo = normalizeAssetLookupValue(serialno)
    const normalizedAssetTagNo = normalizeAssetLookupValue(assettagno)

    const duplicateCheck = await pool.query(
      `
      SELECT
        assetid,
        CASE
          WHEN $2 <> '' AND LOWER(TRIM(serialno)) = $2 THEN 'serial'
          WHEN $3 <> '' AND LOWER(TRIM(assettagno)) = $3 THEN 'assetTag'
          ELSE 'asset'
        END AS duplicatetype
      FROM atec.tblasset
      WHERE clientid = (
        SELECT clientid
        FROM atec.tblasset
        WHERE assetid = $1
      )
        AND assetid <> $1
        AND COALESCE(archived, false) = false
        AND (
          ($2 <> '' AND LOWER(TRIM(serialno)) = $2)
          OR ($3 <> '' AND LOWER(TRIM(assettagno)) = $3)
        )
      LIMIT 1
      `,
      [
        id,
        normalizedSerialNo,
        normalizedAssetTagNo
      ]
    );

    if (duplicateCheck.rows.length > 0) {
      return duplicateAssetResponse(
        res,
        duplicateCheck.rows[0].duplicatetype,
        duplicateCheck.rows[0].assetid
      );
    }

    const result = await pool.query(
      `UPDATE atec.tblasset
       SET
        serialno = $1,
        manufacturer = $2,
        description = $3,
        wll = $4,
        heightoflift = $5,
        numberofchainfalls = $6,
        oemtophooksize = $7,
        oembottomhooksize = $8,
        loadchaindiameter = $9,
        effectivelength = $10,
        span = $11,
        permissibledeflection = $12,
        hooksize = $13,
        steelwireropemm = $14,
        hoistdescription = $15,
        hoistserialno = $16,
        assettagno = $17,
        equiptypeid = $18,
        manufactdate = $19,
        auxhoistdescription = $20,
        auxhoistserialno = $21,
        auxhoistwll = $22,
        auxhoisthooksize = $23,
        auxhoistropemm = $24
       WHERE assetid = $25
       RETURNING *`,
      [
        serialno,
        manufacturer,
        description,
        blankToNull(wll),
        blankToNull(heightoflift),
        blankToNull(numberofchainfalls),
        blankToNull(oemtophooksize),
        blankToNull(oembottomhooksize),
        blankToNull(loadchaindiameter),
        blankToNull(effectivelength),
        blankToNull(span),
        blankToNull(permissibledeflection),
        blankToNull(hooksize),
        blankToNull(steelwireropemm),
        hoistdescription,
        hoistserialno,
        assettagno,
        blankToNull(equiptypeid),
        blankToNull(manufactdate),
        auxhoistdescription,
        auxhoistserialno,
        auxhoistwll,
        auxhoisthooksize,
        auxhoistropemm,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" })
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (isDuplicateActiveClientSerialError(err)) {
      return duplicateAssetResponse(res, "serial")
    }

    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/assets/:id/move", async (req, res) => {
  try {
    if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
      return res.status(403).json({ error: "Only managers and administrators may move assets." })
    }
    const { id } = req.params
    const { siteid, sectionid } = req.body

    if (!siteid || !sectionid) {
      return res.status(400).json({ error: "Site and section are required" })
    }

    const assetResult = await pool.query(
      `
      SELECT assetid, clientid, siteid, sectionid
      FROM atec.tblasset
      WHERE assetid = $1
      `,
      [id]
    )

    if (assetResult.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" })
    }

    const asset = assetResult.rows[0]

    const targetResult = await pool.query(
      `
      SELECT
        s.siteid,
        sec.sectionid,
        sec.responsibleid
      FROM atec.tblsites s
      JOIN atec.tblsection sec
        ON sec.siteid = s.siteid
       AND sec.sectionid = $2
      WHERE s.siteid = $1
        AND s.clientid = $3
        AND sec.clientid = $3
        AND COALESCE(s.archived, false) = false
        AND COALESCE(sec.archived, false) = false
      LIMIT 1
      `,
      [siteid, sectionid, asset.clientid]
    )

    if (targetResult.rows.length === 0) {
      return res.status(400).json({
        error: "Select an active site and section for the same customer as this asset."
      })
    }

    const target = targetResult.rows[0]
    const result = await pool.query(
      `
      UPDATE atec.tblasset
      SET siteid = $1,
          sectionid = $2,
          responsibleid = $3
      WHERE assetid = $4
      RETURNING *
      `,
      [target.siteid, target.sectionid, target.responsibleid, id]
    )

    await req.logAudit("MOVE", "assets", id, {
      from_siteid: asset.siteid,
      from_sectionid: asset.sectionid,
      to_siteid: target.siteid,
      to_sectionid: target.sectionid
    })

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.put("/assets/:id/allocate", async (req, res) => {
  try {
    if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
      return res.status(403).json({ error: "Only managers and administrators may allocate assets." })
    }

    const { id } = req.params
    const { responsibleid } = req.body
    if (!responsibleid) return res.status(400).json({ error: "Responsible person is required." })

    const result = await pool.query(
      `UPDATE atec.tblasset a
       SET responsibleid = p.personid
       FROM atec.tblpeople p
       WHERE a.assetid = $1
         AND p.personid = $2
         AND p.clientid = a.clientid
         AND COALESCE(p.archived, false) = false
       RETURNING a.*`,
      [id, responsibleid]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Select an active responsible person for the asset's customer." })
    }

    await req.logAudit("ALLOCATE", "assets", id, { responsibleid })
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.put("/assets/:id/archive", async (req, res) => {
  let client
  try {
    if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
      return res.status(403).json({ error: "Only managers and administrators may archive assets." })
    }
    const { id } = req.params;
    const reason = String(req.body?.reason || "").trim()

    if (!reason) {
      return res.status(400).json({ error: "An archive reason is required." })
    }

    if (reason.length > 1000) {
      return res.status(400).json({ error: "The archive reason must be 1000 characters or fewer." })
    }

    client = await pool.connect()
    await client.query("BEGIN")

    const result = await client.query(
      `UPDATE atec.tblasset
       SET archived = true
       WHERE assetid = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Asset not found" })
    }

    await client.query(
      `INSERT INTO atec.audit_log
         (user_id, action, module, record_id, ip_address, details)
       VALUES ($1, 'ARCHIVE', 'assets', $2, NULLIF($3, '')::inet, $4)`,
      [req.user?.user_id || null, String(id), req.ip || null, JSON.stringify({ reason })]
    )
    await client.query("COMMIT")
    res.json(result.rows[0]);
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {})
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  } finally {
    client?.release()
  }
});

app.put("/assets/:id/unarchive", async (req, res) => {
  try {
    if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
      return res.status(403).json({ error: "Only managers and administrators may restore assets." })
    }
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE atec.tblasset
       SET archived = false
       WHERE assetid = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" })
    }

    await req.logAudit("RESTORE", "assets", id)
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.post("/assets/:id/photos",
  uploadLimiter,
  upload.fields([
    { name: "photo1", maxCount: 1 },
    { name: "photo2", maxCount: 1 },
  ]),
  validateUploadedImages,
  compressUploadedPhotos,
  async (req, res) => {
    try {
      const { id } = req.params;

      const photo1 = req.files?.photo1?.[0]
        ? `/uploads/assets/${req.files.photo1[0].filename}`
        : null;

      const photo2 = req.files?.photo2?.[0]
        ? `/uploads/assets/${req.files.photo2[0].filename}`
        : null;

      if (!photo1 && !photo2) {
        return res.status(400).json({ error: "Please choose at least one photo" })
      }

      const result = await pool.query(
        `UPDATE atec.tblasset
         SET
          media1 = COALESCE($1, media1),
          media2 = COALESCE($2, media2)
         WHERE assetid = $3
         RETURNING *`,
        [photo1, photo2, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Asset not found" })
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "An unexpected server error occurred" });
    }
  }
);

app.delete("/assets/:id/photos/:slot", async (req, res) => {
  try {
    const { id, slot } = req.params
    const column = slot === "1" ? "media1" : slot === "2" ? "media2" : null

    if (!column) {
      return res.status(400).json({ error: "Photo slot must be 1 or 2" })
    }

    const existingResult = await pool.query(
      `SELECT ${column} AS photo_path FROM atec.tblasset WHERE assetid = $1`,
      [id]
    )

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" })
    }

    const oldPhotoPath = existingResult.rows[0].photo_path

    const updateResult = await pool.query(
      `UPDATE atec.tblasset
       SET ${column} = NULL
       WHERE assetid = $1
       RETURNING *`,
      [id]
    )

    await deleteUploadFileIfUnreferenced(oldPhotoPath)
    await req.logAudit("DELETE", "asset_photos", id, { slot })

    res.json(updateResult.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/assets/:id/inspection-history", async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `
      SELECT
        testid,
        testdate,
        inspectiontype,
        tagnumber,
        status,
        inspector
      FROM atec.tblinspection
      WHERE assetid = $1
      ORDER BY testdate DESC, testid DESC
      `,
      [id]
    )

    res.json(result.rows)

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/assets/:id/archive-history", async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      `SELECT
         audit.audit_id,
         audit.action,
         audit.details ->> 'reason' AS reason,
         audit.created_at,
         COALESCE(NULLIF(TRIM(users.full_name), ''), users.username, 'System') AS performed_by
       FROM atec.audit_log audit
       LEFT JOIN atec.tblusers users ON users.user_id = audit.user_id
       WHERE audit.module = 'assets'
         AND audit.record_id = $1
         AND audit.action IN ('ARCHIVE', 'RESTORE')
       ORDER BY audit.created_at DESC, audit.audit_id DESC`,
      [String(id)]
    )

    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/equipment-types", async (req, res) => {
  try {
    const result = await pool.query(`
     SELECT
      equiptypeid,
      description,
      equipgroupid
      FROM atec.tblequiptype
      ORDER BY description
    `)

    res.json(result.rows)

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

const PORT = process.env.PORT || 5000;

app.get("/equipment-type-criteria", async (req, res) => {
  try {
    const { category } = req.query

    let query = `
      SELECT
        c.criteriaid,
        c.equiptypeid,
        c.criterianame,
        COALESCE(c.criteriadescription, c.criterianame) AS criteriadescription,
        c.fieldtype,
        COALESCE(c.resulttype,
          CASE WHEN UPPER(COALESCE(c.fieldtype, '')) = 'NUMBER' THEN 'MEASURED' ELSE 'PASS_FAIL' END
        ) AS resulttype,
        c.required,
        c.sortorder,
        COALESCE(c.displayorder, c.sortorder, c.criteriaid) AS displayorder,
        c.inspectioncategory,
        COALESCE(c.inspection_category, 'PERIODIC_THOROUGH_INSPECTION') AS inspection_category,
        COALESCE(c.severity, 'MINOR') AS severity,
        COALESCE(c.active, true) AS active,
        t.description AS equipmenttype
      FROM atec.tblequiptypecriteria c
      LEFT JOIN atec.tblequiptype t
        ON c.equiptypeid = t.equiptypeid
    `

    const values = []

    if (category) {
      query += `
        WHERE c.inspectioncategory = $1
      `
      values.push(category)
    }

    query += `
      ORDER BY
        t.description,
        c.inspectioncategory,
        COALESCE(c.displayorder, c.sortorder, c.criteriaid)
    `

    const result = await pool.query(query, values)

    res.json(result.rows)

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.post("/equipment-type-criteria", async (req, res) => {
  try {
    const {
      equiptypeid,
      criterianame,
      criteriadescription,
      fieldtype,
      resulttype,
      required,
      sortorder,
      displayorder,
      inspectioncategory,
      inspection_category,
      severity,
      active
    } = req.body

    const normalizedResultType = normalizeCriteriaResultType(resulttype, fieldtype)
    const normalizedFieldType =
      normalizedResultType === "MEASURED" ? "NUMBER" : (fieldtype || "PASS_FAIL")
    const normalizedDescription = criteriadescription || criterianame

    const result = await pool.query(
      `
      INSERT INTO atec.tblequiptypecriteria
      (
        equiptypeid,
        criterianame,
        criteriadescription,
        fieldtype,
        resulttype,
        required,
        sortorder,
        displayorder,
        inspectioncategory,
        inspection_category,
        severity,
        active
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
      `,
      [
        equiptypeid,
        normalizedDescription,
        normalizedDescription,
        normalizedFieldType,
        normalizedResultType,
        required !== false,
        sortorder || displayorder || null,
        displayorder || sortorder || null,
        inspectioncategory || "VISUAL",
        inspection_category || "PERIODIC_THOROUGH_INSPECTION",
        severity || "MINOR",
        active !== false
      ]
    )

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.put("/equipment-type-criteria/:id", async (req, res) => {
  try {
    const { id } = req.params

    const {
      equiptypeid,
      criterianame,
      criteriadescription,
      fieldtype,
      resulttype,
      required,
      sortorder,
      displayorder,
      inspectioncategory,
      inspection_category,
      severity,
      active
    } = req.body

    const normalizedResultType = normalizeCriteriaResultType(resulttype, fieldtype)
    const normalizedFieldType =
      normalizedResultType === "MEASURED" ? "NUMBER" : (fieldtype || "PASS_FAIL")
    const normalizedDescription = criteriadescription || criterianame

    const result = await pool.query(
      `
      UPDATE atec.tblequiptypecriteria
      SET
        equiptypeid = $1,
        criterianame = $2,
        criteriadescription = $3,
        fieldtype = $4,
        resulttype = $5,
        required = $6,
        sortorder = $7,
        displayorder = $8,
        inspectioncategory = $9,
        inspection_category = $10,
        severity = $11,
        active = $12
      WHERE criteriaid = $13
      RETURNING *
      `,
      [
        equiptypeid,
        normalizedDescription,
        normalizedDescription,
        normalizedFieldType,
        normalizedResultType,
        required !== false,
        sortorder || displayorder || null,
        displayorder || sortorder || null,
        inspectioncategory || "VISUAL",
        inspection_category || "PERIODIC_THOROUGH_INSPECTION",
        severity || "MINOR",
        active !== false,
        id
      ]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Criteria not found" })
    }

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.delete("/equipment-type-criteria/:id", async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `
      DELETE FROM atec.tblequiptypecriteria
      WHERE criteriaid = $1
      RETURNING *
      `,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Criteria not found" })
    }

    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

async function buildVisitWorklistRows(client, {
  clientid,
  siteid,
  sectionid = null,
  visitType = "COMBINED",
  dueCutoff = null
}) {
  const cutoffDate = dueCutoff ? new Date(dueCutoff) : new Date()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const result = await client.query(
    `
    SELECT
      a.assetid,
      a.clientid,
      a.siteid,
      a.sectionid,
      a.equiptypeid,
      a.assettagno,
      a.serialno,
      a.description,
      c.clientname,
      s.sitename,
      sec.sectionname,
      et.description AS equipmenttype,
      latest_visual.testid AS visual_testid,
      latest_visual.validdate AS visual_due_date,
      latest_load.testid AS load_testid,
      latest_load.validdate AS load_due_date,
      ${assetSupportsLoadTestSql("a")} AS supports_load_test
    FROM atec.tblasset a
    LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
    LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
    LEFT JOIN atec.tblpeople p ON a.responsibleid = p.personid
    LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
    LEFT JOIN LATERAL (
      SELECT i.testid, i.validdate
      FROM atec.tblinspection i
      WHERE i.assetid = a.assetid
        AND i.inspectiontype = 'VISUAL'
      ORDER BY i.testdate DESC, i.testid DESC
      LIMIT 1
    ) latest_visual ON true
    LEFT JOIN LATERAL (
      SELECT i.testid, i.validdate
      FROM atec.tblinspection i
      WHERE i.assetid = a.assetid
        AND i.inspectiontype = 'LOADTEST'
      ORDER BY i.testdate DESC, i.testid DESC
      LIMIT 1
    ) latest_load ON true
    WHERE a.clientid = $1
      AND a.siteid = $2
      AND ($3::int IS NULL OR a.sectionid = $3::int)
      AND COALESCE(a.archived, false) = false
      AND COALESCE(c.archived, false) = false
      AND COALESCE(s.archived, false) = false
      AND COALESCE(sec.archived, false) = false
    ORDER BY sec.sectionname NULLS LAST, a.assettagno NULLS LAST, a.assetid
    `,
    [clientid, siteid, sectionid || null]
  )

  const scope = normalizeVisitScope(visitType)
  const includesVisual = ["VISUAL", "COMBINED"].includes(scope)
  const includesLoad = ["LOADTEST", "COMBINED"].includes(scope)

  return result.rows.map(row => {
    const visualDate = row.visual_due_date ? new Date(row.visual_due_date) : null
    const loadDate = row.load_due_date ? new Date(row.load_due_date) : null
    const visualDue = includesVisual && (!visualDate || visualDate <= cutoffDate)
    const loadRequired = includesLoad && row.supports_load_test === true
    const loadDue = loadRequired && (!loadDate || loadDate <= cutoffDate)
    const visualOverdue = includesVisual && (!visualDate || visualDate < today)
    const loadOverdue = loadRequired && (!loadDate || loadDate < today)
    const requiredScope = scope === "SURVEY"
      ? "SURVEY"
      : requiredScopeForDue(visualDue, loadDue)

    return {
      ...row,
      visual_due_flag: visualDue,
      loadtest_due_flag: loadDue,
      overdue_flag: visualOverdue || loadOverdue,
      required_inspection_scope: requiredScope,
      due_reason: scope === "SURVEY"
        ? "Survey / asset verification"
        : dueReasonForAsset(visualDue, loadDue, visualOverdue, loadOverdue)
    }
  }).filter(row => row.required_inspection_scope !== "NONE")
}

function summarizeVisitWorklist(rows) {
  return rows.reduce((summary, row) => {
    summary.total += 1
    if (row.visual_due_flag) summary.visual_due += 1
    if (row.loadtest_due_flag) summary.loadtest_due += 1
    if (row.visual_due_flag && row.loadtest_due_flag) summary.both_due += 1
    if (row.overdue_flag) summary.overdue += 1
    return summary
  }, {
    total: 0,
    visual_due: 0,
    loadtest_due: 0,
    both_due: 0,
    overdue: 0
  })
}

function summarizeVisitWorklistByEquipmentType(rows) {
  return Array.from(rows.reduce((groups, row) => {
    const equipmentType = String(row.equipmenttype || "").trim() || "Unspecified"
    const current = groups.get(equipmentType) || {
      equipment_type: equipmentType,
      total: 0,
      visual_due: 0,
      loadtest_due: 0,
      both_due: 0,
      overdue: 0
    }
    current.total += 1
    if (row.visual_due_flag) current.visual_due += 1
    if (row.loadtest_due_flag) current.loadtest_due += 1
    if (row.visual_due_flag && row.loadtest_due_flag) current.both_due += 1
    if (row.overdue_flag) current.overdue += 1
    groups.set(equipmentType, current)
    return groups
  }, new Map()).values()).sort((a, b) => a.equipment_type.localeCompare(b.equipment_type))
}

function summarizeInspectionCoverageByEquipmentType(allRows, dueRows) {
  const dueAssetIds = new Set(dueRows.map(row => String(row.assetid)))
  return Array.from(allRows.reduce((groups, row) => {
    const equipmentType = String(row.equipmenttype || "").trim() || "Unspecified"
    const current = groups.get(equipmentType) || {
      equipment_type: equipmentType,
      total: 0,
      completed: 0,
      outstanding: 0
    }
    current.total += 1
    if (dueAssetIds.has(String(row.assetid))) current.outstanding += 1
    else current.completed += 1
    groups.set(equipmentType, current)
    return groups
  }, new Map()).values()).sort((a, b) => a.equipment_type.localeCompare(b.equipment_type))
}

app.post("/inspection-visits/preview", asyncRoute(async (req, res) => {
  if (!canCreateOrCloseVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const location = await getActiveVisitLocation(pool, {
    clientid: req.body.clientid,
    siteid: req.body.siteid,
    sectionid: req.body.sectionid
  })

  if (!location) {
    return res.status(400).json({ error: "Select an active customer and site for this visit." })
  }

  const rows = await buildVisitWorklistRows(pool, {
    clientid: req.body.clientid,
    siteid: req.body.siteid,
    sectionid: req.body.sectionid,
    visitType: req.body.visit_type,
    dueCutoff: req.body.due_cutoff
  })

  const allRows = await buildVisitWorklistRows(pool, {
    clientid: req.body.clientid,
    siteid: req.body.siteid,
    sectionid: req.body.sectionid,
    visitType: "SURVEY",
    dueCutoff: req.body.due_cutoff
  })

  const coverageByEquipmentType = summarizeInspectionCoverageByEquipmentType(allRows, rows)
  const coverageSummary = coverageByEquipmentType.reduce((summary, row) => ({
    total: summary.total + row.total,
    completed: summary.completed + row.completed,
    outstanding: summary.outstanding + row.outstanding
  }), { total: 0, completed: 0, outstanding: 0 })

  res.json({
    summary: summarizeVisitWorklist(rows),
    equipment_type_summary: summarizeVisitWorklistByEquipmentType(rows),
    coverage_summary: coverageSummary,
    coverage_by_equipment_type: coverageByEquipmentType,
    assets: rows.slice(0, 100)
  })
}))

app.get("/inspection-visits", asyncRoute(async (req, res) => {
  if (!canWorkVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const result = await pool.query(
    `
    SELECT
      v.*,
      c.clientname,
      s.sitename,
      sec.sectionname,
      COALESCE(vas.total_assets, 0)::int AS total_assets,
      COALESCE(vas.completed_assets, 0)::int AS completed_assets,
      COALESCE(vas.outstanding_assets, 0)::int AS outstanding_assets
    FROM atec.tblinspectionvisit v
    LEFT JOIN atec.tblclients c ON v.clientid = c.clientid
    LEFT JOIN atec.tblsites s ON v.siteid = s.siteid
    LEFT JOIN atec.tblsection sec ON v.sectionid = sec.sectionid
    LEFT JOIN (
      SELECT
        visitid,
        count(*)::int AS total_assets,
        count(*) FILTER (WHERE reconciliation_status = 'COMPLETED')::int AS completed_assets,
        count(*) FILTER (WHERE reconciliation_status = 'OUTSTANDING')::int AS outstanding_assets
      FROM atec.tblinspectionvisitasset
      GROUP BY visitid
    ) vas ON vas.visitid = v.visitid
    ORDER BY v.created_at DESC, v.visitid DESC
    LIMIT 100
    `
  )

  res.json(
    canManageAllUsers(req.user)
      ? result.rows
      : result.rows.filter(user => user.role === "CUSTOMER")
  )
}))

app.post("/inspection-visits", asyncRoute(async (req, res) => {
  if (!canCreateOrCloseVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    const visitType = normalizeVisitScope(req.body.visit_type)
    const visitStatus = normalizeVisitCreationStatus(req.body.visit_status)
    const dueCutoff = req.body.due_cutoff || req.body.planned_start_at || new Date().toISOString()
    const location = await getActiveVisitLocation(client, {
      clientid: req.body.clientid,
      siteid: req.body.siteid,
      sectionid: req.body.sectionid
    })

    if (!location) {
      await client.query("ROLLBACK")
      return res.status(400).json({ error: "Select an active customer and site for this visit." })
    }

    const rows = await buildVisitWorklistRows(client, {
      clientid: req.body.clientid,
      siteid: req.body.siteid,
      sectionid: req.body.sectionid,
      visitType,
      dueCutoff
    })

    const visit = await client.query(
      `
      INSERT INTO atec.tblinspectionvisit
      (
        visit_reference,
        clientid,
        siteid,
        sectionid,
        visit_type,
        planned_start_at,
        actual_start_at,
        visit_status,
        lead_inspector_user_id,
        created_by_user_id,
        notes,
        customer_representative,
        customer_reference,
        due_cutoff_date,
        due_soon_days,
        include_overdue,
        include_already_due,
        include_due_during_visit
      )
      VALUES
      (
        COALESCE(NULLIF($1, ''), 'VISIT-' || to_char(now(), 'YYYYMMDDHH24MISS')),
        $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      RETURNING *
      `,
      [
        req.body.visit_reference || "",
        req.body.clientid,
        req.body.siteid,
        req.body.sectionid || null,
        visitType,
        req.body.planned_start_at || null,
        visitStatus === "OPEN" ? new Date() : null,
        visitStatus,
        req.body.lead_inspector_user_id || req.user.user_id,
        req.user.user_id,
        req.body.notes || "",
        req.body.customer_representative || "",
        req.body.customer_reference || "",
        dueCutoff,
        Number(req.body.due_soon_days || 0),
        req.body.include_overdue !== false,
        req.body.include_already_due !== false,
        req.body.include_due_during_visit !== false
      ]
    )

    const visitid = visit.rows[0].visitid

    if (req.body.members && Array.isArray(req.body.members)) {
      for (const memberUserId of req.body.members) {
        await client.query(
          `
          INSERT INTO atec.tblinspectionvisitmember (visitid, user_id, role_label, assigned_by_user_id)
          VALUES ($1,$2,'INSPECTOR',$3)
          ON CONFLICT (visitid, user_id) DO NOTHING
          `,
          [visitid, memberUserId, req.user.user_id]
        )
      }
    }

    for (const row of rows) {
      await client.query(
        `
        INSERT INTO atec.tblinspectionvisitasset
        (
          visitid,
          assetid,
          clientid_snapshot,
          siteid_snapshot,
          sectionid_snapshot,
          equipmenttypeid_snapshot,
          equipmenttype_snapshot,
          assettag_snapshot,
          serial_snapshot,
          description_snapshot,
          due_reason,
          visual_due_date_at_start,
          loadtest_due_date_at_start,
          visual_due_flag,
          loadtest_due_flag,
          overdue_flag,
          required_inspection_scope
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        -- Duplicate guard: ON CONFLICT (visitid, assetid, required_inspection_scope) DO NOTHING
        ON CONFLICT (visitid, assetid, required_inspection_scope)
        WHERE assetid IS NOT NULL
        DO NOTHING
        `,
        [
          visitid,
          row.assetid,
          row.clientid,
          row.siteid,
          row.sectionid,
          row.equiptypeid,
          row.equipmenttype,
          row.assettagno,
          row.serialno,
          row.description,
          row.due_reason,
          row.visual_due_date,
          row.load_due_date,
          row.visual_due_flag,
          row.loadtest_due_flag,
          row.overdue_flag,
          row.required_inspection_scope
        ]
      )
    }

    await client.query(
      `
      INSERT INTO atec.tblinspectionvisitactivity (visitid, user_id, activity_type, details)
      VALUES ($1,$2,'WORKLIST_GENERATED',$3::jsonb)
      `,
      [visitid, req.user.user_id, JSON.stringify(summarizeVisitWorklist(rows))]
    )

    await client.query("COMMIT")
    await req.logAudit("VISIT_CREATED", "inspection_visits", visitid, {
      visit_type: visitType,
      worklist_assets: rows.length
    })

    res.json({
      visit: visit.rows[0],
      summary: summarizeVisitWorklist(rows)
    })
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("Inspection visit create error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  } finally {
    client.release()
  }
}))

app.get("/inspection-visits/active-match", asyncRoute(async (req, res) => {
  if (!canWorkVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const assetid = req.query.assetid
  const result = await pool.query(
    `
    SELECT
      v.visitid,
      v.visit_reference,
      v.visit_type,
      v.visit_status,
      va.visitassetid,
      va.first_scanned_at,
      va.reconciliation_status
    FROM atec.tblinspectionvisit v
    JOIN atec.tblinspectionvisitasset va ON va.visitid = v.visitid
    WHERE va.assetid = $1
      AND v.visit_status = ANY($2::text[])
    ORDER BY v.created_at DESC
    `,
    [assetid, VISIT_ACTIVE_STATUSES]
  )

  res.json({ visits: result.rows })
}))

app.get("/inspection-visits/:id", asyncRoute(async (req, res) => {
  if (!canWorkVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const result = await pool.query(
    `
    SELECT
      v.*,
      c.clientname,
      s.sitename,
      sec.sectionname
    FROM atec.tblinspectionvisit v
    LEFT JOIN atec.tblclients c ON v.clientid = c.clientid
    LEFT JOIN atec.tblsites s ON v.siteid = s.siteid
    LEFT JOIN atec.tblsection sec ON v.sectionid = sec.sectionid
    WHERE v.visitid = $1
    `,
    [req.params.id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Visit not found" })
  }

  res.json(result.rows[0])
}))

app.get("/inspection-visits/:id/assets", asyncRoute(async (req, res) => {
  if (!canWorkVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 250)
  const offset = Math.max(Number(req.query.offset || 0), 0)
  const status = String(req.query.status || "").toUpperCase()
  const values = [req.params.id, limit, offset]
  let statusSql = ""

  if (status) {
    values.push(status)
    statusSql = `AND va.reconciliation_status = $${values.length}`
  }

  const result = await pool.query(
    `
    SELECT
      va.*,
      count(*) OVER()::int AS total_count
    FROM atec.tblinspectionvisitasset va
    WHERE va.visitid = $1
      ${statusSql}
    ORDER BY
      va.sectionid_snapshot NULLS LAST,
      va.assettag_snapshot NULLS LAST,
      va.visual_due_date_at_start NULLS LAST,
      va.loadtest_due_date_at_start NULLS LAST,
      va.visitassetid
    LIMIT $2 OFFSET $3
    `,
    values
  )

  const counts = await pool.query(
    `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE reconciliation_status = 'COMPLETED')::int AS completed,
      count(*) FILTER (WHERE reconciliation_status = 'OUTSTANDING')::int AS outstanding,
      count(*) FILTER (WHERE overdue_flag)::int AS overdue,
      count(*) FILTER (WHERE visual_due_flag)::int AS visual_due,
      count(*) FILTER (WHERE loadtest_due_flag)::int AS loadtest_due,
      count(*) FILTER (WHERE reconciliation_status = 'NOT_FOUND')::int AS not_found,
      count(*) FILTER (WHERE reconciliation_status = 'INACCESSIBLE')::int AS inaccessible,
      count(*) FILTER (WHERE reconciliation_status = 'DEFERRED')::int AS deferred,
      count(*) FILTER (WHERE reconciliation_status IN ('REMOVED_FROM_SITE','CUSTOMER_CONFIRMED_REMOVED'))::int AS removed
    FROM atec.tblinspectionvisitasset
    WHERE visitid = $1
    `,
    [req.params.id]
  )

  const equipmentTypeSummary = await pool.query(
    `
    SELECT
      COALESCE(NULLIF(TRIM(equipmenttype_snapshot), ''), 'Unspecified') AS equipment_type,
      count(*)::int AS total,
      count(*) FILTER (WHERE reconciliation_status = 'COMPLETED')::int AS completed,
      count(*) FILTER (WHERE reconciliation_status = 'OUTSTANDING')::int AS outstanding,
      count(*) FILTER (WHERE reconciliation_status = 'NOT_FOUND')::int AS not_found,
      count(*) FILTER (WHERE reconciliation_status = 'INACCESSIBLE')::int AS inaccessible,
      count(*) FILTER (WHERE reconciliation_status = 'DEFERRED')::int AS deferred,
      count(*) FILTER (
        WHERE reconciliation_status NOT IN (
          'COMPLETED', 'OUTSTANDING', 'NOT_FOUND', 'INACCESSIBLE', 'DEFERRED'
        )
      )::int AS other_resolved
    FROM atec.tblinspectionvisitasset
    WHERE visitid = $1
    GROUP BY COALESCE(NULLIF(TRIM(equipmenttype_snapshot), ''), 'Unspecified')
    ORDER BY COALESCE(NULLIF(TRIM(equipmenttype_snapshot), ''), 'Unspecified')
    `,
    [req.params.id]
  )

  res.json({
    rows: result.rows,
    total: Number(result.rows[0]?.total_count || 0),
    counts: counts.rows[0] || {},
    equipment_type_summary: equipmentTypeSummary.rows
  })
}))

app.post("/inspection-visits/:id/start", asyncRoute(async (req, res) => {
  if (!canCreateOrCloseVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const result = await pool.query(
    `
    UPDATE atec.tblinspectionvisit
    SET visit_status = 'OPEN',
        actual_start_at = COALESCE(actual_start_at, now()),
        updated_at = now()
    WHERE visitid = $1
      AND visit_status IN ('DRAFT','PAUSED')
    RETURNING *
    `,
    [req.params.id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Visit not found or cannot be started" })
  }

  await req.logAudit("VISIT_STARTED", "inspection_visits", req.params.id)
  res.json(result.rows[0])
}))

app.post("/inspection-visits/:id/scan", asyncRoute(async (req, res) => {
  if (!canWorkVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const result = await pool.query(
    `
    UPDATE atec.tblinspectionvisitasset va
    SET first_scanned_at = COALESCE(first_scanned_at, now())
    FROM atec.tblinspectionvisit v
    WHERE va.visitid = v.visitid
      AND va.visitid = $1
      AND va.assetid = $2
      AND v.visit_status = ANY($3::text[])
    RETURNING va.*
    `,
    [req.params.id, req.body.assetid, VISIT_ACTIVE_STATUSES]
  )

  if (result.rows.length === 0) {
    return res.status(409).json({ error: "This asset is not in the active visit worklist." })
  }

  await req.logAudit("VISIT_ASSET_SCANNED", "inspection_visits", req.params.id, {
    assetid: req.body.assetid
  })

  res.json(result.rows[0])
}))

app.put("/inspection-visits/:id/assets/:visitassetid/disposition", asyncRoute(async (req, res) => {
  if (!canWorkVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const status = normalizeVisitDisposition(req.body.reconciliation_status)
  const comments = String(req.body.disposition_comments || "").trim()

  if (VISIT_COMMENT_REQUIRED_STATUSES.has(status) && !comments) {
    return res.status(400).json({ error: "Comments are required for this disposition." })
  }

  if (status === "CUSTOMER_CONFIRMED_REMOVED" && !String(req.body.customer_confirmation || "").trim()) {
    return res.status(400).json({ error: "Customer confirmation is required." })
  }

  const existing = await pool.query(
    `
    SELECT va.*, v.visit_status
    FROM atec.tblinspectionvisitasset va
    JOIN atec.tblinspectionvisit v ON v.visitid = va.visitid
    WHERE va.visitid = $1
      AND va.visitassetid = $2
    `,
    [req.params.id, req.params.visitassetid]
  )

  if (existing.rows.length === 0) {
    return res.status(404).json({ error: "Visit asset not found" })
  }

  const row = existing.rows[0]
  if (!VISIT_ACTIVE_STATUSES.includes(row.visit_status)) {
    return res.status(409).json({ error: "Completed or cancelled visits are read-only." })
  }

  if (
    status === "COMPLETED" &&
    (
      (row.required_inspection_scope === "VISUAL" && !row.linked_visual_testid) ||
      (row.required_inspection_scope === "LOADTEST" && !row.linked_loadtest_testid) ||
      (row.required_inspection_scope === "BOTH" && (!row.linked_visual_testid || !row.linked_loadtest_testid))
    )
  ) {
    return res.status(400).json({ error: "Completed requires the required linked inspection or load test." })
  }

  const result = await pool.query(
    `
    UPDATE atec.tblinspectionvisitasset
    SET reconciliation_status = $1,
        disposition_reason = $2,
        disposition_comments = $3,
        customer_confirmation = $4,
        deferred_follow_up_date = $5,
        resolved_by_user_id = $6,
        resolution_at = now(),
        completed_at = CASE WHEN $1 = 'COMPLETED' THEN COALESCE(completed_at, now()) ELSE completed_at END
    WHERE visitid = $7
      AND visitassetid = $8
    RETURNING *
    `,
    [
      status,
      req.body.disposition_reason || status,
      comments,
      req.body.customer_confirmation || "",
      req.body.deferred_follow_up_date || null,
      req.user.user_id,
      req.params.id,
      req.params.visitassetid
    ]
  )

  await req.logAudit("VISIT_ASSET_DISPOSITION_SET", "inspection_visits", req.params.id, {
    visitassetid: req.params.visitassetid,
    status
  })

  res.json(result.rows[0])
}))

app.post("/inspection-visits/:id/discoveries", asyncRoute(async (req, res) => {
  if (!canWorkVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const visitResult = await pool.query(
    "SELECT visit_status FROM atec.tblinspectionvisit WHERE visitid = $1",
    [req.params.id]
  )

  if (visitResult.rows.length === 0) {
    return res.status(404).json({ error: "Visit not found" })
  }

  if (!VISIT_ACTIVE_STATUSES.includes(visitResult.rows[0].visit_status)) {
    return res.status(409).json({ error: "Completed or cancelled visits are read-only." })
  }

  const duplicateCheck = await pool.query(
    `
    SELECT assetid
    FROM atec.tblasset
    WHERE COALESCE(archived, false) = false
      AND (
        ($1 <> '' AND lower(trim(serialno)) = lower(trim($1)))
        OR ($2 <> '' AND lower(trim(assettagno)) = lower(trim($2)))
        OR ($3 <> '' AND lower(trim(qrcode)) = lower(trim($3)))
      )
    LIMIT 5
    `,
    [
      String(req.body.serialno || ""),
      String(req.body.assettagno || ""),
      String(req.body.qrcode || "")
    ]
  )

  const result = await pool.query(
    `
    INSERT INTO atec.tblinspectionvisitdiscovery
    (
      visitid,
      description,
      equiptypeid,
      serialno,
      assettagno,
      section_location,
      notes,
      customer_comment,
      inspection_performed,
      duplicate_warning,
      created_by_user_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
    `,
    [
      req.params.id,
      req.body.description || "",
      req.body.equiptypeid || null,
      req.body.serialno || "",
      req.body.assettagno || "",
      req.body.section_location || "",
      req.body.notes || "",
      req.body.customer_comment || "",
      req.body.inspection_performed === true,
      duplicateCheck.rows.length ? JSON.stringify(duplicateCheck.rows) : null,
      req.user.user_id
    ]
  )

  await req.logAudit("VISIT_ASSET_DISCOVERED", "inspection_visits", req.params.id, {
    discoveryid: result.rows[0].discoveryid,
    duplicate_candidates: duplicateCheck.rows.length
  })

  res.json(result.rows[0])
}))

app.post("/inspection-visits/:id/close", asyncRoute(async (req, res) => {
  if (!canCreateOrCloseVisit(req.user)) {
    return res.status(403).json({ error: "Only Admin or Manager users can close or override visit closure." })
  }

  const unresolved = await pool.query(
    `
    SELECT count(*)::int AS unresolved
    FROM atec.tblinspectionvisitasset
    WHERE visitid = $1
      AND reconciliation_status = 'OUTSTANDING'
    `,
    [req.params.id]
  )

  const unresolvedCount = Number(unresolved.rows[0]?.unresolved || 0)
  const override = req.body.override === true
  const overrideReason = String(req.body.override_reason || "").trim()

  if (unresolvedCount > 0 && (!override || !overrideReason)) {
    await req.logAudit("VISIT_CLOSE_BLOCKED", "inspection_visits", req.params.id, { unresolved: unresolvedCount })
    return res.status(409).json({
      error: "Due assets still unaccounted for.",
      unresolved: unresolvedCount
    })
  }

  const result = await pool.query(
    `
    UPDATE atec.tblinspectionvisit
    SET visit_status = 'COMPLETED',
        actual_completion_at = now(),
        closure_summary = $2::jsonb,
        closure_override_reason = $3,
        closed_by_user_id = $4,
        updated_at = now()
    WHERE visitid = $1
      AND visit_status = ANY($5::text[])
    RETURNING *
    `,
    [
      req.params.id,
      JSON.stringify({ unresolved: unresolvedCount, override }),
      overrideReason,
      req.user.user_id,
      VISIT_ACTIVE_STATUSES
    ]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Visit not found or already completed" })
  }

  await req.logAudit(override ? "VISIT_CLOSURE_OVERRIDE" : "VISIT_COMPLETED", "inspection_visits", req.params.id, {
    unresolved: unresolvedCount
  })

  res.json(result.rows[0])
}))

app.get("/inspection-visits/:id/report", asyncRoute(async (req, res) => {
  if (!canWorkVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const visit = await pool.query(
    `
    SELECT v.*, c.clientname, s.sitename, sec.sectionname
    FROM atec.tblinspectionvisit v
    LEFT JOIN atec.tblclients c ON v.clientid = c.clientid
    LEFT JOIN atec.tblsites s ON v.siteid = s.siteid
    LEFT JOIN atec.tblsection sec ON v.sectionid = sec.sectionid
    WHERE v.visitid = $1
    `,
    [req.params.id]
  )

  if (visit.rows.length === 0) {
    return res.status(404).json({ error: "Visit not found" })
  }

  const assets = await pool.query(
    "SELECT * FROM atec.tblinspectionvisitasset WHERE visitid = $1 ORDER BY visitassetid",
    [req.params.id]
  )
  const discoveries = await pool.query(
    "SELECT * FROM atec.tblinspectionvisitdiscovery WHERE visitid = $1 ORDER BY discoveryid",
    [req.params.id]
  )

  const equipmentTypeSummary = Array.from(
    assets.rows.reduce((groups, row) => {
      const equipmentType = String(row.equipmenttype_snapshot || "").trim() || "Unspecified"
      const current = groups.get(equipmentType) || {
        equipment_type: equipmentType,
        total: 0,
        completed: 0,
        outstanding: 0,
        not_found: 0,
        inaccessible: 0,
        deferred: 0,
        other_resolved: 0
      }
      current.total += 1
      const status = row.reconciliation_status || "OUTSTANDING"
      if (status === "COMPLETED") current.completed += 1
      else if (status === "OUTSTANDING") current.outstanding += 1
      else if (status === "NOT_FOUND") current.not_found += 1
      else if (status === "INACCESSIBLE") current.inaccessible += 1
      else if (status === "DEFERRED") current.deferred += 1
      else current.other_resolved += 1
      groups.set(equipmentType, current)
      return groups
    }, new Map()).values()
  ).sort((a, b) => a.equipment_type.localeCompare(b.equipment_type))

  res.json({
    visit: visit.rows[0],
    assets: assets.rows,
    discoveries: discoveries.rows,
    summary: {
      total_due: assets.rows.length,
      completed: assets.rows.filter(row => row.reconciliation_status === "COMPLETED").length,
      outstanding: assets.rows.filter(row => row.reconciliation_status === "OUTSTANDING").length,
      not_safe: assets.rows.filter(row => row.disposition_reason === "NOT SAFE").length,
      newly_discovered: discoveries.rows.length
    },
    equipment_type_summary: equipmentTypeSummary
  })
}))

app.get("/responsible-persons", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.personid,
        p.clientid,
        NULL::int AS siteid,
        NULL::int AS sectionid,
        p.name,
        COALESCE(p.archived, false) AS archived,
        c.clientname,
        STRING_AGG(DISTINCT s.sitename, ', ' ORDER BY s.sitename) AS sitename,
        STRING_AGG(DISTINCT sec.sectionname, ', ' ORDER BY sec.sectionname) AS sectionname,
        false AS sectionarchived,
        false AS sitearchived,
        COALESCE(c.archived, false) AS clientarchived
      FROM atec.tblpeople p
      LEFT JOIN atec.tblclients c
        ON p.clientid = c.clientid
      LEFT JOIN atec.tblsection sec
        ON sec.responsibleid = p.personid
       AND COALESCE(sec.archived, false) = false
      LEFT JOIN atec.tblsites s
        ON sec.siteid = s.siteid
       AND sec.clientid = s.clientid
       AND COALESCE(s.archived, false) = false
      GROUP BY p.personid, p.clientid, p.name, p.archived, c.clientname, c.archived
      ORDER BY c.clientname, p.name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.post("/responsible-persons", async (req, res) => {
  const client = await pool.connect()

  try {
    const { clientid, name } = req.body;
    const normalizedPersonName = normalizeAssetLookupValue(name)

    if (!clientid || !normalizedPersonName) {
      return res.status(400).json({ error: "Customer and responsible person name are required." })
    }

    await client.query("BEGIN")

    const duplicateCheck = await client.query(
      `
      SELECT personid
      FROM atec.tblpeople
      WHERE clientid = $1
        AND lower(trim(name)) = $2
        AND COALESCE(archived, false) = false
      LIMIT 1
      `,
      [clientid, normalizedPersonName]
    )

    if (duplicateCheck.rows.length > 0) {
      await client.query("ROLLBACK")
      return duplicateMasterDataResponse(res, "responsiblePerson", duplicateCheck.rows[0].personid)
    }

    const result = await client.query(
      `
      INSERT INTO atec.tblpeople
      (
        clientid,
        name
      )
      VALUES
      ($1,$2)
      RETURNING *
      `,
      [clientid, name]
    );

    const person = result.rows[0]

    await client.query("COMMIT")

    res.json({
      ...person,
      siteid: null,
      sectionid: null,
      sitename: null,
      sectionname: null
    });

  } catch (err) {
    try {
      await client.query("ROLLBACK")
    } catch (rollbackErr) {
      console.error("Responsible person create rollback failed", rollbackErr)
    }

    console.error(err);
    const duplicateType = isDuplicateActiveMasterDataError(err)
    if (duplicateType) return duplicateMasterDataResponse(res, duplicateType)

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
  } finally {
    client.release()
  }
});

app.put("/responsible-persons/:id", async (req, res) => {
  const client = await pool.connect()

  try {

    const { id } = req.params;
    const { name, clientid } = req.body;
    const normalizedPersonName = normalizeAssetLookupValue(name)

    if (!clientid || !normalizedPersonName) {
      return res.status(400).json({ error: "Customer and responsible person name are required." })
    }

    await client.query("BEGIN")

    const duplicateCheck = await client.query(
      `
      SELECT personid
      FROM atec.tblpeople
      WHERE clientid = $1
        AND personid <> $2
        AND lower(trim(name)) = $3
        AND COALESCE(archived, false) = false
      LIMIT 1
      `,
      [clientid, id, normalizedPersonName]
    )

    if (duplicateCheck.rows.length > 0) {
      await client.query("ROLLBACK")
      return duplicateMasterDataResponse(res, "responsiblePerson", duplicateCheck.rows[0].personid)
    }

    const crossCustomerLinks = await client.query(
      `
      SELECT COUNT(*)::int AS linked_sections
      FROM atec.tblsection
      WHERE responsibleid = $1
        AND clientid <> $2
        AND COALESCE(archived, false) = false
      `,
      [id, clientid]
    )

    if (Number(crossCustomerLinks.rows[0]?.linked_sections || 0) > 0) {
      await client.query("ROLLBACK")
      return res.status(400).json({
        error: "This responsible person is linked to active sections for another customer. Review those section assignments before changing this person."
      })
    }

    const result = await client.query(
      `
      UPDATE atec.tblpeople
      SET
        clientid = $1,
        name = $2
      WHERE personid = $3
      RETURNING *
      `,
      [
        clientid,
        name,
        id
      ]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Responsible person not found" })
    }

    await client.query("COMMIT")

    res.json({
      ...result.rows[0],
      siteid: null,
      sectionid: null,
      sitename: null,
      sectionname: null
    });

  } catch (err) {
    try {
      await client.query("ROLLBACK")
    } catch (rollbackErr) {
      console.error("Responsible person update rollback failed", rollbackErr)
    }

    console.error(err);
    const duplicateType = isDuplicateActiveMasterDataError(err)
    if (duplicateType) return duplicateMasterDataResponse(res, duplicateType)

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
  } finally {
    client.release()
  }
});

app.put("/responsible-persons/:id/archive", async (req, res) => {
  try {
    const { id } = req.params

    const activeLinks = await pool.query(
      `
      SELECT
        (
          SELECT COUNT(*)::int
          FROM atec.tblasset
          WHERE responsibleid = $1
            AND COALESCE(archived, false) = false
        ) AS active_assets,
        (
          SELECT COUNT(*)::int
          FROM atec.tblsection
          WHERE responsibleid = $1
            AND COALESCE(archived, false) = false
        ) AS active_sections
      `,
      [id]
    )

    const activeAssets = Number(activeLinks.rows[0]?.active_assets || 0)
    const activeSections = Number(activeLinks.rows[0]?.active_sections || 0)

    if (activeAssets > 0 || activeSections > 0) {
      return res.status(400).json({
        error: "This responsible person has active sections or assets. Move those records first."
      })
    }

    const result = await pool.query(
      `
      UPDATE atec.tblpeople
      SET archived = true
      WHERE personid = $1
      RETURNING *
      `,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Responsible person not found" })
    }

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.put("/responsible-persons/:id/unarchive", async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `
      UPDATE atec.tblpeople
      SET archived = false
      WHERE personid = $1
      RETURNING *
      `,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Responsible person not found" })
    }

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    const duplicateType = isDuplicateActiveMasterDataError(err)
    if (duplicateType) return duplicateMasterDataResponse(res, duplicateType)

    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/sections", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        sec.sectionid,
        sec.clientid,
        sec.siteid,
        COALESCE(sec.responsibleid, asset_person.responsibleid) AS responsibleid,
        sec.sectionname,
        COALESCE(sec.archived, false) AS archived,
        c.clientname,
        s.sitename,
        p.name AS responsiblename
      FROM atec.tblsection sec
      LEFT JOIN atec.tblclients c
        ON sec.clientid = c.clientid
      LEFT JOIN atec.tblsites s
        ON sec.siteid = s.siteid
      LEFT JOIN LATERAL (
        SELECT MIN(a.responsibleid) AS responsibleid
        FROM atec.tblasset a
        WHERE a.sectionid = sec.sectionid
          AND COALESCE(a.archived, false) = false
          AND a.responsibleid IS NOT NULL
        HAVING COUNT(DISTINCT a.responsibleid) = 1
      ) asset_person
        ON sec.responsibleid IS NULL
      LEFT JOIN atec.tblpeople p
        ON COALESCE(sec.responsibleid, asset_person.responsibleid) = p.personid
        ORDER BY c.clientname, s.sitename, sec.sectionname
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
  }
});

app.post("/sections", async (req, res) => {
  try {
    const { clientid, siteid, responsibleid, sectionname } = req.body;
    const normalizedSectionName = normalizeAssetLookupValue(sectionname)

    if (!clientid || !siteid || !responsibleid || !normalizedSectionName) {
      return res.status(400).json({ error: "Customer, site, responsible person, and section name are required." })
    }

    const responsiblePerson = await getActiveResponsiblePersonForClient(pool, { personid: responsibleid, clientid })
    if (!responsiblePerson) {
      return res.status(400).json({ error: "Select an active responsible person for this customer." })
    }

    if (normalizedSectionName) {
      const duplicateCheck = await pool.query(
        `
        SELECT sectionid
        FROM atec.tblsection
        WHERE clientid = $1
          AND siteid = $2
          AND lower(trim(sectionname)) = $3
          AND COALESCE(archived, false) = false
        LIMIT 1
        `,
        [clientid, siteid, normalizedSectionName]
      )

      if (duplicateCheck.rows.length > 0) {
        return duplicateMasterDataResponse(res, "section", duplicateCheck.rows[0].sectionid)
      }
    }

    const result = await pool.query(
      `INSERT INTO atec.tblsection
       (clientid, siteid, responsibleid, sectionname)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [clientid, siteid, responsibleid, sectionname]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    const duplicateType = isDuplicateActiveMasterDataError(err)
    if (duplicateType) return duplicateMasterDataResponse(res, duplicateType)

    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/sections/:id", async (req, res) => {
  try {

    const { id } = req.params

    const {
      responsibleid,
      sectionname
    } = req.body
    const normalizedSectionName = normalizeAssetLookupValue(sectionname)

    if (!responsibleid || !normalizedSectionName) {
      return res.status(400).json({ error: "Responsible person and section name are required." })
    }

    const currentSection = await pool.query(
      `
      SELECT clientid
      FROM atec.tblsection
      WHERE sectionid = $1
      LIMIT 1
      `,
      [id]
    )

    if (currentSection.rows.length === 0) {
      return res.status(404).json({ error: "Section not found" })
    }

    const responsiblePerson = await getActiveResponsiblePersonForClient(pool, {
      personid: responsibleid,
      clientid: currentSection.rows[0].clientid
    })

    if (!responsiblePerson) {
      return res.status(400).json({ error: "Select an active responsible person for this customer." })
    }

    if (normalizedSectionName) {
      const duplicateCheck = await pool.query(
        `
        SELECT other.sectionid
        FROM atec.tblsection current_section
        JOIN atec.tblsection other
          ON other.clientid = current_section.clientid
          AND other.siteid = current_section.siteid
        WHERE current_section.sectionid = $1
          AND other.sectionid <> $1
          AND lower(trim(other.sectionname)) = $2
          AND COALESCE(other.archived, false) = false
        LIMIT 1
        `,
        [id, normalizedSectionName]
      )

      if (duplicateCheck.rows.length > 0) {
        return duplicateMasterDataResponse(res, "section", duplicateCheck.rows[0].sectionid)
      }
    }

    const result = await pool.query(
      `
      UPDATE atec.tblsection
      SET
        responsibleid = $1,
        sectionname = $2
      WHERE sectionid = $3
      RETURNING *
      `,
      [
        responsibleid,
        sectionname,
        id
      ]
    )

    res.json(result.rows[0])

  } catch (err) {

    console.error(err)
    const duplicateType = isDuplicateActiveMasterDataError(err)
    if (duplicateType) return duplicateMasterDataResponse(res, duplicateType)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

app.post("/inspections",
  uploadLimiter,
  upload.fields([
    { name: "photo1", maxCount: 1 },
    { name: "photo2", maxCount: 1 },
    { name: "inspectionPhotos", maxCount: 20 },
  ]),
  validateUploadedImages,
  compressUploadedPhotos,
  async (req, res) => {
    const client = await pool.connect()

    try {
      await client.query("BEGIN")

      const {
        assetid,
        testdate,
        validdate,
        comments,
        status,
        inspectiontype,
        inspectionfrequency,
        tagnumber,
        visitid,
        results,
        updateassetphotos,
        force_duplicate
      } = req.body

      const parsedResults = JSON.parse(results || "[]")

      const inspectorProfileResult = await client.query(
        `
        SELECT
          userid AS user_id,
          COALESCE(NULLIF(fullname, ''), username) AS full_name,
          lmi_no AS lmi_number,
          usersignature AS signature_image
        FROM atec.tblusers
        WHERE userid = $1
          AND is_active = true
        `,
        [req.user.user_id]
      )

      const inspectorProfile = inspectorProfileResult.rows[0]

      if (!inspectorProfile) {
        await client.query("ROLLBACK")
        return res.status(403).json({ error: "Inspector profile is not active" })
      }

      const photo1 = req.files?.photo1
        ? `/uploads/assets/${req.files.photo1[0].filename}`
        : null

      const photo2 = req.files?.photo2
        ? `/uploads/assets/${req.files.photo2[0].filename}`
        : null

      const updatePhotos =
        updateassetphotos === "true" || updateassetphotos === true

      const inspectionTypeForCriteria = String(inspectiontype || "").toUpperCase()
      const criteriaAvailabilityResult = await client.query(
        `
        SELECT
          a.assetid,
          a.equiptypeid,
          a.clientid,
          s.sitename,
          sec.sectionname,
          et.description AS equipmenttype,
          COUNT(c.criteriaid)::int AS active_criteria_count
        FROM atec.tblasset a
        LEFT JOIN atec.tblsites s
          ON a.siteid = s.siteid
        LEFT JOIN atec.tblsection sec
          ON a.sectionid = sec.sectionid
        LEFT JOIN atec.tblequiptype et
          ON a.equiptypeid = et.equiptypeid
        LEFT JOIN atec.tblequiptypecriteria c
          ON c.equiptypeid = a.equiptypeid
         AND COALESCE(c.active, true) = true
         AND (
           $2::text <> 'LOADTEST'
           OR c.inspectioncategory = 'LOADTEST'
           OR UPPER(COALESCE(c.criterianame, c.criteriadescription, '')) IN ('SAFE FOR SERVICE', 'SAFE FOR CONTINUED OPERATION')
         )
         AND (
           $2::text = 'LOADTEST'
           OR COALESCE(c.inspectioncategory, 'VISUAL') <> 'LOADTEST'
         )
        WHERE a.assetid = $1
          AND COALESCE(a.archived, false) = false
        GROUP BY a.assetid, a.equiptypeid, a.clientid, s.sitename, sec.sectionname, et.description
        `,
        [assetid, inspectionTypeForCriteria]
      )
      const criteriaAvailability = criteriaAvailabilityResult.rows[0]

      if (!criteriaAvailability) {
        await client.query("ROLLBACK")
        return res.status(400).json({ error: "Inspection cannot be saved because the selected asset is not active." })
      }

      if (
        !criteriaAvailability.clientid ||
        !String(criteriaAvailability.sitename || "").trim() ||
        !String(criteriaAvailability.sectionname || "").trim()
      ) {
        await client.query("ROLLBACK")
        return res.status(400).json({
          error: "Inspection cannot be saved because the asset customer, site or section hierarchy is incomplete. Update the asset hierarchy and try again."
        })
      }

      const duplicateInspectionResult = await client.query(
        `
        SELECT testid, testdate, inspectiontype
        FROM atec.tblinspection
        WHERE assetid = $1
          AND UPPER(COALESCE(inspectiontype, '')) = UPPER($2)
          AND testdate = $3::date
          AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'
        ORDER BY testid DESC
        LIMIT 1
        `,
        [assetid, inspectiontype, testdate]
      )

      if (duplicateInspectionResult.rows[0] && String(force_duplicate || '').toLowerCase() !== 'true') {
        await client.query("ROLLBACK")
        return res.status(409).json({
          error: "A matching inspection already exists for this asset, type and date.",
          code: "DUPLICATE_INSPECTION",
          existing: duplicateInspectionResult.rows[0]
        })
      }

      if (!criteriaAvailability.active_criteria_count) {
        await client.query("ROLLBACK")
        return res.status(400).json({
          error: "Inspection cannot be saved because this equipment type has no approved criteria configured.",
          equiptypeid: criteriaAvailability.equiptypeid,
          equipmenttype: criteriaAvailability.equipmenttype
        })
      }

      if (!parsedResults.length) {
        await client.query("ROLLBACK")
        return res.status(400).json({ error: "Inspection cannot be saved without result rows." })
      }

      const criteriaIds = parsedResults
        .map(row => row.criteriaid)
        .filter(Boolean)

      let finalStatus = "SAFE"
      let criticalFailures = []

      if (criteriaIds.length) {
        const criteriaResult = await client.query(
          `
          SELECT
            criteriaid,
            criterianame,
            COALESCE(criteriadescription, criterianame) AS criteriadescription,
            fieldtype,
            COALESCE(resulttype,
              CASE WHEN UPPER(COALESCE(fieldtype, '')) = 'NUMBER' THEN 'MEASURED' ELSE 'PASS_FAIL' END
            ) AS resulttype,
            COALESCE(severity, 'MINOR') AS severity
          FROM atec.tblequiptypecriteria
          WHERE criteriaid = ANY($1::int[])
          `,
          [criteriaIds]
        )

        finalStatus = getSafeContinuationStatus(parsedResults, criteriaResult.rows) || "SAFE"

        const safetyRule = applyCriticalSafetyRule(parsedResults, criteriaResult.rows)

        if (safetyRule.status) {
          finalStatus = safetyRule.status
          criticalFailures = safetyRule.criticalFailures
        }
      } else if (["SAFE", "NOT SAFE"].includes(String(status || "").toUpperCase())) {
        finalStatus = String(status).toUpperCase()
      }

      const assetInspectionContextResult = await client.query(
        `
        SELECT
          a.assettagno,
          et.equipgroupid
        FROM atec.tblasset a
        LEFT JOIN atec.tblequiptype et
          ON a.equiptypeid = et.equiptypeid
        WHERE a.assetid = $1
        `,
        [assetid]
      )
      const assetInspectionContext = assetInspectionContextResult.rows[0] || {}

      let inspectionTagNumber =
        typeof tagnumber === "string" && tagnumber.trim()
          ? tagnumber.trim()
          : null

      if (inspectionTagNumber) {
        const assetTagNumber = assetInspectionContext.assettagno

        if (
          assetTagNumber &&
          normalizeAssetLookupValue(inspectionTagNumber) === normalizeAssetLookupValue(assetTagNumber)
        ) {
          inspectionTagNumber = null
        }
      }

      const assetEquipGroupId = String(assetInspectionContext.equipgroupid || "")
      const normalizedInspectionFrequency =
        String(inspectiontype || "").toUpperCase() === "LOADTEST"
          ? null
          : assetEquipGroupId === "400" && ["FREQUENT", "ANNUAL"].includes(String(inspectionfrequency || "").toUpperCase())
          ? String(inspectionfrequency).toUpperCase()
          : "FREQUENT"

      const optionalInspectionColumnResult = await client.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'atec'
          AND table_name = 'tblinspection'
          AND column_name = ANY($1::text[])
        `,
        [[
          "inspector_user_id",
          "inspector_name",
          "inspector_lmi_number",
          "inspector_signature_image",
          "inspectionfrequency",
          "tagnumber",
          "photo1",
          "photo2",
          "updateassetphotos"
        ]]
      )
      const availableInspectionColumns = new Set(
        optionalInspectionColumnResult.rows.map(row => row.column_name)
      )

      const inspectionColumns = [
        ["assetid", assetid],
        ["testdate", testdate],
        ["validdate", validdate || null],
        ["comments", truncateDbText(comments || "")],
        ["status", finalStatus],
        ["inspectiontype", inspectiontype],
        ["inspector", inspectorProfile.full_name || req.user.full_name || ""]
      ]

      pushAvailableColumn(inspectionColumns, availableInspectionColumns, "tagnumber", inspectionTagNumber)
      pushAvailableColumn(inspectionColumns, availableInspectionColumns, "photo1", photo1)
      pushAvailableColumn(inspectionColumns, availableInspectionColumns, "photo2", photo2)
      pushAvailableColumn(inspectionColumns, availableInspectionColumns, "updateassetphotos", updatePhotos)
      pushAvailableColumn(inspectionColumns, availableInspectionColumns, "inspector_user_id", inspectorProfile.user_id)
      pushAvailableColumn(inspectionColumns, availableInspectionColumns, "inspector_name", inspectorProfile.full_name || req.user.full_name || "")
      pushAvailableColumn(inspectionColumns, availableInspectionColumns, "inspector_lmi_number", inspectorProfile.lmi_number || "")
      pushAvailableColumn(inspectionColumns, availableInspectionColumns, "inspector_signature_image", inspectorProfile.signature_image || "")
      pushAvailableColumn(inspectionColumns, availableInspectionColumns, "inspectionfrequency", normalizedInspectionFrequency)

      const inspection = await client.query(
        `
        INSERT INTO atec.tblinspection
        (
          ${inspectionColumns.map(([column]) => column).join(",\n          ")}
        )
        VALUES
        (${inspectionColumns.map((_, index) => `$${index + 1}`).join(",")})
        RETURNING testid
        `,
        inspectionColumns.map(([, value]) => value)
      )

      const testid = inspection.rows[0].testid

      const photoFiles = req.files?.inspectionPhotos || []
      const captions = Array.isArray(req.body.photoCaptions)
        ? req.body.photoCaptions
        : req.body.photoCaptions ? [req.body.photoCaptions] : []
      const photoTypes = Array.isArray(req.body.photoTypes)
        ? req.body.photoTypes
        : req.body.photoTypes ? [req.body.photoTypes] : []

      for (let index = 0; index < photoFiles.length; index += 1) {
        const file = photoFiles[index]
        const photoType = String(photoTypes[index] || "GENERAL").toUpperCase()

        await client.query(
          `
          INSERT INTO atec.tblinspectionphoto
          (
            testid,
            assetid,
            uploaded_by_user_id,
            photo_path,
            original_filename,
            caption,
            photo_type
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7)
          `,
          [
            testid,
            assetid,
            inspectorProfile.user_id,
            `/uploads/inspections/${file.filename}`,
            file.originalname || "",
            captions[index] || "",
            INSPECTION_PHOTO_TYPES.has(photoType) ? photoType : "GENERAL"
          ]
        )
      }

      const optionalResultColumnResult = await client.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'atec'
          AND table_name = 'tblinspectionresult'
          AND column_name = ANY($1::text[])
        `,
        [[
          "remarks",
          "comments",
          "assetvalue",
          "measuredvalue",
          "criteriadescription"
        ]]
      )
      const availableResultColumns = new Set(
        optionalResultColumnResult.rows.map(row => row.column_name)
      )

      for (const row of parsedResults) {
        const resultColumns = [
          ["testid", testid],
          ["criteriaid", row.criteriaid || null],
          ["result", row.result || ""]
        ]

        pushAvailableColumn(resultColumns, availableResultColumns, "remarks", row.remarks || "")
        pushAvailableColumn(resultColumns, availableResultColumns, "comments", row.remarks || "")
        pushAvailableColumn(resultColumns, availableResultColumns, "assetvalue", blankToNull(row.assetvalue))
        pushAvailableColumn(resultColumns, availableResultColumns, "measuredvalue", blankToNull(row.measuredvalue))
        pushAvailableColumn(resultColumns, availableResultColumns, "criteriadescription", row.criteriadescription || row.criterianame || "")

        await client.query(
          `
          INSERT INTO atec.tblinspectionresult
          (
            ${resultColumns.map(([column]) => column).join(",\n            ")}
          )
          VALUES
          (${resultColumns.map((_, index) => `$${index + 1}`).join(",")})
          `,
          resultColumns.map(([, value]) => value)
        )
      }

      if (updatePhotos && (photo1 || photo2)) {
        await client.query(
          `
          UPDATE atec.tblasset
          SET
            media1 = COALESCE($1, media1),
            media2 = COALESCE($2, media2)
          WHERE assetid = $3
          `,
          [photo1, photo2, assetid]
        )
      }

      if (visitid) {
        const visitAssetResult = await client.query(
          `
          SELECT
            va.visitassetid,
            va.required_inspection_scope,
            va.linked_visual_testid,
            va.linked_loadtest_testid,
            v.visit_type,
            v.visit_status
          FROM atec.tblinspectionvisit v
          JOIN atec.tblinspectionvisitasset va
            ON va.visitid = v.visitid
          WHERE v.visitid = $1
            AND va.assetid = $2
            AND v.visit_status = ANY($3::text[])
          FOR UPDATE OF va
          `,
          [visitid, assetid, VISIT_ACTIVE_STATUSES]
        )

        const visitAsset = visitAssetResult.rows[0]

        if (!visitAsset) {
          await client.query("ROLLBACK")
          return res.status(400).json({ error: "Inspection cannot be linked to this visit." })
        }

        const normalizedInspectionType = String(inspectiontype || "").toUpperCase()
        const allowedByVisitType =
          visitAsset.visit_type === "COMBINED" ||
          (visitAsset.visit_type === "VISUAL" && normalizedInspectionType === "VISUAL") ||
          (visitAsset.visit_type === "LOADTEST" && normalizedInspectionType === "LOADTEST")
        const allowedByAssetScope =
          visitAsset.required_inspection_scope === "BOTH" ||
          visitAsset.required_inspection_scope === normalizedInspectionType

        if (!allowedByVisitType || !allowedByAssetScope) {
          await client.query("ROLLBACK")
          return res.status(400).json({ error: "Inspection type does not match this visit scope." })
        }

        const linkedVisual = normalizedInspectionType === "VISUAL"
          ? testid
          : visitAsset.linked_visual_testid
        const linkedLoad = normalizedInspectionType === "LOADTEST"
          ? testid
          : visitAsset.linked_loadtest_testid
        const completed =
          (visitAsset.required_inspection_scope === "VISUAL" && linkedVisual) ||
          (visitAsset.required_inspection_scope === "LOADTEST" && linkedLoad) ||
          (visitAsset.required_inspection_scope === "BOTH" && linkedVisual && linkedLoad)

        await client.query(
          `
          UPDATE atec.tblinspectionvisitasset
          SET linked_visual_testid = CASE WHEN $1 = 'VISUAL' THEN $2 ELSE linked_visual_testid END,
              linked_loadtest_testid = CASE WHEN $1 = 'LOADTEST' THEN $2 ELSE linked_loadtest_testid END,
              completed_at = CASE WHEN $3::boolean THEN now() ELSE completed_at END,
              reconciliation_status = CASE WHEN $3::boolean THEN 'COMPLETED' ELSE reconciliation_status END,
              resolved_by_user_id = CASE WHEN $3::boolean THEN $4 ELSE resolved_by_user_id END,
              resolution_at = CASE WHEN $3::boolean THEN now() ELSE resolution_at END
          WHERE visitassetid = $5
          `,
          [
            normalizedInspectionType,
            testid,
            Boolean(completed),
            req.user.user_id,
            visitAsset.visitassetid
          ]
        )

        await client.query(
          `
          INSERT INTO atec.tblinspectionvisitactivity (visitid, visitassetid, user_id, activity_type, details)
          VALUES ($1,$2,$3,'INSPECTION_LINKED',$4::jsonb)
          `,
          [
            visitid,
            visitAsset.visitassetid,
            req.user.user_id,
            JSON.stringify({ testid, inspectiontype: normalizedInspectionType, completed: Boolean(completed) })
          ]
        )
      }

      await client.query("COMMIT")
      await req.logAudit("CREATE", "inspections", testid, {
        assetid,
        inspectiontype,
        visitid: visitid || null,
        inspector_user_id: inspectorProfile.user_id,
        critical_failures: criticalFailures.length,
        inspection_photos: req.files?.inspectionPhotos?.length || 0
      })

      if (visitid) {
        await req.logAudit("VISIT_INSPECTION_LINKED", "inspection_visits", visitid, {
          assetid,
          testid,
          inspectiontype
        })
      }

      if (photoFiles.length) {
        await req.logAudit("UPLOAD", "inspection_photos", testid, {
          assetid,
          photo_count: photoFiles.length
        })
      }

      res.json({
        success: true,
        testid,
        resultcount: parsedResults.length,
        status: finalStatus,
        critical_failures: criticalFailures.length,
        photocount: photoFiles.length
      })

    } catch (err) {
      await client.query("ROLLBACK")
      const referenceId = logSafeError("Inspection save", err)
      if (isInspectionTagNotNullError(err)) {
        return res.status(500).json({
          error: "Inspection tag number is optional, but the database still requires it. Apply database/2026-07-15-task12a-optional-inspection-tag.sql and retry.",
          referenceId
        })
      }
      if (isInspectionTagUniqueError(err)) {
        return res.status(409).json({
          error: "Inspection tag number already exists.",
          referenceId
        })
      }
      if (isInspectionSchemaMissingError(err)) {
        return res.status(500).json({
          error: "The inspection could not be saved because the production database is missing a required inspection update. Apply the pending database migrations, including 2026-06-23-security-access-control.sql, 2026-06-23-equipment-401-402-404-406-photos-and-critical-rule.sql, 2026-07-14-inspection-frequency.sql, and 2026-07-15-task12a-optional-inspection-tag.sql, then retry.",
          referenceId
        })
      }
      res.status(500).json({ error: "An unexpected server error occurred", referenceId })
    } finally {
      client.release()
    }
  }
)

app.get("/inspections/:testid/photos", async (req, res) => {
  try {
    const { testid } = req.params
    const inspection = await getInspectionPhotoAccess(testid)

    if (!inspection) {
      return res.status(404).json({ error: "Inspection not found" })
    }

    if (!canReadInspectionPhoto(req.user, inspection)) {
      return res.status(403).json({ error: "Access denied" })
    }

    const result = await pool.query(
      `
      SELECT
        photoid,
        testid,
        assetid,
        uploaded_by_user_id,
        photo_path,
        original_filename,
        caption,
        photo_type,
        uploaded_at
      FROM atec.tblinspectionphoto
      WHERE testid = $1
      ORDER BY photoid
      `,
      [testid]
    )

    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.post("/inspections/:testid/photos",
  uploadLimiter,
  upload.array("inspectionPhotos", 20),
  validateUploadedImages,
  compressUploadedPhotos,
  async (req, res) => {
    try {
      const { testid } = req.params
      const inspection = await getInspectionPhotoAccess(testid)

      if (!inspection) {
        removeUploadedFiles(req.files)
        return res.status(404).json({ error: "Inspection not found" })
      }

      if (!canManageInspectionPhoto(req.user, inspection)) {
        removeUploadedFiles(req.files)
        return res.status(403).json({ error: "Access denied" })
      }

      const photoFiles = req.files || []
      const captions = Array.isArray(req.body.photoCaptions)
        ? req.body.photoCaptions
        : req.body.photoCaptions ? [req.body.photoCaptions] : []
      const photoTypes = Array.isArray(req.body.photoTypes)
        ? req.body.photoTypes
        : req.body.photoTypes ? [req.body.photoTypes] : []

      if (!photoFiles.length) {
        removeUploadedFiles(req.files)
        return res.status(400).json({ error: "Please choose at least one photo" })
      }

      const insertedPhotos = []

      for (let index = 0; index < photoFiles.length; index += 1) {
        const file = photoFiles[index]
        const photoType = String(photoTypes[index] || "GENERAL").toUpperCase()

        const result = await pool.query(
          `
          INSERT INTO atec.tblinspectionphoto
          (
            testid,
            assetid,
            uploaded_by_user_id,
            photo_path,
            original_filename,
            caption,
            photo_type
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7)
          RETURNING *
          `,
          [
            testid,
            inspection.assetid,
            req.user.user_id,
            `/uploads/inspections/${file.filename}`,
            file.originalname || "",
            captions[index] || "",
            INSPECTION_PHOTO_TYPES.has(photoType) ? photoType : "GENERAL"
          ]
        )

        insertedPhotos.push(result.rows[0])
      }

      await req.logAudit("UPLOAD", "inspection_photos", testid, {
        assetid: inspection.assetid,
        photo_count: insertedPhotos.length
      })

      res.status(201).json(insertedPhotos)
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: "An unexpected server error occurred" })
    }
  }
)

app.put("/inspection-photos/:photoid", async (req, res) => {
  try {
    const { photoid } = req.params
    const { caption, photo_type } = req.body || {}

    const existingResult = await pool.query(
      `
      SELECT
        p.*,
        i.inspector_user_id,
        a.clientid
      FROM atec.tblinspectionphoto p
      JOIN atec.tblinspection i
        ON p.testid = i.testid
      LEFT JOIN atec.tblasset a
        ON p.assetid = a.assetid
      WHERE p.photoid = $1
      `,
      [photoid]
    )

    const existingPhoto = existingResult.rows[0]

    if (!existingPhoto) {
      return res.status(404).json({ error: "Inspection photo not found" })
    }

    if (!canManageInspectionPhoto(req.user, existingPhoto)) {
      return res.status(403).json({ error: "Access denied" })
    }

    const normalizedType = String(photo_type || existingPhoto.photo_type || "GENERAL").toUpperCase()

    const result = await pool.query(
      `
      UPDATE atec.tblinspectionphoto
      SET
        caption = $1,
        photo_type = $2
      WHERE photoid = $3
      RETURNING *
      `,
      [
        caption === undefined ? existingPhoto.caption : String(caption || ""),
        INSPECTION_PHOTO_TYPES.has(normalizedType) ? normalizedType : "GENERAL",
        photoid
      ]
    )

    await req.logAudit("UPDATE", "inspection_photos", photoid, {
      testid: existingPhoto.testid
    })

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.delete("/inspection-photos/:photoid", async (req, res) => {
  try {
    const { photoid } = req.params

    const existingResult = await pool.query(
      `
      SELECT
        p.*,
        i.inspector_user_id,
        a.clientid
      FROM atec.tblinspectionphoto p
      JOIN atec.tblinspection i
        ON p.testid = i.testid
      LEFT JOIN atec.tblasset a
        ON p.assetid = a.assetid
      WHERE p.photoid = $1
      `,
      [photoid]
    )

    const existingPhoto = existingResult.rows[0]

    if (!existingPhoto) {
      return res.status(404).json({ error: "Inspection photo not found" })
    }

    if (!canManageInspectionPhoto(req.user, existingPhoto)) {
      return res.status(403).json({ error: "Access denied" })
    }

    await pool.query(
      "DELETE FROM atec.tblinspectionphoto WHERE photoid = $1",
      [photoid]
    )

    await deleteUploadFileIfUnreferenced(existingPhoto.photo_path)
    await req.logAudit("DELETE", "inspection_photos", photoid, {
      testid: existingPhoto.testid
    })

    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/inspection-results/:testid", async (req, res) => {
  try {

    const { testid } = req.params

    const result = await pool.query(
      `
      SELECT
        r.resultid,
        r.testid,
        r.criteriaid,
        r.result,
        r.remarks,
        c.criterianame
      FROM atec.tblinspectionresult r
      LEFT JOIN atec.tblequiptypecriteria c
        ON r.criteriaid = c.criteriaid
      WHERE r.testid = $1
      ORDER BY c.sortorder
      `,
      [testid]
    )

    res.json(result.rows)

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

// SAVE INSPECTION RESULTS
app.post('/inspections/:testid/results', async (req, res) => {
  const { testid } = req.params
  const { results } = req.body

  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'No inspection results received' })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const criteriaIds = results
      .map(row => row.criteriaid)
      .filter(Boolean)

    if (criteriaIds.length) {
      const criteriaResult = await client.query(
        `
        SELECT
          criteriaid,
          criterianame,
          COALESCE(criteriadescription, criterianame) AS criteriadescription,
          fieldtype,
          COALESCE(resulttype,
            CASE WHEN UPPER(COALESCE(fieldtype, '')) = 'NUMBER' THEN 'MEASURED' ELSE 'PASS_FAIL' END
          ) AS resulttype,
          COALESCE(severity, 'MINOR') AS severity
        FROM atec.tblequiptypecriteria
        WHERE criteriaid = ANY($1::int[])
        `,
        [criteriaIds]
      )

      const safetyRule = applyCriticalSafetyRule(results, criteriaResult.rows)

      if (safetyRule.status) {
        await client.query(
          `
          UPDATE atec.tblinspection
          SET status = $1
          WHERE testid = $2
          `,
          [safetyRule.status, testid]
        )
      }
    }

    // remove old rows if re-saving
    await client.query(
      `
      DELETE FROM atec.tblinspectionresult
      WHERE testid = $1
      `,
      [testid]
    )

    for (const row of results) {
      await client.query(
        `
        INSERT INTO atec.tblinspectionresult
        (
          testid,
          criteriaid,
          criteriadescription,
          result,
          comments
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          testid,
          row.criteriaid || null,
          row.criteriadescription || '',
          row.result || '',
          row.comments || ''
        ]
      )
    }

    await client.query('COMMIT')

    res.json({
      message: 'Inspection results saved successfully',
      count: results.length
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error(error)
    res.status(500).json({ error: 'Failed to save inspection results' })
  } finally {
    client.release()
  }
})

app.post("/inspection-results", async (req, res) => {

  try {

    const {
      testid,
      criteriaid,
      result,
      remarks
    } = req.body

    const dbResult = await pool.query(
      `
      INSERT INTO atec.tblinspectionresult
      (
        testid,
        criteriaid,
        result,
        remarks
      )
      VALUES
      ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        testid,
        criteriaid,
        result,
        remarks
      ]
    )

    res.json(dbResult.rows[0])

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }

})

app.get("/inspections/assets/search", searchLimiter, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim()

    if (!q) {
      return res.json([])
    }

    const result = await pool.query(`
      SELECT 
        a.assetid,
        a.assettagno,
        a.serialno,
        a.hoistserialno,
        a.qrcode,
        a.description,
        a.manufacturer,
        a.equiptypeid,
        et.equipgroupid,
        et.description AS equipmenttype
      FROM atec.tblasset a
      LEFT JOIN atec.tblequiptype et
        ON a.equiptypeid = et.equiptypeid
      WHERE
        COALESCE(a.archived, false) = false
        AND (
        a.assettagno ILIKE $1 OR
        a.serialno ILIKE $1 OR
        a.hoistserialno ILIKE $1 OR
        a.auxhoistserialno ILIKE $1 OR
        a.description ILIKE $1 OR
          CAST(a.assetid AS TEXT) ILIKE $1 OR
          a.qrcode ILIKE $1 OR
          ('ATEC-ASSET-' || a.assetid) ILIKE $1
        )
      ORDER BY a.assetid DESC
      LIMIT 50
    `, [`%${q}%`])

    res.json(result.rows)
  } catch (err) {
    console.error("Asset search error:", err)
    res.status(500).json({ error: "Failed to search assets" })
  }
})

const failedInspectionResultSql = `
  EXISTS (
    SELECT 1
    FROM atec.tblinspectionresult status_result
    WHERE status_result.testid = i.testid
      AND (
        UPPER(TRIM(COALESCE(status_result.result, ''))) IN ('FAIL', 'NO', 'NOT SAFE', 'UNSAFE')
        OR UPPER(TRIM(COALESCE(status_result.measuredvalue, ''))) IN ('FAIL', 'NO', 'NOT SAFE', 'UNSAFE')
      )
  )
`

const effectiveInspectionStatusSql = `
  CASE
    WHEN ${failedInspectionResultSql} THEN 'NOT SAFE'
    ELSE i.status
  END
`

const certificateSearchSortColumns = {
  testid: "i.testid",
  tagnumber: "i.tagnumber",
  clientname: "c.clientname",
  sitename: "s.sitename",
  description: "a.description",
  serialno: "a.serialno",
  inspectiontype: "i.inspectiontype",
  testdate: "i.testdate",
  status: effectiveInspectionStatusSql,
  inspector: "COALESCE(i.inspector_name, i.inspector)"
}

app.get("/certificates/search", searchLimiter, async (req, res) => {
  try {
    const {
      search = "",
      inspectiontype = "",
      status = "",
      clientid = "",
      siteid = "",
      sectionid = "",
      datefrom = "",
      dateto = ""
    } = req.query

    const requestedPage = parsePositiveInteger(req.query.page, 1, 100000)
    const limit = parsePositiveInteger(req.query.limit, 25, 250)
    const sortKey = certificateSearchSortColumns[req.query.sortKey] ? req.query.sortKey : "testid"
    const sortDirection = String(req.query.sortDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC"
    const orderSql = `${certificateSearchSortColumns[sortKey]} ${sortDirection} NULLS LAST, i.testid DESC`
    const values = []
    let where = `
      WHERE COALESCE(i.record_status, 'ACTIVE') = 'ACTIVE'
        AND COALESCE(a.archived, false) = false
        AND COALESCE(c.archived, false) = false
        AND COALESCE(s.archived, false) = false
        AND COALESCE(sec.archived, false) = false
    `

    if (search) {
      values.push(`%${search}%`)
      where += `
        AND (
          CAST(i.testid AS TEXT) ILIKE $${values.length}
          OR i.tagnumber ILIKE $${values.length}
          OR a.assettagno ILIKE $${values.length}
          OR a.serialno ILIKE $${values.length}
          OR a.description ILIKE $${values.length}
          OR c.clientname ILIKE $${values.length}
          OR s.sitename ILIKE $${values.length}
          OR sec.sectionname ILIKE $${values.length}
          OR et.description ILIKE $${values.length}
        )
      `
    }

    if (inspectiontype) {
      values.push(inspectiontype)
      where += ` AND i.inspectiontype = $${values.length}`
    }

    if (status) {
      values.push(status)
      where += ` AND ${effectiveInspectionStatusSql} = $${values.length}`
    }

    const effectiveClientId =
      req.user.role === "CUSTOMER"
        ? req.user.clientid
        : clientid

    if (req.user.role === "CUSTOMER" && !effectiveClientId) {
      return res.json({
        rows: [],
        total: 0,
        page: 1,
        limit,
        totalPages: 1,
        summary: {
          safe: 0,
          notSafe: 0,
          visual: 0,
          loadTest: 0
        }
      })
    }

    if (effectiveClientId) {
      values.push(effectiveClientId)
      where += ` AND a.clientid = $${values.length}`
    }

    if (siteid) {
      values.push(siteid)
      where += ` AND a.siteid = $${values.length}`
    }

    if (sectionid) {
      values.push(sectionid)
      where += ` AND a.sectionid = $${values.length}`
    }

    if (datefrom) {
      values.push(datefrom)
      where += ` AND i.testdate >= $${values.length}`
    }

    if (dateto) {
      values.push(dateto)
      where += ` AND i.testdate <= $${values.length}`
    }

    const countResult = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${effectiveInspectionStatusSql} = 'SAFE')::int AS safe,
        COUNT(*) FILTER (WHERE ${effectiveInspectionStatusSql} = 'NOT SAFE')::int AS not_safe,
        COUNT(*) FILTER (WHERE i.inspectiontype = 'VISUAL')::int AS visual,
        COUNT(*) FILTER (WHERE i.inspectiontype = 'LOADTEST')::int AS load_test
      FROM atec.tblinspection i
      LEFT JOIN atec.tblasset a ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      ${where}
      `,
      values
    )

    const total = countResult.rows[0]?.total || 0
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const page = Math.min(requestedPage, totalPages)
    const offset = (page - 1) * limit
    const pagedValues = [...values, limit, offset]
    const limitParam = `$${pagedValues.length - 1}`
    const offsetParam = `$${pagedValues.length}`

    const result = await pool.query(
      `
      SELECT
        i.testid,
        TO_CHAR(i.testdate, 'YYYY-MM-DD') AS testdate,
        TO_CHAR(i.validdate, 'YYYY-MM-DD') AS validdate,
        i.inspectiontype,
        ${effectiveInspectionStatusSql} AS status,
        COALESCE(i.inspector_name, i.inspector) AS inspector,
        i.inspector_lmi_number,
        i.tagnumber,
        a.assetid,
        a.assettagno,
        a.serialno,
        a.description,
        c.clientname,
        s.sitename,
        sec.sectionname,
        et.description AS equipmenttype
      FROM atec.tblinspection i
      LEFT JOIN atec.tblasset a ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      ${where}
      ORDER BY ${orderSql}
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
      `,
      pagedValues
    )

    res.json({
      rows: result.rows,
      total,
      page,
      limit,
      totalPages,
      summary: {
        total,
        safe: countResult.rows[0]?.safe || 0,
        notSafe: countResult.rows[0]?.not_safe || 0,
        visual: countResult.rows[0]?.visual || 0,
        loadTest: countResult.rows[0]?.load_test || 0
      }
    })

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

async function getBulkCertificateMatches(req, includeTestIds = false, eligibleOnly = false) {
  const {
    clientid = "",
    datefrom = "",
    dateto = "",
    siteid = "",
    inspectiontype = "",
    status = "",
    testids = ""
  } = req.query

  if (!datefrom || !dateto) {
    const error = new Error("Date From and Date To are required")
    error.statusCode = 400
    throw error
  }

  if (Number.isNaN(Date.parse(datefrom)) || Number.isNaN(Date.parse(dateto))) {
    const error = new Error("Enter a valid date range")
    error.statusCode = 400
    throw error
  }

  if (req.user.role === "CUSTOMER" && !req.user.clientid) {
    const error = new Error("Access denied")
    error.statusCode = 403
    throw error
  }

  if (req.user.role === "CUSTOMER" && clientid && String(req.user.clientid || "") !== String(clientid)) {
    const error = new Error("Access denied")
    error.statusCode = 403
    throw error
  }

  const effectiveClientId =
    req.user.role === "CUSTOMER"
      ? req.user.clientid
      : clientid

  const selectedTestIds = includeTestIds
    ? String(testids || "")
      .split(",")
      .map(value => Number(value.trim()))
      .filter(value => Number.isInteger(value) && value > 0)
    : []

  const values = [datefrom, dateto]
  let where = `
    WHERE i.testdate::date >= $1::date
      AND i.testdate::date <= $2::date
      AND COALESCE(i.record_status, 'ACTIVE') = 'ACTIVE'
      AND COALESCE(a.archived, false) = false
      AND COALESCE(c.archived, false) = false
      AND COALESCE(s.archived, false) = false
  `

  if (effectiveClientId) {
    values.push(effectiveClientId)
    where += ` AND a.clientid = $${values.length}`
  }

  if (siteid) {
    values.push(siteid)
    where += ` AND a.siteid = $${values.length}`
  }

  if (inspectiontype && inspectiontype !== "ALL") {
    values.push(inspectiontype)
    where += ` AND i.inspectiontype = $${values.length}`
  }

  if (status && status !== "ALL") {
    values.push(status)
    where += ` AND ${effectiveInspectionStatusSql} = $${values.length}`
  }

  if (selectedTestIds.length) {
    values.push(selectedTestIds)
    where += ` AND i.testid = ANY($${values.length}::int[])`
  }

  const result = await pool.query(
    `
    SELECT i.testid
    FROM atec.tblinspection i
    INNER JOIN atec.tblasset a
      ON i.assetid = a.assetid
    INNER JOIN atec.tblclients c
      ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s
      ON a.siteid = s.siteid
    ${where}
    ORDER BY i.testdate ASC, i.testid ASC
    LIMIT 500
    `,
    values
  )

  const certificatesByTestId = await getCertificatesData(result.rows.map(row => row.testid))
  const allCertificates = result.rows
    .map(row => certificatesByTestId.get(Number(row.testid)))
    .filter(certificate => certificate && canViewCertificate(req.user, certificate))
  const blockedCertificates = allCertificates.filter(certificate => !certificateIsEligible(certificate))
  const certificates = eligibleOnly
    ? allCertificates.filter(certificate => certificateIsEligible(certificate))
    : allCertificates

  return {
    filters: {
      clientid: effectiveClientId || "",
      datefrom,
      dateto,
      siteid,
      inspectiontype,
      status,
      testids: selectedTestIds
    },
    certificates,
    blockedCertificates,
    totalMatched: allCertificates.length
  }
}

app.get("/certificates/bulk-print", searchLimiter, async (req, res) => {
  try {
    const { filters, certificates, blockedCertificates, totalMatched } = await getBulkCertificateMatches(req, false, true)

    const blockedReasonCounts = blockedCertificates.reduce((counts, certificate) => {
      for (const reason of certificateEligibility(certificate).reasons || []) {
        counts[reason] = (counts[reason] || 0) + 1
      }
      return counts
    }, {})

    await req.logAudit("BULK_PRINT_SEARCH", "certificates", null, {
      ...filters,
      count: certificates.length,
      blocked: blockedCertificates.length
    })

    res.json({
      certificates,
      blockedCount: blockedCertificates.length,
      blockedReasonCounts,
      totalMatched
    })
  } catch (err) {
    console.error(err)
    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : "An unexpected server error occurred"
    })
  }
})

app.get("/certificates/bulk-pdf", pdfLimiter, async (req, res) => {
  try {
    const explicitSelection = String(req.query.testids || "").trim() !== ""
    const { filters, certificates } = await getBulkCertificateMatches(req, true, !explicitSelection)

    if (!certificates.length) {
      return res.status(404).json({ error: "No certificates found for the selected filters" })
    }

    const blockedCertificates = certificates.filter(certificate => !certificateIsEligible(certificate))

    if (blockedCertificates.length) {
      await req.logAudit("BULK_PDF_BLOCKED", "certificates", null, {
        ...filters,
        blocked: blockedCertificates.length,
        blocked_testids: blockedCertificates.map(certificate => certificate.inspection?.testid).filter(Boolean).slice(0, 25)
      })
      return res.status(409).json({
        error: "One or more selected inspections cannot produce certificates yet.",
        blocked: blockedCertificates.map(certificate => ({
          testid: certificate.inspection?.testid,
          reasons: certificateEligibility(certificate).reasons
        })).slice(0, 25),
        blockedCount: blockedCertificates.length
      })
    }

    if (certificates.length > bulkPdfMaxCertificates) {
      return res.status(400).json({
        error: `Too many certificates selected for one PDF job. Please select ${bulkPdfMaxCertificates} or fewer certificates.`
      })
    }

    const pdfBuffer = await runQueuedPdfJob(() => createRenderedBulkCertificatesPdfBuffer(certificates, {
      projectRoot: path.join(__dirname, ".."),
      uploadsRoot
    }))
    const customerName = certificates[0]?.inspection?.clientname || "Customer"
    const filename = bulkCertificateFilename(customerName, filters.datefrom, filters.dateto)

    await req.logAudit("BULK_PDF_DOWNLOAD", "certificates", null, {
      ...filters,
      count: certificates.length
    })

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader(
      "Content-Disposition",
      `${req.query.inline === "1" ? "inline" : "attachment"}; filename="${filename}"`
    )
    res.send(pdfBuffer)
  } catch (err) {
    const referenceId = logSafeError("Bulk certificate PDF", err)
    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : "An unexpected server error occurred",
      ...(err.statusCode ? {} : { referenceId })
    })
  }
})

app.get("/certificates/count", async (req, res) => {
  try {
    const values = []
    let joinSql = ""
    let whereSql = ""

    if (req.user.role === "CUSTOMER") {
      if (!req.user.clientid) {
        return res.json({ total: "0" })
      }

      values.push(req.user.clientid)
      joinSql = "JOIN atec.tblasset a ON i.assetid = a.assetid"
      whereSql = `WHERE a.clientid = $${values.length}`
    }

    const result = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM atec.tblinspection i
      ${joinSql}
      ${whereSql}
      `,
      values
    )

    res.json(result.rows[0])

  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.put("/sections/:id/archive", async (req, res) => {
  try {
    const { id } = req.params

    const activeAssets = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM atec.tblasset
      WHERE sectionid = $1
        AND COALESCE(archived, false) = false
      `,
      [id]
    )

    if (activeAssets.rows[0].count > 0) {
      return res.status(400).json({
        error: "This section has active assets. Move or archive the assets first."
      })
    }

    const result = await pool.query(
      `
      UPDATE atec.tblsection
      SET archived = true
      WHERE sectionid = $1
      RETURNING *
      `,
      [id]
    )

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.put("/sections/:id/unarchive", async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `
      UPDATE atec.tblsection
      SET archived = false
      WHERE sectionid = $1
      RETURNING *
      `,
      [id]
    )

    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

async function getCertificatesData(testids = []) {
  const normalizedTestIds = [...new Set(
    testids
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0)
  )]

  const certificates = new Map()
  if (!normalizedTestIds.length) return certificates

  const inspectionResult = await pool.query(
    `
    SELECT
      i.*,
      TO_CHAR(i.testdate, 'YYYY-MM-DD') AS testdate,
      TO_CHAR(i.validdate, 'YYYY-MM-DD') AS validdate,
      COALESCE(i.inspector_name, i.inspector) AS inspector,
      a.assetid,
      a.equiptypeid,
      a.serialno,
      a.assettagno,
      a.manufacturer,
      a.description,
      a.media1,
      a.media2,
      TO_CHAR(a.manufactdate, 'YYYY-MM-DD') AS manufactdate,
      a.wll,
      a.heightoflift,
      a.numberofchainfalls,
      a.oemtophooksize,
      a.oembottomhooksize,
      a.loadchaindiameter,
      a.effectivelength,
      a.span,
      a.permissibledeflection,
      a.hooksize,
      a.steelwireropemm,
      a.hoistdescription,
      a.hoistserialno,
      a.auxhoistdescription,
      a.auxhoistserialno,
      a.auxhoistwll,
      a.auxhoisthooksize,
      a.auxhoistropemm,
      c.clientid,
      c.clientname,
      s.sitename,
      sec.sectionname,
      p.name AS responsiblename,
      et.description AS equipmenttype,
      et.equipgroupid
    FROM atec.tblinspection i
    LEFT JOIN atec.tblasset a
      ON i.assetid = a.assetid
    LEFT JOIN atec.tblclients c
      ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s
      ON a.siteid = s.siteid
    LEFT JOIN atec.tblsection sec
      ON a.sectionid = sec.sectionid
    LEFT JOIN atec.tblpeople p
      ON a.responsibleid = p.personid
    LEFT JOIN atec.tblequiptype et
      ON a.equiptypeid = et.equiptypeid
    WHERE i.testid = ANY($1::int[])
      AND COALESCE(i.record_status, 'ACTIVE') = 'ACTIVE'
    `,
    [normalizedTestIds]
  )

  for (const inspection of inspectionResult.rows) {
    certificates.set(Number(inspection.testid), {
      inspection,
      results: [],
      criteria: [],
      photos: []
    })
  }

  const resultsResult = await pool.query(
    `
    SELECT
      r.resultid,
      r.testid,
      r.criteriaid,
      COALESCE(c.criteriadescription, c.criterianame, 'Criteria ' || r.criteriaid) AS criterianame,
      c.fieldtype,
      COALESCE(c.resulttype,
        CASE WHEN UPPER(COALESCE(c.fieldtype, '')) = 'NUMBER' THEN 'MEASURED' ELSE 'PASS_FAIL' END
      ) AS resulttype,
      COALESCE(c.inspectioncategory, 'VISUAL') AS inspectioncategory,
      COALESCE(c.inspection_category, 'PERIODIC_THOROUGH_INSPECTION') AS inspection_category,
      COALESCE(c.severity, 'MINOR') AS severity,
      r.assetvalue,
      r.measuredvalue,
      r.result,
      r.remarks
    FROM atec.tblinspectionresult r
    LEFT JOIN atec.tblequiptypecriteria c
      ON r.criteriaid = c.criteriaid
    WHERE r.testid = ANY($1::int[])
    ORDER BY
      r.testid,
      CASE
        WHEN LOWER(COALESCE(c.criterianame, '')) = 'safe for service' THEN 1
        ELSE 0
      END,
      c.sortorder,
      c.criteriaid
    `,
    [normalizedTestIds]
  )

  const photosResult = await pool.query(
    `
    SELECT
      photoid,
      testid,
      assetid,
      uploaded_by_user_id,
      photo_path,
      original_filename,
      caption,
      photo_type,
      uploaded_at
    FROM atec.tblinspectionphoto
    WHERE testid = ANY($1::int[])
    ORDER BY testid, photoid
    `,
    [normalizedTestIds]
  )

  for (const row of resultsResult.rows) {
    const certificate = certificates.get(Number(row.testid))
    if (certificate) certificate.results.push(row)
  }

  for (const certificate of certificates.values()) {
    if (certificate.results.some(isFailedInspectionResult)) {
      certificate.inspection.status = "NOT SAFE"
    }
  }

  const criteriaEquiptypeIds = [...new Set(
    [...certificates.values()]
      .filter(certificate => certificate.inspection?.equiptypeid)
      .map(certificate => Number(certificate.inspection.equiptypeid))
      .filter(value => Number.isInteger(value) && value > 0)
  )]

  if (criteriaEquiptypeIds.length) {
    const criteriaResult = await pool.query(
      `
      SELECT
        criteriaid,
        equiptypeid,
        COALESCE(criteriadescription, criterianame, 'Criteria ' || criteriaid) AS criterianame,
        fieldtype,
        COALESCE(resulttype,
          CASE WHEN UPPER(COALESCE(fieldtype, '')) = 'NUMBER' THEN 'MEASURED' ELSE 'PASS_FAIL' END
        ) AS resulttype,
        COALESCE(inspectioncategory, 'VISUAL') AS inspectioncategory,
        COALESCE(inspection_category, 'PERIODIC_THOROUGH_INSPECTION') AS inspection_category,
        COALESCE(severity, 'MINOR') AS severity,
        COALESCE(displayorder, sortorder, criteriaid) AS displayorder
      FROM atec.tblequiptypecriteria
      WHERE equiptypeid = ANY($1::int[])
        AND COALESCE(active, true) = true
      ORDER BY equiptypeid, COALESCE(displayorder, sortorder, criteriaid), criteriaid
      `,
      [criteriaEquiptypeIds]
    )

    const criteriaByEquiptype = new Map()
    for (const row of criteriaResult.rows) {
      const key = String(row.equiptypeid)
      if (!criteriaByEquiptype.has(key)) criteriaByEquiptype.set(key, [])
      criteriaByEquiptype.get(key).push(row)
    }

    for (const certificate of certificates.values()) {
      certificate.criteria = criteriaByEquiptype.get(String(certificate.inspection?.equiptypeid)) || []
      certificate.certificateEligibility = evaluateCertificateEligibility(certificate)
    }
  }

  for (const certificate of certificates.values()) {
    certificate.criteria = certificate.criteria || []
    certificate.certificateEligibility = evaluateCertificateEligibility(certificate)
  }

  for (const row of photosResult.rows) {
    const certificate = certificates.get(Number(row.testid))
    if (certificate) certificate.photos.push(row)
  }

  return certificates
}

async function getCertificateData(testid) {
  return (await getCertificatesData([testid])).get(Number(testid)) || null
}

function formatPdfDate(value) {
  if (!value) return "-"

  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, "0")
    const day = String(value.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  return String(value).split("T")[0]
}

function formatInspectionFrequency(value) {
  const normalized = String(value || "").toUpperCase()
  if (normalized === "ANNUAL") return "Annual"
  if (normalized === "FREQUENT") return "Frequent"
  return ""
}

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value)
}

function certificateTagNumberDisplay(inspection) {
  const tagNumber = String(inspection?.tagnumber || "").trim()
  return tagNumber || "Not Issued"
}

function certificateImagePath(imagePath) {
  if (!imagePath) return null

  const fullPath = resolveUploadFilePath(imagePath)

  return fullPath && fs.existsSync(fullPath) ? fullPath : null
}

function getCertificateTitle(inspection) {
  if (
    inspection.inspectiontype !== "LOADTEST" &&
    String(inspection.equipgroupid || "") === "400"
  ) {
    return "SERVICE AND INSPECTION"
  }

  return inspection.inspectiontype === "LOADTEST"
    ? "CERTIFICATE OF EXAMINATION AND TEST"
    : "CERTIFICATE OF INSPECTION"
}

function isCertificateSafeServiceRow(row) {
  const name = String(row?.criterianame || row?.criteriadescription || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()

  return name.includes("safe for service") ||
    name.includes("safe for continued operation") ||
    name.includes("safe for review")
}

function isEmptyLoadTestMeasurementRow(row, inspection = {}) {
  if (inspection.inspectiontype !== "LOADTEST") return false

  const result = String(row?.result || "").trim().toUpperCase()
  const measuredValue = String(row?.measuredvalue || "").trim()
  const remarks = String(row?.remarks || "").trim()

  return result === "RECORDED" && !measuredValue && !remarks
}

function isHookWearCertificateRow(row) {
  const text = [
    row?.criterianame,
    row?.criteriadescription
  ].filter(Boolean).join(" ").toLowerCase()

  return text.includes("hook wear does not exceed allowable limits")
}

function isHookMeasuredSizeCertificateRow(row) {
  const text = [
    row?.criterianame,
    row?.criteriadescription
  ].filter(Boolean).join(" ").toLowerCase()

  return text.includes("hook measured size") ||
    text.includes("measured hook throat opening")
}

function enrichCertificateResultRow(row, inspection = {}) {
  if (!isHookMeasuredSizeCertificateRow(row)) return row

  return {
    ...row,
    measuredvalue: row.measuredvalue || inspection.hooksize || ""
  }
}

function getCertificateResultsForDisplay(results = [], inspection = {}) {
  return results
    .map(row => enrichCertificateResultRow(row, inspection))
    .filter(row => !isHookWearCertificateRow(row))
    .filter(row => !isEmptyLoadTestMeasurementRow(row, inspection))
    .sort((left, right) => {
      const leftSafe = isCertificateSafeServiceRow(left)
      const rightSafe = isCertificateSafeServiceRow(right)

      if (leftSafe && !rightSafe) return 1
      if (!leftSafe && rightSafe) return -1
      return 0
    })
}

function getCertificateResultDisplay(row) {
  const result = String(row?.result || "").trim().toUpperCase()

  if (result === "RECORDED") return "PASS"
  if (!isCertificateSafeServiceRow(row)) return result
  if (["NO", "FAIL", "NOT SAFE", "UNSAFE"].includes(result)) return "NO"
  if (["YES", "PASS", "SAFE"].includes(result)) return "YES"

  return result || "-"
}

function shouldShowDrivenMachineryNote(inspection) {
  return ["400", "500"].includes(String(inspection.equipgroupid || ""))
}

function shouldShowSans500Note(inspection) {
  return ["101", "102"].includes(String(inspection.equiptypeid || ""))
}

function shouldShowRegulation18Note(inspection) {
  return ["103", "105"].includes(String(inspection.equiptypeid || ""))
}

function shouldShowDrivenMachineryItemsNote(inspection) {
  return ["200", "300"].includes(String(inspection.equipgroupid || "")) ||
    DRIVEN_MACHINERY_ITEMS_EQUIPTYPE_IDS.has(String(inspection.equiptypeid || ""))
}

function canViewCertificate(user, certificate) {
  if (!user || !certificate) return false
  if (user.role !== "CUSTOMER") return true

  return String(certificate.inspection?.clientid || "") === String(user.clientid || "")
}

function certificateEligibility(certificate) {
  return certificate?.certificateEligibility || evaluateCertificateEligibility(certificate || {})
}

function certificateBlockedPayload(certificate) {
  const eligibility = certificateEligibility(certificate)
  return {
    error: "Certificate cannot be issued for this inspection yet.",
    reasons: eligibility.reasons || ["Inspection is incomplete."]
  }
}

function certificateIsEligible(certificate) {
  return certificateEligibility(certificate).eligible === true
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function fileUrlIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return ""

  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return ""

  const ext = path.extname(filePath).toLowerCase()
  const mimeType = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream"

  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}`
}

const certificateBrandImageCache = new Map()

function certificateBrandImageDataUrl(fileName) {
  if (certificateBrandImageCache.has(fileName)) {
    return certificateBrandImageCache.get(fileName)
  }

  const imageUrl = fileUrlIfExists(path.join(__dirname, "..", "frontend", "public", fileName))
  certificateBrandImageCache.set(fileName, imageUrl)
  return imageUrl
}

function renderCertificateHeaderHtml(className = "fb-cert-header") {
  const headerUrl = certificateBrandImageDataUrl("header.jpg")
  return headerUrl ? `<img src="${headerUrl}" class="${className}" alt="FB Cranes Header">` : ""
}

function renderCertificateFooterHtml(className = "fb-cert-footer") {
  const footerUrl = certificateBrandImageDataUrl("footer.jpg")
  return footerUrl ? `<img src="${footerUrl}" class="${className}" alt="FB Cranes Footer">` : ""
}

function renderCertificatePdfHeaderTemplate() {
  const headerUrl = certificateBrandImageDataUrl("header.jpg")

  return `
    <div style="width:100%;height:40mm;padding:0 5mm;margin:0;box-sizing:border-box;overflow:hidden;font-size:0;">
      ${headerUrl ? `
        <img
          src="${headerUrl}"
          style="display:block;width:100%;height:40mm;margin:0;object-fit:fill;object-position:center top;"
        >
      ` : ""}
    </div>
  `
}

function renderCertificatePdfFooterTemplate() {
  const footerUrl = certificateBrandImageDataUrl("footer.jpg")

  return `
    <div style="width:100%;padding:0 8mm;margin:0;box-sizing:border-box;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
      ${footerUrl ? `
        <img
          src="${footerUrl}"
          style="display:block;width:100%;height:25mm;margin:0;object-fit:fill;object-position:center bottom;"
        >
      ` : ""}
      <div style="margin-top:0.5mm;text-align:right;font-size:6px;color:#475569;">
        Page <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>
    </div>
  `
}

function certificatePdfRenderOptions() {
  return {
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    margin: {
      top: "0",
      right: "0",
      bottom: "0",
      left: "0"
    }
  }
}

function uploadPathToFileUrl(uploadPath, imageDataUrlCache = null) {
  if (!uploadPath) return ""

  const fullPath = resolveUploadFilePath(uploadPath)

  if (imageDataUrlCache?.has(fullPath)) {
    return imageDataUrlCache.get(fullPath)
  }

  return fileUrlIfExists(fullPath)
}

function collectCertificatePhotoFilePaths(certificates = []) {
  const filePaths = new Set()

  for (const certificate of certificates) {
    const inspection = certificate.inspection || {}
    const photos = getCertificatePhotosForHtml(inspection, certificate.photos || []).slice(0, 4)

    for (const photo of photos) {
      const fullPath = resolveUploadFilePath(photo.photo_path)

      if (fullPath && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        filePaths.add(fullPath)
      }
    }
  }

  return [...filePaths]
}

async function compressImageForCertificatePdf(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return ""

  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return ""

  const buffer = await sharp(filePath)
    .rotate()
    .resize({
      width: 900,
      height: 700,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: 62,
      mozjpeg: true
    })
    .toBuffer()

  return `data:image/jpeg;base64,${buffer.toString("base64")}`
}

async function buildCertificatePdfImageCache(certificates = []) {
  const imageDataUrlCache = new Map()
  const photoFilePaths = collectCertificatePhotoFilePaths(certificates)

  if (!photoFilePaths.length) return imageDataUrlCache

  for (const filePath of photoFilePaths) {
    try {
      const compressedDataUrl = await compressImageForCertificatePdf(filePath)

      if (compressedDataUrl) {
        imageDataUrlCache.set(filePath, compressedDataUrl)
      }
    } catch (err) {
      console.warn(`Could not compress certificate image ${filePath}: ${err.message}`)
    }
  }

  return imageDataUrlCache
}

function getCertificatePhotosForHtml(inspection, savedPhotos = []) {
  if (savedPhotos.length) {
    return savedPhotos
  }

  return [
    inspection.photo1 || inspection.media1,
    inspection.photo2 || inspection.media2
  ]
    .filter(Boolean)
    .map((photoPath, index) => ({
      photo_path: photoPath,
      photo_type: `Photo ${index + 1}`,
      caption: ""
    }))
}

function certificateAssetDetails(inspection) {
  return [
    ["WLL", inspection.wll ? `${inspection.wll} kg` : ""],
    ["Height of Lift", inspection.heightoflift ? `${inspection.heightoflift} mm` : ""],
    ["Number of Chain Falls", inspection.numberofchainfalls],
    ["OEM Top Hook Size", inspection.oemtophooksize ? `${inspection.oemtophooksize} mm` : ""],
    ["OEM Bottom Hook Size", inspection.oembottomhooksize ? `${inspection.oembottomhooksize} mm` : ""],
    ["Load Chain Diameter", inspection.loadchaindiameter ? `${inspection.loadchaindiameter} mm` : ""],
    ["Effective Length", inspection.effectivelength ? `${inspection.effectivelength} mm` : ""],
    ["Span", inspection.span ? `${inspection.span} mm` : ""],
    ["Permissible Deflection", inspection.permissibledeflection ? `${inspection.permissibledeflection} mm` : ""],
    ["Hook Size", inspection.hooksize ? `${inspection.hooksize} mm` : ""],
    ["Steel Wire Rope", inspection.steelwireropemm ? `${inspection.steelwireropemm} mm` : ""],
    ["Hoist Description", inspection.hoistdescription],
    ["Hoist Serial No", inspection.hoistserialno],
    ["Auxiliary Hoist Description", inspection.auxhoistdescription],
    ["Auxiliary Hoist Serial No", inspection.auxhoistserialno],
    ["Auxiliary Hoist WLL", inspection.auxhoistwll ? `${inspection.auxhoistwll} kg` : ""],
    ["Auxiliary Hoist Hook Size", inspection.auxhoisthooksize ? `${inspection.auxhoisthooksize} mm` : ""],
    ["Auxiliary Hoist Steel Wire Rope", inspection.auxhoistropemm ? `${inspection.auxhoistropemm} mm` : ""]
  ].filter(([, value]) => value !== null && value !== undefined && value !== "")
}

function getCertificateRegulationNotes(inspection) {
  const notes = []

  if (shouldShowDrivenMachineryNote(inspection)) {
    notes.push(DRIVEN_MACHINERY_CERTIFICATE_NOTE)
  }

  if (shouldShowSans500Note(inspection)) {
    notes.push(SANS_500_CERTIFICATE_NOTE)
  }

  if (shouldShowRegulation18Note(inspection)) {
    notes.push(REGULATION_18_CERTIFICATE_NOTE)
  }

  if (shouldShowDrivenMachineryItemsNote(inspection)) {
    notes.push(DRIVEN_MACHINERY_ITEMS_CERTIFICATE_NOTE)
  }

  return notes
}

function renderBulkCertificateHtml(certificate, imageDataUrlCache = null, options = {}) {
  const inspection = certificate.inspection || {}
  const results = getCertificateResultsForDisplay(certificate.results || [], inspection)
  const photos = getCertificatePhotosForHtml(inspection, certificate.photos || []).slice(0, 4)
  const signatureUrl = uploadPathToFileUrl(inspection.inspector_signature_image)
  const assetDetails = certificateAssetDetails(inspection)
  const regulationNotes = getCertificateRegulationNotes(inspection)
  const includeBranding = options.includeBranding !== false

  return `
    <section class="bulk-certificate-page">
      <div class="fb-cert-page">
        ${includeBranding ? renderCertificateHeaderHtml() : ""}

        <div class="fb-cert-title">
          <h1>${htmlEscape(getCertificateTitle(inspection))}</h1>
        </div>

        <div class="fb-cert-meta">
          <div><strong>Certificate No:</strong><span>${htmlEscape(inspection.testid || "-")}</span></div>
          <div><strong>Tag Number:</strong><span>${htmlEscape(certificateTagNumberDisplay(inspection))}</span></div>
          <div>
            <strong>Status:</strong>
            <span class="${inspection.status === "SAFE" ? "status-safe" : "status-unsafe"}">
              ${htmlEscape(inspection.status || "-")}
            </span>
          </div>
        </div>

        <div class="fb-cert-section">
          <h3>Customer Details</h3>
          <div class="fb-cert-grid">
            <p><strong>Client:</strong> ${htmlEscape(inspection.clientname || "-")}</p>
            <p><strong>Site:</strong> ${htmlEscape(inspection.sitename || "-")}</p>
            <p><strong>Section:</strong> ${htmlEscape(inspection.sectionname || "-")}</p>
          </div>
        </div>

        <div class="fb-cert-section">
          <h3>Asset Details</h3>
          <div class="fb-cert-grid">
            <p><strong>Asset ID:</strong> ${htmlEscape(inspection.assetid || "-")}</p>
            <p><strong>Asset Tag No:</strong> ${htmlEscape(inspection.assettagno || "-")}</p>
            <p><strong>Equipment Type:</strong> ${htmlEscape(inspection.equipmenttype || "-")}</p>
            <p><strong>Description:</strong> ${htmlEscape(inspection.description || "-")}</p>
            <p class="fb-cert-serial-line"><strong>Serial No:</strong> <span>${htmlEscape(inspection.serialno || "-")}</span></p>
            <p><strong>Manufacturer:</strong> ${htmlEscape(inspection.manufacturer || "-")}</p>
          </div>
        </div>

        ${assetDetails.length ? `
          <div class="fb-cert-section">
            <h3>Asset Specifications</h3>
            <div class="fb-cert-grid">
              ${assetDetails.map(([label, value]) => `
                <p><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</p>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <div class="fb-cert-section">
          <h3>Inspection Details</h3>
          <div class="fb-cert-grid">
            <p><strong>Inspection Type:</strong> ${htmlEscape(inspection.inspectiontype || "-")}</p>
            ${formatInspectionFrequency(inspection.inspectionfrequency) ? `<p><strong>Frequency:</strong> ${htmlEscape(formatInspectionFrequency(inspection.inspectionfrequency))}</p>` : ""}
            <p><strong>Inspection Date:</strong> ${htmlEscape(formatPdfDate(inspection.testdate))}</p>
            <p><strong>Certificate Expiry Date:</strong> ${htmlEscape(formatPdfDate(inspection.validdate))}</p>
            <p><strong>Inspector:</strong> ${htmlEscape(inspection.inspector || "-")}</p>
            <p><strong>LMI Number:</strong> ${htmlEscape(inspection.inspector_lmi_number || "-")}</p>
          </div>
        </div>

        <div class="fb-cert-section">
          <h3>Inspection Photos</h3>
          <div class="fb-cert-photo-grid">
            ${photos.length ? photos.map((photo, index) => {
              const photoUrl = uploadPathToFileUrl(photo.photo_path, imageDataUrlCache)

              return `
                <div>
                  ${photoUrl ? `<img src="${photoUrl}" alt="Inspection Photo">` : ""}
                  <p>${htmlEscape(photo.photo_type ? String(photo.photo_type).replaceAll("_", " ") : `Photo ${index + 1}`)}</p>
                  ${photo.caption ? `<p>${htmlEscape(photo.caption)}</p>` : ""}
                </div>
              `
            }).join("") : `
              <div class="fb-cert-no-photo">No inspection photos</div>
            `}
          </div>
        </div>

        <div class="fb-cert-section">
          <h3>Inspection Results</h3>
          <table class="fb-cert-results-table">
            <colgroup>
              <col class="fb-cert-results-criteria-col">
              <col class="fb-cert-results-result-col">
              <col class="fb-cert-results-standard-col">
              <col class="fb-cert-results-measured-col">
              <col class="fb-cert-results-remarks-col">
            </colgroup>
            <thead>
              <tr>
                <th>Criteria</th>
                <th>Result</th>
                <th>Std. Dimension</th>
                <th>Measured</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(row => `
                <tr>
                  <td>${htmlEscape(row.criterianame || "")}</td>
                  <td>
                    <strong class="${
                      getCertificateResultDisplay(row) === "YES" || getCertificateResultDisplay(row) === "PASS"
                        ? "status-safe"
                        : getCertificateResultDisplay(row) === "NO" || getCertificateResultDisplay(row) === "FAIL"
                          ? "status-unsafe"
                          : ""
                    }">
                      ${htmlEscape(getCertificateResultDisplay(row))}
                    </strong>
                  </td>
                  <td>${htmlEscape(row.assetvalue || "")}</td>
                  <td>${htmlEscape(row.measuredvalue || "")}</td>
                  <td>${htmlEscape(row.remarks || "")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <div class="fb-cert-signature-section">
          <div>
            <strong>Inspector Signature</strong>
            ${signatureUrl ? `<img class="fb-cert-signature-image" src="${signatureUrl}" alt="Inspector Signature">` : ""}
            <div class="fb-cert-signature-line"></div>
          </div>
        </div>

        ${regulationNotes.map(note => `
          <p class="fb-cert-driven-note">${htmlEscape(note)}</p>
        `).join("")}

        ${includeBranding ? renderCertificateFooterHtml() : ""}
      </div>
    </section>
  `
}

function renderBulkCertificatesHtmlDocument(certificates, imageDataUrlCache = null, options = {}) {
  const includeBranding = options.includeBranding !== false

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>FB Certificates</title>
        <style>
          * { box-sizing: border-box; }
          @page { size: A4; margin: 0; }
          html, body {
            margin: 0;
            padding: 0;
            background: white;
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
          }
          .bulk-certificate-page {
            width: ${includeBranding ? "210mm" : "100%"};
            max-width: 100%;
            margin: 0 auto;
            min-height: ${includeBranding ? "297mm" : "auto"};
            padding: ${includeBranding ? "5mm 6mm" : "0"};
            overflow: visible;
            page-break-after: always;
            break-after: page;
            page-break-inside: auto;
            break-inside: auto;
          }
          .bulk-certificate-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .fb-cert-page {
            background: white;
            color: #111827;
            width: 100%;
            min-height: ${includeBranding ? "287mm" : "auto"};
            display: flex;
            flex-direction: column;
            font-size: 9.2px;
            line-height: 1.05;
            overflow: visible;
            transform: none;
            transform-origin: top left;
          }
          .fb-cert-header,
          .fb-cert-footer {
            width: 100%;
            max-width: 100%;
            margin-left: 0;
            display: block;
            object-fit: fill;
          }
          .fb-cert-header {
            margin-bottom: 14mm;
            height: 40mm;
            max-height: none;
            object-position: center top;
          }
          .fb-cert-footer {
            margin-top: auto;
            height: 22mm;
            max-height: none;
            object-position: center bottom;
          }
          .fb-cert-title {
            clear: both;
            padding-top: 0;
          }
          .fb-cert-title h1 {
            text-align: center;
            text-transform: uppercase;
            font-size: 18px;
            font-weight: 800;
            letter-spacing: 0.5px;
            margin: 0 0 4mm;
            color: #0f172a;
            -webkit-text-fill-color: #0f172a;
          }
          .fb-cert-meta {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            border-top: 1px solid #9ca3af;
            border-bottom: 1px solid #9ca3af;
            padding: 3px 0;
            margin-bottom: 4px;
          }
          .fb-cert-meta div {
            display: flex;
            gap: 6px;
          }
          .fb-cert-section { margin: 3px 0; }
          .fb-cert-signature-section,
          .fb-cert-driven-note {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .fb-cert-section h3 {
            color: #1f3b5c;
            border-bottom: 1px solid #d9e1ec;
            padding-bottom: 1px;
            margin: 0 0 2px;
            font-size: 11px;
          }
          .fb-cert-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1px 16px;
          }
          .fb-cert-grid p { margin: 1px 0; }
          .fb-cert-serial-line {
            background: #fff7d6;
            border: 1px solid #f2c94c;
            border-radius: 3px;
            color: #111827;
            font-size: 12px;
            font-weight: 700;
            padding: 2px 4px;
          }
          .fb-cert-serial-line span {
            color: #b45309;
            font-size: 13px;
          }
          .fb-cert-photo-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
          }
          .fb-cert-photo-grid div {
            border: 1px solid #d9e1ec;
            padding: 2px;
            text-align: center;
            min-height: 135px;
          }
          .fb-cert-photo-grid img {
            max-width: 100%;
            max-height: 145px;
            object-fit: contain;
          }
          .fb-cert-photo-grid p { margin: 1px 0; }
          .fb-cert-no-photo {
            display: flex;
            align-items: center;
            justify-content: center;
            color: #6b7280;
            background: #f8fafc;
          }
          .fb-cert-results-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 8.4px;
            line-height: 1;
          }
          .fb-cert-results-table thead {
            display: table-header-group;
          }
          .fb-cert-results-table tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .fb-cert-results-criteria-col { width: 39%; }
          .fb-cert-results-standard-col { width: 10%; }
          .fb-cert-results-measured-col { width: 10%; }
          .fb-cert-results-result-col { width: 9%; }
          .fb-cert-results-remarks-col { width: 32%; }
          .fb-cert-results-table th {
            background: #1f3b5c;
            color: white;
            padding: 1px 2px;
          }
          .fb-cert-results-table td {
            border: 1px solid #d9e1ec;
            padding: 1px 2px;
            vertical-align: top;
          }
          .fb-cert-results-table th:nth-child(2),
          .fb-cert-results-table td:nth-child(2) {
            text-align: center;
          }

          .fb-cert-results-table th:nth-child(3),
          .fb-cert-results-table td:nth-child(3),
          .fb-cert-results-table th:nth-child(4),
          .fb-cert-results-table td:nth-child(4) {
            text-align: right;
          }
          .fb-cert-results-table th:nth-child(5),
          .fb-cert-results-table td:nth-child(5) {
            padding-left: 8px;
            text-align: left;
          }
          .fb-cert-signature-section {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 60px;
            margin: 3px 0 1px;
          }
          .fb-cert-signature-line {
            border-bottom: 1px solid #111827;
            height: 3px;
            margin-top: 1px;
            max-width: 300px;
          }
          .fb-cert-signature-image {
            display: block;
            height: 56px;
            margin-top: 2px;
            max-width: 340px;
            object-fit: contain;
          }
          .fb-cert-driven-note {
            color: #d00000;
            font-size: 7px;
            font-style: italic;
            font-weight: 700;
            line-height: 1.15;
            margin: 2px 0 1px;
            text-align: center;
          }
          .fb-cert-footer {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .status-safe { color: #0a8f2a; font-weight: 700; }
          .status-unsafe { color: #d00000; font-weight: 700; }
        </style>
      </head>
      <body>
        ${certificates.map(certificate => renderBulkCertificateHtml(certificate, imageDataUrlCache, { includeBranding })).join("")}
      </body>
    </html>
  `
}

function findChromiumExecutable() {
  const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH

  const candidates = [
    configuredPath,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean)

  return candidates.find(candidate => fs.existsSync(candidate))
}

async function createBulkCertificatesPdfBuffer(certificates) {
  return runQueuedPdfJob(() => createBulkCertificatesPdfBufferNow(certificates))
}

async function createBulkCertificatesPdfBufferNow(certificates) {
  const executablePath = findChromiumExecutable()

  if (!executablePath) {
    const error = new Error("PDF browser engine not found. Set PUPPETEER_EXECUTABLE_PATH in backend/.env to Chrome or Edge.")
    error.statusCode = 500
    throw error
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--allow-file-access-from-files"]
  })

  let page

  try {
    const imageDataUrlCache = await buildCertificatePdfImageCache(certificates)
    page = await browser.newPage()
    page.setDefaultTimeout(120000)
    page.setDefaultNavigationTimeout(120000)
    await page.setContent(renderBulkCertificatesHtmlDocument(certificates, imageDataUrlCache, {
      includeBranding: true
    }), {
      waitUntil: "load",
      timeout: 120000
    })
    await page.emulateMediaType("print")

    return await page.pdf(certificatePdfRenderOptions())
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }

    await browser.close()
  }
}

function bulkCertificateFilename(customerName, datefrom, dateto) {
  const safeCustomerName = String(customerName || "Customer")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "Customer"

  return `FB-Certificates-${safeCustomerName}-${formatPdfDate(datefrom)}-to-${formatPdfDate(dateto)}.pdf`
}

const DRIVEN_MACHINERY_CERTIFICATE_NOTE =
  "Certification that the item has been inspected in accordance with the requirements of Driven Machinery and SANS Regulations and the responsible person has been informed of all defects."

const DRIVEN_MACHINERY_ITEMS_CERTIFICATE_NOTE =
  "Certification that the items have been inspected in accordance with the requirements of Driven Machinery and SANS Regulations and the responsible person has been informed of all defects."

const SANS_500_CERTIFICATE_NOTE =
  "EXAMINED AND TESTED IN ACCORDANCE WITH SANS 500"

const REGULATION_18_CERTIFICATE_NOTE =
  "EXAMINED AND TESTED IN ACCORDANCE WITH REGULATION 18 OF OHS ACT 85 OF 1993"

const DRIVEN_MACHINERY_ITEMS_EQUIPTYPE_IDS = new Set([
  "201",
  "202",
  "203",
  "301",
  "302",
  "303",
  "304",
  "305",
  "309",
  "312",
  "314",
  "315",
  "317",
  "319",
  "320",
  "323",
  "324",
  "338",
  "339"
])

function shouldShowSans500Note(inspection) {
  return ["101", "102"].includes(String(inspection.equiptypeid || ""))
}

function addPdfKeyValues(doc, items, x, y, width, options = {}) {
  const columnCount = options.columns || 2
  const columnGap = 18
  const labelWidth = options.labelWidth || 106
  const fontSize = options.fontSize || 6.8
  const minRowHeight = options.rowHeight || 9
  const columnWidth = (width - (columnGap * (columnCount - 1))) / columnCount
  const rows = []

  for (let index = 0; index < items.length; index += columnCount) {
    rows.push(items.slice(index, index + columnCount))
  }

  rows.forEach(rowItems => {
    const rowHeight = Math.max(
      minRowHeight,
      ...rowItems.map(item => {
        const valueHeight = doc
          .font("Helvetica")
          .fontSize(fontSize)
          .heightOfString(valueOrDash(item[1]), {
            width: columnWidth - labelWidth - 4
          })

        return valueHeight + 3
      })
    )

    rowItems.forEach((item, column) => {
      const itemX = x + (column * (columnWidth + columnGap))
      const valueX = itemX + labelWidth

      doc
        .font("Helvetica-Bold")
        .fontSize(fontSize)
        .fillColor("#111827")
        .text(`${item[0]}:`, itemX, y, {
          width: labelWidth - 4,
          lineBreak: false
        })

      doc
        .font("Helvetica")
        .fontSize(fontSize)
        .text(valueOrDash(item[1]), valueX, y, {
          width: columnWidth - labelWidth,
          lineGap: 0
        })
    })

    y += rowHeight
  })

  return y
}

function addPdfMetaValues(doc, items, x, y, width) {
  const columnWidth = width / items.length

  items.forEach((item, index) => {
    const column = index
    const itemX = x + (column * columnWidth)
    const value = valueOrDash(item[1])
    const isStatus = String(item[0]).toLowerCase() === "status"
    const isSafe = value.toUpperCase() === "SAFE"
    const statusColor = isSafe ? "#00843d" : "#d00000"

    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor("#111827")
      .text(`${item[0]}:`, itemX, y, {
        width: columnWidth,
        continued: false
      })

    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(isStatus ? statusColor : "#111827")
      .text(value, itemX + 78, y, {
        width: columnWidth - 82
      })
  })

  doc.fillColor("#111827")

  return y + 10
}

function addPdfSectionTitle(doc, title, x, y, width) {
  doc
    .moveTo(x, y + 12)
    .lineTo(x + width, y + 12)
    .strokeColor("#d9e1ec")
    .stroke()

  doc
    .fillColor("#1f3b5c")
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(title, x, y)
    .fillColor("#111827")

  return y + 13
}

function drawPdfPageFrame(doc, inspection, pageNumber) {
  const pageWidth = doc.page.width
  const pageHeight = doc.page.height
  const marginX = 28.35
  const width = pageWidth - (marginX * 2)
  const headerPath = path.join(__dirname, "..", "frontend", "public", "header.jpg")
  const footerPath = path.join(__dirname, "..", "frontend", "public", "footer.jpg")

  if (fs.existsSync(headerPath)) {
    doc.image(headerPath, marginX, 14, { width, height: 82 })
  }

  if (fs.existsSync(footerPath)) {
    doc.image(footerPath, marginX, pageHeight - 76, { width, height: 42 })
  }

  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor("#1f2937")
    .text(`Certificate ${inspection.testid} | Page ${pageNumber}`, marginX, pageHeight - 88, {
      width,
      align: "right",
      lineBreak: false
    })
    .fillColor("#111827")
}

function addCertificatePhotoPages(doc, inspection, photos, startPageNumber) {
  const savedPhotos = photos.filter(photo => photo?.photo_path)
  if (!savedPhotos.length) return

  const marginX = 28.35
  const width = doc.page.width - (marginX * 2)
  let pageNumber = startPageNumber

  for (let index = 0; index < savedPhotos.length; index += 2) {
    doc.addPage()
    drawPdfPageFrame(doc, inspection, pageNumber)

    let y = 106

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#1f2937")
      .text("INSPECTION PHOTO REPORT", marginX, y, {
        width,
        align: "center"
      })

    y += 24
    y = addPdfMetaValues(doc, [
      ["Certificate No", inspection.testid],
      ["Asset ID", inspection.assetid],
      ["Inspection Date", formatPdfDate(inspection.testdate)]
    ], marginX, y, width)

    y += 8
    y = addPdfKeyValues(doc, [
      ["Client", inspection.clientname],
      ["Site", inspection.sitename],
      ["Asset", inspection.description],
      ["Serial No", inspection.serialno],
      ["Inspector", inspection.inspector],
      ["LMI Number", inspection.inspector_lmi_number]
    ], marginX, y, width)

    y += 12

    savedPhotos.slice(index, index + 2).forEach((photo, photoIndex) => {
      const photoPath = certificateImagePath(photo.photo_path)
      const boxWidth = (width - 14) / 2
      const boxHeight = 430
      const x = marginX + (photoIndex * (boxWidth + 14))

      doc.rect(x, y, boxWidth, boxHeight).strokeColor("#d9e1ec").stroke()

      if (photoPath) {
        doc.image(photoPath, x + 8, y + 8, {
          fit: [boxWidth - 16, boxHeight - 72],
          align: "center",
          valign: "center"
        })
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .fillColor("#1f3b5c")
        .text(valueOrDash(photo.photo_type).replaceAll("_", " "), x + 8, y + boxHeight - 58, {
          width: boxWidth - 16,
          align: "center"
        })
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#111827")
        .text(valueOrDash(photo.caption), x + 8, y + boxHeight - 42, {
          width: boxWidth - 16,
          align: "center"
        })
    })

    pageNumber += 1
  }
}

function drawCertificatePdf(doc, inspection, results, photos = []) {
  const displayResults = getCertificateResultsForDisplay(results, inspection)
  const pageWidth = doc.page.width
  const marginX = 28.35
  const width = pageWidth - (marginX * 2)
  const bottomLimit = doc.page.height - 92
  let pageNumber = 1
  let y = 100

  drawPdfPageFrame(doc, inspection, pageNumber)

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#1f2937")
    .text(getCertificateTitle(inspection), marginX, y, {
      width,
      align: "center"
    })

  y += 14
  doc.moveTo(marginX, y).lineTo(marginX + width, y).strokeColor("#9ca3af").stroke()
  y += 4

  y = addPdfMetaValues(doc, [
    ["Certificate No", inspection.testid],
    ["Tag Number", certificateTagNumberDisplay(inspection)],
    ["Status", inspection.status]
  ], marginX, y, width)

  y += 5
  doc.moveTo(marginX, y).lineTo(marginX + width, y).strokeColor("#9ca3af").stroke()
  y += 6

  y = addPdfSectionTitle(doc, "Customer Details", marginX, y, width)
  y = addPdfKeyValues(doc, [
    ["Client", inspection.clientname],
    ["Site", inspection.sitename],
    ["Section", inspection.sectionname]
  ], marginX, y, width)

  y += 5
  y = addPdfSectionTitle(doc, "Asset Details", marginX, y, width)
  y = addPdfKeyValues(doc, [
    ["Asset ID", inspection.assetid],
    ["Asset Tag No", inspection.assettagno],
    ["Equipment Type", inspection.equipmenttype],
    ["Description", inspection.description],
    ["Serial No", inspection.serialno],
    ["Manufacturer", inspection.manufacturer]
  ], marginX, y, width)

  const assetSpecs = [
    ["WLL", inspection.wll ? `${inspection.wll} kg` : ""],
    ["Height of Lift", inspection.heightoflift ? `${inspection.heightoflift} mm` : ""],
    ["Span/Jib", inspection.span ? `${inspection.span} mm` : ""],
    ["Permissible Deflection", inspection.permissibledeflection ? `${inspection.permissibledeflection} mm` : ""],
    ["Hook Size", inspection.hooksize ? `${inspection.hooksize} mm` : ""],
    ["Steel Wire Rope", inspection.steelwireropemm ? `${inspection.steelwireropemm} mm` : ""],
    ["Manufacture Date", formatPdfDate(inspection.manufactdate)]
  ].filter(([, value]) => value && value !== "-")

  if (assetSpecs.length) {
    y += 5
    y = addPdfSectionTitle(doc, "Asset Specifications", marginX, y, width)
    y = addPdfKeyValues(doc, assetSpecs, marginX, y, width)
  }

  y += 5
  y = addPdfSectionTitle(doc, "Inspection Details", marginX, y, width)
  y = addPdfKeyValues(doc, [
    ["Inspection Type", inspection.inspectiontype],
    ["Inspection Date", formatPdfDate(inspection.testdate)],
    ["Certificate Expiry Date", formatPdfDate(inspection.validdate)],
    ["Inspector", inspection.inspector],
    ["LMI Number", inspection.inspector_lmi_number]
  ], marginX, y, width)

  y += 5
  y = addPdfSectionTitle(doc, "Inspection Photos", marginX, y, width)

  const photo1Path = certificateImagePath(inspection.photo1 || inspection.media1)
  const photo2Path = certificateImagePath(inspection.photo2 || inspection.media2)
  const photoBoxWidth = (width - 12) / 2
  const photoBoxHeight = 88

  ;[photo1Path, photo2Path].forEach((photoPath, index) => {
    const boxX = marginX + (index * (photoBoxWidth + 12))
    doc.rect(boxX, y, photoBoxWidth, photoBoxHeight).strokeColor("#d9e1ec").stroke()

    if (photoPath) {
      doc.image(photoPath, boxX + 5, y + 5, {
        fit: [photoBoxWidth - 10, photoBoxHeight - 18],
        align: "center",
        valign: "center"
      })
      doc.font("Helvetica").fontSize(6.5).text(`Photo ${index + 1}`, boxX, y + photoBoxHeight - 10, {
        width: photoBoxWidth,
        align: "center"
      })
    } else {
      doc.font("Helvetica").fontSize(7).fillColor("#6b7280").text(`No Photo ${index + 1}`, boxX, y + 30, {
        width: photoBoxWidth,
        align: "center"
      }).fillColor("#111827")
    }
  })

  y += photoBoxHeight + 6
  y = addPdfSectionTitle(doc, "Inspection Results", marginX, y, width)

  const tableColumns = [
    { title: "Criteria", width: Math.round(width * 0.42) },
    { title: "Result", width: Math.round(width * 0.10), align: "center" },
    { title: "Standard", width: Math.round(width * 0.15), align: "right" },
    { title: "Measured", width: Math.round(width * 0.15), align: "right" },
    { title: "Remarks", width: width - Math.round(width * 0.42) - Math.round(width * 0.15) - Math.round(width * 0.15) - Math.round(width * 0.10) }
  ]

  const addNewPdfPage = () => {
    doc.addPage()
    pageNumber += 1
    drawPdfPageFrame(doc, inspection, pageNumber)
    y = 100
  }

  const ensurePdfSpace = requiredHeight => {
    if (y + requiredHeight <= bottomLimit) return
    addNewPdfPage()
  }

  const drawResultsHeader = () => {
    ensurePdfSpace(14)

    let x = marginX
    doc.font("Helvetica-Bold").fontSize(6.5)
    tableColumns.forEach(column => {
      doc.rect(x, y, column.width, 11).fillAndStroke("#1f3b5c", "#1f3b5c")
      doc.fillColor("#ffffff")
      doc.text(column.title, x + 3, y + 3, {
        width: column.width - 6,
        align: column.align || "left"
      })
      x += column.width
    })

    y += 11
    doc.fillColor("#111827").font("Helvetica").fontSize(6.4)
  }

  drawResultsHeader()

  displayResults.forEach(row => {
    const values = [
      valueOrDash(row.criterianame),
      getCertificateResultDisplay(row),
      row.assetvalue || "",
      row.measuredvalue || "",
      row.remarks || ""
    ]

    const rowHeight = Math.max(
      10,
      doc.heightOfString(values[0], { width: tableColumns[0].width - 6 }) + 4,
      doc.heightOfString(values[4], { width: tableColumns[4].width - 6 }) + 4
    )

    ensurePdfSpace(rowHeight + 4)

    if (y === 100) {
      drawResultsHeader()
    }

    let x = marginX
    x = marginX
    tableColumns.forEach((column, index) => {
      doc.rect(x, y, column.width, rowHeight).strokeColor("#d9e1ec").stroke()
      doc
        .font(index === 1 ? "Helvetica-Bold" : "Helvetica")
        .text(values[index], x + (index === 4 ? 6 : 3), y + 3, {
          width: column.width - (index === 4 ? 9 : 6),
          align: column.align || "left"
        })
      x += column.width
    })

    y += rowHeight
  })

  const signaturePath = certificateImagePath(inspection.inspector_signature_image)
  const hasInspectorDetails =
    signaturePath ||
    valueOrDash(inspection.inspector) !== "-" ||
    valueOrDash(inspection.inspector_lmi_number) !== "-"

  if (hasInspectorDetails) {
    ensurePdfSpace(120)

    y += 8
    doc.font("Helvetica-Bold").fontSize(8).text("Inspector Signature", marginX, y)
    if (signaturePath) {
      doc.image(signaturePath, marginX, y + 10, {
        fit: [320, 86],
        align: "left",
        valign: "center"
      })
    }
    doc.moveTo(marginX, y + 100).lineTo(marginX + 320, y + 100).strokeColor("#111827").stroke()
    y += 106
  }

  if (shouldShowDrivenMachineryNote(inspection)) {
    ensurePdfSpace(28)
    y += 6
    doc
      .font("Helvetica-Oblique")
      .fontSize(7.5)
      .fillColor("#d00000")
      .text(DRIVEN_MACHINERY_CERTIFICATE_NOTE, marginX, y, {
        width,
        align: "center"
      })
      .fillColor("#111827")

    y += doc.heightOfString(DRIVEN_MACHINERY_CERTIFICATE_NOTE, {
      width,
      align: "center"
    }) + 4
  }

  if (shouldShowSans500Note(inspection)) {
    ensurePdfSpace(20)
    y += 6
    doc
      .font("Helvetica-Oblique")
      .fontSize(8)
      .fillColor("#d00000")
      .text(SANS_500_CERTIFICATE_NOTE, marginX, y, {
        width,
        align: "center"
      })
      .fillColor("#111827")

    y += doc.heightOfString(SANS_500_CERTIFICATE_NOTE, {
      width,
      align: "center"
    }) + 4
  }

  if (shouldShowRegulation18Note(inspection)) {
    ensurePdfSpace(20)
    y += 6
    doc
      .font("Helvetica-Oblique")
      .fontSize(8)
      .fillColor("#d00000")
      .text(REGULATION_18_CERTIFICATE_NOTE, marginX, y, {
        width,
        align: "center"
      })
      .fillColor("#111827")

    y += doc.heightOfString(REGULATION_18_CERTIFICATE_NOTE, {
      width,
      align: "center"
    }) + 4
  }

  if (shouldShowDrivenMachineryItemsNote(inspection)) {
    ensurePdfSpace(28)
    y += 6
    doc
      .font("Helvetica-Oblique")
      .fontSize(7.5)
      .fillColor("#d00000")
      .text(DRIVEN_MACHINERY_ITEMS_CERTIFICATE_NOTE, marginX, y, {
        width,
        align: "center"
      })
      .fillColor("#111827")

    y += doc.heightOfString(DRIVEN_MACHINERY_ITEMS_CERTIFICATE_NOTE, {
      width,
      align: "center"
    }) + 4
  }

  addCertificatePhotoPages(doc, inspection, photos, pageNumber + 1)
}

function createCertificatePdfBuffer(certificate) {
  return runQueuedPdfJob(() => createSingleCertificatePdfBuffer(certificate, {
    projectRoot: path.join(__dirname, ".."),
    uploadsRoot
  }))
}

function getMailTransport() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !process.env.MAIL_FROM) {
    return null
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: user && pass ? { user, pass } : undefined
  })
}

let graphTokenCache = { accessToken: null, expiresAt: 0 }

function useMicrosoftGraphMail() {
  return String(process.env.MAIL_PROVIDER || "").trim().toLowerCase() === "graph"
}

async function getMicrosoftGraphAccessToken() {
  if (graphTokenCache.accessToken && graphTokenCache.expiresAt > Date.now() + 60000) return graphTokenCache.accessToken

  const tenantId = String(process.env.GRAPH_TENANT_ID || "").trim()
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: String(process.env.GRAPH_CLIENT_ID || "").trim(),
      client_secret: String(process.env.GRAPH_CLIENT_SECRET || ""),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.access_token) {
    const error = new Error(payload.error_description || payload.error || "Microsoft Graph token request failed")
    error.code = "GRAPH_AUTH"
    throw error
  }

  graphTokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
  }
  return graphTokenCache.accessToken
}

function graphRecipients(value) {
  const recipients = Array.isArray(value) ? value : String(value || "").split(",")
  return recipients.map(address => String(address || "").trim()).filter(Boolean)
    .map(address => ({ emailAddress: { address } }))
}

async function sendApplicationEmail(options) {
  if (!useMicrosoftGraphMail()) {
    const transport = getMailTransport()
    if (!transport) throw new Error("SMTP transport is not configured")
    return transport.sendMail(options)
  }

  const sender = String(process.env.GRAPH_SENDER || "").trim()
  const accessToken = await getMicrosoftGraphAccessToken()
  const attachments = (options.attachments || []).map(attachment => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: attachment.filename,
    contentType: attachment.contentType || "application/octet-stream",
    contentBytes: Buffer.isBuffer(attachment.content)
      ? attachment.content.toString("base64")
      : Buffer.from(attachment.content || "").toString("base64")
  }))
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: String(options.subject || ""),
        body: { contentType: "Text", content: String(options.text || "") },
        toRecipients: graphRecipients(options.to),
        ...(attachments.length ? { attachments } : {})
      },
      saveToSentItems: true
    })
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const error = new Error(payload.error?.message || `Microsoft Graph send failed with HTTP ${response.status}`)
    error.code = "GRAPH_SEND"
    throw error
  }
}

function getMailConfigIssues() {
  const required = useMicrosoftGraphMail() ? [
    ["GRAPH_TENANT_ID", process.env.GRAPH_TENANT_ID],
    ["GRAPH_CLIENT_ID", process.env.GRAPH_CLIENT_ID],
    ["GRAPH_CLIENT_SECRET", process.env.GRAPH_CLIENT_SECRET],
    ["GRAPH_SENDER", process.env.GRAPH_SENDER]
  ] : [
    ["SMTP_HOST", process.env.SMTP_HOST],
    ["SMTP_PORT", process.env.SMTP_PORT],
    ["SMTP_USER", process.env.SMTP_USER],
    ["SMTP_PASS", process.env.SMTP_PASS],
    ["MAIL_FROM", process.env.MAIL_FROM]
  ]
  return required.filter(([, value]) => !String(value || "").trim())
    .map(([key]) => key)
}

function getMailErrorMessage(err) {
  const code = String(err?.code || "").toUpperCase()
  const command = err?.command ? ` (${err.command})` : ""
  const response = String(err?.response || err?.message || "").replace(/\s+/g, " ").trim()

  if (code === "GRAPH_AUTH") {
    return "Microsoft Graph authentication failed. Check the tenant ID, client ID, client secret, and Mail.Send admin consent."
  }

  if (code === "GRAPH_SEND") {
    return response ? `Microsoft Graph could not send the email: ${response}` : "Microsoft Graph could not send the email."
  }

  if (["EAUTH", "AUTH"].includes(code) || /auth|credential|login|password/i.test(response)) {
    return `SMTP login failed${command}. Check SMTP_USER and SMTP_PASS.`
  }

  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED"].includes(code)) {
    return `Could not connect to the mail server${command}. Check SMTP_HOST, SMTP_PORT and firewall/hosting mail access.`
  }

  if (["EENVELOPE", "EMESSAGE"].includes(code) || /sender|recipient|relay|envelope/i.test(response)) {
    return `The mail server rejected the sender or recipient${command}. Check MAIL_FROM and the recipient email address.`
  }

  return response
    ? `Email failed${command}: ${response}`
    : "Email failed. Check the backend logs for the SMTP error."
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim())
}

app.get("/inspections/:testid/certificate", async (req, res) => {
  try {
    const { testid } = req.params
    const certificate = await getCertificateData(testid)

    if (!certificate) {
      return res.status(404).json({
        error: "Certificate not found"
      })
    }

    if (!canViewCertificate(req.user, certificate)) {
      return res.status(403).json({ error: "Access denied" })
    }

    if (!certificateIsEligible(certificate)) {
      await req.logAudit("CERTIFICATE_BLOCKED", "certificates", testid, certificateBlockedPayload(certificate))
      return res.status(409).json(certificateBlockedPayload(certificate))
    }

    await req.logAudit("VIEW", "certificates", testid)
    res.json(certificate)

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/inspections/:testid/certificate.html", async (req, res) => {
  try {
    const { testid } = req.params
    const certificate = await getCertificateData(testid)

    if (!certificate) {
      return res.status(404).send("Certificate not found")
    }

    if (!canViewCertificate(req.user, certificate)) {
      return res.status(403).send("Access denied")
    }

    if (!certificateIsEligible(certificate)) {
      const blockedPayload = certificateBlockedPayload(certificate)
      await req.logAudit("CERTIFICATE_HTML_BLOCKED", "certificates", testid, blockedPayload)
      return res.status(409).json(blockedPayload)
    }

    await req.logAudit("VIEW_HTML", "certificates", testid)

    const html = await renderSingleCertificatePreviewHtml(certificate, {
      projectRoot: path.join(__dirname, ".."),
      uploadsRoot
    })

    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Expires", "0")
    res.send(html)
  } catch (err) {
    console.error(err)
    res.status(500).send("An unexpected server error occurred")
  }
})

app.get("/inspections/:testid/certificate.pdf", pdfLimiter, async (req, res) => {
  try {
    const { testid } = req.params
    const certificate = await getCertificateData(testid)

    if (!certificate) {
      return res.status(404).json({
        error: "Certificate not found"
      })
    }

    if (!canViewCertificate(req.user, certificate)) {
      return res.status(403).json({ error: "Access denied" })
    }

    if (!certificateIsEligible(certificate)) {
      await req.logAudit("CERTIFICATE_PDF_BLOCKED", "certificates", testid, certificateBlockedPayload(certificate))
      return res.status(409).json(certificateBlockedPayload(certificate))
    }

    await req.logAudit("GENERATE_PDF", "certificates", testid)

    const disposition =
      req.query.inline === "1" ? "inline" : "attachment"

    const pdfBuffer = await runQueuedPdfJob(() => createSingleCertificatePdfBuffer(certificate, {
      projectRoot: path.join(__dirname, ".."),
      uploadsRoot
    }))

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Expires", "0")
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="certificate-${testid}.pdf"`
    )

    res.send(pdfBuffer)

  } catch (err) {
    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/certificates/voided", async (req, res) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Only admins may view voided certificates" })

  const result = await pool.query(
    `SELECT i.testid, i.assetid, i.inspectiontype, i.status,
            TO_CHAR(i.testdate, 'YYYY-MM-DD') AS testdate,
            TO_CHAR(i.voided_at, 'YYYY-MM-DD HH24:MI') AS voided_at,
            i.void_reason,
            COALESCE(NULLIF(u.fullname, ''), u.username, 'System duplicate review') AS voided_by,
            a.assettagno, a.serialno, a.description, c.clientname, s.sitename
     FROM atec.tblinspection i
     LEFT JOIN atec.tblusers u ON u.userid = i.voided_by_user_id
     LEFT JOIN atec.tblasset a ON a.assetid = i.assetid
     LEFT JOIN atec.tblclients c ON c.clientid = a.clientid
     LEFT JOIN atec.tblsites s ON s.siteid = a.siteid
     WHERE i.record_status = 'VOID'
     ORDER BY i.voided_at DESC NULLS LAST, i.testid DESC
     LIMIT 500`
  )
  res.json(result.rows)
})

function normalizeCertificateIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0))].slice(0, 500)
}

app.post("/certificates/voided/bulk-restore", async (req, res) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Only admins may restore certificates" })
  const testids = normalizeCertificateIds(req.body?.testids)
  if (!testids.length) return res.status(400).json({ error: "Select at least one certificate" })

  const conflicts = await pool.query(
    `SELECT v.testid, active.testid AS existing_testid
     FROM atec.tblinspection v
     JOIN LATERAL (
       SELECT i.testid FROM atec.tblinspection i
       WHERE i.assetid = v.assetid AND i.inspectiontype = v.inspectiontype
         AND i.testdate = v.testdate AND i.record_status = 'ACTIVE'
       ORDER BY i.testid DESC LIMIT 1
     ) active ON true
     WHERE v.testid = ANY($1::int[]) AND v.record_status = 'VOID'`,
    [testids]
  )
  if (conflicts.rows.length && req.body?.force_restore !== true) {
    return res.status(409).json({ error: "Some selected certificates match active inspections.", code: "RESTORE_DUPLICATES", conflicts: conflicts.rows })
  }

  const restored = await pool.query(
    `UPDATE atec.tblinspection SET record_status = 'ACTIVE', voided_at = NULL,
       voided_by_user_id = NULL, void_reason = NULL
     WHERE testid = ANY($1::int[]) AND record_status = 'VOID' RETURNING testid`,
    [testids]
  )
  await req.logAudit("BULK_RESTORE", "certificates", null, { testids: restored.rows.map(row => row.testid) })
  res.json({ success: true, restored: restored.rows.map(row => row.testid) })
})

app.post("/certificates/voided/bulk-delete", async (req, res) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Only admins may permanently delete certificates" })
  const testids = normalizeCertificateIds(req.body?.testids)
  if (!testids.length) return res.status(400).json({ error: "Select at least one certificate" })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const records = await client.query(
      `SELECT testid, assetid, inspectiontype, testdate, void_reason
       FROM atec.tblinspection WHERE testid = ANY($1::int[]) AND record_status = 'VOID' FOR UPDATE`, [testids]
    )
    if (records.rowCount !== testids.length) throw Object.assign(new Error("One or more selected certificates are no longer voided"), { statusCode: 409 })
    await client.query("DELETE FROM atec.tblinspectionphoto WHERE testid = ANY($1::int[])", [testids])
    await client.query("DELETE FROM atec.tblinspectionresult WHERE testid = ANY($1::int[])", [testids])
    await client.query("DELETE FROM atec.tblinspection WHERE testid = ANY($1::int[])", [testids])
    await client.query("COMMIT")
    await req.logAudit("BULK_PERMANENT_DELETE", "certificates", null, { records: records.rows })
    res.json({ success: true, deleted: testids })
  } catch (err) {
    await client.query("ROLLBACK")
    if (err.code === "23503") return res.status(409).json({ error: "A selected certificate is linked to another record and cannot be permanently deleted." })
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    throw err
  } finally {
    client.release()
  }
})

app.delete("/certificates/:testid/permanent", async (req, res) => {
  req.body = { ...(req.body || {}), testids: [req.params.testid] }
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Only admins may permanently delete certificates" })
  const testid = Number(req.params.testid)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const record = await client.query(
      `SELECT testid, assetid, inspectiontype, testdate, void_reason FROM atec.tblinspection
       WHERE testid = $1 AND record_status = 'VOID' FOR UPDATE`, [testid]
    )
    if (!record.rows[0]) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Voided certificate not found" })
    }
    await client.query("DELETE FROM atec.tblinspectionphoto WHERE testid = $1", [testid])
    await client.query("DELETE FROM atec.tblinspectionresult WHERE testid = $1", [testid])
    await client.query("DELETE FROM atec.tblinspection WHERE testid = $1", [testid])
    await client.query("COMMIT")
    await req.logAudit("PERMANENT_DELETE", "certificates", testid, record.rows[0])
    res.json({ success: true, deleted: testid })
  } catch (err) {
    await client.query("ROLLBACK")
    if (err.code === "23503") return res.status(409).json({ error: "This certificate is linked to another record and cannot be permanently deleted." })
    throw err
  } finally {
    client.release()
  }
})

app.patch("/certificates/:testid/restore", async (req, res) => {
  const { testid } = req.params
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Only admins may restore certificates" })

  const current = await pool.query(
    `SELECT testid, assetid, inspectiontype, testdate FROM atec.tblinspection
     WHERE testid = $1 AND record_status = 'VOID'`, [testid]
  )
  const inspection = current.rows[0]
  if (!inspection) return res.status(404).json({ error: "Voided certificate not found" })

  const duplicate = await pool.query(
    `SELECT testid FROM atec.tblinspection
     WHERE assetid = $1 AND inspectiontype = $2 AND testdate = $3 AND record_status = 'ACTIVE'
     ORDER BY testid DESC LIMIT 1`,
    [inspection.assetid, inspection.inspectiontype, inspection.testdate]
  )
  if (duplicate.rows[0] && req.body?.force_restore !== true) {
    return res.status(409).json({
      error: "A matching active inspection already exists.",
      code: "RESTORE_DUPLICATE",
      existing_testid: duplicate.rows[0].testid
    })
  }

  await pool.query(
    `UPDATE atec.tblinspection SET record_status = 'ACTIVE', voided_at = NULL,
       voided_by_user_id = NULL, void_reason = NULL WHERE testid = $1`, [testid]
  )
  await req.logAudit("RESTORE", "certificates", testid, {
    restored_from_void: true,
    duplicate_override: Boolean(duplicate.rows[0])
  })
  res.json({ success: true, testid })
})

app.delete("/certificates/:testid", async (req, res) => {
  const { testid } = req.params

  if (!["ADMIN", "MANAGER", "INSPECTOR"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Only inspectors, managers, and administrators may void certificates" })
  }

  const client = await pool.connect()

  try {
    const certificate = await getCertificateData(testid)

    if (!certificate) {
      return res.status(404).json({ error: "Certificate not found" })
    }

    await client.query("BEGIN")

    const reason = String(req.body?.reason || "").trim()
    if (reason.length < 3) {
      await client.query("ROLLBACK")
      return res.status(400).json({ error: "Enter a reason for voiding this certificate" })
    }

    const voidResult = await client.query(
      `UPDATE atec.tblinspection
       SET record_status = 'VOID',
           voided_at = now(),
           voided_by_user_id = $2,
           void_reason = $3
       WHERE testid = $1
         AND COALESCE(record_status, 'ACTIVE') = 'ACTIVE'`,
      [testid, req.user.user_id, reason.slice(0, 500)]
    )

    await client.query("COMMIT")

    await req.logAudit("VOID", "certificates", testid, {
      assetid: certificate.inspection?.assetid || null,
      inspectiontype: certificate.inspection?.inspectiontype || null,
      reason: reason.slice(0, 500)
    })

    res.json({
      success: true,
      voided: voidResult.rowCount
    })
  } catch (err) {
    await client.query("ROLLBACK")
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  } finally {
    client.release()
  }
})

app.post("/certificates/:testid/email", emailLimiter, async (req, res) => {
  try {
    const { testid } = req.params
    const { to, subject, message } = req.body || {}
    const recipient = String(to || "").trim()

    if (!isValidEmailAddress(recipient)) {
      return res.status(400).json({ error: "Enter a valid recipient email address" })
    }

    if (
      req.user.role === "CUSTOMER" &&
      String(recipient).toLowerCase() !== String(req.user.email || "").trim().toLowerCase()
    ) {
      return res.status(403).json({
        error: "Customer users may only email certificates to their registered email address."
      })
    }

    const mailConfigIssues = getMailConfigIssues()

    if (mailConfigIssues.length) {
      return res.status(400).json({
        error: `Email is not configured yet. Missing: ${mailConfigIssues.join(", ")}. Add these values to backend/.env and restart the backend.`
      })
    }

    const certificate = await getCertificateData(testid)

    if (!certificate) {
      return res.status(404).json({ error: "Certificate not found" })
    }

    if (!canViewCertificate(req.user, certificate)) {
      return res.status(403).json({ error: "Access denied" })
    }

    if (!certificateIsEligible(certificate)) {
      await req.logAudit("CERTIFICATE_EMAIL_BLOCKED", "certificates", testid, certificateBlockedPayload(certificate))
      return res.status(409).json(certificateBlockedPayload(certificate))
    }

    const inspection = certificate.inspection
    const pdfBuffer = await runQueuedPdfJob(() => createSingleCertificatePdfBuffer(certificate, {
      projectRoot: path.join(__dirname, ".."),
      uploadsRoot
    }))
    const defaultSubject = `ATEC Certificate ${inspection.testid}`
    const defaultMessage = [
      `Good day,`,
      ``,
      `Please find attached certificate ${inspection.testid}.`,
      ``,
      `Client: ${valueOrDash(inspection.clientname)}`,
      `Site: ${valueOrDash(inspection.sitename)}`,
      `Asset: ${valueOrDash(inspection.description)}`,
      `Serial No: ${valueOrDash(inspection.serialno)}`,
      `Inspection Date: ${formatPdfDate(inspection.testdate)}`,
      `Status: ${valueOrDash(inspection.status)}`,
      ``,
      `Regards,`,
      `ATEC Inspection Platform`
    ].join("\n")

    await sendApplicationEmail({
      from: process.env.MAIL_FROM,
      to: recipient,
      subject: String(subject || defaultSubject).trim(),
      text: String(message || defaultMessage),
      attachments: [
        {
          filename: `certificate-${inspection.testid}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf"
        }
      ]
    })

    await req.logAudit("EMAIL_PDF", "certificates", testid, {
      to: recipient
    })

    res.json({ success: true })
  } catch (err) {
    const referenceId = logSafeError("Certificate email", err)
    res.status(500).json({ error: getMailErrorMessage(err), referenceId })
  }
})

app.post("/admin/email-test", emailLimiter, async (req, res) => {
  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ error: "Only admins may test email settings" })
    }

    const recipient = String(req.body?.to || "").trim()

    if (!isValidEmailAddress(recipient)) {
      return res.status(400).json({ error: "Enter a valid recipient email address" })
    }

    const mailConfigIssues = getMailConfigIssues()

    if (mailConfigIssues.length) {
      return res.status(400).json({
        error: `Email is not configured yet. Missing: ${mailConfigIssues.join(", ")}. Add these values to backend/.env and restart the backend.`
      })
    }

    await sendApplicationEmail({
      from: process.env.MAIL_FROM,
      to: recipient,
      subject: "ATEC email test",
      text: [
        "Good day,",
        "",
        "This is a test email from ATEC.",
        "",
        "If you received this, Microsoft Graph email is working."
      ].join("\n")
    })

    await req.logAudit("TEST_EMAIL", "system_email", null, { to: recipient })
    res.json({ success: true })
  } catch (err) {
    const referenceId = logSafeError("Email test", err)
    res.status(500).json({ error: getMailErrorMessage(err), referenceId })
  }
})

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function riskRating(severity, likelihood) {
  const sev = nullableInteger(severity)
  const like = nullableInteger(likelihood)

  if (!sev || !like) return null
  return sev * like
}

function normalizeRiskStatus(value) {
  const status = String(value || "OPEN").toUpperCase()
  return ["OPEN", "IN_PROGRESS", "CLOSED", "ARCHIVED"].includes(status)
    ? status
    : "OPEN"
}

function cleanJsonArray(value) {
  return Array.isArray(value)
    ? value.filter(item => item !== null && item !== undefined && String(item).trim() !== "")
    : []
}

function cleanJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  return Object.entries(value).reduce((cleaned, [key, entry]) => {
    cleaned[String(key)] = entry === null || entry === undefined ? "" : String(entry).trim()
    return cleaned
  }, {})
}

function cleanTeamMembers(value) {
  return Array.isArray(value)
    ? value.map(member => ({
        name: String(member?.name || "").trim(),
        surname: String(member?.surname || "").trim(),
        signature: String(member?.signature || "").trim()
      })).filter(member => member.name || member.surname || member.signature)
    : []
}

function riskPayload(body = {}) {
  const initialSeverity = nullableInteger(body.initial_severity)
  const initialLikelihood = nullableInteger(body.initial_likelihood)
  const residualSeverity = nullableInteger(body.residual_severity)
  const residualLikelihood = nullableInteger(body.residual_likelihood)

  return {
    assetid: nullableInteger(body.assetid),
    clientid: nullableInteger(body.clientid),
    siteid: nullableInteger(body.siteid),
    sectionid: nullableInteger(body.sectionid),
    assessment_date: body.assessment_date || new Date().toISOString().split("T")[0],
    assessment_time: body.assessment_time || null,
    activity: String(body.activity || "").trim(),
    hazard: String(body.hazard || "").trim(),
    hazard_categories: cleanJsonArray(body.hazard_categories),
    stop_questions: cleanJsonObject(body.stop_questions),
    consequence: String(body.consequence || "").trim() || null,
    initial_severity: initialSeverity,
    initial_likelihood: initialLikelihood,
    initial_rating: riskRating(initialSeverity, initialLikelihood),
    controls: String(body.controls || "").trim() || null,
    residual_severity: residualSeverity,
    residual_likelihood: residualLikelihood,
    residual_rating: riskRating(residualSeverity, residualLikelihood),
    action_required: String(body.action_required || "").trim() || null,
    manage_plan: String(body.manage_plan || "").trim() || null,
    monitor_notes: String(body.monitor_notes || "").trim() || null,
    review_questions: cleanJsonObject(body.review_questions),
    additional_notes: String(body.additional_notes || "").trim() || null,
    team_members: cleanTeamMembers(body.team_members),
    responsible_signoff_name: String(body.responsible_signoff_name || "").trim() || null,
    supervisor_signoff_name: String(body.supervisor_signoff_name || "").trim() || null,
    responsible_person: String(body.responsible_person || "").trim() || null,
    due_date: body.due_date || null,
    status: normalizeRiskStatus(body.status)
  }
}

function riskAssessmentFilters(req) {
  return {
    status: String(req.query.status || "").trim().toUpperCase(),
    search: String(req.query.search || "").trim()
  }
}

async function getRiskAssessmentRows(filters = {}) {
  const values = []
  const where = ["COALESCE(r.archived, false) = false"]

  if (filters.status) {
    values.push(filters.status)
    where.push(`r.status = $${values.length}`)
  }

  if (filters.search) {
    values.push(`%${filters.search}%`)
    where.push(`
      (
        CAST(r.riskid AS text) ILIKE $${values.length}
        OR COALESCE(a.assettagno, '') ILIKE $${values.length}
        OR COALESCE(a.serialno, '') ILIKE $${values.length}
        OR COALESCE(a.description, '') ILIKE $${values.length}
        OR COALESCE(c.clientname, '') ILIKE $${values.length}
        OR COALESCE(s.sitename, '') ILIKE $${values.length}
        OR COALESCE(r.activity, '') ILIKE $${values.length}
        OR COALESCE(r.hazard, '') ILIKE $${values.length}
        OR COALESCE(r.manage_plan, '') ILIKE $${values.length}
        OR COALESCE(r.monitor_notes, '') ILIKE $${values.length}
        OR COALESCE(r.additional_notes, '') ILIKE $${values.length}
        OR COALESCE(r.status, '') ILIKE $${values.length}
      )
    `)
  }

  const result = await pool.query(
    `
    SELECT
      r.*,
      a.assettagno,
      a.serialno,
      a.description AS asset_description,
      c.clientname,
      s.sitename,
      sec.sectionname,
      COALESCE(NULLIF(u.fullname, ''), u.username) AS created_by_name
    FROM atec.tblriskassessment r
    LEFT JOIN atec.tblasset a ON r.assetid = a.assetid
    LEFT JOIN atec.tblclients c ON COALESCE(r.clientid, a.clientid) = c.clientid
    LEFT JOIN atec.tblsites s ON COALESCE(r.siteid, a.siteid) = s.siteid
    LEFT JOIN atec.tblsection sec ON COALESCE(r.sectionid, a.sectionid) = sec.sectionid
    LEFT JOIN atec.tblusers u ON r.created_by_user_id = u.userid
    WHERE ${where.join(" AND ")}
    ORDER BY r.assessment_date DESC, r.riskid DESC
    LIMIT 500
    `,
    values
  )

  return result.rows
}

app.get("/she/risk-assessments", async (req, res) => {
  try {
    const rows = await getRiskAssessmentRows(riskAssessmentFilters(req))
    res.json(rows)
  } catch (err) {
    console.error("Risk assessment list error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/she/risk-assessments.pdf", pdfLimiter, async (req, res) => {
  try {
    const rows = await getRiskAssessmentRows(riskAssessmentFilters(req))
    const filename = `ATEC-SHE-Risk-Register-${new Date().toISOString().split("T")[0]}.pdf`

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28
    })

    doc.pipe(res)

    const columns = [
      ["ID", 26],
      ["Date", 52],
      ["Time", 34],
      ["Asset", 70],
      ["Activity", 100],
      ["Hazard", 112],
      ["Types", 70],
      ["Initial", 38],
      ["Residual", 44],
      ["Status", 58],
      ["Due", 50],
      ["Responsible", 70]
    ]
    const tableWidth = columns.reduce((sum, [, width]) => sum + width, 0)
    const marginX = doc.page.margins.left
    let y = 70

    const drawHeader = () => {
      doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .fillColor("#1f3b5c")
        .text("ATEC SHE Risk Register", marginX, 28, {
          width: tableWidth,
          align: "left"
        })
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#4b5563")
        .text(`Generated ${new Date().toISOString().split("T")[0]} | Records: ${rows.length}`, marginX, 48)

      let x = marginX
      doc.font("Helvetica-Bold").fontSize(7)
      columns.forEach(([title, width]) => {
        doc.rect(x, y, width, 16).fillAndStroke("#1f3b5c", "#1f3b5c")
        doc.fillColor("#ffffff").text(title, x + 3, y + 5, { width: width - 6 })
        x += width
      })
      doc.fillColor("#111827").font("Helvetica").fontSize(7)
      y += 16
    }

    drawHeader()

    rows.forEach(row => {
      const values = [
        row.riskid,
        reportDate(row.assessment_date),
        row.assessment_time || "-",
        row.assettagno || row.assetid || "-",
        row.activity || "",
        row.hazard || "",
        Array.isArray(row.hazard_categories) ? row.hazard_categories.join(", ") : "",
        row.initial_rating || "-",
        row.residual_rating || "-",
        String(row.status || "").replaceAll("_", " "),
        reportDate(row.due_date),
        row.responsible_person || ""
      ].map(reportValue)

      const rowHeight = Math.max(
        18,
        doc.heightOfString(values[4], { width: columns[4][1] - 6 }) + 8,
        doc.heightOfString(values[5], { width: columns[5][1] - 6 }) + 8
      )

      if (y + rowHeight > doc.page.height - 30) {
        doc.addPage()
        y = 70
        drawHeader()
      }

      let x = marginX
      columns.forEach(([, width], index) => {
        doc.rect(x, y, width, rowHeight).strokeColor("#d9e1ec").stroke()
        doc
          .font(index === 7 || index === 8 ? "Helvetica-Bold" : "Helvetica")
          .fillColor((index === 7 || index === 8) && Number(values[index]) >= 15 ? "#d00000" : "#111827")
          .text(values[index], x + 3, y + 4, { width: width - 6 })
        x += width
      })

      y += rowHeight
    })

    doc.end()
  } catch (err) {
    const referenceId = logSafeError("Risk assessment PDF", err)
    res.status(500).json({ error: "An unexpected server error occurred", referenceId })
  }
})

app.get("/she/risk-assessments.xlsx", exportLimiter, async (req, res) => {
  try {
    const rows = await getRiskAssessmentRows(riskAssessmentFilters(req))
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("SHE Risk Register")
    const filename = `ATEC-SHE-Risk-Register-${new Date().toISOString().split("T")[0]}.xlsx`

    workbook.creator = "ATEC"
    workbook.created = new Date()

    sheet.columns = [
      { header: "Risk ID", key: "riskid", width: 10 },
      { header: "Assessment Date", key: "assessment_date", width: 18 },
      { header: "Assessment Time", key: "assessment_time", width: 16 },
      { header: "Customer", key: "clientname", width: 24 },
      { header: "Site", key: "sitename", width: 22 },
      { header: "Section", key: "sectionname", width: 22 },
      { header: "Asset", key: "asset", width: 22 },
      { header: "Activity", key: "activity", width: 34 },
      { header: "Hazard Types", key: "hazard_categories_text", width: 34 },
      { header: "Hazard", key: "hazard", width: 38 },
      { header: "Consequence", key: "consequence", width: 38 },
      { header: "Initial Severity", key: "initial_severity", width: 16 },
      { header: "Initial Likelihood", key: "initial_likelihood", width: 18 },
      { header: "Initial Rating", key: "initial_rating", width: 16 },
      { header: "Controls", key: "controls", width: 38 },
      { header: "Residual Severity", key: "residual_severity", width: 18 },
      { header: "Residual Likelihood", key: "residual_likelihood", width: 20 },
      { header: "Residual Rating", key: "residual_rating", width: 18 },
      { header: "Action Required", key: "action_required", width: 38 },
      { header: "Manage Plan", key: "manage_plan", width: 38 },
      { header: "Monitor Notes", key: "monitor_notes", width: 38 },
      { header: "Additional Notes", key: "additional_notes", width: 38 },
      { header: "Responsible Person", key: "responsible_person", width: 24 },
      { header: "Due Date", key: "due_date", width: 16 },
      { header: "Status", key: "status", width: 16 },
      { header: "Created By", key: "created_by_name", width: 22 }
    ]

    rows.forEach(row => {
      sheet.addRow({
        ...row,
        assessment_date: reportDate(row.assessment_date),
        assessment_time: row.assessment_time || "",
        asset: row.assettagno || row.assetid || "",
        hazard_categories_text: Array.isArray(row.hazard_categories) ? row.hazard_categories.join(", ") : "",
        due_date: reportDate(row.due_date),
        status: String(row.status || "").replaceAll("_", " ")
      })
    })

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F3B5C" }
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: "A1", to: "Z1" }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

    await workbook.xlsx.write(res)
    res.end()
  } catch (err) {
    const referenceId = logSafeError("Risk assessment Excel", err)
    res.status(500).json({ error: "An unexpected server error occurred", referenceId })
  }
})

app.post("/she/risk-assessments", async (req, res) => {
  try {
    const payload = riskPayload(req.body)

    if (!payload.activity || !payload.hazard) {
      return res.status(400).json({ error: "Activity and hazard are required" })
    }

    if (payload.assetid) {
      const assetResult = await pool.query(
        "SELECT clientid, siteid, sectionid FROM atec.tblasset WHERE assetid = $1",
        [payload.assetid]
      )

      if (assetResult.rows.length === 0) {
        return res.status(404).json({ error: "Asset not found" })
      }

      payload.clientid = payload.clientid || assetResult.rows[0].clientid
      payload.siteid = payload.siteid || assetResult.rows[0].siteid
      payload.sectionid = payload.sectionid || assetResult.rows[0].sectionid
    }

    const result = await pool.query(
      `
      INSERT INTO atec.tblriskassessment (
        assetid, clientid, siteid, sectionid, assessment_date, assessment_time,
        activity, hazard, hazard_categories, stop_questions, consequence,
        initial_severity, initial_likelihood, initial_rating,
        controls, residual_severity, residual_likelihood, residual_rating,
        action_required, manage_plan, monitor_notes, review_questions,
        additional_notes, team_members, responsible_signoff_name, supervisor_signoff_name,
        responsible_person, due_date, status,
        created_by_user_id
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9::jsonb,$10::jsonb,$11,
        $12,$13,$14,
        $15,$16,$17,$18,
        $19,$20,$21,$22::jsonb,
        $23,$24::jsonb,$25,$26,
        $27,$28,$29,
        $30
      )
      RETURNING *
      `,
      [
        payload.assetid,
        payload.clientid,
        payload.siteid,
        payload.sectionid,
        payload.assessment_date,
        payload.assessment_time,
        payload.activity,
        payload.hazard,
        JSON.stringify(payload.hazard_categories),
        JSON.stringify(payload.stop_questions),
        payload.consequence,
        payload.initial_severity,
        payload.initial_likelihood,
        payload.initial_rating,
        payload.controls,
        payload.residual_severity,
        payload.residual_likelihood,
        payload.residual_rating,
        payload.action_required,
        payload.manage_plan,
        payload.monitor_notes,
        JSON.stringify(payload.review_questions),
        payload.additional_notes,
        JSON.stringify(payload.team_members),
        payload.responsible_signoff_name,
        payload.supervisor_signoff_name,
        payload.responsible_person,
        payload.due_date,
        payload.status,
        req.user.user_id
      ]
    )

    await req.logAudit("CREATE", "she_risk_assessments", result.rows[0].riskid)
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error("Risk assessment create error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.put("/she/risk-assessments/:id", async (req, res) => {
  try {
    const payload = riskPayload(req.body)

    if (!payload.activity || !payload.hazard) {
      return res.status(400).json({ error: "Activity and hazard are required" })
    }

    const result = await pool.query(
      `
      UPDATE atec.tblriskassessment
      SET
        assetid = $1,
        clientid = $2,
        siteid = $3,
        sectionid = $4,
        assessment_date = $5,
        assessment_time = $6,
        activity = $7,
        hazard = $8,
        hazard_categories = $9::jsonb,
        stop_questions = $10::jsonb,
        consequence = $11,
        initial_severity = $12,
        initial_likelihood = $13,
        initial_rating = $14,
        controls = $15,
        residual_severity = $16,
        residual_likelihood = $17,
        residual_rating = $18,
        action_required = $19,
        manage_plan = $20,
        monitor_notes = $21,
        review_questions = $22::jsonb,
        additional_notes = $23,
        team_members = $24::jsonb,
        responsible_signoff_name = $25,
        supervisor_signoff_name = $26,
        responsible_person = $27,
        due_date = $28,
        status = $29,
        updated_at = now()
      WHERE riskid = $30
      RETURNING *
      `,
      [
        payload.assetid,
        payload.clientid,
        payload.siteid,
        payload.sectionid,
        payload.assessment_date,
        payload.assessment_time,
        payload.activity,
        payload.hazard,
        JSON.stringify(payload.hazard_categories),
        JSON.stringify(payload.stop_questions),
        payload.consequence,
        payload.initial_severity,
        payload.initial_likelihood,
        payload.initial_rating,
        payload.controls,
        payload.residual_severity,
        payload.residual_likelihood,
        payload.residual_rating,
        payload.action_required,
        payload.manage_plan,
        payload.monitor_notes,
        JSON.stringify(payload.review_questions),
        payload.additional_notes,
        JSON.stringify(payload.team_members),
        payload.responsible_signoff_name,
        payload.supervisor_signoff_name,
        payload.responsible_person,
        payload.due_date,
        payload.status,
        req.params.id
      ]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Risk assessment not found" })
    }

    await req.logAudit("UPDATE", "she_risk_assessments", req.params.id)
    res.json(result.rows[0])
  } catch (err) {
    console.error("Risk assessment update error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.put("/she/risk-assessments/:id/archive", async (req, res) => {
  try {
    const result = await pool.query(
      `
      UPDATE atec.tblriskassessment
      SET archived = true,
          status = 'ARCHIVED',
          updated_at = now()
      WHERE riskid = $1
      RETURNING *
      `,
      [req.params.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Risk assessment not found" })
    }

    await req.logAudit("ARCHIVE", "she_risk_assessments", req.params.id)
    res.json(result.rows[0])
  } catch (err) {
    console.error("Risk assessment archive error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/dashboard/visual-due", async (req, res) => {
  try {
    res.json({ total: 0 })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

function dashboardClientScope(req, tableAlias = "a", prefix = "AND") {
  if (req.user?.role === "CUSTOMER" && req.user?.clientid) {
    return {
      clause: `${prefix} ${tableAlias}.clientid = $1`,
      values: [req.user.clientid]
    }
  }

  return { clause: "", values: [] }
}

function reportDate(value) {
  if (!value) return "-"

  if (value instanceof Date) {
    return value.toISOString().split("T")[0]
  }

  return String(value).split("T")[0]
}

function reportValue(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value)
}

function reportFileName(report, extension) {
  const customerName =
    report.customers.length === 1
      ? report.customers[0].clientname
      : "all-customers"

  const cleanName = String(customerName || "customer-report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

  return `customer-detailed-report-${cleanName || "customers"}.${extension}`
}

function customerReportFilters(query = {}) {
  return {
    clientid: query.clientid || "",
    siteid: query.siteid || "",
    sectionid: query.sectionid || "",
    responsibleid: query.responsibleid || "",
    equiptypeid: query.equiptypeid || "",
    datefrom: query.datefrom || "",
    dateto: query.dateto || "",
    status: query.status || ""
  }
}

function customerScopedReportFilters(req) {
  const filters = customerReportFilters(req.query)

  if (req.user.role === "CUSTOMER" && req.user.clientid) {
    filters.clientid = req.user.clientid || "-1"
  }

  if (req.user.role === "CUSTOMER" && !req.user.clientid) {
    filters.clientid = "-1"
  }

  return filters
}

const customerReportSortColumns = {
  clientname: "clientname",
  assetid: "assetid",
  assettagno: "assettagno",
  serialno: "serialno",
  sitename: "sitename",
  sectionname: "sectionname",
  responsiblename: "responsiblename",
  equipmenttype: "equipmenttype",
  description: "description",
  latestinspectiondate: "latestinspectiondate",
  visualtestdate: "visualtestdate",
  visualstatus: "visualstatus",
  loadtestdate: "loadtestdate",
  loadstatus: "loadstatus",
  reportstatus: "reportstatus"
}

async function getCustomerDetailedReport(filters = {}, options = {}) {
  const {
    clientid = "",
    siteid = "",
    sectionid = "",
    responsibleid = "",
    equiptypeid = "",
    datefrom = "",
    dateto = "",
    status = ""
  } = filters

  const customerValues = []
  const values = []
  let customerWhere = "WHERE COALESCE(c.archived, false) = false"
  let assetWhere = `
    WHERE COALESCE(a.archived, false) = false
      AND COALESCE(c.archived, false) = false
      AND COALESCE(s.archived, false) = false
      AND COALESCE(sec.archived, false) = false
  `
  const inspectionWhere = []
  const paged = options.paginated === true
  const requestedPage = parsePositiveInteger(options.page, 1, 100000)
  const limit = parsePositiveInteger(options.limit, 25, 250)
  const sortKey = customerReportSortColumns[options.sortKey] ? options.sortKey : "latestinspectiondate"
  const sortDirection = String(options.sortDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC"

  if (clientid) {
    customerValues.push(clientid)
    customerWhere += ` AND c.clientid = $${customerValues.length}`

    values.push(clientid)
    assetWhere += ` AND a.clientid = $${values.length}`
  }

  if (siteid) {
    customerValues.push(siteid)
    customerWhere += ` AND EXISTS (
      SELECT 1
      FROM atec.tblasset customer_asset
      WHERE customer_asset.clientid = c.clientid
        AND customer_asset.siteid = $${customerValues.length}
        AND COALESCE(customer_asset.archived, false) = false
    )`

    values.push(siteid)
    assetWhere += ` AND a.siteid = $${values.length}`
  }

  if (sectionid) {
    customerValues.push(sectionid)
    customerWhere += ` AND EXISTS (
      SELECT 1
      FROM atec.tblasset customer_asset
      WHERE customer_asset.clientid = c.clientid
        AND customer_asset.sectionid = $${customerValues.length}
        AND COALESCE(customer_asset.archived, false) = false
    )`

    values.push(sectionid)
    assetWhere += ` AND a.sectionid = $${values.length}`
  }

  if (responsibleid) {
    customerValues.push(responsibleid)
    customerWhere += ` AND EXISTS (
      SELECT 1
      FROM atec.tblasset customer_asset
      LEFT JOIN atec.tblsection customer_section
        ON customer_asset.sectionid = customer_section.sectionid
      WHERE customer_asset.clientid = c.clientid
        AND customer_section.responsibleid = $${customerValues.length}
        AND COALESCE(customer_asset.archived, false) = false
        AND COALESCE(customer_section.archived, false) = false
    )`

    values.push(responsibleid)
    assetWhere += ` AND sec.responsibleid = $${values.length}`
  }

  if (equiptypeid) {
    values.push(equiptypeid)
    assetWhere += ` AND a.equiptypeid = $${values.length}`
  }

  if (datefrom) {
    values.push(datefrom)
    inspectionWhere.push(`testdate >= $${values.length}`)
  }

  if (dateto) {
    values.push(dateto)
    inspectionWhere.push(`testdate <= $${values.length}`)
  }

  const inspectionFilterSql = inspectionWhere.length
    ? ` AND ${inspectionWhere.join(" AND ")}`
    : ""

  const normalizedStatus = String(status || "").trim().toUpperCase()
  const allowedStatuses = new Set([
    "OK",
    "NOT SAFE",
    "INCOMPLETE INSPECTION",
    "MISSING CERTIFICATE METADATA",
    "VISUAL OVERDUE",
    "LOAD TEST OVERDUE",
    "NO VISUAL",
    "NO LOAD TEST"
  ])
  const reportStatusFilterSql = allowedStatuses.has(normalizedStatus)
    ? `WHERE reportstatus = '${normalizedStatus}'`
    : ""

  if (datefrom || dateto) {
    assetWhere += `
      AND (
        lv.testdate IS NOT NULL
        OR ll.testdate IS NOT NULL
      )
    `
  }

  const customerResult = await pool.query(
    `
    SELECT
      c.clientid,
      c.clientname,
      c.clientaddr,
      c.archived,
      COUNT(DISTINCT s.siteid) AS sitecount,
      COUNT(DISTINCT sec.sectionid) AS sectioncount,
      COUNT(DISTINCT section_person.personid) AS responsiblecount
    FROM atec.tblclients c
    LEFT JOIN atec.tblsites s
      ON c.clientid = s.clientid
      AND COALESCE(s.archived, false) = false
    LEFT JOIN atec.tblsection sec
      ON c.clientid = sec.clientid
      AND COALESCE(sec.archived, false) = false
    LEFT JOIN atec.tblpeople section_person
      ON sec.responsibleid = section_person.personid
      AND COALESCE(section_person.archived, false) = false
    ${customerWhere}
    GROUP BY c.clientid, c.clientname, c.clientaddr, c.archived
    ORDER BY c.clientname
    `,
    customerValues
  )

  const unfilteredAssetBaseSql = `
    WITH latest_visual AS (
      SELECT DISTINCT ON (assetid)
        assetid,
      testid,
      testdate,
      validdate,
      status,
      inspector,
      inspector_lmi_number,
      inspector_signature_image,
      (
        SELECT COUNT(*)::int
        FROM atec.tblinspectionresult r
        WHERE r.testid = tblinspection.testid
      ) AS result_count
      FROM atec.tblinspection
      WHERE inspectiontype = 'VISUAL'
      ${inspectionFilterSql}
      ORDER BY assetid, testdate DESC NULLS LAST, testid DESC
    ),
    latest_load AS (
      SELECT DISTINCT ON (assetid)
        assetid,
      testid,
      testdate,
      validdate,
      status,
      inspector,
      inspector_lmi_number,
      inspector_signature_image,
      (
        SELECT COUNT(*)::int
        FROM atec.tblinspectionresult r
        WHERE r.testid = tblinspection.testid
      ) AS result_count
      FROM atec.tblinspection
      WHERE inspectiontype = 'LOADTEST'
      ${inspectionFilterSql}
      ORDER BY assetid, testdate DESC NULLS LAST, testid DESC
    )
    SELECT
      c.clientid,
      c.clientname,
      c.clientaddr,
      a.assetid,
      a.assettagno,
      a.serialno,
      a.description,
      a.manufacturer,
      a.wll,
      a.archived,
      s.sitename,
      sec.sectionname,
      section_person.name AS responsiblename,
      et.description AS equipmenttype,
      lv.testid AS visualtestid,
      lv.testdate AS visualtestdate,
      lv.validdate AS visualvaliddate,
      lv.status AS visualstatus,
      lv.inspector AS visualinspector,
      lv.result_count AS visualresultcount,
      CASE
        WHEN lv.testid IS NULL THEN 'NO VISUAL'
        WHEN COALESCE(lv.result_count, 0) = 0 THEN 'INCOMPLETE'
        WHEN COALESCE(lv.inspector, '') = '' THEN 'INCOMPLETE'
        WHEN COALESCE(lv.inspector_lmi_number, '') = '' THEN 'INCOMPLETE'
        WHEN COALESCE(lv.inspector_signature_image, '') = '' THEN 'INCOMPLETE'
        ELSE 'COMPLETE'
      END AS visualintegritystatus,
      (
        lv.testid IS NOT NULL
        AND COALESCE(lv.result_count, 0) > 0
        AND COALESCE(lv.inspector, '') <> ''
        AND COALESCE(lv.inspector_lmi_number, '') <> ''
        AND COALESCE(lv.inspector_signature_image, '') <> ''
      ) AS visualcertificateeligible,
      ll.testid AS loadtestid,
      ll.testdate AS loadtestdate,
      ll.validdate AS loadvaliddate,
      ll.status AS loadstatus,
      ll.inspector AS loadinspector,
      ll.result_count AS loadresultcount,
      CASE
        WHEN NOT ${assetSupportsLoadTestSql("a")} THEN 'NOT REQUIRED'
        WHEN ll.testid IS NULL THEN 'NO LOAD TEST'
        WHEN COALESCE(ll.result_count, 0) = 0 THEN 'INCOMPLETE'
        WHEN COALESCE(ll.inspector, '') = '' THEN 'INCOMPLETE'
        WHEN COALESCE(ll.inspector_lmi_number, '') = '' THEN 'INCOMPLETE'
        WHEN COALESCE(ll.inspector_signature_image, '') = '' THEN 'INCOMPLETE'
        ELSE 'COMPLETE'
      END AS loadintegritystatus,
      (
        ll.testid IS NOT NULL
        AND COALESCE(ll.result_count, 0) > 0
        AND COALESCE(ll.inspector, '') <> ''
        AND COALESCE(ll.inspector_lmi_number, '') <> ''
        AND COALESCE(ll.inspector_signature_image, '') <> ''
      ) AS loadcertificateeligible,
      GREATEST(lv.testdate, ll.testdate) AS latestinspectiondate,
      CASE
        WHEN lv.testdate IS NULL THEN NULL
        ELSE (lv.testdate + INTERVAL '3 months')::date
      END AS nextvisualdue,
      CASE
        WHEN NOT ${assetSupportsLoadTestSql("a")} OR ll.testdate IS NULL THEN NULL
        ELSE (ll.testdate + INTERVAL '12 months')::date
      END AS nextloaddue,
      CASE
        WHEN COALESCE(a.archived, false) = true THEN 'ARCHIVED'
        WHEN lv.status = 'NOT SAFE' OR ll.status = 'NOT SAFE' THEN 'NOT SAFE'
        WHEN lv.testid IS NOT NULL AND COALESCE(lv.result_count, 0) = 0 THEN 'INCOMPLETE INSPECTION'
        WHEN ll.testid IS NOT NULL AND COALESCE(ll.result_count, 0) = 0 THEN 'INCOMPLETE INSPECTION'
        WHEN lv.testid IS NOT NULL AND (COALESCE(lv.inspector_lmi_number, '') = '' OR COALESCE(lv.inspector_signature_image, '') = '') THEN 'MISSING CERTIFICATE METADATA'
        WHEN ll.testid IS NOT NULL AND (COALESCE(ll.inspector_lmi_number, '') = '' OR COALESCE(ll.inspector_signature_image, '') = '') THEN 'MISSING CERTIFICATE METADATA'
        WHEN lv.testdate IS NULL THEN 'NO VISUAL'
        WHEN ${assetSupportsLoadTestSql("a")} AND ll.testdate IS NULL THEN 'NO LOAD TEST'
        WHEN (lv.testdate + INTERVAL '3 months')::date < CURRENT_DATE THEN 'VISUAL OVERDUE'
        WHEN ${assetSupportsLoadTestSql("a")} AND (ll.testdate + INTERVAL '12 months')::date < CURRENT_DATE THEN 'LOAD TEST OVERDUE'
        ELSE 'OK'
      END AS reportstatus
    FROM atec.tblasset a
    LEFT JOIN atec.tblclients c
      ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s
      ON a.siteid = s.siteid
    LEFT JOIN atec.tblsection sec
      ON a.sectionid = sec.sectionid
    LEFT JOIN atec.tblpeople section_person
      ON sec.responsibleid = section_person.personid
    LEFT JOIN atec.tblequiptype et
      ON a.equiptypeid = et.equiptypeid
    LEFT JOIN latest_visual lv
      ON a.assetid = lv.assetid
    LEFT JOIN latest_load ll
      ON a.assetid = ll.assetid
    ${assetWhere}
  `

  const assetBaseSql = `
    SELECT *
    FROM (${unfilteredAssetBaseSql}) customer_report_assets
    ${reportStatusFilterSql}
  `

  let summary = null
  let totalAssets = null

  if (paged) {
    const summaryResult = await pool.query(
      `
      WITH report_assets AS (
        ${assetBaseSql}
      )
      SELECT
        COUNT(*)::int AS assets,
        COUNT(*) FILTER (WHERE archived IS NOT TRUE)::int AS active_assets,
        COUNT(*) FILTER (WHERE archived IS TRUE)::int AS archived_assets,
        COUNT(*) FILTER (WHERE archived IS NOT TRUE AND reportstatus = 'OK')::int AS safe_assets,
        COUNT(*) FILTER (WHERE archived IS NOT TRUE AND reportstatus = 'NOT SAFE')::int AS not_safe_assets,
        COUNT(*) FILTER (WHERE archived IS NOT TRUE AND reportstatus = 'INCOMPLETE INSPECTION')::int AS incomplete_inspection_assets,
        COUNT(*) FILTER (WHERE archived IS NOT TRUE AND reportstatus = 'MISSING CERTIFICATE METADATA')::int AS missing_certificate_metadata_assets,
        COUNT(*) FILTER (WHERE archived IS NOT TRUE AND reportstatus = 'VISUAL OVERDUE')::int AS visual_overdue_assets,
        COUNT(*) FILTER (WHERE archived IS NOT TRUE AND reportstatus = 'LOAD TEST OVERDUE')::int AS load_overdue_assets,
        COUNT(*) FILTER (WHERE archived IS NOT TRUE AND reportstatus = 'NO VISUAL')::int AS no_visual_assets,
        COUNT(*) FILTER (WHERE archived IS NOT TRUE AND reportstatus = 'NO LOAD TEST')::int AS no_load_assets
      FROM report_assets
      `,
      values
    )

    totalAssets = summaryResult.rows[0]?.assets || 0
    summary = summaryResult.rows[0] || {}
  }

  const page = paged ? Math.min(requestedPage, Math.max(1, Math.ceil((totalAssets || 0) / limit))) : requestedPage
  const offset = (page - 1) * limit
  const orderColumn = customerReportSortColumns[sortKey] || customerReportSortColumns.latestinspectiondate
  const orderSql = paged
    ? `${orderColumn} ${sortDirection} NULLS LAST, assetid DESC`
    : "latestinspectiondate DESC NULLS LAST, clientname, sitename, sectionname, assetid"
  const pagedValues = paged ? [...values, limit, offset] : values
  const limitSql = paged
    ? `LIMIT $${pagedValues.length - 1} OFFSET $${pagedValues.length}`
    : ""

  const assetResult = await pool.query(
    `
    ${assetBaseSql}
    ORDER BY ${orderSql}
    ${limitSql}
    `,
    pagedValues
  )

  const assets = assetResult.rows
  const activeAssets = paged ? [] : assets.filter(row => row.archived !== true)
  const statusCounts = paged
    ? {
        OK: summary.safe_assets || 0,
        "NOT SAFE": summary.not_safe_assets || 0,
        "INCOMPLETE INSPECTION": summary.incomplete_inspection_assets || 0,
        "MISSING CERTIFICATE METADATA": summary.missing_certificate_metadata_assets || 0,
        "VISUAL OVERDUE": summary.visual_overdue_assets || 0,
        "LOAD TEST OVERDUE": summary.load_overdue_assets || 0,
        "NO VISUAL": summary.no_visual_assets || 0,
        "NO LOAD TEST": summary.no_load_assets || 0
      }
    : activeAssets.reduce((counts, row) => {
        counts[row.reportstatus] = (counts[row.reportstatus] || 0) + 1
        return counts
      }, {})

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      clientid: clientid || "",
      siteid: siteid || "",
      sectionid: sectionid || "",
      responsibleid: responsibleid || "",
      equiptypeid: equiptypeid || "",
      datefrom: datefrom || "",
      dateto: dateto || ""
    },
    customers: customerResult.rows,
    assets,
    summary: {
      customers: customerResult.rows.length,
      assets: paged ? totalAssets : assets.length,
      activeAssets: paged ? summary.active_assets || 0 : activeAssets.length,
      archivedAssets: paged ? summary.archived_assets || 0 : assets.length - activeAssets.length,
      safeAssets: paged ? summary.safe_assets || 0 : activeAssets.filter(row => row.reportstatus === "OK").length,
      notSafeAssets: paged ? summary.not_safe_assets || 0 : activeAssets.filter(row => row.reportstatus === "NOT SAFE").length,
      incompleteInspectionAssets: paged ? summary.incomplete_inspection_assets || 0 : activeAssets.filter(row => row.reportstatus === "INCOMPLETE INSPECTION").length,
      missingCertificateMetadataAssets: paged ? summary.missing_certificate_metadata_assets || 0 : activeAssets.filter(row => row.reportstatus === "MISSING CERTIFICATE METADATA").length,
      visualOverdueAssets: paged ? summary.visual_overdue_assets || 0 : activeAssets.filter(row => row.reportstatus === "VISUAL OVERDUE").length,
      loadOverdueAssets: paged ? summary.load_overdue_assets || 0 : activeAssets.filter(row => row.reportstatus === "LOAD TEST OVERDUE").length,
      noVisualAssets: paged ? summary.no_visual_assets || 0 : activeAssets.filter(row => row.reportstatus === "NO VISUAL").length,
      noLoadAssets: paged ? summary.no_load_assets || 0 : activeAssets.filter(row => row.reportstatus === "NO LOAD TEST").length,
      statusCounts
    },
    pagination: paged
      ? {
          page,
          limit,
          total: totalAssets,
          totalPages: Math.max(1, Math.ceil((totalAssets || 0) / limit))
        }
      : null
  }
}

function drawCustomerReportPdf(doc, report) {
  const marginX = 32
  const width = doc.page.width - (marginX * 2)
  let y = 28

  const title =
    report.customers.length === 1
      ? report.customers[0].clientname
      : "All Customers"

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#1f2937")
    .text("Customer Detailed Report", marginX, y, { width })

  y += 24

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#1f3b5c")
    .text(title, marginX, y, { width })

  y += 16

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#374151")
    .text(`Generated: ${reportDate(report.generatedAt)}`, marginX, y)

  y += 20

  const summaryItems = [
    ["Customers", report.summary.customers],
    ["Assets", report.summary.assets],
    ["Active", report.summary.activeAssets],
    ["OK", report.summary.safeAssets],
    ["Not Safe", report.summary.notSafeAssets],
    ["Incomplete", report.summary.incompleteInspectionAssets],
    ["Missing Metadata", report.summary.missingCertificateMetadataAssets],
    ["Visual Overdue", report.summary.visualOverdueAssets],
    ["Load Overdue", report.summary.loadOverdueAssets],
    ["No Visual", report.summary.noVisualAssets],
    ["No Load Test", report.summary.noLoadAssets]
  ]

  const summaryWidth = width / 3

  summaryItems.forEach((item, index) => {
    const col = index % 3
    const row = Math.floor(index / 3)
    const boxX = marginX + (col * summaryWidth)
    const boxY = y + (row * 24)

    doc.rect(boxX, boxY, summaryWidth - 8, 20).strokeColor("#d9e1ec").stroke()
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#1f3b5c").text(item[0], boxX + 5, boxY + 4, {
      width: summaryWidth - 50
    })
    doc.font("Helvetica").fontSize(9).fillColor("#111827").text(reportValue(item[1]), boxX + summaryWidth - 45, boxY + 4, {
      width: 36,
      align: "right"
    })
  })

  y += 84

  const columns = [
    ["Asset", 40],
    ["Tag", 48],
    ["Serial", 58],
    ["Site", 58],
    ["Section", 58],
    ["Responsible", 68],
    ["Equipment", 70],
    ["Description", 96],
    ["Last Visual", 52],
    ["Visual Status", 48],
    ["Last Load", 52],
    ["Load Status", 48],
    ["Report Status", width - 696]
  ]

  const drawHeader = () => {
    let x = marginX
    doc.font("Helvetica-Bold").fontSize(6.5)
    columns.forEach(([label, colWidth]) => {
      doc.rect(x, y, colWidth, 16).fillAndStroke("#1f3b5c", "#1f3b5c")
      doc.fillColor("#ffffff").text(label, x + 3, y + 5, { width: colWidth - 6 })
      x += colWidth
    })
    y += 16
    doc.fillColor("#111827").font("Helvetica").fontSize(6.4)
  }

  drawHeader()

  report.assets.forEach(row => {
    if (y > doc.page.height - 48) {
      doc.addPage()
      y = 28
      drawHeader()
    }

    const values = [
      row.assetid,
      row.assettagno,
      row.serialno,
      row.sitename,
      row.sectionname,
      row.responsiblename,
      row.equipmenttype,
      row.description,
      reportDate(row.visualtestdate),
      row.visualstatus,
      reportDate(row.loadtestdate),
      row.loadstatus,
      row.reportstatus
    ].map(reportValue)

    const rowHeight = Math.max(
      18,
      doc.heightOfString(values[7], { width: columns[7][1] - 6 }) + 8,
      doc.heightOfString(values[12], { width: columns[12][1] - 6 }) + 8
    )

    let x = marginX
    columns.forEach(([, colWidth], index) => {
      doc.rect(x, y, colWidth, rowHeight).strokeColor("#d9e1ec").stroke()
      doc
        .font(index === 12 ? "Helvetica-Bold" : "Helvetica")
        .fillColor(values[index] === "NOT SAFE" ? "#d00000" : "#111827")
        .text(values[index], x + 3, y + 4, { width: colWidth - 6 })
      x += colWidth
    })

    y += rowHeight
  })
}

async function buildCustomerReportWorkbook(report) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "ATEC"
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet("Summary")
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 18 }
  ]

  summarySheet.addRow(["Generated", reportDate(report.generatedAt)])
  summarySheet.addRow(["Customers", report.summary.customers])
  summarySheet.addRow(["Assets", report.summary.assets])
  summarySheet.addRow(["Active Assets", report.summary.activeAssets])
  summarySheet.addRow(["Archived Assets", report.summary.archivedAssets])
  summarySheet.addRow(["OK Assets", report.summary.safeAssets])
  summarySheet.addRow(["Not Safe Assets", report.summary.notSafeAssets])
  summarySheet.addRow(["Incomplete Inspection Assets", report.summary.incompleteInspectionAssets])
  summarySheet.addRow(["Missing Certificate Metadata Assets", report.summary.missingCertificateMetadataAssets])
  summarySheet.addRow(["Visual Overdue Assets", report.summary.visualOverdueAssets])
  summarySheet.addRow(["Load Overdue Assets", report.summary.loadOverdueAssets])
  summarySheet.addRow(["No Visual Assets", report.summary.noVisualAssets])
  summarySheet.addRow(["No Load Test Assets", report.summary.noLoadAssets])

  summarySheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  summarySheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F3B5C" }
  }

  const assetSheet = workbook.addWorksheet("Assets")
  assetSheet.columns = [
    { header: "Customer", key: "clientname", width: 28 },
    { header: "Address", key: "clientaddr", width: 32 },
    { header: "Site", key: "sitename", width: 22 },
    { header: "Section", key: "sectionname", width: 22 },
    { header: "Responsible Person", key: "responsiblename", width: 24 },
    { header: "Asset ID", key: "assetid", width: 12 },
    { header: "Asset Tag No", key: "assettagno", width: 18 },
    { header: "Serial No", key: "serialno", width: 20 },
    { header: "Equipment Type", key: "equipmenttype", width: 28 },
    { header: "Description", key: "description", width: 36 },
    { header: "Manufacturer", key: "manufacturer", width: 22 },
    { header: "WLL", key: "wll", width: 12 },
    { header: "Latest Inspection Date", key: "latestinspectiondate", width: 20 },
    { header: "Last Visual Test ID", key: "visualtestid", width: 16 },
    { header: "Last Visual Date", key: "visualtestdate", width: 16 },
    { header: "Visual Valid Until", key: "visualvaliddate", width: 18 },
    { header: "Visual Status", key: "visualstatus", width: 16 },
    { header: "Visual Inspector", key: "visualinspector", width: 20 },
    { header: "Visual Integrity", key: "visualintegritystatus", width: 20 },
    { header: "Visual Certificate Eligible", key: "visualcertificateeligible", width: 24 },
    { header: "Next Visual Due", key: "nextvisualdue", width: 16 },
    { header: "Last Load Test ID", key: "loadtestid", width: 16 },
    { header: "Last Load Date", key: "loadtestdate", width: 16 },
    { header: "Load Valid Until", key: "loadvaliddate", width: 18 },
    { header: "Load Status", key: "loadstatus", width: 16 },
    { header: "Load Inspector", key: "loadinspector", width: 20 },
    { header: "Load Integrity", key: "loadintegritystatus", width: 20 },
    { header: "Load Certificate Eligible", key: "loadcertificateeligible", width: 24 },
    { header: "Next Load Due", key: "nextloaddue", width: 16 },
    { header: "Report Status", key: "reportstatus", width: 22 },
    { header: "Archived", key: "archived", width: 12 }
  ]

  report.assets.forEach(row => {
    assetSheet.addRow({
      ...row,
      latestinspectiondate: reportDate(row.latestinspectiondate),
      visualtestdate: reportDate(row.visualtestdate),
      visualvaliddate: reportDate(row.visualvaliddate),
      nextvisualdue: reportDate(row.nextvisualdue),
      loadtestdate: reportDate(row.loadtestdate),
      loadvaliddate: reportDate(row.loadvaliddate),
      nextloaddue: reportDate(row.nextloaddue),
      visualcertificateeligible: row.visualcertificateeligible ? "Yes" : "No",
      loadcertificateeligible: row.loadcertificateeligible ? "Yes" : "No",
      archived: row.archived ? "Yes" : "No"
    })
  })

  ;[summarySheet, assetSheet].forEach(sheet => {
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F3B5C" }
    }
    sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.eachRow(row => {
      row.eachCell(cell => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD9E1EC" } },
          left: { style: "thin", color: { argb: "FFD9E1EC" } },
          bottom: { style: "thin", color: { argb: "FFD9E1EC" } },
          right: { style: "thin", color: { argb: "FFD9E1EC" } }
        }
      })
    })
  })

  assetSheet.autoFilter = {
    from: "A1",
    to: "AE1"
  }

  return workbook
}

app.get("/reports/customer-detailed", searchLimiter, async (req, res) => {
  try {
    const report = await getCustomerDetailedReport(customerScopedReportFilters(req), {
      paginated: true,
      page: req.query.page,
      limit: req.query.limit,
      sortKey: req.query.sortKey,
      sortDir: req.query.sortDir
    })
    res.json(report)
  } catch (err) {
    console.error("Customer detailed report error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/reports/customer-detailed.pdf", pdfLimiter, async (req, res) => {
  try {
    const report = await getCustomerDetailedReport(customerScopedReportFilters(req))

    if (report.assets.length > reportExportMaxRows) {
      return res.status(400).json({
        error: `Report export is limited to ${reportExportMaxRows} rows. Please use filters to reduce the result size.`
      })
    }

    const filename = reportFileName(report, "pdf")

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28,
      bufferPages: false
    })

    doc.pipe(res)
    drawCustomerReportPdf(doc, report)
    doc.end()
  } catch (err) {
    const referenceId = logSafeError("Customer detailed PDF", err)
    res.status(500).json({ error: "An unexpected server error occurred", referenceId })
  }
})

app.get("/reports/customer-detailed.xlsx", exportLimiter, async (req, res) => {
  try {
    const report = await getCustomerDetailedReport(customerScopedReportFilters(req))

    if (report.assets.length > reportExportMaxRows) {
      return res.status(400).json({
        error: `Report export is limited to ${reportExportMaxRows} rows. Please use filters to reduce the result size.`
      })
    }

    const workbook = await buildCustomerReportWorkbook(report)
    const filename = reportFileName(report, "xlsx")

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

    await workbook.xlsx.write(res)
    res.end()
  } catch (err) {
    const referenceId = logSafeError("Customer detailed Excel", err)
    res.status(500).json({ error: "An unexpected server error occurred", referenceId })
  }
})

app.get("/dashboard/stats", async (req, res) => {
  try {
    const scopedToClient = dashboardClientScope(req)
    const clientWhere = scopedToClient.values.length ? "WHERE c.clientid = $1" : ""
    const siteClientWhere = scopedToClient.values.length ? "WHERE s.clientid = $1" : ""

    const result = await pool.query(`
      WITH active_assets AS (
        SELECT
          a.assetid,
          a.clientid,
          a.sectionid,
          a.equiptypeid
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_visual AS (
        SELECT DISTINCT ON (i.assetid)
          i.assetid,
          i.testdate,
          i.status,
          i.inspector_lmi_number,
          i.inspector_signature_image,
          (
            SELECT COUNT(*)::int
            FROM atec.tblinspectionresult r
            WHERE r.testid = i.testid
          ) AS result_count
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype = 'VISUAL'
        ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
      ),
      latest_load AS (
        SELECT DISTINCT ON (i.assetid)
          i.assetid,
          i.testdate,
          i.status,
          i.inspector_lmi_number,
          i.inspector_signature_image,
          (
            SELECT COUNT(*)::int
            FROM atec.tblinspectionresult r
            WHERE r.testid = i.testid
          ) AS result_count
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype = 'LOADTEST'
        ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
      )
      SELECT
        (
          SELECT COUNT(*)
          FROM atec.tblclients c
          ${clientWhere}
        ) AS customers,
        (
          SELECT COUNT(*)
          FROM atec.tblsites s
          ${siteClientWhere}
        ) AS sites,
        (SELECT COUNT(*) FROM active_assets) AS assets,
        (
          SELECT COUNT(DISTINCT equiptypeid)
          FROM active_assets
          WHERE equiptypeid IS NOT NULL
        ) AS equipmenttypes,
        (
          SELECT COUNT(*)
          FROM atec.tblinspection i
          JOIN active_assets a
            ON a.assetid = i.assetid
          WHERE EXISTS (
            SELECT 1
            FROM atec.tblinspectionresult r
            WHERE r.testid = i.testid
          )
        ) AS certificates,
        (
          SELECT COUNT(*)
          FROM atec.tblinspection i
          JOIN active_assets a
            ON a.assetid = i.assetid
          WHERE NOT EXISTS (
            SELECT 1
            FROM atec.tblinspectionresult r
            WHERE r.testid = i.testid
          )
        ) AS incompleteinspections,
        (
          SELECT COUNT(*)
          FROM active_assets
          WHERE sectionid IS NULL
        ) AS assetsmissingsection,
        (
          SELECT COUNT(DISTINCT a.equiptypeid)
          FROM active_assets a
          WHERE a.equiptypeid IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM atec.tblequiptypecriteria c
              WHERE c.equiptypeid = a.equiptypeid
                AND COALESCE(c.active, true) = true
            )
        ) AS equipmenttypeswithoutcriteria,
        (
          SELECT COUNT(*)
          FROM active_assets a
          LEFT JOIN latest_visual v
            ON a.assetid = v.assetid
          LEFT JOIN latest_load l
            ON a.assetid = l.assetid
          WHERE (v.testdate IS NOT NULL AND (
              COALESCE(v.result_count, 0) = 0
              OR COALESCE(v.inspector_lmi_number, '') = ''
              OR COALESCE(v.inspector_signature_image, '') = ''
            ))
             OR (l.testdate IS NOT NULL AND (
              COALESCE(l.result_count, 0) = 0
              OR COALESCE(l.inspector_lmi_number, '') = ''
              OR COALESCE(l.inspector_signature_image, '') = ''
            ))
        ) AS certificateintegrityalerts,
        (
          SELECT COUNT(DISTINCT a.assetid)
          FROM active_assets a
          LEFT JOIN latest_visual v
            ON v.assetid = a.assetid
          LEFT JOIN latest_load l
            ON l.assetid = a.assetid
          WHERE v.status = 'NOT SAFE'
             OR l.status = 'NOT SAFE'
        ) AS failedtotal,

        (
          SELECT COUNT(*)
          FROM active_assets a
          LEFT JOIN latest_visual i
            ON a.assetid = i.assetid
          WHERE (
            i.testdate IS NULL
            OR i.testdate + INTERVAL '3 months' <= CURRENT_DATE + INTERVAL '30 days'
          )
        ) AS visualdue,

        (
          SELECT COUNT(*)
          FROM active_assets a
          LEFT JOIN latest_load i
            ON a.assetid = i.assetid
          WHERE ${assetSupportsLoadTestSql("a")}
            AND (
            i.testdate IS NULL
            OR i.testdate + INTERVAL '12 months' <= CURRENT_DATE + INTERVAL '30 days'
          )
        ) AS loadtestdue,

        (
          SELECT COUNT(*)
          FROM active_assets a
          LEFT JOIN latest_visual v
            ON a.assetid = v.assetid
          LEFT JOIN latest_load l
            ON a.assetid = l.assetid
          WHERE (
            v.testdate + INTERVAL '3 months' < CURRENT_DATE
            OR (${assetSupportsLoadTestSql("a")} AND l.testdate + INTERVAL '12 months' < CURRENT_DATE)
          )
        ) AS overdue
    `, scopedToClient.values)

    res.json(result.rows[0])

  } catch (err) {
    console.error("Dashboard stats error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/dashboard/review-queue/:queue", async (req, res) => {
  try {
    const queue = String(req.params.queue || "").toLowerCase()
    const scopedToClient = dashboardClientScope(req)

    const activeAssetsSql = `
      SELECT *
      FROM atec.tblasset a
      WHERE COALESCE(a.archived, false) = false
      ${scopedToClient.clause}
    `

    const assetColumnsSql = `
      a.assetid,
      a.assettagno,
      COALESCE(NULLIF(a.serialno, ''), a.hoistserialno) AS serialno,
      a.clientid,
      c.clientname,
      a.siteid,
      s.sitename,
      a.sectionid,
      sec.sectionname,
      a.equiptypeid,
      et.description AS equipmenttype,
      a.description
    `

    const queueQueries = {
      "incomplete-inspections": `
        WITH active_assets AS (
          ${activeAssetsSql}
        )
        SELECT
          i.testid,
          i.assetid,
          a.assettagno,
          COALESCE(NULLIF(a.serialno, ''), a.hoistserialno) AS serialno,
          a.clientid,
          c.clientname,
          a.siteid,
          s.sitename,
          a.sectionid,
          sec.sectionname,
          a.equiptypeid,
          et.description AS equipmenttype,
          i.inspectiontype,
          i.testdate,
          i.inspector,
          i.status,
          'No result rows recorded' AS issue
        FROM atec.tblinspection i
        JOIN active_assets a ON a.assetid = i.assetid
        LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
    LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
    LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
    LEFT JOIN atec.tblpeople p ON a.responsibleid = p.personid
    LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
        WHERE NOT EXISTS (
          SELECT 1
          FROM atec.tblinspectionresult r
          WHERE r.testid = i.testid
        )
        ORDER BY i.testdate DESC NULLS LAST, i.testid DESC
        LIMIT 200
      `,
      "certificate-metadata": `
        WITH active_assets AS (
          ${activeAssetsSql}
        ),
        latest_visual AS (
          SELECT DISTINCT ON (i.assetid)
            i.assetid,
            i.testid,
            i.testdate,
            i.inspector,
            i.inspector_lmi_number,
            i.inspector_signature_image,
            (
              SELECT COUNT(*)::int
              FROM atec.tblinspectionresult r
              WHERE r.testid = i.testid
            ) AS result_count
          FROM atec.tblinspection i
          JOIN active_assets a ON a.assetid = i.assetid
          WHERE i.inspectiontype = 'VISUAL'
          ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
        ),
        latest_load AS (
          SELECT DISTINCT ON (i.assetid)
            i.assetid,
            i.testid,
            i.testdate,
            i.inspector,
            i.inspector_lmi_number,
            i.inspector_signature_image,
            (
              SELECT COUNT(*)::int
              FROM atec.tblinspectionresult r
              WHERE r.testid = i.testid
            ) AS result_count
          FROM atec.tblinspection i
          JOIN active_assets a ON a.assetid = i.assetid
          WHERE i.inspectiontype = 'LOADTEST'
          ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
        )
        SELECT
          ${assetColumnsSql},
          lv.testid AS visualtestid,
          lv.testdate AS visualtestdate,
          ll.testid AS loadtestid,
          ll.testdate AS loadtestdate,
          CONCAT_WS(', ',
            CASE WHEN lv.testid IS NOT NULL AND COALESCE(lv.result_count, 0) = 0 THEN 'Visual has no result rows' END,
            CASE WHEN lv.testid IS NOT NULL AND COALESCE(lv.inspector_lmi_number, '') = '' THEN 'Visual missing LMI number' END,
            CASE WHEN lv.testid IS NOT NULL AND COALESCE(lv.inspector_signature_image, '') = '' THEN 'Visual missing signature' END,
            CASE WHEN ll.testid IS NOT NULL AND COALESCE(ll.result_count, 0) = 0 THEN 'Load test has no result rows' END,
            CASE WHEN ll.testid IS NOT NULL AND COALESCE(ll.inspector_lmi_number, '') = '' THEN 'Load test missing LMI number' END,
            CASE WHEN ll.testid IS NOT NULL AND COALESCE(ll.inspector_signature_image, '') = '' THEN 'Load test missing signature' END
          ) AS issue
        FROM active_assets a
        LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
        LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
        LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
        LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
        LEFT JOIN latest_visual lv ON a.assetid = lv.assetid
        LEFT JOIN latest_load ll ON a.assetid = ll.assetid
        WHERE (lv.testid IS NOT NULL AND (
            COALESCE(lv.result_count, 0) = 0
            OR COALESCE(lv.inspector_lmi_number, '') = ''
            OR COALESCE(lv.inspector_signature_image, '') = ''
          ))
          OR (ll.testid IS NOT NULL AND (
            COALESCE(ll.result_count, 0) = 0
            OR COALESCE(ll.inspector_lmi_number, '') = ''
            OR COALESCE(ll.inspector_signature_image, '') = ''
          ))
        ORDER BY c.clientname NULLS LAST, s.sitename NULLS LAST, a.assetid DESC
        LIMIT 200
      `,
      "missing-section": `
        WITH active_assets AS (
          ${activeAssetsSql}
        )
        SELECT
          ${assetColumnsSql},
          'No section assigned' AS issue
        FROM active_assets a
        LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
        LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
        LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
        LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
        WHERE a.sectionid IS NULL
        ORDER BY c.clientname NULLS LAST, s.sitename NULLS LAST, a.assetid DESC
        LIMIT 200
      `,
      "types-without-criteria": `
        WITH active_assets AS (
          ${activeAssetsSql}
        )
        SELECT
          a.equiptypeid,
          COALESCE(et.description, 'Unknown') AS equipmenttype,
          COUNT(a.assetid)::int AS assets,
          MIN(a.assetid)::int AS sampleassetid,
          STRING_AGG(DISTINCT COALESCE(c.clientname, 'Unknown Customer'), ', ' ORDER BY COALESCE(c.clientname, 'Unknown Customer')) AS customers,
          'No active criteria configured' AS issue
        FROM active_assets a
        LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
        LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
        WHERE a.equiptypeid IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM atec.tblequiptypecriteria criteria
            WHERE criteria.equiptypeid = a.equiptypeid
              AND COALESCE(criteria.active, true) = true
          )
        GROUP BY a.equiptypeid, et.description
        ORDER BY assets DESC, equipmenttype ASC
        LIMIT 200
      `,
      overdue: `
        WITH active_assets AS (
          ${activeAssetsSql}
        ),
        latest_visual AS (
          SELECT DISTINCT ON (i.assetid)
            i.assetid,
            i.testid,
            i.testdate,
            i.validdate,
            i.status
          FROM atec.tblinspection i
          JOIN active_assets a ON a.assetid = i.assetid
          WHERE i.inspectiontype = 'VISUAL'
          ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
        ),
        latest_load AS (
          SELECT DISTINCT ON (i.assetid)
            i.assetid,
            i.testid,
            i.testdate,
            i.validdate,
            i.status
          FROM atec.tblinspection i
          JOIN active_assets a ON a.assetid = i.assetid
          WHERE i.inspectiontype = 'LOADTEST'
          ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
        )
        SELECT
          ${assetColumnsSql},
          lv.testdate AS visualtestdate,
          (lv.testdate + INTERVAL '3 months')::date AS nextvisualdue,
          ll.testdate AS loadtestdate,
          CASE WHEN ${assetSupportsLoadTestSql("a")}
            THEN (ll.testdate + INTERVAL '12 months')::date
            ELSE NULL
          END AS nextloaddue,
          CONCAT_WS(', ',
            CASE WHEN lv.testdate IS NOT NULL AND (lv.testdate + INTERVAL '3 months')::date < CURRENT_DATE THEN 'Visual overdue' END,
            CASE WHEN ${assetSupportsLoadTestSql("a")} AND ll.testdate IS NOT NULL AND (ll.testdate + INTERVAL '12 months')::date < CURRENT_DATE THEN 'Load test overdue' END
          ) AS issue
        FROM active_assets a
        LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
        LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
        LEFT JOIN atec.tblsection sec ON a.sectionid = sec.sectionid
        LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
        LEFT JOIN latest_visual lv ON a.assetid = lv.assetid
        LEFT JOIN latest_load ll ON a.assetid = ll.assetid
        WHERE (lv.testdate + INTERVAL '3 months')::date < CURRENT_DATE
           OR (${assetSupportsLoadTestSql("a")} AND (ll.testdate + INTERVAL '12 months')::date < CURRENT_DATE)
        ORDER BY
          LEAST(
            COALESCE((lv.testdate + INTERVAL '3 months')::date, CURRENT_DATE),
            COALESCE((ll.testdate + INTERVAL '12 months')::date, CURRENT_DATE)
          ) ASC,
          a.assetid DESC
        LIMIT 200
      `
    }

    if (!queueQueries[queue]) {
      return res.status(404).json({ error: "Unknown dashboard review queue" })
    }

    const result = await pool.query(queueQueries[queue], scopedToClient.values)
    res.json({
      queue,
      total: result.rows.length,
      rows: result.rows
    })
  } catch (err) {
    console.error("Dashboard review queue error:", err)
    res.status(500).json({ error: "Failed to load dashboard review queue" })
  }
})

app.get("/dashboard/top-customers", async (req, res) => {
  try {
    const scopedToClient = req.user?.role === "CUSTOMER" && req.user?.clientid

    const whereClause = scopedToClient ? "WHERE c.clientid = $1" : ""
    const values = scopedToClient ? [req.user.clientid] : []

    const result = await pool.query(`
      SELECT
        c.clientid,
        c.clientname,
        COUNT(DISTINCT s.siteid)::int AS sites,
        COUNT(DISTINCT a.assetid)::int AS assets
      FROM atec.tblclients c
      LEFT JOIN atec.tblsites s
        ON c.clientid = s.clientid
      LEFT JOIN atec.tblasset a
        ON c.clientid = a.clientid
        AND COALESCE(a.archived, false) = false
      ${whereClause}
      GROUP BY c.clientid, c.clientname
      ORDER BY COUNT(DISTINCT a.assetid) DESC, c.clientname ASC
      LIMIT 10
    `, values)

    res.json(result.rows)
  } catch (err) {
    console.error("Dashboard top customers error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/dashboard/equipment-by-type", async (req, res) => {
  try {
    const scopedToClient = req.user?.role === "CUSTOMER" && req.user?.clientid

    const clientFilter = scopedToClient ? "AND a.clientid = $1" : ""
    const values = scopedToClient ? [req.user.clientid] : []

    const result = await pool.query(`
      SELECT
        COALESCE(et.description, 'Unknown') AS equipmenttype,
        COUNT(a.assetid)::int AS total
      FROM atec.tblasset a
      LEFT JOIN atec.tblequiptype et
        ON a.equiptypeid = et.equiptypeid
      WHERE COALESCE(a.archived, false) = false
      ${clientFilter}
      GROUP BY COALESCE(et.description, 'Unknown')
      ORDER BY COUNT(a.assetid) DESC, COALESCE(et.description, 'Unknown') ASC
      LIMIT 10
    `, values)

    res.json(result.rows)
  } catch (err) {
    console.error("Dashboard equipment by type error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/dashboard/attention", async (req, res) => {
  try {
    const scopedToClient = dashboardClientScope(req)

    const result = await pool.query(`
      WITH active_assets AS (
        SELECT *
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      last_visual AS (
        SELECT i.assetid, MAX(i.testdate) AS lastvisual
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype = 'VISUAL'
        GROUP BY i.assetid
      ),
      last_load AS (
        SELECT i.assetid, MAX(i.testdate) AS lastload
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype = 'LOADTEST'
        GROUP BY i.assetid
      )
      SELECT
        a.assetid,
        a.assettagno,
        a.serialno,
        c.clientname,
        s.sitename,
        e.description AS equipmenttype,
        lv.lastvisual,
        ll.lastload,

        CASE
          WHEN lv.lastvisual IS NULL THEN 'No Visual Inspection'
          WHEN lv.lastvisual < CURRENT_DATE - INTERVAL '3 months' THEN 'Visual Overdue'
          WHEN ${assetSupportsLoadTestSql("a")} AND ll.lastload IS NULL THEN 'No Load Test'
          WHEN ${assetSupportsLoadTestSql("a")} AND ll.lastload < CURRENT_DATE - INTERVAL '12 months' THEN 'Load Test Overdue'
          ELSE 'OK'
        END AS reason,

        CASE
          WHEN lv.lastvisual IS NULL THEN NULL
          WHEN lv.lastvisual < CURRENT_DATE - INTERVAL '3 months'
            THEN CURRENT_DATE - (lv.lastvisual + INTERVAL '3 months')::date
          WHEN ${assetSupportsLoadTestSql("a")} AND ll.lastload IS NULL THEN NULL
          WHEN ${assetSupportsLoadTestSql("a")} AND ll.lastload < CURRENT_DATE - INTERVAL '12 months'
            THEN CURRENT_DATE - (ll.lastload + INTERVAL '12 months')::date
          ELSE 0
        END AS daysoverdue

      FROM active_assets a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblequiptype e ON a.equiptypeid = e.equiptypeid      
      LEFT JOIN last_visual lv ON a.assetid = lv.assetid
      LEFT JOIN last_load ll ON a.assetid = ll.assetid
      WHERE (
        lv.lastvisual IS NULL
        OR lv.lastvisual < CURRENT_DATE - INTERVAL '3 months'
        OR (${assetSupportsLoadTestSql("a")} AND ll.lastload IS NULL)
        OR (${assetSupportsLoadTestSql("a")} AND ll.lastload < CURRENT_DATE - INTERVAL '12 months')
      )
      ORDER BY daysoverdue DESC NULLS LAST, a.assetid DESC
      LIMIT 50
    `, scopedToClient.values);

    res.json(result.rows);
  } catch (err) {
    console.error("Dashboard attention error:", err);
    res.status(500).json({ error: "Failed to load dashboard attention items" });
  }
});

app.get("/dashboard/failed-equipment", async (req, res) => {
  try {
    const scopedToClient = dashboardClientScope(req)

    const result = await pool.query(`
      WITH active_assets AS (
        SELECT *
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_inspections AS (
        SELECT DISTINCT ON (i.assetid, i.inspectiontype)
          i.testid,
          i.assetid,
          i.inspectiontype,
          i.testdate,
          i.validdate,
          i.inspector,
          i.status
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype IN ('VISUAL', 'LOADTEST')
        ORDER BY i.assetid, i.inspectiontype, i.testdate DESC NULLS LAST, i.testid DESC
      )
      SELECT
        i.testid,
        i.assetid,
        a.assettagno,
        a.serialno,
        c.clientname,
        s.sitename,
        e.description AS equipmenttype,
        i.testdate,
        i.validdate,
        i.inspector,
        i.status
      FROM latest_inspections i
      JOIN active_assets a
        ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c
        ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s
        ON a.siteid = s.siteid
      LEFT JOIN atec.tblequiptype e ON a.equiptypeid = e.equiptypeid
      WHERE i.status = 'NOT SAFE'
      ORDER BY i.testdate DESC
      LIMIT 20
    `, scopedToClient.values)

    res.json(result.rows)
  } catch (err) {
    console.error("Dashboard failed equipment error:", err)
    res.status(500).json({
      error: "Failed to load failed equipment"
    })
  }
})

app.get("/dashboard/failed-equipment-by-customer", async (req, res) => {
  try {
    const scopedToClient = dashboardClientScope(req)

    const result = await pool.query(`
      WITH active_assets AS (
        SELECT *
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_inspections AS (
        SELECT DISTINCT ON (i.assetid, i.inspectiontype)
          i.testid,
          i.assetid,
          i.inspectiontype,
          i.testdate,
          i.status
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype IN ('VISUAL', 'LOADTEST')
        ORDER BY i.assetid, i.inspectiontype, i.testdate DESC NULLS LAST, i.testid DESC
      ),
      failed_assets AS (
        SELECT
          a.clientid,
          a.assetid,
          COUNT(i.testid)::int AS failed_certificates,
          MAX(i.testdate) AS latest_failed_date
        FROM active_assets a
        JOIN latest_inspections i
          ON i.assetid = a.assetid
        WHERE i.status = 'NOT SAFE'
        GROUP BY a.clientid, a.assetid
      )
      SELECT
        fa.clientid,
        COALESCE(c.clientname, 'Unknown Customer') AS clientname,
        COUNT(fa.assetid)::int AS failed_assets,
        SUM(fa.failed_certificates)::int AS failed_certificates,
        MAX(fa.latest_failed_date) AS latest_failed_date
      FROM failed_assets fa
      LEFT JOIN atec.tblclients c
        ON fa.clientid = c.clientid
      GROUP BY fa.clientid, c.clientname
      ORDER BY failed_assets DESC, clientname ASC
      LIMIT 50
    `, scopedToClient.values)

    res.json(result.rows)
  } catch (err) {
    console.error("Dashboard failed equipment customer summary error:", err)
    res.status(500).json({
      error: "Failed to load failed equipment by customer"
    })
  }
})

app.get("/dashboard/upcoming-expiries", async (req, res) => {
  try {
    const scopedToClient = dashboardClientScope(req)

    const result = await pool.query(`
      WITH active_assets AS (
        SELECT *
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_inspections AS (
        SELECT DISTINCT ON (i.assetid, i.inspectiontype)
          i.testid,
          i.assetid,
          i.inspectiontype,
          i.testdate,
          i.validdate
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype IN ('VISUAL', 'LOADTEST')
        ORDER BY i.assetid, i.inspectiontype, i.testdate DESC NULLS LAST, i.testid DESC
      )
      SELECT
        i.testid,
        a.assetid,
        a.assettagno,
        a.serialno,
        c.clientname,
        s.sitename,
        et.description AS equipmenttype,
        i.inspectiontype,
        i.testdate,
        i.validdate,
        (i.validdate - CURRENT_DATE) AS daysremaining
      FROM latest_inspections i
      JOIN active_assets a
        ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c
        ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s
        ON a.siteid = s.siteid
      LEFT JOIN atec.tblequiptype et
        ON a.equiptypeid = et.equiptypeid
      WHERE
        i.validdate IS NOT NULL
        AND i.validdate >= CURRENT_DATE
        AND i.validdate <= CURRENT_DATE + INTERVAL '90 days'
      ORDER BY
        i.validdate ASC,
        a.assetid ASC,
        i.inspectiontype ASC
    `, scopedToClient.values)

    res.json(result.rows)

  } catch (err) {
    console.error("Dashboard upcoming expiries:", err)
    res.status(500).json({
      error: "Failed to load upcoming expiries"
    })
  }
})

app.get("/dashboard/upcoming-expiries-by-customer", async (req, res) => {
  try {
    const scopedToClient = dashboardClientScope(req)

    const result = await pool.query(`
      WITH active_assets AS (
        SELECT *
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_inspections AS (
        SELECT DISTINCT ON (i.assetid, i.inspectiontype)
          i.testid,
          i.assetid,
          i.inspectiontype,
          i.testdate,
          i.validdate
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype IN ('VISUAL', 'LOADTEST')
        ORDER BY i.assetid, i.inspectiontype, i.testdate DESC NULLS LAST, i.testid DESC
      ),
      upcoming_assets AS (
        SELECT
          a.clientid,
          a.assetid,
          COUNT(i.testid)::int AS upcoming_certificates,
          MIN(i.validdate) AS next_expiry_date,
          MIN(i.validdate - CURRENT_DATE) AS days_remaining
        FROM active_assets a
        JOIN latest_inspections i
          ON i.assetid = a.assetid
        WHERE i.validdate IS NOT NULL
          AND i.validdate >= CURRENT_DATE
          AND i.validdate <= CURRENT_DATE + INTERVAL '90 days'
        GROUP BY a.clientid, a.assetid
      )
      SELECT
        ua.clientid,
        COALESCE(c.clientname, 'Unknown Customer') AS clientname,
        COUNT(ua.assetid)::int AS upcoming_assets,
        SUM(ua.upcoming_certificates)::int AS upcoming_certificates,
        MIN(ua.next_expiry_date) AS next_expiry_date,
        MIN(ua.days_remaining) AS days_remaining
      FROM upcoming_assets ua
      LEFT JOIN atec.tblclients c
        ON ua.clientid = c.clientid
      GROUP BY ua.clientid, c.clientname
      ORDER BY next_expiry_date ASC, upcoming_assets DESC, clientname ASC
      LIMIT 50
    `, scopedToClient.values)

    res.json(result.rows)
  } catch (err) {
    console.error("Dashboard upcoming expiries customer summary error:", err)
    res.status(500).json({
      error: "Failed to load upcoming expiries by customer"
    })
  }
})

const dashboardSummaryCache = new Map()
const dashboardSummaryCacheTtlMs = Number(process.env.DASHBOARD_SUMMARY_CACHE_TTL_MS || 15000)
const notificationSchedulerState = {
  running: false,
  lastCheckedAt: null,
  lastRunAt: null,
  lastRunDate: null,
  lastResult: null,
  lastError: null
}

function dashboardSummaryCacheKey(req) {
  return `${req.user?.role || ""}:${req.user?.clientid || ""}`
}

async function task14VisitTablesAvailable() {
  const result = await pool.query(
    `
    SELECT
      to_regclass('atec.tblinspectionvisit') IS NOT NULL AS has_visits,
      to_regclass('atec.tblinspectionvisitasset') IS NOT NULL AS has_visit_assets
    `
  )

  return Boolean(result.rows[0]?.has_visits && result.rows[0]?.has_visit_assets)
}

async function notificationDeliveryTableAvailable() {
  const result = await pool.query(
    "SELECT to_regclass('atec.tblnotificationdelivery') IS NOT NULL AS available"
  )

  return Boolean(result.rows[0]?.available)
}

function notificationSchedulerConfig() {
  return {
    enabled: String(process.env.NOTIFICATION_AUTO_SEND_ENABLED || "").trim().toLowerCase() === "true",
    time: String(process.env.NOTIFICATION_AUTO_SEND_TIME || "07:00").trim(),
    cooldownHours: parsePositiveInteger(process.env.NOTIFICATION_AUTO_SEND_COOLDOWN_HOURS, 24, 168),
    intervalMinutes: parsePositiveInteger(process.env.NOTIFICATION_AUTO_SEND_CHECK_MINUTES, 5, 1440),
    maxRows: parsePositiveInteger(process.env.NOTIFICATION_AUTO_SEND_MAX_ROWS, 25, 100)
  }
}

function notificationSchedulerStatus() {
  const config = notificationSchedulerConfig()

  return {
    enabled: config.enabled,
    time: config.time,
    cooldown_hours: config.cooldownHours,
    check_interval_minutes: config.intervalMinutes,
    max_rows: config.maxRows,
    running: notificationSchedulerState.running,
    last_checked_at: notificationSchedulerState.lastCheckedAt,
    last_run_at: notificationSchedulerState.lastRunAt,
    last_result: notificationSchedulerState.lastResult,
    last_error: notificationSchedulerState.lastError
  }
}

function scheduledNotificationDue(now = new Date()) {
  const config = notificationSchedulerConfig()
  const today = now.toISOString().slice(0, 10)
  const match = /^(\d{1,2}):(\d{2})$/.exec(config.time)
  const targetHour = match ? Math.min(Number(match[1]), 23) : 7
  const targetMinute = match ? Math.min(Number(match[2]), 59) : 0

  return notificationSchedulerState.lastRunDate !== today &&
    (now.getHours() > targetHour || (now.getHours() === targetHour && now.getMinutes() >= targetMinute))
}

function notificationCounts(row) {
  return {
    due_assets: Number(row.due_assets || 0),
    overdue_assets: Number(row.overdue_assets || 0),
    expiring_certificates: Number(row.expiring_certificates || 0),
    failed_assets: Number(row.failed_assets || 0),
    unresolved_visit_items: Number(row.unresolved_visit_items || 0),
    deferred_followups_due: Number(row.deferred_followups_due || 0)
  }
}

function notificationAutoSendEligible(row, config = notificationSchedulerConfig()) {
  if (Number(row.portal_recipients || 0) <= 0) return false
  if (!row.last_notification_sent_at) return true

  const lastSent = new Date(row.last_notification_sent_at).getTime()
  if (!Number.isFinite(lastSent)) return true

  return Date.now() - lastSent >= config.cooldownHours * 60 * 60 * 1000
}

async function getNotificationCentreRows(req) {
  const scopedToClient = dashboardClientScope(req)
  const visitTablesAvailable = await task14VisitTablesAvailable()
  const deliveryTableAvailable = await notificationDeliveryTableAvailable()

  const visitExceptionColumns = visitTablesAvailable
    ? `
      COALESCE(visit_exceptions.open_visits, 0)::int AS open_visits,
      COALESCE(visit_exceptions.unresolved_visit_items, 0)::int AS unresolved_visit_items,
      COALESCE(visit_exceptions.deferred_followups_due, 0)::int AS deferred_followups_due,
    `
    : `
      0::int AS open_visits,
      0::int AS unresolved_visit_items,
      0::int AS deferred_followups_due,
    `

  const visitExceptionJoin = visitTablesAvailable
    ? `
      LEFT JOIN (
        SELECT
          v.clientid,
          v.siteid,
          COUNT(DISTINCT v.visitid) FILTER (WHERE v.visit_status IN ('OPEN','PAUSED','RECONCILIATION_REQUIRED'))::int AS open_visits,
          COUNT(va.visitassetid) FILTER (
            WHERE v.visit_status IN ('OPEN','PAUSED','RECONCILIATION_REQUIRED')
              AND va.reconciliation_status IN ('OUTSTANDING','NOT_FOUND','INACCESSIBLE','CUSTOMER_MISSING','DEFERRED')
          )::int AS unresolved_visit_items,
          COUNT(va.visitassetid) FILTER (
            WHERE va.reconciliation_status = 'DEFERRED'
              AND va.deferred_follow_up_date IS NOT NULL
              AND va.deferred_follow_up_date <= CURRENT_DATE + INTERVAL '14 days'
          )::int AS deferred_followups_due
        FROM atec.tblinspectionvisit v
        LEFT JOIN atec.tblinspectionvisitasset va ON va.visitid = v.visitid
        GROUP BY v.clientid, v.siteid
      ) visit_exceptions
        ON visit_exceptions.clientid = grouped.clientid
       AND (
          visit_exceptions.siteid = grouped.siteid
          OR (visit_exceptions.siteid IS NULL AND grouped.siteid IS NULL)
       )
    `
    : ""

  const deliveryColumns = deliveryTableAvailable
    ? `
      latest_delivery.sent_at AS last_notification_sent_at,
      latest_delivery.delivery_type AS last_notification_delivery_type,
      latest_delivery.status AS last_notification_status,
    `
    : `
      NULL::timestamptz AS last_notification_sent_at,
      NULL::text AS last_notification_delivery_type,
      NULL::text AS last_notification_status,
    `

  const deliveryJoin = deliveryTableAvailable
    ? `
      LEFT JOIN LATERAL (
        SELECT
          d.sent_at,
          d.delivery_type,
          d.status
        FROM atec.tblnotificationdelivery d
        WHERE d.clientid = grouped.clientid
          AND (
            d.siteid = grouped.siteid
            OR (d.siteid IS NULL AND grouped.siteid IS NULL)
          )
          AND d.status = 'SENT'
        ORDER BY d.sent_at DESC NULLS LAST, d.notificationdeliveryid DESC
        LIMIT 1
      ) latest_delivery ON true
    `
    : ""

  const result = await pool.query(
    `
    WITH active_assets AS (
      SELECT
        a.assetid,
        a.clientid,
        a.siteid,
        a.assettagno,
        COALESCE(NULLIF(a.serialno, ''), a.hoistserialno) AS serialno,
        ${assetSupportsLoadTestSql("a")} AS supports_load_test
      FROM atec.tblasset a
      WHERE COALESCE(a.archived, false) = false
      ${scopedToClient.clause}
    ),
    latest_visual AS (
      SELECT DISTINCT ON (i.assetid)
        i.assetid,
        i.testid,
        i.testdate,
        i.validdate,
        i.status
      FROM atec.tblinspection i
      JOIN active_assets a ON a.assetid = i.assetid
      WHERE i.inspectiontype = 'VISUAL'
      ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
    ),
    latest_load AS (
      SELECT DISTINCT ON (i.assetid)
        i.assetid,
        i.testid,
        i.testdate,
        i.validdate,
        i.status
      FROM atec.tblinspection i
      JOIN active_assets a ON a.assetid = i.assetid
      WHERE i.inspectiontype = 'LOADTEST'
      ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
    ),
    latest_inspections AS (
      SELECT * FROM latest_visual
      UNION ALL
      SELECT * FROM latest_load
    ),
    grouped AS (
      SELECT
        a.clientid,
        a.siteid,
        COUNT(DISTINCT a.assetid)::int AS active_assets,
        COUNT(DISTINCT a.assetid) FILTER (
          WHERE v.testdate IS NULL
             OR (v.testdate + INTERVAL '3 months')::date <= CURRENT_DATE + INTERVAL '30 days'
             OR (a.supports_load_test AND (
               l.testdate IS NULL
               OR (l.testdate + INTERVAL '12 months')::date <= CURRENT_DATE + INTERVAL '30 days'
             ))
        )::int AS due_assets,
        COUNT(DISTINCT a.assetid) FILTER (
          WHERE (v.testdate + INTERVAL '3 months')::date < CURRENT_DATE
             OR (a.supports_load_test AND (l.testdate + INTERVAL '12 months')::date < CURRENT_DATE)
        )::int AS overdue_assets,
        COUNT(DISTINCT a.assetid) FILTER (
          WHERE v.status = 'NOT SAFE'
             OR l.status = 'NOT SAFE'
        )::int AS failed_assets,
        MIN(LEAST(
          COALESCE((v.testdate + INTERVAL '3 months')::date, CURRENT_DATE),
          CASE WHEN a.supports_load_test
            THEN COALESCE((l.testdate + INTERVAL '12 months')::date, CURRENT_DATE)
            ELSE 'infinity'::date
          END
        )) AS next_due_date
      FROM active_assets a
      LEFT JOIN latest_visual v ON v.assetid = a.assetid
      LEFT JOIN latest_load l ON l.assetid = a.assetid
      GROUP BY a.clientid, a.siteid
    ),
    expiring AS (
      SELECT
        a.clientid,
        a.siteid,
        COUNT(i.testid)::int AS expiring_certificates,
        MIN(i.validdate) AS next_expiry_date
      FROM active_assets a
      JOIN latest_inspections i ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c ON c.clientid = a.clientid
      WHERE i.validdate IS NOT NULL
        AND i.validdate >= CURRENT_DATE
        AND i.validdate <= CURRENT_DATE + make_interval(days => COALESCE(c.notification_lead_days, 30))
      GROUP BY a.clientid, a.siteid
    ),
    recipients AS (
      SELECT
        u.clientid,
        COUNT(*) FILTER (
          WHERE COALESCE(u.is_active, true) = true
            AND COALESCE(u.email, '') <> ''
        )::int AS portal_recipients
      FROM atec.tblusers u
      WHERE u.role = 'CUSTOMER'
        AND u.clientid IS NOT NULL
      GROUP BY u.clientid
    )
    SELECT
      grouped.clientid,
      COALESCE(c.clientname, 'Unknown Customer') AS clientname,
      grouped.siteid,
      COALESCE(s.sitename, 'All Sites') AS sitename,
      grouped.active_assets,
      CASE WHEN COALESCE(c.notify_overdue_assets, true) THEN grouped.due_assets ELSE 0 END::int AS due_assets,
      CASE WHEN COALESCE(c.notify_overdue_assets, true) THEN grouped.overdue_assets ELSE 0 END::int AS overdue_assets,
      CASE WHEN COALESCE(c.notify_failed_assets, true) THEN grouped.failed_assets ELSE 0 END::int AS failed_assets,
      CASE WHEN COALESCE(c.notify_expiring_certificates, true) THEN COALESCE(expiring.expiring_certificates, 0) ELSE 0 END::int AS expiring_certificates,
      ${visitExceptionColumns.replaceAll("COALESCE(visit_exceptions.", "CASE WHEN COALESCE(c.notify_visit_exceptions, true) THEN COALESCE(visit_exceptions.").replaceAll(")::int AS", ") ELSE 0 END::int AS")}
      COALESCE(recipients.portal_recipients, 0)::int AS portal_recipients,
      COALESCE(c.notify_expiring_certificates, true) AS notify_expiring_certificates,
      COALESCE(c.notify_overdue_assets, true) AS notify_overdue_assets,
      COALESCE(c.notify_failed_assets, true) AS notify_failed_assets,
      COALESCE(c.notify_visit_exceptions, true) AS notify_visit_exceptions,
      COALESCE(c.notification_lead_days, 30)::int AS notification_lead_days,
      ${deliveryColumns}
      grouped.next_due_date,
      expiring.next_expiry_date,
      CASE
        WHEN (
            COALESCE(c.notify_overdue_assets, true) = true
            AND (grouped.due_assets > 0 OR grouped.overdue_assets > 0)
          )
          OR (COALESCE(c.notify_failed_assets, true) = true AND grouped.failed_assets > 0)
          OR (COALESCE(c.notify_expiring_certificates, true) = true AND COALESCE(expiring.expiring_certificates, 0) > 0)
          ${visitTablesAvailable ? "OR (COALESCE(c.notify_visit_exceptions, true) = true AND COALESCE(visit_exceptions.unresolved_visit_items, 0) > 0)" : ""}
        THEN 'READY'
        ELSE 'NO_ACTION'
      END AS notification_status
    FROM grouped
    LEFT JOIN atec.tblclients c ON c.clientid = grouped.clientid
    LEFT JOIN atec.tblsites s ON s.siteid = grouped.siteid
    LEFT JOIN expiring
      ON expiring.clientid = grouped.clientid
     AND (
        expiring.siteid = grouped.siteid
        OR (expiring.siteid IS NULL AND grouped.siteid IS NULL)
     )
    LEFT JOIN recipients ON recipients.clientid = grouped.clientid
    ${visitExceptionJoin}
    ${deliveryJoin}
    WHERE (
        COALESCE(c.notify_overdue_assets, true) = true
        AND (grouped.due_assets > 0 OR grouped.overdue_assets > 0)
      )
       OR (COALESCE(c.notify_failed_assets, true) = true AND grouped.failed_assets > 0)
       OR (COALESCE(c.notify_expiring_certificates, true) = true AND COALESCE(expiring.expiring_certificates, 0) > 0)
       ${visitTablesAvailable ? "OR (COALESCE(c.notify_visit_exceptions, true) = true AND COALESCE(visit_exceptions.unresolved_visit_items, 0) > 0)" : ""}
    ORDER BY
      grouped.overdue_assets DESC,
      grouped.failed_assets DESC,
      COALESCE(expiring.expiring_certificates, 0) DESC,
      COALESCE(c.clientname, 'Unknown Customer') ASC,
      COALESCE(s.sitename, 'All Sites') ASC
    LIMIT 100
    `,
    scopedToClient.values
  )

  return result.rows.map(row => ({
    ...row,
    automatic_notification_ready: notificationAutoSendEligible(row)
  }))
}

async function findNotificationCentreRow(req, { clientid, siteid }) {
  const rows = await getNotificationCentreRows(req)

  return rows.find(row =>
    String(row.clientid || "") === String(clientid || "") &&
    String(row.siteid || "") === String(siteid || "")
  )
}

async function getNotificationRecipients({ clientid, siteid }) {
  const result = await pool.query(
    `
    SELECT DISTINCT
      LOWER(TRIM(email)) AS email,
      COALESCE(NULLIF(fullname, ''), username, email) AS full_name
    FROM atec.tblusers
    WHERE role = 'CUSTOMER'
      AND clientid = $1
      AND COALESCE(is_active, true) = true
      AND COALESCE(email, '') <> ''
      AND (
        $2::int IS NULL
        OR siteid IS NULL
        OR siteid = $2::int
      )
    ORDER BY LOWER(TRIM(email))
    `,
    [clientid, siteid || null]
  )

  return result.rows
}

function notificationEmailSubject(row) {
  const siteLabel = row.siteid ? ` - ${row.sitename || "Site"}` : ""
  return `ATEC notification: ${row.clientname || "Customer"}${siteLabel}`
}

function notificationAttentionLines(row) {
  return [
    ["Due assets", row.due_assets],
    ["Overdue assets", row.overdue_assets],
    ["Certificates expiring soon", row.expiring_certificates],
    ["Failed assets", row.failed_assets],
    ["Unresolved visit items", row.unresolved_visit_items],
    ["Deferred follow-ups due", row.deferred_followups_due]
  ]
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([label, value]) => `- ${label}: ${value}`)
}

function notificationEmailText(row) {
  const attentionLines = notificationAttentionLines(row)
  const lines = [
    "Good day,",
    "",
    "The ATEC Inspection Platform has items needing attention for your account.",
    "",
    `Customer: ${valueOrDash(row.clientname)}`,
    `Site: ${valueOrDash(row.sitename)}`,
    "",
    "Items needing attention:",
    ...(attentionLines.length ? attentionLines : ["- No active notification items are currently listed."]),
    "",
    "Please log in to the ATEC Customer Portal to review certificates, asset status and reports.",
    "If you need assistance, please contact ATEC Systems.",
    "",
    "Regards,",
    "ATEC Systems"
  ]

  return lines.join("\n")
}

async function buildNotificationEmailPreview(req, body = {}) {
  const clientid = body.clientid || req.query?.clientid
  const siteid = body.siteid || req.query?.siteid || null
  const row = await findNotificationCentreRow(req, { clientid, siteid })

  if (!row) {
    return null
  }

  const recipients = await getNotificationRecipients({
    clientid: row.clientid,
    siteid: row.siteid
  })

  return {
    row,
    recipients,
    subject: notificationEmailSubject(row),
    message: notificationEmailText(row)
  }
}

async function recordNotificationDelivery(preview, recipients, options = {}) {
  if (!await notificationDeliveryTableAvailable()) return null

  const counts = notificationCounts(preview.row)
  const result = await pool.query(
    `
    INSERT INTO atec.tblnotificationdelivery (
      clientid,
      siteid,
      delivery_type,
      status,
      subject,
      message,
      recipients,
      due_assets,
      overdue_assets,
      expiring_certificates,
      failed_assets,
      unresolved_visit_items,
      deferred_followups_due,
      error_message,
      sent_by_user_id,
      sent_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7::text[],
      $8, $9, $10, $11, $12, $13, $14, $15,
      CASE WHEN $4 = 'SENT' THEN now() ELSE NULL END
    )
    RETURNING notificationdeliveryid, sent_at
    `,
    [
      preview.row.clientid,
      preview.row.siteid || null,
      options.deliveryType || "MANUAL",
      options.status || "SENT",
      preview.subject,
      preview.message,
      recipients,
      counts.due_assets,
      counts.overdue_assets,
      counts.expiring_certificates,
      counts.failed_assets,
      counts.unresolved_visit_items,
      counts.deferred_followups_due,
      options.errorMessage || null,
      options.sentByUserId || null
    ]
  )

  return result.rows[0]
}

async function getNotificationDeliveryHistory(req) {
  if (!await notificationDeliveryTableAvailable()) return []

  const scopedToClient = dashboardClientScope(req, "d", "WHERE")
  const values = [...scopedToClient.values]
  const limit = parsePositiveInteger(req.query?.limit, 25, 100)
  values.push(limit)

  const result = await pool.query(
    `
    SELECT
      d.notificationdeliveryid,
      d.clientid,
      COALESCE(c.clientname, 'Unknown Customer') AS clientname,
      d.siteid,
      COALESCE(s.sitename, 'All Sites') AS sitename,
      d.delivery_type,
      d.status,
      d.subject,
      d.recipients,
      cardinality(d.recipients)::int AS recipient_count,
      d.due_assets,
      d.overdue_assets,
      d.expiring_certificates,
      d.failed_assets,
      d.unresolved_visit_items,
      d.deferred_followups_due,
      d.error_message,
      d.sent_by_user_id,
      COALESCE(NULLIF(u.fullname, ''), u.username, 'System') AS sent_by,
      d.created_at,
      d.sent_at
    FROM atec.tblnotificationdelivery d
    LEFT JOIN atec.tblclients c ON c.clientid = d.clientid
    LEFT JOIN atec.tblsites s ON s.siteid = d.siteid
    LEFT JOIN atec.tblusers u ON u.userid = d.sent_by_user_id
    ${scopedToClient.clause}
    ORDER BY COALESCE(d.sent_at, d.created_at) DESC, d.notificationdeliveryid DESC
    LIMIT $${values.length}
    `,
    values
  )

  return result.rows
}

async function sendNotificationPreview(preview, options = {}) {
  const recipients = preview.recipients.map(recipient => recipient.email)

  try {
    await sendApplicationEmail({
      from: process.env.MAIL_FROM,
      to: recipients,
      subject: preview.subject,
      text: preview.message
    })

    await recordNotificationDelivery(preview, recipients, {
      deliveryType: options.deliveryType || "MANUAL",
      status: "SENT",
      sentByUserId: options.sentByUserId || null
    })

    return {
      success: true,
      sent_to: recipients.length,
      recipients
    }
  } catch (err) {
    await recordNotificationDelivery(preview, recipients, {
      deliveryType: options.deliveryType || "MANUAL",
      status: "FAILED",
      sentByUserId: options.sentByUserId || null,
      errorMessage: getMailErrorMessage(err)
    })
    throw err
  }
}

async function runScheduledNotificationDelivery(options = {}) {
  const config = notificationSchedulerConfig()
  notificationSchedulerState.lastCheckedAt = new Date().toISOString()

  if (!options.force && !config.enabled) {
    return { skipped: true, reason: "Automatic notifications are switched off." }
  }

  if (notificationSchedulerState.running) {
    return { skipped: true, reason: "Automatic notification run already in progress." }
  }

  const mailConfigIssues = getMailConfigIssues()

  if (mailConfigIssues.length) {
    return {
      skipped: true,
      reason: `Email settings missing: ${mailConfigIssues.join(", ")}`
    }
  }

  notificationSchedulerState.running = true
  notificationSchedulerState.lastError = null

  try {
    const systemReq = {
      user: { role: "ADMIN", username: "system-notification-scheduler" },
      query: {},
      ip: null
    }
    const rows = await getNotificationCentreRows(systemReq)
    const candidates = rows
      .filter(row => notificationAutoSendEligible(row, config))
      .slice(0, config.maxRows)
    const result = {
      checked_rows: rows.length,
      sent: 0,
      failed: 0,
      skipped: rows.length - candidates.length,
      details: []
    }

    for (const row of candidates) {
      const preview = {
        row,
        recipients: await getNotificationRecipients({
          clientid: row.clientid,
          siteid: row.siteid
        }),
        subject: notificationEmailSubject(row),
        message: notificationEmailText(row)
      }

      if (!preview.recipients.length) {
        result.skipped += 1
        result.details.push({
          clientid: row.clientid,
          siteid: row.siteid,
          status: "SKIPPED",
          reason: "No active customer portal recipients"
        })
        continue
      }

      try {
        const delivery = await sendNotificationPreview(preview, {
          deliveryType: "AUTOMATIC"
        })
        result.sent += 1
        result.details.push({
          clientid: row.clientid,
          siteid: row.siteid,
          status: "SENT",
          sent_to: delivery.sent_to
        })
        await logAudit(systemReq, "SEND_NOTIFICATION_AUTOMATIC", "notifications", row.clientid, {
          clientid: row.clientid,
          siteid: row.siteid,
          recipients: delivery.recipients,
          counts: notificationCounts(row)
        })
      } catch (err) {
        result.failed += 1
        result.details.push({
          clientid: row.clientid,
          siteid: row.siteid,
          status: "FAILED",
          error: getMailErrorMessage(err)
        })
      }
    }

    notificationSchedulerState.lastRunAt = new Date().toISOString()
    notificationSchedulerState.lastRunDate = notificationSchedulerState.lastRunAt.slice(0, 10)
    notificationSchedulerState.lastResult = result
    return result
  } catch (err) {
    notificationSchedulerState.lastError = err.message || String(err)
    throw err
  } finally {
    notificationSchedulerState.running = false
  }
}

function startNotificationScheduler() {
  const config = notificationSchedulerConfig()
  if (!config.enabled) {
    console.log("Automatic customer notifications are switched off.")
    return
  }

  const intervalMs = config.intervalMinutes * 60 * 1000
  console.log(`Automatic customer notifications enabled for ${config.time}.`)

  setInterval(() => {
    if (!scheduledNotificationDue()) return

    runScheduledNotificationDelivery()
      .catch(err => {
        notificationSchedulerState.lastError = err.message || String(err)
        console.error("Automatic notification run failed:", err)
      })
  }, intervalMs).unref()
}

async function getCachedDashboardSummary(req) {
  const key = dashboardSummaryCacheKey(req)
  const cached = dashboardSummaryCache.get(key)

  if (cached && Date.now() - cached.createdAt < dashboardSummaryCacheTtlMs) {
    return cached.data
  }

  const scopedToClient = dashboardClientScope(req)
  const scopedCustomer =
    ["CUSTOMER", "VIEWER"].includes(req.user?.role) &&
    req.user?.clientid
  const customerWhere = scopedCustomer ? "WHERE c.clientid = $1" : ""
  const customerValues = scopedCustomer ? [req.user.clientid] : []
  const equipmentClientFilter = scopedCustomer ? "AND a.clientid = $1" : ""

  const dashboardResults = await Promise.allSettled([
    pool.query(`
      WITH active_assets AS (
        SELECT a.assetid, a.clientid
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_visual AS (
        SELECT DISTINCT ON (i.assetid) i.assetid, i.testdate, i.validdate, i.status
        FROM atec.tblinspection i
        JOIN active_assets a ON a.assetid = i.assetid
        WHERE i.inspectiontype = 'VISUAL'
        ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
      ),
      latest_load AS (
        SELECT DISTINCT ON (i.assetid) i.assetid, i.testdate, i.validdate, i.status
        FROM atec.tblinspection i
        JOIN active_assets a ON a.assetid = i.assetid
        WHERE i.inspectiontype = 'LOADTEST'
        ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
      ),
      latest_inspections AS (
        SELECT * FROM latest_visual
        UNION ALL
        SELECT * FROM latest_load
      )
      SELECT
        (
          SELECT COUNT(DISTINCT a.assetid)
          FROM active_assets a
          LEFT JOIN latest_visual v ON v.assetid = a.assetid
          LEFT JOIN latest_load l ON l.assetid = a.assetid
          WHERE v.status = 'NOT SAFE' OR l.status = 'NOT SAFE'
        ) AS failed,
        (
          SELECT COUNT(*)
          FROM latest_inspections
          WHERE validdate IS NOT NULL
            AND validdate BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        ) AS expiring,
        (
          SELECT COUNT(*)
          FROM active_assets a
          LEFT JOIN latest_visual v ON v.assetid = a.assetid
          LEFT JOIN latest_load l ON l.assetid = a.assetid
          WHERE (
            v.testdate + INTERVAL '3 months' < CURRENT_DATE
            OR l.testdate + INTERVAL '12 months' < CURRENT_DATE
          )
        ) AS overdue
    `, scopedToClient.values),
    pool.query(`
      WITH active_assets AS (
        SELECT *
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_inspections AS (
        SELECT DISTINCT ON (i.assetid, i.inspectiontype)
          i.testid, i.assetid, i.inspectiontype, i.testdate, i.status
        FROM atec.tblinspection i
        JOIN active_assets a ON a.assetid = i.assetid
        WHERE i.inspectiontype IN ('VISUAL', 'LOADTEST')
        ORDER BY i.assetid, i.inspectiontype, i.testdate DESC NULLS LAST, i.testid DESC
      ),
      failed_assets AS (
        SELECT
          a.clientid,
          a.assetid,
          COUNT(i.testid)::int AS failed_certificates,
          MAX(i.testdate) AS latest_failed_date
        FROM active_assets a
        JOIN latest_inspections i ON i.assetid = a.assetid
        WHERE i.status = 'NOT SAFE'
        GROUP BY a.clientid, a.assetid
      )
      SELECT
        fa.clientid,
        COALESCE(c.clientname, 'Unknown Customer') AS clientname,
        COUNT(fa.assetid)::int AS failed_assets,
        SUM(fa.failed_certificates)::int AS failed_certificates,
        MAX(fa.latest_failed_date) AS latest_failed_date
      FROM failed_assets fa
      LEFT JOIN atec.tblclients c ON fa.clientid = c.clientid
      GROUP BY fa.clientid, c.clientname
      ORDER BY failed_assets DESC, clientname ASC
      LIMIT 50
    `, scopedToClient.values),
    pool.query(`
      WITH active_assets AS (
        SELECT *
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_inspections AS (
        SELECT DISTINCT ON (i.assetid, i.inspectiontype)
          i.testid, i.assetid, i.inspectiontype, i.testdate, i.validdate
        FROM atec.tblinspection i
        JOIN active_assets a ON a.assetid = i.assetid
        WHERE i.inspectiontype IN ('VISUAL', 'LOADTEST')
        ORDER BY i.assetid, i.inspectiontype, i.testdate DESC NULLS LAST, i.testid DESC
      ),
      upcoming_assets AS (
        SELECT
          a.clientid,
          a.assetid,
          COUNT(i.testid)::int AS upcoming_certificates,
          MIN(i.validdate) AS next_expiry_date,
          MIN(i.validdate - CURRENT_DATE) AS days_remaining
        FROM active_assets a
        JOIN latest_inspections i ON i.assetid = a.assetid
        WHERE i.validdate IS NOT NULL
          AND i.validdate >= CURRENT_DATE
          AND i.validdate <= CURRENT_DATE + INTERVAL '90 days'
        GROUP BY a.clientid, a.assetid
      )
      SELECT
        ua.clientid,
        COALESCE(c.clientname, 'Unknown Customer') AS clientname,
        COUNT(ua.assetid)::int AS upcoming_assets,
        SUM(ua.upcoming_certificates)::int AS upcoming_certificates,
        MIN(ua.next_expiry_date) AS next_expiry_date,
        MIN(ua.days_remaining) AS days_remaining
      FROM upcoming_assets ua
      LEFT JOIN atec.tblclients c ON ua.clientid = c.clientid
      GROUP BY ua.clientid, c.clientname
      ORDER BY next_expiry_date ASC, upcoming_assets DESC, clientname ASC
      LIMIT 50
    `, scopedToClient.values),
    pool.query(`
      SELECT
        c.clientid,
        c.clientname,
        COUNT(DISTINCT s.siteid)::int AS sites,
        COUNT(DISTINCT a.assetid)::int AS assets
      FROM atec.tblclients c
      LEFT JOIN atec.tblsites s ON c.clientid = s.clientid
      LEFT JOIN atec.tblasset a
        ON c.clientid = a.clientid
        AND COALESCE(a.archived, false) = false
      ${customerWhere}
      GROUP BY c.clientid, c.clientname
      ORDER BY COUNT(DISTINCT a.assetid) DESC, c.clientname ASC
      LIMIT 10
    `, customerValues),
    pool.query(`
      SELECT
        COALESCE(et.description, 'Unknown') AS equipmenttype,
        COUNT(a.assetid)::int AS total
      FROM atec.tblasset a
      LEFT JOIN atec.tblequiptype et ON a.equiptypeid = et.equiptypeid
      WHERE COALESCE(a.archived, false) = false
      ${equipmentClientFilter}
      GROUP BY COALESCE(et.description, 'Unknown')
      ORDER BY COUNT(a.assetid) DESC, COALESCE(et.description, 'Unknown') ASC
      LIMIT 10
    `, customerValues),
    getNotificationCentreRows(req)
  ])

  const dashboardResultValue = (index, fallback, label) => {
    const result = dashboardResults[index]
    if (result?.status === "fulfilled") return result.value

    console.error(`Dashboard summary ${label} query failed:`, result?.reason)
    return fallback
  }

  const alertsResult = dashboardResultValue(0, { rows: [{}] }, "alerts")
  const failedResult = dashboardResultValue(1, { rows: [] }, "failed equipment")
  const upcomingResult = dashboardResultValue(2, { rows: [] }, "upcoming expiries")
  const topCustomersResult = dashboardResultValue(3, { rows: [] }, "top customers")
  const equipmentResult = dashboardResultValue(4, { rows: [] }, "equipment by type")
  const notificationsResult = dashboardResults[5]
  const notificationCentre = notificationsResult?.status === "fulfilled"
    ? notificationsResult.value
    : []

  if (notificationsResult?.status === "rejected") {
    console.error("Dashboard summary notification centre query failed:", notificationsResult.reason)
  }

  const data = {
    alerts: alertsResult.rows[0] || {},
    failedEquipmentByCustomer: failedResult.rows,
    upcomingExpiriesByCustomer: upcomingResult.rows,
    topCustomers: topCustomersResult.rows,
    equipmentByType: equipmentResult.rows,
    notificationCentre
  }

  dashboardSummaryCache.set(key, {
    createdAt: Date.now(),
    data
  })

  return data
}

app.get("/dashboard/summary", async (req, res) => {
  try {
    res.json(await getCachedDashboardSummary(req))
  } catch (err) {
    console.error("Dashboard summary error:", err)
    res.status(500).json({ error: "Failed to load dashboard summary" })
  }
})

app.get("/dashboard/notification-centre", asyncRoute(async (req, res) => {
  res.json(await getNotificationCentreRows(req))
}))

app.get("/dashboard/notification-centre/preview", asyncRoute(async (req, res) => {
  const preview = await buildNotificationEmailPreview(req)

  if (!preview) {
    return res.status(404).json({ error: "Notification row not found" })
  }

  res.json({
    ...preview,
    can_send: preview.recipients.length > 0 && getMailConfigIssues().length === 0,
    mail_config_issues: getMailConfigIssues()
  })
}))

app.get("/dashboard/notification-centre/scheduler", asyncRoute(async (req, res) => {
  res.json(notificationSchedulerStatus())
}))

app.get("/dashboard/notification-centre/history", asyncRoute(async (req, res) => {
  res.json(await getNotificationDeliveryHistory(req))
}))

app.post("/dashboard/notification-centre/scheduler/run", emailLimiter, asyncRoute(async (req, res) => {
  if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Only admins and managers can run automatic notifications" })
  }

  const result = await runScheduledNotificationDelivery({ force: true })
  res.json({
    success: true,
    result,
    scheduler: notificationSchedulerStatus()
  })
}))

app.post("/dashboard/notification-centre/send", emailLimiter, asyncRoute(async (req, res) => {
  if (!["ADMIN", "MANAGER"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Only admins and managers can send customer notifications" })
  }

  const preview = await buildNotificationEmailPreview(req, req.body || {})

  if (!preview) {
    return res.status(404).json({ error: "Notification row not found" })
  }

  if (!preview.recipients.length) {
    return res.status(400).json({ error: "No active customer portal users with email addresses are available for this customer/site." })
  }

  const mailConfigIssues = getMailConfigIssues()

  if (mailConfigIssues.length) {
    return res.status(400).json({
      error: `Email is not configured yet. Missing: ${mailConfigIssues.join(", ")}. Add these values to backend/.env and restart the backend.`
    })
  }

  const recipients = preview.recipients.map(recipient => recipient.email)

  const delivery = await sendNotificationPreview(preview, {
    deliveryType: "MANUAL",
    sentByUserId: req.user?.user_id || null
  })

  await req.logAudit("SEND_NOTIFICATION", "notifications", preview.row.clientid, {
    clientid: preview.row.clientid,
    siteid: preview.row.siteid,
    recipients,
    counts: notificationCounts(preview.row)
  })

  res.json({
    success: true,
    sent_to: delivery.sent_to,
    recipients: delivery.recipients
  })
}))

app.get("/dashboard/alerts", async (req, res) => {
  try {
    const scopedToClient = dashboardClientScope(req)

    const result = await pool.query(`
      WITH active_assets AS (
        SELECT
          a.assetid,
          a.clientid
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_visual AS (
        SELECT DISTINCT ON (i.assetid)
          i.assetid,
          i.testdate,
          i.validdate,
          i.status
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype = 'VISUAL'
        ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
      ),
      latest_load AS (
        SELECT DISTINCT ON (i.assetid)
          i.assetid,
          i.testdate,
          i.validdate,
          i.status
        FROM atec.tblinspection i
        JOIN active_assets a
          ON a.assetid = i.assetid
        WHERE i.inspectiontype = 'LOADTEST'
        ORDER BY i.assetid, i.testdate DESC NULLS LAST, i.testid DESC
      ),
      latest_inspections AS (
        SELECT * FROM latest_visual
        UNION ALL
        SELECT * FROM latest_load
      )
      SELECT
      (
        SELECT COUNT(DISTINCT a.assetid)
        FROM active_assets a
        LEFT JOIN latest_visual v
          ON v.assetid = a.assetid
        LEFT JOIN latest_load l
          ON l.assetid = a.assetid
        WHERE v.status = 'NOT SAFE'
           OR l.status = 'NOT SAFE'
      ) AS failed,

      (
        SELECT COUNT(*)
        FROM latest_inspections
        WHERE validdate IS NOT NULL
        AND validdate BETWEEN CURRENT_DATE
        AND CURRENT_DATE + INTERVAL '30 days'
      ) AS expiring,

      (
        SELECT COUNT(*)
        FROM active_assets a
        LEFT JOIN latest_visual v
          ON v.assetid = a.assetid
        LEFT JOIN latest_load l
          ON l.assetid = a.assetid
        WHERE (
          v.testdate + INTERVAL '3 months' < CURRENT_DATE
          OR l.testdate + INTERVAL '12 months' < CURRENT_DATE
        )
      ) AS overdue
    `, scopedToClient.values)

    res.json(result.rows[0])

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

app.get("/dashboard/visit-alerts", asyncRoute(async (req, res) => {
  if (!canWorkVisit(req.user)) {
    return res.status(403).json({ error: "Access denied" })
  }

  const result = await pool.query(
    `
    SELECT
      count(*) FILTER (WHERE visit_status IN ('OPEN','PAUSED'))::int AS open_visits,
      count(*) FILTER (WHERE visit_status = 'RECONCILIATION_REQUIRED')::int AS reconciliation_required,
      COALESCE((
        SELECT count(*)::int
        FROM atec.tblinspectionvisitasset va
        JOIN atec.tblinspectionvisit v ON v.visitid = va.visitid
        WHERE v.visit_status IN ('OPEN','PAUSED','RECONCILIATION_REQUIRED')
          AND va.reconciliation_status = 'OUTSTANDING'
      ), 0) AS outstanding_due_assets,
      COALESCE((
        SELECT count(*)::int
        FROM atec.tblinspectionvisitasset
        WHERE reconciliation_status = 'DEFERRED'
          AND deferred_follow_up_date IS NOT NULL
          AND deferred_follow_up_date <= CURRENT_DATE + INTERVAL '14 days'
      ), 0) AS deferred_followups_due,
      count(*) FILTER (WHERE visit_status = 'COMPLETED' AND actual_completion_at >= now() - INTERVAL '14 days')::int AS recently_completed
    FROM atec.tblinspectionvisit
    `
  )

  res.json(result.rows[0])
}))

app.use(errorHandler)

startNotificationScheduler()

const server = app.listen(PORT, () => {
  console.log(`ATEC server running on port ${PORT}`);
});

server.requestTimeout = requestTimeoutMs
server.headersTimeout = headersTimeoutMs
server.keepAliveTimeout = keepAliveTimeoutMs

