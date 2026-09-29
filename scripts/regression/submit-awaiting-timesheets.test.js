const test = require('node:test')
const assert = require('node:assert/strict')
const { submitAwaitingTimesheets } = require('../../backend/services/submitAwaitingTimesheets')
function database({status='AWAITING_EMPLOYEE',empty=false,auditFails=false}={}) {
  const calls=[]
  const client={query:async(sql,params)=>{
    calls.push({sql,params})
    if(sql.startsWith('SELECT timesheetid')) return {rows:[{timesheetid:1,status},{timesheetid:2,status}]}
    if(sql.startsWith('SELECT t.timesheetid')) return {rows:empty?[{timesheetid:2}]:[]}
    if(sql.startsWith('INSERT') && auditFails) throw Error('audit failed')
    return {rows:[]}
  },release:()=>calls.push({sql:'RELEASE'})}
  return {calls,connect:async()=>client}
}
const admin={role:'ADMIN',user_id:9}
test('deduplicates selected IDs, submits together and audits before commit',async()=>{
  const db=database()
  assert.deepEqual(await submitAwaitingTimesheets(db,admin,[2,1,2],'Reviewed with employees'),{submitted:2})
  const update=db.calls.find(c=>c.sql.startsWith('UPDATE'))
  assert.deepEqual(update.params,[[1,2]])
  const audit=db.calls.find(c=>c.sql.startsWith('INSERT'))
  assert.equal(audit.params[1],9)
  assert.equal(JSON.parse(audit.params[2]).reason,'Reviewed with employees')
  assert.equal(db.calls.at(-2).sql,'COMMIT')
})
test('rejects unauthorized roles and malformed requests before connecting',async()=>{
  const pool={connect:()=>{throw Error('should not connect')}}
  for(const role of ['MANAGER','HR','TECHNICIAN']) await assert.rejects(submitAwaitingTimesheets(pool,{role},[1],'reviewed'),{statusCode:403})
  for(const ids of [[],[0],['x'],[1.5]]) await assert.rejects(submitAwaitingTimesheets(pool,admin,ids,'reviewed'),{statusCode:400})
  await assert.rejects(submitAwaitingTimesheets(pool,admin,[1],'no'),{statusCode:400})
})
test('stale stages and empty sheets abort the whole batch',async()=>{
  for(const options of [{status:'MANAGER_APPROVED'},{status:'CLOSED_INVALID'},{empty:true}]) {
    const db=database(options)
    await assert.rejects(submitAwaitingTimesheets(db,admin,[1,2],'reviewed'),{statusCode:409})
    assert.ok(!db.calls.some(c=>c.sql.startsWith('UPDATE')))
    assert.equal(db.calls.at(-2).sql,'ROLLBACK')
  }
})
test('audit failure rolls back the submission',async()=>{
  const db=database({auditFails:true})
  await assert.rejects(submitAwaitingTimesheets(db,admin,[1,2],'reviewed'),/audit failed/)
  assert.ok(!db.calls.some(c=>c.sql==='COMMIT'))
  assert.equal(db.calls.at(-2).sql,'ROLLBACK')
})
test('button and submitted IDs respect filters and admin role',async()=>{
  const fs=require('fs'),vm=require('vm'),path=require('path')
  const source=fs.readFileSync(path.join(__dirname,'../../frontend/src/pages/Workforce.js'),'utf8')
  const elements=Object.fromEntries(['approvalSearch','approvalFrom','approvalTo','approvalSort','approvalStages','approvalCount','approvalGroups'].map(id=>[id,{value:'',innerHTML:''}]))
  const posts=[];let confirm=true
  const ctx=vm.createContext({window:{currentUser:{role:'ADMIN'},prompt:()=> 'Reviewed with employees',confirm:()=>confirm},document:{querySelector:s=>elements[s.slice(1)]},API_BASE:'/api',escapeHtml:String,safeAttr:String,hours:String,alert:()=>{},api:async(url,options)=>{posts.push(JSON.parse(options.body));return {submitted:1}}})
  vm.runInContext(source.slice(source.indexOf('let approvalRows = []'),source.indexOf('export async function recalculateAwaitingTimesheets')).replaceAll('export ',''),ctx)
  vm.runInContext(`approvalRows=[{timesheetid:1,status:'AWAITING_EMPLOYEE',employee_name:'Amy',timesheet_date:'2026-09-01'},{timesheetid:2,status:'AWAITING_EMPLOYEE',employee_name:'Bob',timesheet_date:'2026-09-02'}]; renderTimesheetApprovals=async()=>{};`,ctx)
  elements.approvalSearch.value='Amy'
  ctx.filterTimesheetApprovals()
  assert.ok(elements.approvalGroups.innerHTML.includes('Submit all shown (1)'))
  confirm=false;await ctx.submitAllAwaitingTimesheets();assert.equal(posts.length,0)
  confirm=true;await ctx.submitAllAwaitingTimesheets();assert.deepEqual(posts[0].timesheet_ids,[1])
  ctx.window.currentUser.role='MANAGER';ctx.filterTimesheetApprovals();await ctx.submitAllAwaitingTimesheets()
  assert.ok(!elements.approvalGroups.innerHTML.includes('Submit all shown'))
  assert.equal(posts.length,1)
})
