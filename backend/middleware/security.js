const jwt = require("jsonwebtoken")
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

function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
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
  console.error(err)

  if (res.headersSent) {
    return next(err)
  }

  const status = err.statusCode || err.status || 500
  const message = status >= 500
    ? "An unexpected server error occurred"
    : err.message

  return res.status(status).json({ error: message })
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

  return `${Date.now()}-${baseName}${extension}`
}

module.exports = {
  ROLE_ACCESS,
  asyncRoute,
  auditLogger,
  authCookieOptions,
  canAccess,
  errorHandler,
  isSafeUpload,
  publicUser,
  requireAuth,
  requireRole,
  sanitizeFilename,
  signAuthToken
}
