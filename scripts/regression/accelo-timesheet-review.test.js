const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/acceloTimesheetReview.js'), 'utf8')
  .replace(/^import .*$/gm, '').replace(/export /g, '')

function setup() {
  const calls = []
  const feedback = { textContent:'', isConnected:true }
  const scope = {
    API_BASE:'/api', escapeHtml:value => String(value ?? '').replaceAll('<','&lt;'),
    window:{confirm:() => true}, document:{querySelector:() => feedback},
    fetch:async (url, options) => {
      calls.push({url,options})
      return {ok:true,json:async () => options ? {} : [{timesheetid:1,status:'EMPLOYEE_SUBMITTED'}]}
    }
  }
  vm.createContext(scope)
  vm.runInContext(source,scope)
  return {scope,calls,feedback}
}
const sheets = [
  {timesheetid:1,employee_name:'Employee A',timesheet_date:'2026-09-29',status:'EMPLOYEE_SUBMITTED'},
  {timesheetid:2,employee_name:'Employee B',timesheet_date:'2026-09-29',status:'EMPLOYEE_SUBMITTED'},
  {timesheetid:3,employee_name:'Employee C',timesheet_date:'2026-09-29',status:'AWAITING_EMPLOYEE'},
  {timesheetid:4,employee_name:'Employee D',timesheet_date:'2026-09-29',status:'MANAGER_APPROVED'}
]

test('links every daily timesheet and only offers approval for submitted rows in the permitted queue', async () => {
  const {scope} = setup()
  const html = await scope.renderAcceloTimesheetReview(10,sheets,'MANAGER')
  assert.equal((html.match(/View timesheet/g) || []).length,4)
  assert.equal((html.match(/>Approve timesheet</g) || []).length,1)
  assert.match(html,/approveAcceloTimesheet\(10,1,this\)/)
  assert.match(html,/Employee submission is required/)
  assert.match(html,/full day, including time on other job cards/)
})

test('approved time refreshes the current job card without sending a package', async () => {
  const {scope,calls} = setup()
  await scope.renderAcceloTimesheetReview(10,sheets,'ADMIN')
  const button = {}
  let refreshed = null
  await scope.approveAcceloTimesheet(10,1,button,async id => {refreshed=id})
  assert.equal(refreshed,10)
  assert.equal(button.disabled,true)
  assert.equal(calls.length,2)
  assert.equal(calls[1].url,'/api/workforce/timesheets/1/action')
  assert.deepEqual(JSON.parse(calls[1].options.body),{action:'APPROVE',reason:''})
  await scope.approveAcceloTimesheet(10,1,button,async () => {})
  assert.equal(calls.length,2)
})

test('cancel, wrong job card and out-of-scope timesheet do not submit an approval', async () => {
  const {scope,calls} = setup()
  await scope.renderAcceloTimesheetReview(10,sheets,'MANAGER')
  await scope.approveAcceloTimesheet(11,1,{},async () => {})
  await scope.approveAcceloTimesheet(10,2,{},async () => {})
  scope.window.confirm = () => false
  await scope.approveAcceloTimesheet(10,1,{},async () => {})
  assert.equal(calls.length,1)
})

test('server rejection shows the error and permits retry without refreshing', async () => {
  const {scope,feedback} = setup()
  await scope.renderAcceloTimesheetReview(10,sheets,'ADMIN')
  scope.fetch = async () => ({ok:false,json:async () => ({error:'Timesheet status changed.'})})
  const button = {}
  await scope.approveAcceloTimesheet(10,1,button,async () => assert.fail('Must not refresh after rejection'))
  assert.equal(feedback.textContent,'Timesheet status changed.')
  assert.equal(button.disabled,false)
})

test('permission lookup failure keeps PDF links but hides approvals', async () => {
  const {scope} = setup()
  scope.fetch = async () => {throw new Error('Offline')}
  const html = await scope.renderAcceloTimesheetReview(10,sheets,'ADMIN')
  assert.match(html,/Approval access could not be checked/)
  assert.match(html,/View timesheet/)
  assert.doesNotMatch(html,/>Approve timesheet</)
})
