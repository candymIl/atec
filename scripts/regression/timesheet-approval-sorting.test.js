const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/Workforce.js'), 'utf8')
const elements = Object.fromEntries(['approvalSearch','approvalFrom','approvalTo','approvalSort','approvalStages','approvalCount','approvalGroups'].map(id => [id, { value:'', innerHTML:'', textContent:'' }]))
const context = vm.createContext({
  window:{currentUser:{role:'MANAGER'}}, API_BASE:'/api',
  document:{querySelector:selector => elements[selector.slice(1)], getElementById:id => elements[id]},
  escapeHtml:String, safeAttr:String, hours:value => Number(value || 0).toFixed(2)
})
vm.runInContext(source.slice(source.indexOf('let approvalRows = []'), source.indexOf('export async function recalculateAwaitingTimesheets')).replaceAll('export ', ''), context)
context.rows = ['RETURNED','EMPLOYEE_SUBMITTED','MANAGER_APPROVED','AWAITING_EMPLOYEE'].flatMap((status,index) => [
  {timesheetid:index*10+1,status,employee_name:'Zoe',timesheet_date:'2026-09-01',job_card_numbers:'JC-10'},
  {timesheetid:index*10+2,status,employee_name:'amy',timesheet_date:'2026-09-29',job_card_numbers:'JC-2'},
  {timesheetid:index*10+3,status,employee_name:'Ben',timesheet_date:'2026-09-15',job_card_numbers:''}
])
vm.runInContext('approvalRows = rows; filterTimesheetApprovals()', context)
const html = () => elements.approvalGroups.innerHTML
assert.equal((html().match(/data-label="Date"/g) || []).length, 12)
assert.ok(!html().includes('Employee / date'))
assert.equal((html().match(/aria-sort="ascending"/g) || []).length, 4)
for (const [key, asc, desc] of [
  ['EMPLOYEE','2,3,1','1,3,2'], ['DATE','1,3,2','2,3,1'], ['JOBS','2,1,3','1,2,3']
]) {
  for (const [direction, expected] of [['ASC',asc],['DESC',desc]]) {
    context.selectTimesheetApprovalSort(`${key}_${direction}`)
    const ids = vm.runInContext('approvalRows.slice(0,3).sort(compareApprovalRows).map(row => row.timesheetid).join(",")', context)
    assert.equal(ids, expected, `${key} ${direction}`)
    assert.equal(elements.approvalSort.value, `${key}_${direction}`)
  }
}
context.sortTimesheetApprovals('EMPLOYEE','RETURNED')
assert.equal(elements.approvalSort.value, 'EMPLOYEE_ASC')
context.sortTimesheetApprovals('EMPLOYEE','RETURNED')
assert.equal(elements.approvalSort.value, 'EMPLOYEE_DESC')
context.filterTimesheetApprovals('EMPLOYEE_SUBMITTED')
assert.equal((html().match(/<section /g) || []).length, 1)
assert.ok(html().indexOf('>Zoe<') < html().indexOf('>amy<'))
assert.ok(html().includes('Approve</button>'), 'Manager approval action remains available')
elements.approvalSearch.value = 'amy'
context.filterTimesheetApprovals()
assert.ok(html().includes('>amy<') && !html().includes('>Zoe<'))
assert.equal(elements.approvalSort.value, 'EMPLOYEE_DESC', 'Filtering preserves sort')
elements.approvalFrom.value = '2026-10-01'
context.filterTimesheetApprovals()
assert.ok(html().includes('No timesheets match'))
context.resetTimesheetApprovalFilters()
assert.equal((html().match(/<section /g) || []).length, 4)
assert.ok(!html().includes('Close as invalid'), 'Managers cannot close invalid records')
context.window.currentUser.role = 'ADMIN'
context.filterTimesheetApprovals()
assert.equal((html().match(/>Close as invalid</g) || []).length, 12, 'Admin can close records in every outstanding section')
console.log('Timesheet approval sorting checks passed')
