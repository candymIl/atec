const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/Workforce.js'), 'utf8')

function review(role = 'ADMIN', status = 'AWAITING_EMPLOYEE', entries = [{timeentryid:1,activity_type:'TRAVEL'}]) {
  const editor = {innerHTML:'',querySelector:()=>({}),scrollIntoView:()=>{}}
  const requests = [], refreshes = []
  const context = vm.createContext({
    window:{currentUser:{role},prompt:()=> 'Overlap reviewed and accepted',confirm:()=>true},
    document:{querySelector:()=>editor}, escapeHtml:String, safeAttr:String,
    datetimeLocalValue:()=>'', managerAuditDetails:()=>({}),
    mountJobCardTimeGuide:()=>{}, mountDailyTimeline:()=>{}, alert:()=>{},
    api:async(url, options)=>{
      if(options) { requests.push({url,...options}); return {} }
      return {timesheet:{employee_name:'Test employee',timesheet_date:'2026-10-03',status},entries,audits:[]}
    },
    refreshEmployeeTimeReview:async(...args)=>refreshes.push(args),
    renderTimesheetApprovals:async()=>refreshes.push('queue')
  })
  for(const [start,end] of [
    ['export async function editEmployeeTimes','export function closeEmployeeTimeEditor'],
    ['export async function workforceAction','export async function approveCorrectedTimesheet']
  ]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)).replaceAll('export ',''),context)
  return {context,editor,requests,refreshes}
}

test('review offers submission only for an admin with awaiting entries',async()=>{
  for(const [role,status,entries,visible] of [
    ['ADMIN','AWAITING_EMPLOYEE',undefined,true],
    ['MANAGER','AWAITING_EMPLOYEE',undefined,false],
    ['HR','AWAITING_EMPLOYEE',undefined,false],
    ['ADMIN','EMPLOYEE_SUBMITTED',undefined,false],
    ['ADMIN','RETURNED',undefined,false],
    ['ADMIN','HR_ACCEPTED',undefined,false],
    ['ADMIN','AWAITING_EMPLOYEE',[],false]
  ]) {
    const fixture=review(role,status,entries)
    await fixture.context.editEmployeeTimes(7)
    assert.equal(fixture.editor.innerHTML.includes('Submit for employee</button>'),visible)
    if(visible) assert.ok(fixture.editor.innerHTML.includes("workforceAction(7,'SUBMIT_EMPLOYEE',true)"))
  }
})

test('review submission posts only the existing action and reason, then closes the review',async()=>{
  const {context,requests,refreshes}=review()
  await context.workforceAction(7,'SUBMIT_EMPLOYEE',true)
  assert.equal(requests.length,1)
  assert.equal(requests[0].url,'/workforce/timesheets/7/action')
  assert.equal(requests[0].method,'POST')
  assert.deepEqual(JSON.parse(requests[0].body),{action:'SUBMIT_EMPLOYEE',reason:'Overlap reviewed and accepted'})
  assert.equal(JSON.stringify(refreshes),'[[7,false]]')
})

test('cancelled or short reasons never submit; queue submissions retain their refresh',async()=>{
  const {context,requests,refreshes}=review()
  for(const reason of [null,'no']) {
    context.window.prompt=()=>reason
    await context.workforceAction(7,'SUBMIT_EMPLOYEE',true)
  }
  context.window.prompt=()=> 'Reviewed entries'
  context.window.confirm=()=>false
  await context.workforceAction(7,'SUBMIT_EMPLOYEE',true)
  assert.equal(requests.length,0)
  context.window.confirm=()=>true
  await context.workforceAction(7,'SUBMIT_EMPLOYEE')
  assert.equal(JSON.stringify(refreshes),'["queue"]')
})
