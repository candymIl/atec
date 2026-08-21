const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..", "..")
const frontend = fs.readFileSync(path.join(root, "frontend", "src", "main.js"), "utf8")

assert.ok(
  frontend.includes("function isTrestleLoadTestMeasurementCriteria(asset, row, inspectiontype)"),
  "Trestle load tests must identify duplicate measurement criteria"
)
assert.ok(
  frontend.includes('["trestle", "trestles"].includes(equipmentType) && fieldType === "NUMBER"'),
  "The exclusion must stay limited to numeric trestle criteria"
)
assert.strictEqual(
  (frontend.match(/!isTrestleLoadTestMeasurementCriteria\(asset, row, inspectiontype\)/g) || []).length,
  2,
  "Duplicate trestle measurements must be excluded from both rendering and saving"
)

console.log("Trestle load-test form regression checks passed.")
