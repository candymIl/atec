const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const deploy = fs.readFileSync(path.join(root, "deployment", "deploy-live.sh"), "utf8")
const contract = JSON.parse(fs.readFileSync(path.join(root, "deployment", "production-schema-contract.json"), "utf8"))
const manifest = JSON.parse(fs.readFileSync(path.join(root, "deployment", "production-migrations.json"), "utf8"))
const migrator = fs.readFileSync(path.join(root, "scripts", "apply-production-migrations.js"), "utf8")
const beamClampFrequencyMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-beam-clamp-frequent-inspection.sql"),
  "utf8"
)
const generalLiftingDevicesFrequencyMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-general-lifting-devices-frequent-inspection.sql"),
  "utf8"
)

const backupAt = deploy.indexOf("npm run backup:create")
const migrationAt = deploy.indexOf("scripts/apply-production-migrations.js")
const schemaCheckAt = deploy.indexOf("scripts/check-production-schema.js")
const restartAt = deploy.indexOf('pm2 restart "$PM2_APP"')

assert(backupAt >= 0, "Deployment must create a backup")
assert(migrationAt > backupAt, "Migrations must run after the backup")
assert(schemaCheckAt > migrationAt, "Schema verification must run after migrations")
assert(restartAt > schemaCheckAt, "Backend restart must happen only after schema verification")
assert(manifest.migrations.includes("2026-07-18-void-inspections-entered-in-error.sql"))
assert(manifest.migrations.includes("2026-07-21-beam-clamp-frequent-inspection.sql"))
assert(manifest.migrations.includes("2026-07-21-general-lifting-devices-frequent-inspection.sql"))
assert(beamClampFrequencyMigration.includes("'FREQUENT_INSPECTION'"))
assert(beamClampFrequencyMigration.includes("'beam clamp', 'beam clamps'"))
assert(beamClampFrequencyMigration.includes("COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'"))
assert(generalLiftingDevicesFrequencyMigration.includes("'FREQUENT_INSPECTION'"))
assert(generalLiftingDevicesFrequencyMigration.includes("'general lifting devices/equipment'"))
assert(generalLiftingDevicesFrequencyMigration.includes("COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'"))
assert(contract.requirements.some(item => item.table === "tblinspection" && item.columns.includes("record_status")))
assert(migrator.includes("schema_migrations"), "Migrator must record applied migrations")
assert(migrator.includes("Checksum mismatch"), "Migrator must reject changed applied migrations")

for (const migration of manifest.migrations) {
  assert(fs.existsSync(path.join(root, "database", migration)), `Missing production migration: ${migration}`)
}

for (const requirement of contract.requirements) {
  assert(
    manifest.migrations.includes(requirement.migration),
    `Schema contract migration is not approved for deployment: ${requirement.migration}`
  )
}

console.log("Deployment safety regression checks passed.")
