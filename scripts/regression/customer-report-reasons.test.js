const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const { attachCustomerReportReasons } = require("../../backend/services/customerReportReasons")
const ExcelJS = require("../../backend/node_modules/exceljs")

async function run() {
  const assets = [
    { assetid: 1, visualstatus: "NOT SAFE", visualtestid: 10, loadstatus: "NOT SAFE", loadtestid: 11 },
    { assetid: 2, loadstatus: "NOT SAFE", loadtestid: 12 },
    { assetid: 3, visualstatus: "SAFE", visualtestid: 13 }
  ]
  let calls = 0
  await attachCustomerReportReasons({ query: async (sql, params) => {
    calls++
    assert.deepEqual(params, [[10, 11, 12]])
    return { rows: [
      { testid: 10, criterion: "Hook", result: "FAIL", remarks: "Cracked", comments: "Replace hook" },
      { testid: 10, criterion: "Chain", result: "PASS", remarks: "Good", comments: "Replace hook" },
      { testid: 11, criterion: "Brake", result: "RECORDED", measuredvalue: "NO", remarks: "Slips" },
      { testid: 12, result: null, comments: " " }
    ] }
  } }, assets)
  assert.equal(calls, 1)
  assert.match(assets[0].notsafereason, /Visual inspection 10: Hook: FAIL — Cracked/)
  assert.match(assets[0].notsafereason, /Inspector comments: Replace hook/)
  assert.match(assets[0].notsafereason, /Load test 11: Brake: RECORDED; Measured: NO — Slips/)
  assert.doesNotMatch(assets[0].notsafereason, /Chain|Good/)
  assert.equal(assets[1].notsafereason, "Load test 12: No reason recorded")
  assert.equal(assets[2].notsafereason, "")
  await attachCustomerReportReasons({ query: () => assert.fail("Safe rows must not query findings") }, [assets[2]])

  const server = fs.readFileSync(require.resolve("../../backend/server.js"), "utf8")
  const start = server.indexOf("async function buildCustomerReportWorkbook(")
  const end = server.indexOf('\napp.get("/reports/customer-detailed"', start)
  const context = { ExcelJS, reportDate: value => value || "-", Date }
  vm.createContext(context)
  vm.runInContext(server.slice(start, end), context)
  const workbook = await context.buildCustomerReportWorkbook({ assets, summary: {}, generatedAt: "2026-09-28" })
  const reloaded = new ExcelJS.Workbook()
  await reloaded.xlsx.load(await workbook.xlsx.writeBuffer())
  const sheet = reloaded.getWorksheet("Assets")
  const reasonColumn = sheet.getRow(1).values.indexOf("Not Safe Reason")
  assert(reasonColumn > 0)
  assert.equal(sheet.getRow(2).getCell(reasonColumn).value, assets[0].notsafereason)
  assert.equal(sheet.getRow(2).getCell(reasonColumn).alignment.wrapText, true)
  assert.equal(sheet.getRow(3).getCell(reasonColumn).value, assets[1].notsafereason)
  console.log("Customer report reasons: findings, scope, missing reasons and XLSX round-trip passed")
}

run().catch(error => { console.error(error); process.exitCode = 1 })
