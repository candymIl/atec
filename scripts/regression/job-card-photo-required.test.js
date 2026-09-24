const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const frontend = fs.readFileSync(path.join(root,'frontend/src/main.js'),'utf8')
const server = fs.readFileSync(path.join(root,'backend/server.js'),'utf8')
const saveCode = frontend.slice(frontend.indexOf('let jobCardSaveInProgress = false'),frontend.indexOf('window.uploadJobCardPhotos ='))
async function browserCase({existing=false,photos=[],files=[],status='SUBMITTED',failUpload=false,failFinal=false}={}) {
  const events=[], alerts=[]
  const input={files,value:'selected',focus(){events.push('focus')}}
  const context=vm.createContext({window:{},jobCardEditing:existing?{jobcardid:42,status:'IN_PROGRESS',photos}:null,
    API_BASE:'/api',document:{querySelector:selector=>selector==='#jcPhotos'?input:null},
    collectJobCardPayload:()=>({status,customer_reference:'12345',assetids:[1]}),
    alert:message=>alerts.push(message),renderJobCardForm:()=>events.push('render'),
    readApiResponse:async response=>response.data,
    fetch:async (url,options)=>{
      const payload=JSON.parse(options.body);events.push(`${options.method}:${payload.status}`)
      if(failFinal && payload.status===status) return {ok:false,data:{error:'Validation failed'}}
      return {ok:true,data:{jobcardid:42,jobcard_reference:'JC-TEST',status:payload.status,photos:[...photos]}}
    },
    uploadJobCardPhotoFiles:async()=>{
      events.push('upload')
      if(failUpload) throw Error('Upload failed')
      return {uploaded:files.length,result:files.map((_,i)=>({photoid:i+1}))}
    }
  })
  vm.runInContext(saveCode,context)
  await context.window.saveJobCard(status)
  return {events,alerts,context,input}
}
async function main(){
  for(const status of ['SUBMITTED','APPROVED','INVOICED']){
    const test=await browserCase({existing:true,status})
    assert.deepEqual(test.events,['focus']);assert.match(test.alerts[0],/at least one photo/)
  }
  assert.deepEqual((await browserCase({status:'DRAFT'})).events,['POST:DRAFT','render'])
  assert.deepEqual((await browserCase({files:[{}]})).events,['POST:IN_PROGRESS','upload','PUT:SUBMITTED','render'])
  assert.deepEqual((await browserCase({existing:true,files:[{}]})).events,['upload','PUT:SUBMITTED','render'])
  assert.deepEqual((await browserCase({existing:true,photos:[{photoid:1}]})).events,['PUT:SUBMITTED','render'])
  const failedNew=await browserCase({files:[{}],failUpload:true})
  assert.deepEqual(failedNew.events,['POST:IN_PROGRESS','upload']);assert.equal(failedNew.context.jobCardEditing.jobcardid,42)
  assert.deepEqual((await browserCase({existing:true,files:[{}],failUpload:true})).events,['upload'])
  const failedSave=await browserCase({existing:true,files:[{}],failFinal:true})
  assert.equal(failedSave.input.value,'');assert.equal(failedSave.context.jobCardEditing.photos.length,1)
  assert.equal(vm.runInContext('jobCardSaveInProgress',failedSave.context),false)
  const gateStart=server.indexOf('    if (["SUBMITTED", "APPROVED", "INVOICED"].includes(requestedStatus)) {',server.indexOf('const adminSelfApproval = req.user.role'))
  assert(gateStart>0)
  const gateEnd=server.indexOf('    if (requestedStatus === "SUBMITTED"',gateStart)
  const gateCode=server.slice(gateStart,gateEnd)
  for(const status of ['DRAFT','IN_PROGRESS','AWAITING_SIGNATURE','SUBMITTED','APPROVED','INVOICED']){
    for(const kind of ['none','missing','present']){
      const queries=[];let errorStatus=null
      const context=vm.createContext({requestedStatus:status,jobcardid:42,
        client:{query:async(sql)=>{queries.push(sql);return {rows:kind==='none'?[]:[{photo_path:'/uploads/work.jpg'}]}}},
        resolveUploadFilePath:value=>value,fs:{existsSync:()=>kind==='present'},
        res:{status:code=>{errorStatus=code;return {json:body=>body}}}
      })
      await vm.runInContext(`(async()=>{${gateCode}})()`,context)
      const protectedStatus=['SUBMITTED','APPROVED','INVOICED'].includes(status)
      assert.equal(errorStatus,protectedStatus&&kind!=='present'?400:null)
      assert.equal(queries.includes('ROLLBACK'),protectedStatus&&kind!=='present')
      if(!protectedStatus)assert.equal(queries.length,0)
    }
  }
  console.log('Mandatory work-photo checks passed: drafts, existing/new cards, upload-before-submit, failures, and server file validation.')
}
main().catch(error=>{console.error(error);process.exitCode=1})
