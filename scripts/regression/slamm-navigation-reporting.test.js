const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.resolve(__dirname, '../..')
const main = fs.readFileSync(path.join(root, 'frontend/src/main.js'), 'utf8')
const page = fs.readFileSync(path.join(root, 'frontend/src/pages/RiskAssessments.js'), 'utf8')

assert(main.includes("menuGroup('risk-assessment','Risk Assesment'"))
assert(main.includes("menuButton('she-reports','Reporting','showRiskAssessmentReports()')"))
assert(main.includes("'she-reports': ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER']"))
assert(page.includes('Print Report'))
assert(page.includes("downloadRiskAssessments('pdf')"))
console.log('SLAMM navigation and reporting regression passed')
