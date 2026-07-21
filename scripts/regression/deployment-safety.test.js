const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const deploy = fs.readFileSync(path.join(root, "deployment", "deploy-live.sh"), "utf8")
const manualBackup = fs.readFileSync(path.join(root, "deployment", "backup-live.sh"), "utf8")
const contract = JSON.parse(fs.readFileSync(path.join(root, "deployment", "production-schema-contract.json"), "utf8"))
const manifest = JSON.parse(fs.readFileSync(path.join(root, "deployment", "production-migrations.json"), "utf8"))
const migrator = fs.readFileSync(path.join(root, "scripts", "apply-production-migrations.js"), "utf8")
const backupScript = fs.readFileSync(path.join(root, "scripts", "atec-backup.js"), "utf8")
const beamClampFrequencyMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-beam-clamp-frequent-inspection.sql"),
  "utf8"
)
const generalLiftingDevicesFrequencyMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-general-lifting-devices-frequent-inspection.sql"),
  "utf8"
)
const bottleJackFrequencyMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-bottle-jack-frequent-inspection.sql"),
  "utf8"
)
const bowShackleChainSlingFrequencyMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-bow-shackle-chain-sling-frequent-inspection.sql"),
  "utf8"
)
const additionalLiftingTackleFrequencyMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-additional-lifting-tackle-frequent-inspection.sql"),
  "utf8"
)
const moreFrequentInspectionEquipmentMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-more-frequent-inspection-equipment.sql"),
  "utf8"
)
const manualHoistsFrequencyMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-manual-hoists-frequent-inspection.sql"),
  "utf8"
)
const trolleyPalletJackLoadTestMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-trolley-pallet-jack-load-test-criteria.sql"),
  "utf8"
)
const trestleManCageLoadTestMigration = fs.readFileSync(
  path.join(root, "database", "2026-07-21-trestle-man-cage-load-test-criteria.sql"),
  "utf8"
)

const backupAt = deploy.indexOf("npm run backup:create")
const migrationAt = deploy.indexOf("scripts/apply-production-migrations.js")
const schemaCheckAt = deploy.indexOf("scripts/check-production-schema.js")
const restartAt = deploy.indexOf('pm2 restart "$PM2_APP"')

assert(backupAt === -1, "Deployment must not create an automatic full backup")
assert(manualBackup.includes("npm run backup:create"), "Manual live backup script must create a full backup")
assert(migrationAt >= 0, "Deployment must apply production migrations")
assert(schemaCheckAt > migrationAt, "Schema verification must run after migrations")
assert(restartAt > schemaCheckAt, "Backend restart must happen only after schema verification")
assert(manifest.migrations.includes("2026-07-18-void-inspections-entered-in-error.sql"))
assert(manifest.migrations.includes("2026-07-21-beam-clamp-frequent-inspection.sql"))
assert(manifest.migrations.includes("2026-07-21-general-lifting-devices-frequent-inspection.sql"))
assert(manifest.migrations.includes("2026-07-21-bottle-jack-frequent-inspection.sql"))
assert(manifest.migrations.includes("2026-07-21-bow-shackle-chain-sling-frequent-inspection.sql"))
assert(manifest.migrations.includes("2026-07-21-additional-lifting-tackle-frequent-inspection.sql"))
assert(manifest.migrations.includes("2026-07-21-more-frequent-inspection-equipment.sql"))
assert(manifest.migrations.includes("2026-07-21-manual-hoists-frequent-inspection.sql"))
assert(manifest.migrations.includes("2026-07-21-trolley-pallet-jack-load-test-criteria.sql"))
assert(manifest.migrations.includes("2026-07-21-trestle-man-cage-load-test-criteria.sql"))
assert(beamClampFrequencyMigration.includes("'FREQUENT_INSPECTION'"))
assert(beamClampFrequencyMigration.includes("'beam clamp', 'beam clamps'"))
assert(beamClampFrequencyMigration.includes("COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'"))
assert(generalLiftingDevicesFrequencyMigration.includes("'FREQUENT_INSPECTION'"))
assert(generalLiftingDevicesFrequencyMigration.includes("'general lifting devices/equipment'"))
assert(generalLiftingDevicesFrequencyMigration.includes("COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'"))
assert(bottleJackFrequencyMigration.includes("'FREQUENT_INSPECTION'"))
assert(bottleJackFrequencyMigration.includes("'bottle jack'"))
assert(bottleJackFrequencyMigration.includes("COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'"))
assert(bowShackleChainSlingFrequencyMigration.includes("'FREQUENT_INSPECTION'"))
assert(bowShackleChainSlingFrequencyMigration.includes("'bow shackle'"))
assert(bowShackleChainSlingFrequencyMigration.includes("'chain sling'"))
assert(bowShackleChainSlingFrequencyMigration.includes("COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'"))
assert(additionalLiftingTackleFrequencyMigration.includes("'FREQUENT_INSPECTION'"))
for (const equipmentType of ["'d shackle'", "'drum lifter'", "'endless round sling'", "'eye bolt'", "'fall arrestor'"]) {
  assert(additionalLiftingTackleFrequencyMigration.includes(equipmentType))
}
assert(additionalLiftingTackleFrequencyMigration.includes("COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'"))
for (const equipmentType of [
  "'winch / wire rope winch'", "'trolley jack / pallet jack'", "'trestles / engine lifter'",
  "'steel wire rope sling'", "'safety harness lanyard'", "'safety harness'",
  "'polyester sling / webbing sling'", "'plate grab'", "'man cage / boatswain chair'"
]) {
  assert(moreFrequentInspectionEquipmentMigration.includes(equipmentType))
}
assert(moreFrequentInspectionEquipmentMigration.includes("'FREQUENT_INSPECTION'"))
assert(moreFrequentInspectionEquipmentMigration.includes("COALESCE(criteria.inspectioncategory, 'VISUAL') = 'VISUAL'"))
assert(manualHoistsFrequencyMigration.includes("'FREQUENT_INSPECTION'"))
assert(manualHoistsFrequencyMigration.includes("'hoists - manual chain hoist'"))
assert(manualHoistsFrequencyMigration.includes("'hoists - manual lever hoist'"))
assert(trolleyPalletJackLoadTestMigration.includes("'LOADTEST'"))
assert(trolleyPalletJackLoadTestMigration.includes("'trolley jack / pallet jack'"))
assert(trolleyPalletJackLoadTestMigration.includes("'SAFE FOR CONTINUED OPERATION'"))
assert(trestleManCageLoadTestMigration.includes("'TRESTLE'"))
assert(trestleManCageLoadTestMigration.includes("'MAN_CAGE'"))
assert(trestleManCageLoadTestMigration.includes("'PERIODIC_THOROUGH_INSPECTION'"))
assert(trestleManCageLoadTestMigration.includes("SWL/test load actually lifted"))
assert(contract.requirements.some(item => item.table === "tblinspection" && item.columns.includes("record_status")))
assert(migrator.includes("schema_migrations"), "Migrator must record applied migrations")
assert(migrator.includes("Checksum mismatch"), "Migrator must reject changed applied migrations")
assert(deploy.includes("git pull --no-rebase --no-edit"), "Live deployment pulls must not open an interactive merge editor")
assert(backupScript.includes("createMediaArchive(tempPath, mediaRoot)"), "Media backup must use the retry-safe archive helper")
assert(backupScript.includes("file changed as we read it"), "Media backup must retry transient live-file changes")

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
