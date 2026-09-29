const test=require('node:test'),assert=require('node:assert/strict');const {acceloOverride}=require('../../backend/services/acceloOverride');
const readiness={card:{status:'APPROVED'},recipient:'job+123@fb-cranes.accelo.com',issues:['Missing timesheets: Example.']};
test('force send requires Admin, approved card, valid recipient and reason',()=>{
 assert.equal(acceloOverride({role:'ADMIN'},{},readiness),null);
 for(const role of ['MANAGER','INSPECTOR','HR'])assert.throws(()=>acceloOverride({role},{force:true,reason:'Document handover'},readiness),{statusCode:403});
 for(const status of ['DRAFT','CANCELLED','SUBMITTED'])assert.throws(()=>acceloOverride({role:'ADMIN'},{force:true,reason:'Document handover'},{...readiness,card:{status}}),{statusCode:409});
 assert.throws(()=>acceloOverride({role:'ADMIN'},{force:true,reason:'Document handover'},{...readiness,recipient:''}),{statusCode:409});
 assert.throws(()=>acceloOverride({role:'ADMIN'},{force:true,reason:'ok'},readiness),{statusCode:400});
 assert.deepEqual(acceloOverride({role:'ADMIN',user_id:4},{force:true,reason:'Document handover'},readiness),{actor_user_id:4,reason:'Document handover',issues:readiness.issues});
});
test('force send confirms actual recipient, CC, warnings and reason; cancellation never sends',async()=>{
 const fs=require('fs'),vm=require('vm'),path=require('path');const source=fs.readFileSync(path.join(__dirname,'../../frontend/src/main.js'),'utf8');const start=source.indexOf('let acceloSendPending = false');const end=source.indexOf('const startupTap',start);let confirm=false;let message='';const requests=[];
 const context=vm.createContext({currentUser:{role:'ADMIN'},API_BASE:'/api',document:{querySelector:()=>({dataset:{recipient:readiness.recipient,cc:'review@example.com',issues:JSON.stringify(readiness.issues)}})},window:{prompt:()=> 'Document handover',confirm:m=>{message=m;return confirm}},alert:()=>{},fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true}},readApiResponse:async()=>({recipient:readiness.recipient,attachments:[]}),openJobCard:async()=>{}});
 vm.runInContext(source.slice(start,end),context);
 await context.window.sendAcceloPackage(123,false,true);assert.equal(requests.length,0);assert.match(message,/job\+123/);assert.match(message,/review@example.com/);assert.match(message,/Missing timesheets/);
 confirm=true;await context.window.sendAcceloPackage(123,false,true);assert.equal(requests.length,1);assert.deepEqual(requests[0].body,{resend:false,force:true,reason:'Document handover'});
 context.currentUser.role='MANAGER';await context.window.sendAcceloPackage(123,false,true);assert.equal(requests.length,1);
});
