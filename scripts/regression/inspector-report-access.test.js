const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..", "..")
const main = fs.readFileSync(path.join(root, "frontend", "src", "main.js"), "utf8")
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8")

assert(
  main.includes("'customer-report': ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER', 'CUSTOMER']"),
  "Inspectors must see and open the Reports page"
)

const inspectorAuthorization = server.slice(
  server.indexOf('if (role === "INSPECTOR")'),
  server.indexOf('return res.status(403).json({ error: "Access denied" })', server.indexOf('if (role === "INSPECTOR")'))
)

assert(
  inspectorAuthorization.includes('routePath.startsWith("/reports/customer-detailed")'),
  "Inspectors must be authorized to preview and export customer detailed reports"
)

console.log("Inspector report access regression test passed")
