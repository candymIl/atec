const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..", "..")
const main = fs.readFileSync(path.join(root, "frontend", "src", "main.js"), "utf8")
const api = fs.readFileSync(path.join(root, "frontend", "src", "api.js"), "utf8")

assert(
  main.includes("response.status === 401") &&
    main.includes("window.location.reload()"),
  "Authenticated API 401 responses must refresh the page"
)
assert(
  main.includes("window.setInterval(checkSession, 60000)"),
  "The frontend must periodically check an active session"
)
assert(
  main.includes("window.addEventListener('focus', checkSession)"),
  "The frontend must check the session when the user returns to the page"
)
assert(
  main.includes("if (!currentUser || sessionExpiryReloadStarted) return"),
  "Session checks must not run on the login screen or during a pending refresh"
)
assert(
  !api.includes("`${window.location.origin}${encodedPath}`") &&
    api.includes("return apiUrl(encodedPath)"),
  "Authenticated upload URLs must use the configured API route in production"
)

console.log("Session expiry refresh regression test passed")
