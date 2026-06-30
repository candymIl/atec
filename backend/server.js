const fs = require("fs")
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const bcrypt = require("bcryptjs")
const pool = require("./db");
require("dotenv").config();
const app = express();
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
  asyncRoute,
  auditLogger,
  authCookieOptions,
  errorHandler,
  isSafeUpload,
  publicUser,
  requireAuth,
  sanitizeFilename,
  signAuthToken,
  validateUploadedImages
} = require("./middleware/security")

const defaultFrontendOrigin = process.env.NODE_ENV === "production"
  ? "https://www.fbcranes.co.za"
  : "http://localhost:5174,http://localhost:5173,http://127.0.0.1:5174,http://127.0.0.1:5173"
const uploadsRoot = path.resolve(process.env.UPLOADS_PATH || path.join(__dirname, "uploads"))
const publicBasePath = (process.env.PUBLIC_BASE_PATH || "/atec").replace(/\/+$/, "")
const allowedOrigins = (process.env.FRONTEND_ORIGIN || defaultFrontendOrigin)
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean)
const trustProxy = process.env.TRUST_PROXY || (process.env.NODE_ENV === "production" ? "1" : "")

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
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    return callback(new Error("Origin not allowed by CORS"))
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const logAudit = auditLogger(pool)

app.use((req, res, next) => {
  req.logAudit = (...args) => logAudit(req, ...args)
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

  const targetPath = file.path.replace(/\.[^.]+$/, ".jpg")
  const tempPath = `${targetPath}.tmp`

  await sharp(file.path)
    .rotate()
    .resize({
      width: Number(process.env.UPLOAD_IMAGE_MAX_WIDTH || 1600),
      height: Number(process.env.UPLOAD_IMAGE_MAX_HEIGHT || 1600),
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: Number(process.env.UPLOAD_IMAGE_QUALITY || 72),
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
    await Promise.all(files.map(file => compressUploadedPhoto(file)))
    next()
  } catch (err) {
    removeUploadedFiles(files)
    next(err)
  }
}

app.get("/", (req, res) => {
  res.send("ATEC backend is running");
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
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

app.post("/auth/login", loginLimiter, asyncRoute(async (req, res) => {
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

app.post("/auth/logout", requireAuth, asyncRoute(async (req, res) => {
  await req.logAudit("LOGOUT", "auth", req.user.user_id)
  res.clearCookie("atec_session", authCookieOptions())
  res.json({ success: true })
}))

app.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user })
})

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
    if (method === "POST" && /^\/certificates\/[^/]+\/email$/.test(routePath)) {
      return next()
    }

    if (["POST", "PUT"].includes(method) && routePath.startsWith("/she/")) {
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
    if (
      isRead &&
      (
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

    if (
      method === "POST" &&
      /^\/assets\/[^/]+\/photos$/.test(routePath)
    ) {
      return next()
    }

    if (method === "PUT" && /^\/assets\/[^/]+$/.test(routePath)) {
      const allowedAssetUpdateFields = new Set(["assettagno"])
      const bodyKeys = Object.keys(req.body || {})
      const updatesOnlyAssetTag = bodyKeys.length > 0 &&
        bodyKeys.every(key => allowedAssetUpdateFields.has(key))

      if (updatesOnlyAssetTag) {
        return next()
      }

      return res.status(403).json({
        error: "Inspectors may only update asset tag numbers and photos"
      })
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

  const accessResult = await pool.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM atec.tblasset a
      WHERE a.clientid = $1
        AND $2 IN (a.media1, a.media2)

      UNION ALL

      SELECT 1
      FROM atec.tblinspection i
      JOIN atec.tblasset a
        ON i.assetid = a.assetid
      WHERE a.clientid = $1
        AND $2 IN (i.photo1, i.photo2, i.inspector_signature_image)

      UNION ALL

      SELECT 1
      FROM atec.tblinspectionphoto p
      JOIN atec.tblasset a
        ON p.assetid = a.assetid
      WHERE a.clientid = $1
        AND p.photo_path = $2
    ) AS allowed
    `,
    [req.user.clientid, normalizedPath]
  )

  if (!accessResult.rows[0]?.allowed) {
    return res.status(403).json({ error: "Access denied" })
  }

  return next()
}

app.use("/uploads", requireAuth, asyncRoute(authorizeUploadRequest), express.static(uploadsRoot));
app.use(requireAuth)
app.use(authorizeRequest)
app.use(asyncRoute(enforceInspectorInspectionOwnership))
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
  if (password) {
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
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" })
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

    res.json(result.rows[0])

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

    const result = await pool.query(
      `INSERT INTO atec.tblsites (clientid, sitename)
       VALUES ($1, $2)
       RETURNING *`,
      [clientid, sitename]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/sites/:id", async (req, res) => {
  try {

    const { id } = req.params
    const { sitename } = req.body

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

    res.json(result.rows[0])

  } catch (err) {

    console.error(err)

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

    res.json(result.rows[0])
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

app.get("/assets", async (req, res) => {
  try {
    const result = await pool.query(`
SELECT 
        a.assetid,
        a.clientid,
        a.siteid,
        a.equiptypeid,
        a.serialno,
        a.assettagno,
        a.manufacturer,
        a.description,
        a.wll,
        a.span,
        a.permissibledeflection,
        a.hooksize,
        a.steelwireropemm,
        a.hoistdescription,
        a.hoistserialno,
        a.oemtophooksize,
        a.oembottomhooksize,
        a.loadchaindiameter,
        a.auxhoistwll,
        a.auxhoistdescription,
        a.auxhoistserialno,
        a.auxhoistropemm,
        a.auxhoisthooksize,
        a.media1,
        a.media2,
        a.qrcode,
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
      ORDER BY a.assetid DESC
    `)

    res.json(result.rows)

  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "An unexpected server error occurred"
    })
  }
})

app.get("/assets/qr/:code", async (req, res) => {
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
          a.qrcode = $1
          OR CAST(a.assetid AS text) = $1
          OR ('ATEC-ASSET-' || a.assetid) = $1
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

app.get("/assets/:id/qr-label.pdf", async (req, res) => {
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

app.get("/assets/:id/quick-details", async (req, res) => {
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

    const duplicateCheck = await pool.query(
        `
        SELECT assetid, serialno, assettagno
        FROM atec.tblasset
        WHERE clientid = $1
          AND COALESCE(archived, false) = false
          AND (
            (NULLIF(TRIM($2), '') IS NOT NULL AND LOWER(serialno) = LOWER($2))
            OR (NULLIF(TRIM($3), '') IS NOT NULL AND LOWER(assettagno) = LOWER($3))
          )
        LIMIT 1
        `,
        [
          clientid,
          serialno || '',
          assettagno || ''
        ]
      )

      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({
          error: "Duplicate asset found for this client. Serial No or Asset Tag No already exists."
        })
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
    console.error(err);
    res.status(500).json({ error: "An unexpected server error occurred" });
  }
});

app.put("/assets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role === "INSPECTOR") {
      const assettagno = String(req.body.assettagno || "").trim()

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
          AND NULLIF(TRIM($2), '') IS NOT NULL
          AND LOWER(assettagno) = LOWER($2)
        LIMIT 1
        `,
        [id, assettagno]
      )

      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({
          error: "Duplicate asset found for this client. Asset Tag No already exists."
        })
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
        AND (
          (NULLIF(TRIM($2), '') IS NOT NULL AND LOWER(serialno) = LOWER($2))
          OR (NULLIF(TRIM($3), '') IS NOT NULL AND LOWER(assettagno) = LOWER($3))
        )
      LIMIT 1
      `,
      [
        id,
        serialno || '',
        assettagno || ''
      ]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        error: "Duplicate asset found for this client. Serial No or Asset Tag No already exists."
      });
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

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
  }
});

app.put("/responsible-persons/:id", async (req, res) => {
  try {

    const { id } = req.params;
    const { clientid, name } = req.body;

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

    res.status(500).json({
      error: "An unexpected server error occurred"
    });
  }
});

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

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

app.post("/inspections",
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
          photo1,
          photo2,
          updateassetphotos
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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

app.get("/inspections/assets/search", async (req, res) => {
  try {
    const q = req.query.q || ""

    const result = await pool.query(`
      SELECT 
        assetid,
        assettagno,
        serialno,
        description,
        manufacturer
      FROM atec.tblasset
      WHERE
        assettagno ILIKE $1 OR
        serialno ILIKE $1 OR
        description ILIKE $1 OR
        CAST(assetid AS TEXT) ILIKE $1 OR
        qrcode ILIKE $1
      ORDER BY assetid DESC
      LIMIT 50
    `, [`%${q}%`])

    res.json(result.rows)
  } catch (err) {
    console.error("Asset search error:", err)
    res.status(500).json({ error: "Failed to search assets" })
  }
})

app.get("/certificates/search", async (req, res) => {
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
      return res.json([])
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

    const result = await pool.query(
      `
      SELECT
        i.testid,
        i.testdate,
        i.validdate,
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
      ORDER BY i.testdate DESC, i.testid DESC
      LIMIT 200
      `,
      values
    )

    res.json(result.rows)

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

  if (!clientid || !datefrom || !dateto) {
    const error = new Error("Customer, Date From and Date To are required")
    error.statusCode = 400
    throw error
  }

  if (Number.isNaN(Date.parse(datefrom)) || Number.isNaN(Date.parse(dateto))) {
    const error = new Error("Enter a valid date range")
    error.statusCode = 400
    throw error
  }

  if (req.user.role === "CUSTOMER" && String(req.user.clientid || "") !== String(clientid)) {
    const error = new Error("Access denied")
    error.statusCode = 403
    throw error
  }

  const selectedTestIds = includeTestIds
    ? String(testids || "")
      .split(",")
      .map(value => Number(value.trim()))
      .filter(value => Number.isInteger(value) && value > 0)
    : []

  const values = [clientid, datefrom, dateto]
  let where = `
    WHERE a.clientid = $1
      AND i.testdate::date >= $2::date
      AND i.testdate::date <= $3::date
  `

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

  const certificates = []

  for (const row of result.rows) {
    const certificate = await getCertificateData(row.testid)

    if (certificate && canViewCertificate(req.user, certificate)) {
      certificates.push(certificate)
    }
  }

  return {
    filters: {
      clientid,
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

app.get("/certificates/bulk-print", async (req, res) => {
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

app.get("/certificates/bulk-pdf", async (req, res) => {
  try {
    const { filters, certificates } = await getBulkCertificateMatches(req, true)

    if (!certificates.length) {
      return res.status(404).json({ error: "No certificates found for the selected filters" })
    }

    const pdfBuffer = await createBulkCertificatesPdfBuffer(certificates)
    const customerName = certificates[0]?.inspection?.clientname || "Customer"
    const filename = bulkCertificateFilename(customerName, filters.datefrom, filters.dateto)

    await req.logAudit("BULK_PDF_DOWNLOAD", "certificates", null, {
      ...filters,
      count: certificates.length
    })

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    res.send(pdfBuffer)
  } catch (err) {
    console.error("Bulk certificate PDF error:", err)
    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : "An unexpected server error occurred"
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

async function getCertificateData(testid) {
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
    WHERE i.testid = $1
    `,
    [testid]
  )

  if (inspectionResult.rows.length === 0) {
    return null
  }

  const resultsResult = await pool.query(
    `
    SELECT
      r.resultid,
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
    WHERE r.testid = $1
    ORDER BY
      CASE
        WHEN LOWER(COALESCE(c.criterianame, '')) = 'safe for service' THEN 1
        ELSE 0
      END,
      c.sortorder,
      c.criteriaid
    `,
    [testid]
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
    WHERE testid = $1
    ORDER BY photoid
    `,
    [testid]
  )

  return {
    inspection: inspectionResult.rows[0],
    results: resultsResult.rows,
    photos: photosResult.rows
  }
}

function formatPdfDate(value) {
  if (!value) return "-"

  if (value instanceof Date) {
    return value.toISOString().split("T")[0]
  }

  return String(value).split("T")[0]
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
  return String(inspection.equiptypeid || "") === "102"
}

function shouldShowRegulation18Note(inspection) {
  return ["103", "105"].includes(String(inspection.equiptypeid || ""))
}

function shouldShowDrivenMachineryItemsNote(inspection) {
  return DRIVEN_MACHINERY_ITEMS_EQUIPTYPE_IDS.has(String(inspection.equiptypeid || ""))
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

function renderBulkCertificateHtml(certificate, imageDataUrlCache = null) {
  const inspection = certificate.inspection || {}
  const results = getCertificateResultsForDisplay(certificate.results || [], inspection)
  const photos = getCertificatePhotosForHtml(inspection, certificate.photos || []).slice(0, 4)
  const headerUrl = fileUrlIfExists(path.join(__dirname, "..", "frontend", "public", "header.jpg"))
  const footerUrl = fileUrlIfExists(path.join(__dirname, "..", "frontend", "public", "footer.jpg"))
  const signatureUrl = uploadPathToFileUrl(inspection.inspector_signature_image)
  const assetDetails = certificateAssetDetails(inspection)
  const regulationNotes = getCertificateRegulationNotes(inspection)

  return `
    <section class="bulk-certificate-page">
      <div class="fb-cert-page">
        ${headerUrl ? `<img src="${headerUrl}" class="fb-cert-header" alt="FB Cranes Header">` : ""}

        <div class="fb-cert-title">
          <h1 style="color:#1f2937 !important; -webkit-text-fill-color:#1f2937 !important;">${htmlEscape(getCertificateTitle(inspection))}</h1>
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

        ${footerUrl ? `<img src="${footerUrl}" class="fb-cert-footer" alt="FB Cranes Footer">` : ""}
      </div>
    </section>
  `
}

function renderBulkCertificatesHtmlDocument(certificates, imageDataUrlCache = null) {
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
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            padding: 6mm;
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
            min-height: 285mm;
            display: block;
            font-size: 9.5px;
            line-height: 1.08;
            overflow: visible;
            transform: none;
            transform-origin: top left;
          }
          .fb-cert-header,
          .fb-cert-footer {
            width: 100%;
            display: block;
            height: auto;
            object-fit: contain;
          }
          .fb-cert-header {
            margin-bottom: 3px;
            max-height: 32mm;
            object-position: center top;
          }
          .fb-cert-footer {
            margin-top: 4px;
            max-height: 22mm;
            object-position: center bottom;
          }
          .fb-cert-title h1 {
            text-align: center;
            text-transform: uppercase;
            font-size: 18px;
            letter-spacing: 0.5px;
            margin: 2px 0 3px;
            color: #1f2937;
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
            min-height: 95px;
          }
          .fb-cert-photo-grid img {
            max-width: 100%;
            max-height: 105px;
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
            font-size: 8.8px;
            line-height: 1.02;
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
            page-break-inside: avoid;
            break-inside: avoid;
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
            page-break-inside: avoid;
            break-inside: avoid;
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
        ${certificates.map(certificate => renderBulkCertificateHtml(certificate, imageDataUrlCache)).join("")}
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

  try {
    const imageDataUrlCache = await buildCertificatePdfImageCache(certificates)
    const page = await browser.newPage()
    page.setDefaultTimeout(120000)
    page.setDefaultNavigationTimeout(120000)
    await page.setContent(renderBulkCertificatesHtmlDocument(certificates, imageDataUrlCache), {
      waitUntil: "load",
      timeout: 120000
    })

    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0"
      }
    })
  } finally {
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
  return String(inspection.equiptypeid || "") === "102"
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
  return createBulkCertificatesPdfBuffer([certificate])
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

app.get("/inspections/:testid/certificate.pdf", async (req, res) => {
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

    const pdfBuffer = await createCertificatePdfBuffer(certificate)

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

app.post("/certificates/:testid/email", async (req, res) => {
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
    console.error("Certificate email error:", err)
    res.status(500).json({ error: getMailErrorMessage(err) })
  }
})

app.post("/admin/email-test", async (req, res) => {
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
    console.error("Email test error:", err)
    res.status(500).json({ error: getMailErrorMessage(err) })
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
    activity: String(body.activity || "").trim(),
    hazard: String(body.hazard || "").trim(),
    consequence: String(body.consequence || "").trim() || null,
    initial_severity: initialSeverity,
    initial_likelihood: initialLikelihood,
    initial_rating: riskRating(initialSeverity, initialLikelihood),
    controls: String(body.controls || "").trim() || null,
    residual_severity: residualSeverity,
    residual_likelihood: residualLikelihood,
    residual_rating: riskRating(residualSeverity, residualLikelihood),
    action_required: String(body.action_required || "").trim() || null,
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

app.get("/she/risk-assessments.pdf", async (req, res) => {
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
      ["ID", 34],
      ["Date", 58],
      ["Asset", 86],
      ["Activity", 120],
      ["Hazard", 145],
      ["Initial", 48],
      ["Residual", 54],
      ["Status", 72],
      ["Due", 58],
      ["Responsible", 92]
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
        row.assettagno || row.assetid || "-",
        row.activity || "",
        row.hazard || "",
        row.initial_rating || "-",
        row.residual_rating || "-",
        String(row.status || "").replaceAll("_", " "),
        reportDate(row.due_date),
        row.responsible_person || ""
      ].map(reportValue)

      const rowHeight = Math.max(
        18,
        doc.heightOfString(values[3], { width: columns[3][1] - 6 }) + 8,
        doc.heightOfString(values[4], { width: columns[4][1] - 6 }) + 8
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
          .font(index === 5 || index === 6 ? "Helvetica-Bold" : "Helvetica")
          .fillColor(Number(values[index]) >= 15 ? "#d00000" : "#111827")
          .text(values[index], x + 3, y + 4, { width: width - 6 })
        x += width
      })

      y += rowHeight
    })

    doc.end()
  } catch (err) {
    console.error("Risk assessment PDF error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/she/risk-assessments.xlsx", async (req, res) => {
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
      { header: "Customer", key: "clientname", width: 24 },
      { header: "Site", key: "sitename", width: 22 },
      { header: "Section", key: "sectionname", width: 22 },
      { header: "Asset", key: "asset", width: 22 },
      { header: "Activity", key: "activity", width: 34 },
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
      { header: "Responsible Person", key: "responsible_person", width: 24 },
      { header: "Due Date", key: "due_date", width: 16 },
      { header: "Status", key: "status", width: 16 },
      { header: "Created By", key: "created_by_name", width: 22 }
    ]

    rows.forEach(row => {
      sheet.addRow({
        ...row,
        assessment_date: reportDate(row.assessment_date),
        asset: row.assettagno || row.assetid || "",
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
    sheet.autoFilter = { from: "A1", to: "U1" }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)

    await workbook.xlsx.write(res)
    res.end()
  } catch (err) {
    console.error("Risk assessment Excel error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
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
        assetid, clientid, siteid, sectionid, assessment_date,
        activity, hazard, consequence,
        initial_severity, initial_likelihood, initial_rating,
        controls, residual_severity, residual_likelihood, residual_rating,
        action_required, responsible_person, due_date, status,
        created_by_user_id
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,$15,
        $16,$17,$18,$19,
        $20
      )
      RETURNING *
      `,
      [
        payload.assetid,
        payload.clientid,
        payload.siteid,
        payload.sectionid,
        payload.assessment_date,
        payload.activity,
        payload.hazard,
        payload.consequence,
        payload.initial_severity,
        payload.initial_likelihood,
        payload.initial_rating,
        payload.controls,
        payload.residual_severity,
        payload.residual_likelihood,
        payload.residual_rating,
        payload.action_required,
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
        activity = $6,
        hazard = $7,
        consequence = $8,
        initial_severity = $9,
        initial_likelihood = $10,
        initial_rating = $11,
        controls = $12,
        residual_severity = $13,
        residual_likelihood = $14,
        residual_rating = $15,
        action_required = $16,
        responsible_person = $17,
        due_date = $18,
        status = $19,
        updated_at = now()
      WHERE riskid = $20
      RETURNING *
      `,
      [
        payload.assetid,
        payload.clientid,
        payload.siteid,
        payload.sectionid,
        payload.assessment_date,
        payload.activity,
        payload.hazard,
        payload.consequence,
        payload.initial_severity,
        payload.initial_likelihood,
        payload.initial_rating,
        payload.controls,
        payload.residual_severity,
        payload.residual_likelihood,
        payload.residual_rating,
        payload.action_required,
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

async function getCustomerDetailedReport(filters = {}) {
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

  const assetResult = await pool.query(
    `
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
    ORDER BY latestinspectiondate DESC NULLS LAST, c.clientname, s.sitename, sec.sectionname, a.assetid
    `,
    values
  )

  const assets = assetResult.rows
  const activeAssets = assets.filter(row => row.archived !== true)
  const statusCounts = activeAssets.reduce((counts, row) => {
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
      assets: assets.length,
      activeAssets: activeAssets.length,
      archivedAssets: assets.length - activeAssets.length,
      safeAssets: activeAssets.filter(row => row.reportstatus === "OK").length,
      notSafeAssets: activeAssets.filter(row => row.reportstatus === "NOT SAFE").length,
      visualOverdueAssets: activeAssets.filter(row => row.reportstatus === "VISUAL OVERDUE").length,
      loadOverdueAssets: activeAssets.filter(row => row.reportstatus === "LOAD TEST OVERDUE").length,
      noVisualAssets: activeAssets.filter(row => row.reportstatus === "NO VISUAL").length,
      noLoadAssets: activeAssets.filter(row => row.reportstatus === "NO LOAD TEST").length,
      statusCounts
    }
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

app.get("/reports/customer-detailed", async (req, res) => {
  try {
    const report = await getCustomerDetailedReport(customerScopedReportFilters(req))
    res.json(report)
  } catch (err) {
    console.error("Customer detailed report error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/reports/customer-detailed.pdf", async (req, res) => {
  try {
    const report = await getCustomerDetailedReport(customerScopedReportFilters(req))
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
    console.error("Customer detailed PDF error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/reports/customer-detailed.xlsx", async (req, res) => {
  try {
    const report = await getCustomerDetailedReport(customerScopedReportFilters(req))
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
    console.error("Customer detailed Excel error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/dashboard/stats", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM atec.tblclients) AS customers,
        (SELECT COUNT(*) FROM atec.tblsites) AS sites,
        (SELECT COUNT(*) FROM atec.tblasset WHERE COALESCE(archived,false)=false) AS assets,
        (SELECT COUNT(*) FROM atec.tblequiptype) AS equipmenttypes,
        (SELECT COUNT(*) FROM atec.tblinspection) AS certificates,
        (SELECT COUNT(*) FROM atec.tblinspection WHERE status = 'NOT SAFE') AS failedtotal,

        (
          SELECT COUNT(*)
          FROM atec.tblasset a
          LEFT JOIN (
            SELECT assetid, MAX(testdate) AS lastvisual
            FROM atec.tblinspection
            WHERE inspectiontype = 'VISUAL'
            GROUP BY assetid
          ) i ON a.assetid = i.assetid
          WHERE COALESCE(a.archived,false)=false
          AND (
            i.lastvisual IS NULL
            OR i.lastvisual + INTERVAL '3 months' <= CURRENT_DATE + INTERVAL '30 days'
          )
        ) AS visualdue,

        (
          SELECT COUNT(*)
          FROM atec.tblasset a
          LEFT JOIN (
            SELECT assetid, MAX(testdate) AS lastloadtest
            FROM atec.tblinspection
            WHERE inspectiontype = 'LOADTEST'
            GROUP BY assetid
          ) i ON a.assetid = i.assetid
          WHERE COALESCE(a.archived,false)=false
          AND (
            i.lastloadtest IS NULL
            OR i.lastloadtest + INTERVAL '12 months' <= CURRENT_DATE + INTERVAL '30 days'
          )
        ) AS loadtestdue,

        (
          SELECT COUNT(*)
          FROM atec.tblasset a
          LEFT JOIN (
            SELECT assetid, MAX(testdate) AS lastvisual
            FROM atec.tblinspection
            WHERE inspectiontype = 'VISUAL'
            GROUP BY assetid
          ) v ON a.assetid = v.assetid
          LEFT JOIN (
            SELECT assetid, MAX(testdate) AS lastloadtest
            FROM atec.tblinspection
            WHERE inspectiontype = 'LOADTEST'
            GROUP BY assetid
          ) l ON a.assetid = l.assetid
          WHERE COALESCE(a.archived,false)=false
          AND (
            v.lastvisual + INTERVAL '3 months' < CURRENT_DATE
            OR l.lastloadtest + INTERVAL '12 months' < CURRENT_DATE
          )
        ) AS overdue
    `)

    res.json(result.rows[0])

  } catch (err) {
    console.error("Dashboard stats error:", err)
    res.status(500).json({ error: "An unexpected server error occurred" })
  }
})

app.get("/dashboard/attention", async (req, res) => {
  try {
    const result = await pool.query(`
      WITH last_visual AS (
        SELECT assetid, MAX(testdate) AS lastvisual
        FROM atec.tblinspection
        WHERE inspectiontype = 'VISUAL'
        GROUP BY assetid
      ),
      last_load AS (
        SELECT assetid, MAX(testdate) AS lastload
        FROM atec.tblinspection
        WHERE inspectiontype = 'LOADTEST'
        GROUP BY assetid
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

      FROM atec.tblasset a
      LEFT JOIN atec.tblclients c ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s ON a.siteid = s.siteid
      LEFT JOIN atec.tblequiptype e ON a.equiptypeid = e.equiptypeid      
      LEFT JOIN last_visual lv ON a.assetid = lv.assetid
      LEFT JOIN last_load ll ON a.assetid = ll.assetid
      WHERE COALESCE(a.archived,false)=false
      AND (
        lv.lastvisual IS NULL
        OR lv.lastvisual < CURRENT_DATE - INTERVAL '3 months'
        OR ll.lastload IS NULL
        OR ll.lastload < CURRENT_DATE - INTERVAL '12 months'
      )
      ORDER BY daysoverdue DESC NULLS LAST, a.assetid DESC
      LIMIT 50
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Dashboard attention error:", err);
    res.status(500).json({ error: "Failed to load dashboard attention items" });
  }
});

app.get("/dashboard/failed-equipment", async (req, res) => {
  try {
    const result = await pool.query(`
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
      FROM atec.tblinspection i
      JOIN atec.tblasset a
        ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c
        ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s
        ON a.siteid = s.siteid
      LEFT JOIN atec.tblequiptype e ON a.equiptypeid = e.equiptypeid
      WHERE i.status = 'NOT SAFE'
      ORDER BY i.testdate DESC
      LIMIT 20
    `)

    res.json(result.rows)
  } catch (err) {
    console.error("Dashboard failed equipment error:", err)
    res.status(500).json({
      error: "Failed to load failed equipment"
    })
  }
})

app.get("/dashboard/upcoming-expiries", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (a.assetid)
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
      FROM atec.tblinspection i
      JOIN atec.tblasset a
        ON i.assetid = a.assetid
      LEFT JOIN atec.tblclients c
        ON a.clientid = c.clientid
      LEFT JOIN atec.tblsites s
        ON a.siteid = s.siteid
      LEFT JOIN atec.tblequiptype et
        ON a.equiptypeid = et.equiptypeid
      WHERE
        i.validdate IS NOT NULL
        AND i.validdate <= CURRENT_DATE + INTERVAL '90 days'
      ORDER BY
        a.assetid,
        i.validdate DESC
    `)

    res.json(result.rows)

  } catch (err) {
    console.error("Dashboard upcoming expiries:", err)
    res.status(500).json({
      error: "Failed to load upcoming expiries"
    })
  }
})

app.get("/dashboard/alerts", async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT
      (
        SELECT COUNT(*)
        FROM atec.tblinspection
        WHERE status='NOT SAFE'
      ) AS failed,

      (
        SELECT COUNT(*)
        FROM atec.tblinspection
        WHERE validdate IS NOT NULL
        AND validdate BETWEEN CURRENT_DATE
        AND CURRENT_DATE + INTERVAL '30 days'
      ) AS expiring,

      (
        SELECT COUNT(*)
        FROM atec.tblasset a
        LEFT JOIN (
          SELECT
            assetid,
            MAX(validdate) AS validdate
          FROM atec.tblinspection
          GROUP BY assetid
        ) i
          ON a.assetid=i.assetid
        WHERE
          COALESCE(a.archived,false)=false
          AND (
            i.validdate IS NULL
            OR i.validdate<CURRENT_DATE
          )
      ) AS overdue
    `)

    res.json(result.rows[0])

  } catch (err) {

    console.error(err)

    res.status(500).json({
      error: "An unexpected server error occurred"
    })

  }
})

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`ATEC server running on port ${PORT}`);
});

