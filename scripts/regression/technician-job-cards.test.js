const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..", "..")
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8")
const frontend = fs.readFileSync(path.join(root, "frontend", "src", "main.js"), "utf8")
const migration = fs.readFileSync(path.join(root, "database", "2026-07-21-technician-job-cards.sql"), "utf8")

for (const table of ["tbljobcard", "tbljobcardasset", "tbljobcardmaterial", "tbljobcarddeviation", "tbljobcardphoto"]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS atec\\.${table}`))
}

for (const route of [
  'app.get("/job-cards"',
  'app.get("/job-cards/:id"',
  'app.post("/job-cards"',
  'app.put("/job-cards/:id"',
  'app.post("/job-cards/:id/photos"',
  'app.get("/job-cards/:id/pdf"'
]) assert.ok(server.includes(route), `Missing route: ${route}`)

assert.ok(server.includes("A critical deviation requires Out of Service or Restricted status"))
assert.ok(server.includes("Capture the customer signature or provide an unavailable/refused reason"))
assert.ok(server.includes("Only an Admin or Manager can approve, invoice or cancel a job card"))
assert.ok(frontend.includes("Technician Job Cards"))
assert.ok(frontend.includes("customer_signature_data"))
assert.ok(frontend.includes("jobCardCanvasHasInk"))
assert.ok(frontend.includes("capture=\"environment\""))

console.log("Technician job-card regression checks passed")
