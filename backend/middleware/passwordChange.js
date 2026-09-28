const { requireAuth: verifyToken, publicUser, signAuthToken, authCookieOptions, validatePassword } = require("./security")
const bcrypt = require("bcryptjs")

const INTERNAL_ROLES = new Set(["ADMIN", "MANAGER", "INSPECTOR", "ASSISTANT", "HR", "VIEWER"])
const USER_AUTH_SELECT = `SELECT userid AS user_id, username, email,
  COALESCE(NULLIF(fullname, ''), username) AS full_name,
  COALESCE(role, CASE userlevel WHEN 1 THEN 'ADMIN' WHEN 2 THEN 'MANAGER'
    WHEN 3 THEN 'INSPECTOR' WHEN 5 THEN 'CUSTOMER' ELSE 'VIEWER' END) AS role,
  lmi_no AS lmi_number, usersignature AS signature_image, clientid, siteid, sectionid,
  is_active, must_change_password, auth_version FROM atec.tblusers WHERE userid = $1`

// Check the database on every protected request: JWT claims alone cannot revoke a session.
function createCurrentAuth(pool) {
  return function requireCurrentAuth(req, res, next) {
    return verifyToken(req, res, async () => {
      try {
        const claims = req.user
        const { rows } = await pool.query(USER_AUTH_SELECT, [claims.user_id])
        const user = rows[0]
        if (!user?.is_active || Number(claims.auth_version || 0) !== Number(user.auth_version)) {
          return res.status(401).json({ error: "Session expired. Please log in again." })
        }
        req.user = publicUser(user)
        req.user.must_change_password = INTERNAL_ROLES.has(user.role) && user.must_change_password === true
        const route = `${req.baseUrl || ""}${req.path}`.replace(/\/+$/, "").toLowerCase()
        const permitted = (req.method === "GET" && route === "/auth/me") ||
          (req.method === "POST" && ["/auth/logout", "/users/me/password"].includes(route))
        if (req.user.must_change_password && !permitted) {
          return res.status(403).json({ code: "PASSWORD_CHANGE_REQUIRED", error: "Change your password before continuing." })
        }
        return next()
      } catch (error) {
        return next(error)
      }
    })
  }
}

function createChangePasswordHandler(pool) {
  return async function changePassword(req, res) {
    const currentPassword = String(req.body?.current_password || "")
    const newPassword = String(req.body?.new_password || "")
    if (!currentPassword) return res.status(400).json({ error: "Enter your current password" })
    const validation = validatePassword(newPassword)
    if (!validation.valid) return res.status(400).json({ error: validation.message })
    // bcrypt only considers the first 72 bytes. Reject truncation rather than silently accepting it.
    if (Buffer.byteLength(newPassword, "utf8") > 72) {
      return res.status(400).json({ error: "New password is too long. Use no more than 72 UTF-8 bytes." })
    }
    const { rows } = await pool.query(
      "SELECT password AS password_hash, auth_version FROM atec.tblusers WHERE userid = $1 AND is_active = TRUE",
      [req.user.user_id]
    )
    const existing = rows[0]
    if (!existing || Number(existing.auth_version) !== Number(req.user.auth_version)) {
      return res.status(401).json({ error: "Session expired. Please log in again." })
    }
    if (!await bcrypt.compare(currentPassword, existing.password_hash)) {
      return res.status(400).json({ error: "Current password is incorrect" })
    }
    if (await bcrypt.compare(newPassword, existing.password_hash)) {
      return res.status(400).json({ error: "New password must be different from your current password" })
    }
    const passwordHash = await bcrypt.hash(newPassword, 12)
    // Compare-and-set prevents an older concurrent request overwriting a completed reset.
    const changed = await pool.query(`UPDATE atec.tblusers
      SET password = $1, must_change_password = FALSE, updated_at = now()
      WHERE userid = $2 AND password = $3 AND auth_version = $4 AND is_active = TRUE
      RETURNING auth_version`, [passwordHash, req.user.user_id, existing.password_hash, existing.auth_version])
    if (!changed.rows.length) {
      return res.status(409).json({ error: "Your account changed during this request. Please log in again." })
    }
    req.user = { ...req.user, must_change_password: false, auth_version: changed.rows[0].auth_version }
    await req.logAudit("PASSWORD_CHANGE", "users", req.user.user_id)
    res.cookie("atec_session", signAuthToken(req.user), authCookieOptions())
    return res.json({ success: true, user: publicUser(req.user) })
  }
}

module.exports = { createCurrentAuth, createChangePasswordHandler }
