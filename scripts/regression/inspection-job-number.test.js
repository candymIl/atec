const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..", "..")
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8")

const frontend = read("frontend/src/main.js")
const certificatesPage = read("frontend/src/pages/Certificates.js")
const server = read("backend/server.js")
const renderer = read("backend/services/certificateRenderer.js")
const migration = read("database/2026-07-30-inspection-job-number.sql")
const migrationManifest = JSON.parse(read("deployment/production-migrations.json"))

assert.strictEqual(
  (frontend.match(/id="inspectionJobNumber"/g) || []).length,
  4,
  "Every inspection creation mode must capture the Accelo Job Number"
)
assert.ok(frontend.includes('formData.append("job_number"'))
assert.ok(frontend.includes("<span>Job Number</span>"))
assert.ok(server.includes('"job_number"'))
assert.ok(server.includes("truncateDbText(acceloJobNumber, 200)"))
assert.ok(server.includes('"jobcardid"'))
assert.ok(server.includes("Accelo Job Number is required and may contain numeric digits only"))
assert.ok(server.includes("More than one active Job Card uses this Accelo Job Number"),"Ambiguous inspection-to-job linkage must be rejected")
assert.ok(server.includes("OR i.job_number ILIKE"))
assert.ok(renderer.includes("<strong>Job Number:</strong>"))
assert.ok(certificatesPage.includes("Job Number"))
assert.ok(certificatesPage.includes("cert.job_number"))
assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS job_number"))
assert.ok(migration.includes("idx_tblinspection_job_number"))
assert.ok(migrationManifest.migrations.includes("2026-07-30-inspection-job-number.sql"))

console.log("Inspection certificate Job Number regression checks passed.")
