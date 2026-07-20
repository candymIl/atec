const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8")
const certificates = fs.readFileSync(path.join(root, "frontend", "src", "pages", "Certificates.js"), "utf8")

assert(
  certificates.includes('const certificateVoidRoles = ["ADMIN", "MANAGER", "INSPECTOR"]'),
  "The certificate action must be visible to inspectors, managers, and administrators"
)
assert(
  (server.match(/method === "DELETE" && \/\^\\\/certificates\\\/\[\^\/\]\+\$\//g) || []).length === 2,
  "Manager and inspector authorization must permit certificate void requests"
)
assert(
  server.includes('!["ADMIN", "MANAGER", "INSPECTOR"].includes(req.user?.role)'),
  "The certificate void endpoint must accept inspectors, managers, and administrators"
)
assert(
  server.includes('req.logAudit("VOID", "certificates", testid'),
  "Certificate voiding must remain audit logged"
)

console.log("Certificate entered-in-error access regression checks passed.")
