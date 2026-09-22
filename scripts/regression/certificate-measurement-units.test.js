const assert = require("assert")
const path = require("path")
const { pathToFileURL } = require("url")
const { formatCertificateMeasurement } = require("../../backend/services/certificateMeasurement")
const { renderSingleCertificateHtmlDocument } = require("../../backend/services/certificateRenderer")

async function main() {
  const frontend = await import(pathToFileURL(path.resolve(__dirname, "../../frontend/src/utils/certificateMeasurement.js")))
  for (const format of [formatCertificateMeasurement, frontend.formatCertificateMeasurement]) {
    for (const [value, criteria, expected] of [
      [1000, "Enter the Safe Working Load (SWL) of the beam in kilograms as marked on the beam identification plate.", "1000 kg"],
      [1000, "Enter the Safe Working Load (SWL) of the installed hoist in kilograms.", "1000 kg"],
      [1100, "Enter the proof load applied during the load test in kilograms.", "1100 kg"],
      [9, "Enter the maximum allowable beam deflection in millimetres as specified by the manufacturer or applicable standard.", "9 mm"],
      [7, "Enter the measured hook throat opening dimension in millimetres.", "7 mm"],
      [0, "Deflection (mm)", "0 mm"],
      ["1,100", "Proof load (kg)", "1,100 kg"],
      ["7 mm", "Opening in millimetres", "7 mm"],
      ["1 t", "Load in kilograms", "1 t"],
      [null, "Load in kilograms", ""],
      ["N/A", "Opening in millimetres", "N/A"],
      [5, "Count", "5"],
      [5, "Load kg / deflection mm", "5"]
    ]) assert.strictEqual(format(value, { criterianame: criteria }), expected)
    assert.strictEqual(format(7, { criteriadescription: "Opening in millimeters" }), "7 mm")
  }

  const html = renderSingleCertificateHtmlDocument({
    inspection: { inspectiontype: "LOADTEST" },
    results: [
      { criterianame: "Safe working load in kilograms", assetvalue: 1000, measuredvalue: 1000, result: "PASS" },
      { criterianame: "Deflection in millimetres", assetvalue: 9, measuredvalue: 0, result: "PASS" }
    ],
    photos: []
  })
  assert.ok(html.includes("<th>Specified Value</th>"))
  assert.strictEqual((html.match(/<td>1000 kg<\/td>/g) || []).length, 2)
  assert.ok(html.includes("<td>9 mm</td>"))
  assert.ok(html.includes("<td>0 mm</td>"))
  console.log("Certificate measurement unit checks passed")
}

main().catch(error => { console.error(error); process.exitCode = 1 })
