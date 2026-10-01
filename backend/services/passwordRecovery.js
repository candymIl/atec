const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { validatePassword } = require('../middleware/security')

const MESSAGE = 'If an active account has that email address, a password reset link will be sent. Please check your inbox and spam folder.'
const INVALID = 'This reset link is invalid or expired. Request a new link.'
const digest = token => crypto.createHash('sha256').update(token).digest('hex')

function createPasswordRecovery({ pool, sendEmail, appUrl, reportFailure = () => {} }) {
  const url = new URL(appUrl)
  url.search = ''
  url.hash = ''

  async function request(req, res) {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Enter a valid email address.' })
    }
    // Return before delivery for consistent account-independent response timing.
    res.json({ message: MESSAGE })
    try {
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Password recovery requires a trusted HTTPS PUBLIC_APP_URL')
      const token = crypto.randomBytes(32).toString('hex')
      const hash = digest(token)
      const result = await pool.query(`UPDATE atec.tblusers SET
        password_reset_hash = $1, password_reset_expires_at = now() + interval '30 minutes',
        password_reset_requested_at = now(), password_reset_auth_version = auth_version,
        password_reset_email = email
        WHERE LOWER(email) = $2 AND is_active = TRUE
          AND (SELECT count(*) FROM atec.tblusers WHERE LOWER(email) = $2) = 1
          AND (password_reset_requested_at IS NULL OR password_reset_requested_at < now() - interval '5 minutes')
        RETURNING userid, email`, [hash, email])
      const user = result.rows[0]
      if (!user) return
      // A fragment keeps the secret out of HTTP access logs and Referer headers.
      const link = new URL(url)
      link.hash = `reset-password=${token}`
      try {
        await sendEmail({ to: user.email, subject: 'Reset your ATEC password',
          text: `A password reset was requested for your ATEC account.\n\nChoose your new password using this single-use link, valid for 30 minutes:\n${link.href}\n\nIf you did not request this, ignore this email. Your password has not changed.` })
      } catch (error) {
        await pool.query(`UPDATE atec.tblusers SET password_reset_hash = NULL,
          password_reset_expires_at = NULL, password_reset_requested_at = NULL
          WHERE userid = $1 AND password_reset_hash = $2`, [user.userid, hash])
        throw error
      }
    } catch (error) {
      // Do not log provider errors: they can include the email body and secret link.
      reportFailure('PASSWORD_RECOVERY_DELIVERY_FAILED')
    }
  }

  async function reset(req, res) {
    const token = String(req.body?.token || '')
    const password = String(req.body?.password || '')
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: INVALID })
    const validation = validatePassword(password)
    if (!validation.valid) return res.status(400).json({ error: validation.message })
    if (Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Use no more than 72 UTF-8 bytes for your password.' })
    if (password !== req.body?.confirmation) return res.status(400).json({ error: 'The passwords do not match.' })
    const hash = await bcrypt.hash(password, 12)
    // One atomic update consumes the token, rejects races, revokes every role's sessions,
    // and invalidates links issued before another password or email change.
    const result = await pool.query(`UPDATE atec.tblusers SET password = $1,
      must_change_password = FALSE, auth_version = auth_version + 1, updated_at = now(),
      password_reset_hash = NULL, password_reset_expires_at = NULL,
      password_reset_auth_version = NULL, password_reset_email = NULL
      WHERE password_reset_hash = $2 AND password_reset_expires_at > now()
        AND password_reset_auth_version = auth_version AND password_reset_email = email
        AND is_active = TRUE RETURNING userid, email`, [hash, digest(token)])
    const user = result.rows[0]
    if (!user) return res.status(400).json({ error: INVALID })
    await req.logAudit('PASSWORD_RECOVERY_COMPLETED', 'users', user.userid)
    res.clearCookie('atec_session', { path: '/' })
    res.json({ message: 'Your password has been changed. Sign in with your new password.' })
    try {
      await sendEmail({ to: user.email, subject: 'Your ATEC password has changed',
        text: 'Your ATEC password was changed using an email recovery link. All previous sessions have been ended. If you did not make this change, contact your ATEC administrator immediately.' })
    } catch (error) { reportFailure('PASSWORD_RECOVERY_NOTICE_FAILED') }
  }
  return { request, reset }
}

module.exports = { createPasswordRecovery, digest, MESSAGE, INVALID }
