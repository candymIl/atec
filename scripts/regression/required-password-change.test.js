const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const express = require("../../backend/node_modules/express")
const cookieParser = require("../../backend/node_modules/cookie-parser")
const bcrypt = require("../../backend/node_modules/bcryptjs")
const jwt = require("../../backend/node_modules/jsonwebtoken")
const { createCurrentAuth, createChangePasswordHandler } = require("../../backend/middleware/passwordChange")
const { asyncRoute, signAuthToken, createCsrfProtection } = require("../../backend/middleware/security")

// Real HTTP, JWT and bcrypt; deterministic database double. The separate DB test verifies SQL/trigger semantics.
async function main() {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex")
  const oldPassword = "Old test password 123!"
  const users = new Map()
  const hash = await bcrypt.hash(oldPassword, 4)
  const roles = ["ADMIN", "MANAGER", "INSPECTOR", "ASSISTANT", "HR", "VIEWER", "CUSTOMER"]
  roles.forEach((role, index) => users.set(index + 1, {
    user_id: index + 1, role, username: `fixture-${index}`, is_active: true,
    must_change_password: role !== "CUSTOMER", auth_version: 0, password_hash: hash
  }))
  const audit = []
  let conflict = false
  let unavailable = false
  const pool = { async query(sql, params) {
    if (unavailable) throw new Error("Database unavailable")
    if (sql.startsWith("UPDATE")) {
      const user = users.get(params[1])
      if (conflict || !user?.is_active || user.password_hash !== params[2] || user.auth_version !== params[3]) return { rows: [] }
      user.password_hash = params[0]
      user.must_change_password = false
      if (user.role !== "CUSTOMER") user.auth_version++
      return { rows: [{ auth_version: user.auth_version }] }
    }
    const user = users.get(params[0])
    return { rows: user ? [{ ...user }] : [] }
  } }
  const app = express()
  app.use(express.json(), cookieParser())
  const auth = createCurrentAuth(pool)
  app.use((req, res, next) => { req.logAudit = async (...args) => audit.push(args); next() })
  app.use("/uploads", auth, (req, res) => res.json({ uploaded: true }))
  app.use(auth)
  app.use(createCsrfProtection("https://atec.test"))
  app.get("/auth/me", (req, res) => res.json({ user: req.user }))
  app.post("/auth/logout", (req, res) => res.json({ success: true }))
  app.post("/users/me/password", asyncRoute(createChangePasswordHandler(pool)))
  app.use((req, res) => res.json({ work: true }))
  app.use((error, req, res, next) => res.status(503).json({ error: "Unavailable" }))
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const tokenFor = id => signAuthToken(users.get(id))
  async function request(route, token, body, extra = {}) {
    return fetch(`${base}${route}`, {
      method: body ? "POST" : "GET", ...extra,
      headers: { ...(token ? { Cookie: `atec_session=${token}` } : {}), Origin: "https://atec.test", "Content-Type": "application/json", ...extra.headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
  }
  try {
    assert.equal((await request("/assets")).status, 401)
    for (let id = 1; id <= 6; id++) {
      const token = tokenFor(id)
      for (const route of ["/assets", "/users/me", "/uploads/photo.jpg", "/uploads/auth/me", "/admin/system-info"]) {
        const response = await request(route, token)
        assert.equal(response.status, 403, `${users.get(id).role} must be blocked at ${route}`)
        assert.equal((await response.json()).code, "PASSWORD_CHANGE_REQUIRED")
      }
      assert.equal((await request("/auth/me", token)).status, 200)
      assert.equal((await request("/auth/logout", token, {})).status, 200)
      assert.equal((await request("/users/me/password", token)).status, 403)
      assert.equal((await request("/auth/me", token, {})).status, 403)
    }
    const staffToken = tokenFor(1)
    const oldClaim = jwt.sign({ user_id: 1, role: "ADMIN" }, process.env.JWT_SECRET)
    assert.equal((await request("/assets", oldClaim)).status, 403, "Legacy staff session must not bypass the gate")
    const customer = tokenFor(7)
    users.get(7).must_change_password = true // Accidental flag must not enrol a customer.
    assert.equal((await request("/assets", customer)).status, 200)
    assert.equal((await (await request("/auth/me", customer)).json()).user.must_change_password, false)
    assert.equal((await request("/assets", jwt.sign({ user_id: 7, role: "CUSTOMER" }, process.env.JWT_SECRET))).status, 200)
    assert.equal((await request("/assets", null, null, { headers: { Authorization: `Bearer ${staffToken}` } })).status, 403)
    const change = (current_password, new_password, extra) => request("/users/me/password", staffToken, { current_password, new_password }, extra)
    assert.equal((await change(oldPassword, "short")).status, 400)
    assert.equal((await change("incorrect", "New valid password!1")).status, 400)
    assert.equal((await change(oldPassword, oldPassword)).status, 400)
    assert.equal((await change(oldPassword, "é".repeat(37))).status, 400)
    assert.equal((await change(oldPassword, "New valid password!1", { headers: { Origin: "https://other.test" } })).status, 403)
    assert.equal(users.get(1).must_change_password, true)
    conflict = true
    assert.equal((await change(oldPassword, "New valid password!1")).status, 409)
    conflict = false
    const changed = await change(oldPassword, "New valid password!1")
    assert.equal(changed.status, 200)
    const cookie = changed.headers.get("set-cookie").split(";")[0].split("=").slice(1).join("=")
    assert.equal((await changed.json()).user.must_change_password, false)
    assert.equal(audit.length, 1)
    assert.equal(audit[0][0], "PASSWORD_CHANGE")
    assert.equal(await bcrypt.compare(oldPassword, users.get(1).password_hash), false)
    assert.equal(await bcrypt.compare("New valid password!1", users.get(1).password_hash), true)
    assert.equal((await request("/assets", cookie)).status, 200)
    assert.equal((await request("/assets", staffToken)).status, 401, "Other sessions must be revoked")
    assert.equal((await request("/auth/me", oldClaim)).status, 401)
    const beforeActivation = tokenFor(2)
    users.get(2).auth_version++
    assert.equal((await request("/auth/me", beforeActivation)).status, 401, "Activation revokes already-open sessions")
    assert.equal((await request("/assets", tokenFor(2))).status, 403)
    users.get(3).is_active = false
    assert.equal((await request("/auth/me", tokenFor(3))).status, 401)
    unavailable = true
    assert.equal((await request("/assets", cookie)).status, 503, "Database failure must fail closed")
    console.log("Required password change HTTP tests passed: six staff roles, customer exclusion, bypass denial, validation, CSRF, concurrent update, session revocation and database failure.")
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
