const fs = require("fs")
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const cookieParser = require("cookie-parser")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const bcrypt = require("bcryptjs")
const pool = require("./db");
require("dotenv").config();
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

app.use((req, res, next) => {
  req.logAudit = (...args) => logAudit(req, ...args)
  next()
})

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

function resolveUploadFilePath(uploadPath) {
  if (!uploadPath) return null

  const normalizedPath = path.posix.normalize(
    String(uploadPath).replace(/\\/g, "/")
  )

  if (!normalizedPath.startsWith("/uploads/") || normalizedPath.includes("/../")) {
    return null
  }

  const fullPath = path.resolve(uploadsRoot, normalizedPath.replace(/^\/uploads\//, ""))

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

  const result = String(resultRow?.result || "").trim().toUpperCase()
  const measuredValue = String(resultRow?.measuredvalue || "").trim().toUpperCase()

  return result === "FAIL" ||
    result === "NO" ||
    measuredValue === "FAIL" ||
    measuredValue === "NO"
}

function blankToNull(value) {
  return value === "" || value === undefined ? null : value
}

function normalizeAssetLookupValue(value) {
  return String(value || "").trim().toLowerCase()
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

  res.cookie("atec_session", signAuthToken(user), authCookieOptions())
  res.json({ user: publicUser(user) })
}))

app.post("/auth/logout", csrfProtection, asyncRoute(async (req, res) => {
  if (req.user?.user_id) {
    await req.logAudit("LOGOUT", "auth", req.user.user_id)
  }

  res.clearCookie("atec_session", authCookieOptions())
  res.json({ success: true })
}))

app.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user })
})

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

    if (method === "POST" && /^\/certificates\/[^/]+\/email$/.test(routePath)) {
      return next()
    }

    if (["POST", "PUT"].includes(method) && routePath.startsWith("/she/")) {
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
        routePath.startsWith("/inspection-photos") ||
        routePath.startsWith("/she/")
      )
    ) {
      return next()
    }

    return res.status(403).json({ error: "Access denied" })
  }

  if (role === "VIEWER") {
    if (
      isRead &&
      (
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

app.use("/uploads", requireAuth, asyncRoute(authorizeUploadRequest), express.static(uploadsRoot));
app.use(requireAuth)
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
    appVersion: backendPackage.version
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
    ORDER BY COALESCE(NULLIF(fullname, ''), username), username
    `
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

  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: "Username, password, full name and role are required" })
  }

  const passwordValidation = validatePassword(password)
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: passwordValidation.message })
  }

  if (!validRoles().includes(role)) {
    return res.status(400).json({ error: "Invalid role" })
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
      String(username).trim(),
      email ? String(email).trim() : null,
      passwordHash,
      String(full_name).trim(),
      roleToUserLevel(role),
      role,
      lmi_number ? String(lmi_number).trim() : null,
      clientid || null,
      siteid || null,
      sectionid || null,
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

  if (!full_name || !role) {
    return res.status(400).json({ error: "Full name and role are required" })
  }

  if (!validRoles().includes(role)) {
    return res.status(400).json({ error: "Invalid role" })
  }

  const params = [
    email ? String(email).trim() : null,
    String(full_name).trim(),
    roleToUserLevel(role),
    role,
    lmi_number ? String(lmi_number).trim() : null,
    clientid || null,
    siteid || null,
    sectionid || null,
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

  const result = await pool.query(
    `
    UPDATE atec.tblusers
    SET is_active = false,
        updated_at = now()
    WHERE userid = $1
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
    [req.params.id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "User not found" })
  }

  await req.logAudit("DELETE", "users", req.params.id)
  res.json({ success: true, user: result.rows[0] })
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
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Only admins can reset passwords" })
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
    const { clientname, clientaddr } = req.body;

    const result = await pool.query(
      `INSERT INTO atec.tblclients (clientname, clientaddr)
       VALUES ($1, $2)
       RETURNING *`,
      [clientname, clientaddr || null]
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

    const {
      clientname,
      clientaddr
    } = req.body

    const result = await pool.query(
      `
      UPDATE atec.tblclients
      SET
        clientname = $1,
        clientaddr = $2
      WHERE clientid = $3
      RETURNING *
      `,
      [
        clientname,
        clientaddr,
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
          SELECT i.inspector
          FROM atec.tblinspection i
          WHERE i.assetid = a.assetid
          ORDER BY i.testdate DESC, i.testid DESC
          LIMIT 1
        ) AS lastinspector,

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
        et.description AS equipmenttype
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

    if (req.user.role === "INSPECTOR") {
      const assettagno = String(req.body.assettagno || "").trim()
      const normalizedAssetTagNo = normalizeAssetLookupValue(assettagno)

      const duplicateCheck = await pool.query(
        `
        SELECT assetid
        FROM atec.tblasset
        WHERE clientid = (
          SELECT clientid
          FROM atec.tblasset
          WHERE assetid = $1
        )
          AND assetid <> $1
          AND COALESCE(archived, false) = false
          AND $2 <> ''
          AND LOWER(TRIM(assettagno)) = $2
        LIMIT 1
        `,
        [id, normalizedAssetTagNo]
      )

      if (duplicateCheck.rows.length > 0) {
        return duplicateAssetResponse(res, "assetTag", duplicateCheck.rows[0].assetid)
      }

      const result = await pool.query(
        `
        UPDATE atec.tblasset
        SET assettagno = $1
        WHERE assetid = $2
        RETURNING *
        `,
        [assettagno || null, id]
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Asset not found" })
      }

      return res.json(result.rows[0])
    }

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

app.put("/assets/:id/archive", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE atec.tblasset
       SET archived = true
       WHERE assetid = $1
       RETURNING *`,
      [id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/assets/:id/unarchive", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE atec.tblasset
       SET archived = false
       WHERE assetid = $1
       RETURNING *`,
      [id]
    );

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

app.get("/responsible-persons", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.personid,
        p.clientid,
        p.name,
        COALESCE(p.archived, false) AS archived,
        c.clientname
      FROM atec.tblpeople p
      LEFT JOIN atec.tblclients c
        ON p.clientid = c.clientid
      ORDER BY c.clientname, p.name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.post("/responsible-persons", async (req, res) => {
  try {
    const { clientid, name } = req.body;
    const normalizedPersonName = normalizeAssetLookupValue(name)

    if (normalizedPersonName) {
      const duplicateCheck = await pool.query(
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
        return duplicateMasterDataResponse(res, "responsiblePerson", duplicateCheck.rows[0].personid)
      }
    }

    const result = await pool.query(
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

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    const duplicateType = isDuplicateActiveMasterDataError(err)
    if (duplicateType) return duplicateMasterDataResponse(res, duplicateType)

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
  }
});

app.put("/responsible-persons/:id", async (req, res) => {
  try {

    const { id } = req.params;
    const { clientid, name } = req.body;
    const normalizedPersonName = normalizeAssetLookupValue(name)

    if (normalizedPersonName) {
      const duplicateCheck = await pool.query(
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
        return duplicateMasterDataResponse(res, "responsiblePerson", duplicateCheck.rows[0].personid)
      }
    }

    const result = await pool.query(
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

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    const duplicateType = isDuplicateActiveMasterDataError(err)
    if (duplicateType) return duplicateMasterDataResponse(res, duplicateType)

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
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
        sec.responsibleid,
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
      LEFT JOIN atec.tblpeople p
        ON sec.responsibleid = p.personid
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
        results,
        updateassetphotos
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

      const inspectionTagNumber =
        typeof tagnumber === "string" && tagnumber.trim()
          ? tagnumber.trim()
          : null
      const normalizedInspectionFrequency =
        ["FREQUENT", "ANNUAL"].includes(String(inspectionfrequency || "").toUpperCase())
          ? String(inspectionfrequency).toUpperCase()
          : null

      const inspection = await client.query(
        `
        INSERT INTO atec.tblinspection
        (
          assetid,
          testdate,
          validdate,
          comments,
          status,
          inspectiontype,
          inspector,
          inspector_user_id,
          inspector_name,
          inspector_lmi_number,
          inspector_signature_image,
          tagnumber,
          inspectionfrequency,
          photo1,
          photo2,
          updateassetphotos
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING testid
        `,
        [
          assetid,
          testdate,
          validdate || null,
          comments || "",
          finalStatus,
          inspectiontype,
          inspectorProfile.full_name || req.user.full_name || "",
          inspectorProfile.user_id,
          inspectorProfile.full_name || req.user.full_name || "",
          inspectorProfile.lmi_number || "",
          inspectorProfile.signature_image || "",
          inspectionTagNumber,
          normalizedInspectionFrequency,
          photo1,
          photo2,
          updatePhotos
        ]
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

      for (const row of parsedResults) {
        await client.query(
          `
          INSERT INTO atec.tblinspectionresult
          (
            testid,
            criteriaid,
            result,
            remarks,
            assetvalue,
            measuredvalue
          )
          VALUES
          ($1,$2,$3,$4,$5,$6)
          `,
          [
            testid,
            row.criteriaid || null,
            row.result || "",
            row.remarks || "",
            row.assetvalue || null,
            row.measuredvalue || null
          ]
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

      await client.query("COMMIT")
      await req.logAudit("CREATE", "inspections", testid, {
        assetid,
        inspectiontype,
        inspector_user_id: inspectorProfile.user_id,
        critical_failures: criticalFailures.length,
        inspection_photos: req.files?.inspectionPhotos?.length || 0
      })

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
      console.error(err)
      res.status(500).json({ error: "An unexpected server error occurred" })
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

const certificateSearchSortColumns = {
  testid: "i.testid",
  tagnumber: "i.tagnumber",
  clientname: "c.clientname",
  sitename: "s.sitename",
  description: "a.description",
  serialno: "a.serialno",
  inspectiontype: "i.inspectiontype",
  testdate: "i.testdate",
  status: "i.status",
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
    let where = `WHERE 1 = 1`

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
      where += ` AND i.status = $${values.length}`
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
        COUNT(*) FILTER (WHERE i.status = 'SAFE')::int AS safe,
        COUNT(*) FILTER (WHERE i.status = 'NOT SAFE')::int AS not_safe,
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
        i.status,
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

async function getBulkCertificateMatches(req, includeTestIds = false) {
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
    where += ` AND i.status = $${values.length}`
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
  const certificates = result.rows
    .map(row => certificatesByTestId.get(Number(row.testid)))
    .filter(certificate => certificate && canViewCertificate(req.user, certificate))

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
    certificates
  }
}

app.get("/certificates/bulk-print", searchLimiter, async (req, res) => {
  try {
    const { filters, certificates } = await getBulkCertificateMatches(req, false)

    await req.logAudit("BULK_PRINT_SEARCH", "certificates", null, {
      ...filters,
      count: certificates.length
    })

    res.json({ certificates })
  } catch (err) {
    console.error(err)
    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : "An unexpected server error occurred"
    })
  }
})

app.get("/certificates/bulk-pdf", pdfLimiter, async (req, res) => {
  try {
    const { filters, certificates } = await getBulkCertificateMatches(req, true)

    if (!certificates.length) {
      return res.status(404).json({ error: "No certificates found for the selected filters" })
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
      COALESCE(i.inspector_name, i.inspector) AS inspector,
      a.assetid,
      a.equiptypeid,
      a.serialno,
      a.assettagno,
      a.manufacturer,
      a.description,
      a.media1,
      a.media2,
      a.manufactdate,
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
    LEFT JOIN atec.tblequiptype et
      ON a.equiptypeid = et.equiptypeid
    WHERE i.testid = ANY($1::int[])
    `,
    [normalizedTestIds]
  )

  for (const inspection of inspectionResult.rows) {
    certificates.set(Number(inspection.testid), {
      inspection,
      results: [],
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

  const fallbackEquiptypeIds = [...new Set(
    [...certificates.values()]
      .filter(certificate =>
        certificate.results.length === 0 &&
        certificate.inspection?.equiptypeid &&
        certificate.inspection?.inspectiontype !== "LOADTEST"
      )
      .map(certificate => Number(certificate.inspection.equiptypeid))
      .filter(value => Number.isInteger(value) && value > 0)
  )]

  if (fallbackEquiptypeIds.length) {
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
        COALESCE(inspection_category, 'PERIODIC_THOROUGH_INSPECTION') AS inspection_category,
        COALESCE(severity, 'MINOR') AS severity,
        COALESCE(displayorder, sortorder, criteriaid) AS displayorder
      FROM atec.tblequiptypecriteria
      WHERE equiptypeid = ANY($1::int[])
        AND COALESCE(active, true) = true
      ORDER BY equiptypeid, COALESCE(displayorder, sortorder, criteriaid), criteriaid
      `,
      [fallbackEquiptypeIds]
    )

    const criteriaByEquiptype = new Map()
    for (const row of criteriaResult.rows) {
      const key = String(row.equiptypeid)
      if (!criteriaByEquiptype.has(key)) criteriaByEquiptype.set(key, [])
      criteriaByEquiptype.get(key).push(row)
    }

    for (const certificate of certificates.values()) {
      if (certificate.results.length || certificate.inspection?.inspectiontype === "LOADTEST") continue

      const criteriaRows = criteriaByEquiptype.get(String(certificate.inspection?.equiptypeid)) || []
      const inspectionIsSafe = certificate.inspection?.status === "SAFE"

      certificate.results.push(...criteriaRows.map(row => ({
        resultid: null,
        testid: certificate.inspection.testid,
        criteriaid: row.criteriaid,
        criterianame: row.criterianame,
        fieldtype: row.fieldtype,
        resulttype: row.resulttype,
        inspection_category: row.inspection_category,
        severity: row.severity,
        assetvalue: "",
        measuredvalue: "",
        result: inspectionIsSafe
          ? isSafeForContinuedOperation(row.criterianame) ? "YES" : "PASS"
          : "",
        remarks: ""
      })))
    }
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
    return value.toISOString().split("T")[0]
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

function certificateImagePath(imagePath) {
  if (!imagePath) return null

  const normalizedPath = imagePath.replace(/^\/+/, "")
  const fullPath = path.join(__dirname, normalizedPath)

  return fs.existsSync(fullPath) ? fullPath : null
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
          <div><strong>Tag Number:</strong><span>${htmlEscape(inspection.tagnumber || "-")}</span></div>
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
    ["Tag Number", inspection.tagnumber],
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

function getMailConfigIssues() {
  return [
    ["SMTP_HOST", process.env.SMTP_HOST],
    ["SMTP_PORT", process.env.SMTP_PORT],
    ["SMTP_USER", process.env.SMTP_USER],
    ["SMTP_PASS", process.env.SMTP_PASS],
    ["MAIL_FROM", process.env.MAIL_FROM]
  ]
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => key)
}

function getMailErrorMessage(err) {
  const code = String(err?.code || "").toUpperCase()
  const command = err?.command ? ` (${err.command})` : ""
  const response = String(err?.response || err?.message || "").replace(/\s+/g, " ").trim()

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

app.delete("/certificates/:testid", async (req, res) => {
  const { testid } = req.params

  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Only admins may delete certificates" })
  }

  const client = await pool.connect()

  try {
    const certificate = await getCertificateData(testid)

    if (!certificate) {
      return res.status(404).json({ error: "Certificate not found" })
    }

    await client.query("BEGIN")

    await client.query(
      "DELETE FROM atec.tblinspectionphoto WHERE testid = $1",
      [testid]
    )

    await client.query(
      "DELETE FROM atec.tblinspectionresult WHERE testid = $1",
      [testid]
    )

    const deleteResult = await client.query(
      "DELETE FROM atec.tblinspection WHERE testid = $1",
      [testid]
    )

    await client.query("COMMIT")

    await req.logAudit("DELETE", "certificates", testid, {
      assetid: certificate.inspection?.assetid || null,
      inspectiontype: certificate.inspection?.inspectiontype || null
    })

    res.json({
      success: true,
      deleted: deleteResult.rowCount
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

    const transport = getMailTransport()

    if (!transport) {
      return res.status(400).json({
        error: "Email is not configured yet. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM to backend/.env."
      })
    }

    const certificate = await getCertificateData(testid)

    if (!certificate) {
      return res.status(404).json({ error: "Certificate not found" })
    }

    if (!canViewCertificate(req.user, certificate)) {
      return res.status(403).json({ error: "Access denied" })
    }

    const inspection = certificate.inspection
    const pdfBuffer = await createCertificatePdfBuffer(certificate)
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

    await transport.sendMail({
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

    const transport = getMailTransport()

    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to: recipient,
      subject: "ATEC email test",
      text: [
        "Good day,",
        "",
        "This is a test email from ATEC.",
        "",
        "If you received this, SMTP is working."
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
  if (["CUSTOMER", "VIEWER"].includes(req.user?.role) && req.user?.clientid) {
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
    dateto: query.dateto || ""
  }
}

function customerScopedReportFilters(req) {
  const filters = customerReportFilters(req.query)

  if (req.user.role === "CUSTOMER") {
    filters.clientid = req.user.clientid || "-1"
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
    dateto = ""
  } = filters

  const customerValues = []
  const values = []
  let customerWhere = "WHERE 1 = 1"
  let assetWhere = "WHERE 1 = 1"
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
    )`

    values.push(sectionid)
    assetWhere += ` AND a.sectionid = $${values.length}`
  }

  if (responsibleid) {
    customerValues.push(responsibleid)
    customerWhere += ` AND EXISTS (
      SELECT 1
      FROM atec.tblasset customer_asset
      WHERE customer_asset.clientid = c.clientid
        AND customer_asset.responsibleid = $${customerValues.length}
    )`

    values.push(responsibleid)
    assetWhere += ` AND a.responsibleid = $${values.length}`
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
      COUNT(DISTINCT p.personid) AS responsiblecount
    FROM atec.tblclients c
    LEFT JOIN atec.tblsites s
      ON c.clientid = s.clientid
    LEFT JOIN atec.tblsection sec
      ON c.clientid = sec.clientid
    LEFT JOIN atec.tblpeople p
      ON c.clientid = p.clientid
    ${customerWhere}
    GROUP BY c.clientid, c.clientname, c.clientaddr, c.archived
    ORDER BY c.clientname
    `,
    customerValues
  )

  const assetBaseSql = `
    WITH latest_visual AS (
      SELECT DISTINCT ON (assetid)
        assetid,
        testid,
        testdate,
        validdate,
        status,
        inspector
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
        inspector
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
      p.name AS responsiblename,
      et.description AS equipmenttype,
      lv.testid AS visualtestid,
      lv.testdate AS visualtestdate,
      lv.validdate AS visualvaliddate,
      lv.status AS visualstatus,
      lv.inspector AS visualinspector,
      ll.testid AS loadtestid,
      ll.testdate AS loadtestdate,
      ll.validdate AS loadvaliddate,
      ll.status AS loadstatus,
      ll.inspector AS loadinspector,
      GREATEST(lv.testdate, ll.testdate) AS latestinspectiondate,
      CASE
        WHEN lv.testdate IS NULL THEN NULL
        ELSE (lv.testdate + INTERVAL '3 months')::date
      END AS nextvisualdue,
      CASE
        WHEN ll.testdate IS NULL THEN NULL
        ELSE (ll.testdate + INTERVAL '12 months')::date
      END AS nextloaddue,
      CASE
        WHEN COALESCE(a.archived, false) = true THEN 'ARCHIVED'
        WHEN lv.status = 'NOT SAFE' OR ll.status = 'NOT SAFE' THEN 'NOT SAFE'
        WHEN lv.testdate IS NULL THEN 'NO VISUAL'
        WHEN ll.testdate IS NULL THEN 'NO LOAD TEST'
        WHEN (lv.testdate + INTERVAL '3 months')::date < CURRENT_DATE THEN 'VISUAL OVERDUE'
        WHEN (ll.testdate + INTERVAL '12 months')::date < CURRENT_DATE THEN 'LOAD TEST OVERDUE'
        ELSE 'OK'
      END AS reportstatus
    FROM atec.tblasset a
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
    LEFT JOIN latest_visual lv
      ON a.assetid = lv.assetid
    LEFT JOIN latest_load ll
      ON a.assetid = ll.assetid
    ${assetWhere}
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
    { header: "Next Visual Due", key: "nextvisualdue", width: 16 },
    { header: "Last Load Test ID", key: "loadtestid", width: 16 },
    { header: "Last Load Date", key: "loadtestdate", width: 16 },
    { header: "Load Valid Until", key: "loadvaliddate", width: 18 },
    { header: "Load Status", key: "loadstatus", width: 16 },
    { header: "Load Inspector", key: "loadinspector", width: 20 },
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
    to: "AA1"
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
          a.equiptypeid
        FROM atec.tblasset a
        WHERE COALESCE(a.archived, false) = false
        ${scopedToClient.clause}
      ),
      latest_visual AS (
        SELECT DISTINCT ON (i.assetid)
          i.assetid,
          i.testdate,
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
          i.status
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
        ) AS certificates,
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
          WHERE (
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
            OR l.testdate + INTERVAL '12 months' < CURRENT_DATE
          )
        ) AS overdue
    `, scopedToClient.values)

    res.json(result.rows[0])

  } catch (err) {
    console.error("Dashboard stats error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/dashboard/top-customers", async (req, res) => {
  try {
    const scopedToClient =
      ["CUSTOMER", "VIEWER"].includes(req.user?.role) &&
      req.user?.clientid

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
    const scopedToClient =
      ["CUSTOMER", "VIEWER"].includes(req.user?.role) &&
      req.user?.clientid

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
          WHEN ll.lastload IS NULL THEN 'No Load Test'
          WHEN ll.lastload < CURRENT_DATE - INTERVAL '12 months' THEN 'Load Test Overdue'
          ELSE 'OK'
        END AS reason,

        CASE
          WHEN lv.lastvisual IS NULL THEN NULL
          WHEN lv.lastvisual < CURRENT_DATE - INTERVAL '3 months'
            THEN CURRENT_DATE - (lv.lastvisual + INTERVAL '3 months')::date
          WHEN ll.lastload IS NULL THEN NULL
          WHEN ll.lastload < CURRENT_DATE - INTERVAL '12 months'
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
        OR ll.lastload IS NULL
        OR ll.lastload < CURRENT_DATE - INTERVAL '12 months'
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

function dashboardSummaryCacheKey(req) {
  return `${req.user?.role || ""}:${req.user?.clientid || ""}`
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
    `, customerValues)
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

  const data = {
    alerts: alertsResult.rows[0] || {},
    failedEquipmentByCustomer: failedResult.rows,
    upcomingExpiriesByCustomer: upcomingResult.rows,
    topCustomers: topCustomersResult.rows,
    equipmentByType: equipmentResult.rows
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

app.use(errorHandler)

const server = app.listen(PORT, () => {
  console.log(`ATEC server running on port ${PORT}`);
});

server.requestTimeout = requestTimeoutMs
server.headersTimeout = headersTimeoutMs
server.keepAliveTimeout = keepAliveTimeoutMs

