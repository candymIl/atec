const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8")
const frontend = fs.readFileSync(path.join(root, "frontend", "src", "main.js"), "utf8")

assert(server.includes('const reason = String(req.body?.reason || "").trim()'), "Archive reason must be normalized server-side")
assert(server.includes('error: "An archive reason is required."'), "Backend must reject missing archive reasons")
assert(server.includes("INSERT INTO atec.audit_log"), "Asset archive must write an audit history record")
assert(server.includes("JSON.stringify({ reason })"), "Archive audit history must contain the supplied reason")
assert(server.includes('app.get("/assets/:id/archive-history"'), "Asset archive history endpoint is missing")
assert(frontend.includes("Why is asset "), "Archive action must ask the user for a reason")
assert(frontend.includes("body: JSON.stringify({ reason })"), "Frontend must send the archive reason")
assert(frontend.includes("<h3>Archive History</h3>"), "Asset history page must display archive history")

console.log("Asset archive reason regression checks passed.")
