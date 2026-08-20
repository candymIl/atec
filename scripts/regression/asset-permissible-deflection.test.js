const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const root = path.resolve(__dirname, "..", "..")
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8")
const frontend = fs.readFileSync(path.join(root, "frontend", "src", "main.js"), "utf8")

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notStrictEqual(start, -1, `Missing function ${name}`)

  const bodyStart = source.indexOf("{", start)
  let depth = 0

  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1
    if (source[index] === "}") depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }

  throw new Error(`Could not extract function ${name}`)
}

const backendValidatorSource = extractFunction(server, "validatePermissibleDeflection")
const context = {}
vm.createContext(context)
vm.runInContext(`${backendValidatorSource}; this.validate = validatePermissibleDeflection`, context)

for (const valid of [null, undefined, "", " ", 0, "0", 19, "19", 20, "20"]) {
  assert.strictEqual(context.validate(valid), null, `Expected ${String(valid)} to be valid`)
}

for (const invalid of [-1, "-1", 19.9, "19.9", "not-a-number"]) {
  const result = context.validate(invalid)
  assert.ok(result, `Expected ${String(invalid)} to be rejected`)
  assert.strictEqual(result.field, "permissibledeflection")
  assert.match(result.acceptedFormat, /Whole millimetres only/)
}

assert.ok(server.includes('app.post("/assets"'), "Asset create route is missing")
assert.ok(server.includes('err?.code === "22001"'), "Asset create must explain legacy text-length errors")
assert.ok(server.includes('err?.code === "23503"'), "Asset create must explain invalid hierarchy selections")
assert.ok(fs.readFileSync(path.join(root, "database", "2026-08-20-expand-asset-text-fields.sql"), "utf8").includes("ALTER COLUMN description TYPE text"), "Asset descriptions must support clear operational detail")
assert.ok(server.includes('app.put("/assets/:id"'), "Asset update route is missing")
assert.strictEqual(
  (server.match(/validatePermissibleDeflection\(permissibledeflection\)/g) || []).length,
  2,
  "Backend validation must protect both asset create and update"
)

assert.ok(frontend.includes('step="1"'), "Frontend deflection fields must use whole-number steps")
assert.ok(frontend.includes('min="0"'), "Frontend deflection fields must reject negative values")
assert.ok(frontend.includes("validatePermissibleDeflection('#assetPermissibleDeflection')"))
assert.ok(frontend.includes("validatePermissibleDeflection('#editAssetPermissibleDeflection')"))
assert.ok(frontend.includes("formatAssetSaveError"))

console.log("Asset permissible-deflection regression checks passed")
