const jwt = require("jsonwebtoken")
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const ROLE_ACCESS = {
  ADMIN: ["ADMIN", "MANAGER", "INSPECTOR", "VIEWER", "CUSTOMER"],
  MANAGER: ["MANAGER", "INSPECTOR", "VIEWER", "CUSTOMER"],
  INSPECTOR: ["INSPECTOR"],
  VIEWER: ["VIEWER"],
  CUSTOMER: ["CUSTOMER"]
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET

  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters long")
  }

  return secret
}

function publicUser(user) {
  if (!user) return null

  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    lmi_number: user.lmi_number,
    signature_image: user.signature_image,
    clientid: user.clientid,
    siteid: user.siteid,
    sectionid: user.sectionid,
    is_active: user.is_active
  }
}

function signAuthToken(user) {
  return jwt.sign(publicUser(user), getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h"
  })
}

function durationToMs(value, fallbackMs) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  const match = String(value || "").trim().match(/^(\d+)(ms|s|m|h|d)?$/i)
  if (!match) return fallbackMs

  const amount = Number(match[1])
  const unit = (match[2] || "ms").toLowerCase()
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  }

  return amount * multipliers[unit]
}

function authCookieOptions() {
  const maxAge = durationToMs(process.env.JWT_EXPIRES_IN || "8h", 8 * 60 * 60 * 1000)

  return {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAME_SITE || "lax",
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    path: process.env.COOKIE_PATH || (process.env.NODE_ENV === "production" ? "/atec" : "/"),
    maxAge
  }
}

function allowedOriginsFromConfig(value) {
  return String(value || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)
}

function originFromReferer(referer) {
  if (!referer) return null

  try {
    return new URL(referer).origin
  } catch (err) {
    return "invalid"
  }
}

function createCsrfProtection(allowedOrigins) {
  const allowed = new Set(allowedOriginsFromConfig(allowedOrigins))
  const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"])

  return function csrfProtection(req, res, next) {
    if (!mutatingMethods.has(req.method)) {
      return next()
    }

    const origin = req.get("origin")
    const refererOrigin = origin ? null : originFromReferer(req.get("referer"))
    const requestOrigin = origin || refererOrigin

    if (!requestOrigin || !allowed.has(requestOrigin)) {
      return res.status(403).json({ error: "Request origin is not allowed" })
    }

    return next()
  }
}

function validatePassword(password) {
  if (typeof password !== "string" || password.trim().length === 0) {
    return {
      valid: false,
      message: "Password must not be blank and must be at least 8 characters"
    }
  }

  if (password.length < 8) {
    return {
      valid: false,
      message: "Password must be at least 8 characters"
    }
  }

  return { valid: true, message: "" }
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/(password|db_password|jwt_secret|smtp_pass|secret|token)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
}

function logSafeError(context, err) {
  const referenceId = crypto.randomUUID()
  console.error(`${context} failed`, {
    referenceId,
    message: redactSensitiveText(err?.message || "Unknown error"),
    code: err?.code,
    table: err?.table,
    column: err?.column,
    constraint: err?.constraint
  })
  return referenceId
}

function requireAuth(req, res, next) {
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null
  const token = req.cookies?.atec_session || headerToken

  if (!token) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    req.user = jwt.verify(token, getJwtSecret())
    return next()
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please log in again." })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" })
    }

    if (req.user.role === "ADMIN" || roles.includes(req.user.role)) {
      return next()
    }

    return res.status(403).json({ error: "Access denied" })
  }
}

function canAccess(userRole, allowedRoles) {
  return userRole === "ADMIN" || allowedRoles.includes(userRole)
}

function auditLogger(pool) {
  return async function logAudit(req, action, module, recordId = null, details = null) {
    try {
      await pool.query(
        `
        INSERT INTO atec.audit_log
          (user_id, action, module, record_id, ip_address, details)
        VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet, $6)
        `,
        [
          req.user?.user_id || null,
          action,
          module,
          recordId === null || recordId === undefined ? null : String(recordId),
          req.ip || null,
          details ? JSON.stringify(details) : null
        ]
      )
    } catch (err) {
      console.error("Audit log failed", err.message)
    }
  }
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next)
    } catch (err) {
      next(err)
    }
  }
}

function errorHandler(err, req, res, next) {
  const referenceId = logSafeError("Request", err)

  if (res.headersSent) {
    return next(err)
  }

  if (err?.name === "MulterError") {
    const uploadMessages = {
      LIMIT_FILE_SIZE: "The selected photo is too large. Please upload a JPG, PNG or WebP photo up to 15 MB.",
      LIMIT_FILE_COUNT: "Too many photos selected.",
      LIMIT_UNEXPECTED_FILE: "Unexpected upload field. Please choose the asset photo fields shown on the form."
    }

    return res.status(400).json({
      error: uploadMessages[err.code] || "Photo upload failed. Please check the selected image files."
    })
  }

  const status = err.statusCode || err.status || 500
  const message = status >= 500
    ? "An unexpected server error occurred"
    : err.message

  return res.status(status).json(status >= 500 ? { error: message, referenceId } : { error: message })
}

function isSafeUpload(file) {
  const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])
  const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"])
  const extension = path.extname(file.originalname || "").toLowerCase()

  return allowedMimeTypes.has(file.mimetype) && allowedExtensions.has(extension)
}

function sanitizeFilename(name) {
  const extension = path.extname(name || "").toLowerCase()
  const baseName = path
    .basename(name || "upload", extension)
    .replace(/[^a-z0-9_-]/gi, "-")
    .slice(0, 60)

  return `${crypto.randomUUID()}-${baseName || "upload"}${extension}`
}

function isRealImageFile(filePath) {
  const header = Buffer.alloc(16)
  const fd = fs.openSync(filePath, "r")

  try {
    fs.readSync(fd, header, 0, header.length, 0)
  } finally {
    fs.closeSync(fd)
  }

  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
  const isPng =
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  const isWebp =
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP"

  return isJpeg || isPng || isWebp
}

function flattenUploadedFiles(req) {
  if (req.file) return [req.file]
  if (!req.files) return []
  if (Array.isArray(req.files)) return req.files

  return Object.values(req.files).flat()
}

function validateUploadedImages(req, res, next) {
  const files = flattenUploadedFiles(req)

  for (const file of files) {
    try {
      if (!file?.path || !isRealImageFile(file.path)) {
        files.forEach(uploadedFile => {
          if (uploadedFile?.path) {
            fs.unlink(uploadedFile.path, () => {})
          }
        })

        return res.status(400).json({
          error: "Only valid JPG, PNG and WebP images are allowed"
        })
      }
    } catch (err) {
      files.forEach(uploadedFile => {
        if (uploadedFile?.path) {
          fs.unlink(uploadedFile.path, () => {})
        }
      })

      return next(err)
    }
  }

  return next()
}

module.exports = {
  ROLE_ACCESS,
  asyncRoute,
  auditLogger,
  authCookieOptions,
  canAccess,
  createCsrfProtection,
  durationToMs,
  errorHandler,
  isSafeUpload,
  logSafeError,
  publicUser,
  redactSensitiveText,
  requireAuth,
  requireRole,
  sanitizeFilename,
  signAuthToken,
  validatePassword,
  validateUploadedImages
}
