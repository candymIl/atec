const assert = require("assert")
const fs = require("fs")
const path = require("path")
const rateLimit = require("../../backend/node_modules/express-rate-limit")

const {
  authCookieOptions,
  createCsrfProtection,
  durationToMs,
  logSafeError,
  sanitizeFilename,
  validatePassword
} = require("../../backend/middleware/security")

function mockReq({ method = "GET", origin, referer } = {}) {
  return {
    method,
    get(name) {
      const key = String(name).toLowerCase()
      if (key === "origin") return origin
      if (key === "referer") return referer
      return undefined
    }
  }
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    }
  }
}

function runCsrf(middleware, req) {
  const res = mockRes()
  let nextCalled = false
  middleware(req, res, () => {
    nextCalled = true
  })
  return { res, nextCalled }
}

async function runLimiterTwice() {
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 1,
    validate: false,
    standardHeaders: false,
    legacyHeaders: false,
    message: { error: "Too many test requests. Please wait a moment and try again." }
  })

  function request() {
    const req = {
      ip: "127.0.0.1",
      headers: {},
      method: "GET",
      originalUrl: "/expensive",
      app: { get: () => false }
    }
    const res = {
      statusCode: 200,
      body: null,
      setHeader() {},
      status(code) {
        this.statusCode = code
        return this
      },
      send(payload) {
        this.body = payload
        return this
      },
      json(payload) {
        this.body = payload
        return this
      }
    }

    return new Promise(resolve => {
      Promise.resolve(limiter(req, res, () => resolve(res))).then(() => {
        resolve(res)
      })
    })
  }

  await request()
  return request()
}

async function main() {
  const csrf = createCsrfProtection("http://localhost:5173,https://www.fbcranes.co.za")

  assert.strictEqual(runCsrf(csrf, mockReq({ method: "POST", origin: "http://localhost:5173" })).nextCalled, true)
  const blocked = runCsrf(csrf, mockReq({ method: "POST", origin: "https://evil.example" }))
  assert.strictEqual(blocked.nextCalled, false)
  assert.strictEqual(blocked.res.statusCode, 403)
  assert.strictEqual(runCsrf(csrf, mockReq({ method: "GET", origin: "https://evil.example" })).nextCalled, true)
  assert.strictEqual(runCsrf(csrf, mockReq({ method: "POST", referer: "https://www.fbcranes.co.za/atec/" })).nextCalled, true)

  assert.strictEqual(validatePassword("short").valid, false)
  assert.strictEqual(validatePassword("        ").valid, false)
  assert.strictEqual(validatePassword("validpass").valid, true)

  assert.strictEqual(durationToMs("8h", 1), 8 * 60 * 60 * 1000)
  process.env.JWT_EXPIRES_IN = "30m"
  assert.strictEqual(authCookieOptions().maxAge, 30 * 60 * 1000)

  assert.notStrictEqual(sanitizeFilename("photo.jpg"), sanitizeFilename("photo.jpg"))
  assert.match(sanitizeFilename("photo.jpg"), /^[0-9a-f-]{36}-photo\.jpg$/)

  const limited = await runLimiterTwice()
  assert.strictEqual(limited.statusCode, 429)
  assert.match(JSON.stringify(limited.body), /Too many test requests/)

  const logged = []
  const originalError = console.error
  console.error = (...args) => logged.push(args)
  try {
    logSafeError("Regression", new Error("password=secret JWT_SECRET=secret DB_PASSWORD=secret"))
  } finally {
    console.error = originalError
  }
  const logPayload = JSON.stringify(logged)
  assert(!logPayload.includes("secret"))
  assert(logPayload.includes("referenceId"))

  const serverSource = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "server.js"), "utf8")
  const securitySource = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "middleware", "security.js"), "utf8")

  assert(serverSource.includes('app.use(requireAuth)\napp.use(csrfProtection)'))
  assert(serverSource.includes('app.post("/auth/login", csrfProtection, loginLimiter'))
  assert(serverSource.includes('app.post("/auth/logout", csrfProtection'))
  assert(!serverSource.includes('app.post("/auth/logout", requireAuth'))
  assert(serverSource.includes('app.use(express.json({\n  limit: process.env.JSON_BODY_LIMIT || "1mb"'))

  assert(serverSource.includes('app.get("/certificates/search", searchLimiter'))
  assert(serverSource.includes('app.get("/certificates/bulk-print", searchLimiter'))
  assert(serverSource.includes('app.get("/certificates/bulk-pdf", pdfLimiter'))
  assert(serverSource.includes('app.get("/assets/:id/qr-label.pdf", pdfLimiter'))
  assert(serverSource.includes('app.get("/she/risk-assessments.pdf", pdfLimiter'))
  assert(serverSource.includes('app.get("/she/risk-assessments.xlsx", exportLimiter'))
  assert(serverSource.includes('app.get("/reports/customer-detailed.pdf", pdfLimiter'))
  assert(serverSource.includes('app.get("/reports/customer-detailed.xlsx", exportLimiter'))
  assert(serverSource.includes('app.post("/certificates/:testid/email", emailLimiter'))
  assert(serverSource.includes('app.post("/admin/email-test", emailLimiter'))

  assert(securitySource.includes('crypto.randomUUID()'))
  assert(securitySource.includes('function validatePassword(password)'))
  assert(serverSource.includes('parseRateLimitEnv("SEARCH_RATE_LIMIT", 120, 1000)'))
  assert(serverSource.includes('parseRateLimitEnv("PDF_RATE_LIMIT", 40, 300)'))
  assert(serverSource.includes('parseRateLimitEnv("EXPORT_RATE_LIMIT", 60, 300)'))

  console.log("Task 8B security regression checks passed.")
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
