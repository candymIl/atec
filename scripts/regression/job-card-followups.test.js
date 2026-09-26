const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname,'../..')
const { enrich, filterRows, summary, sortRows, validateUpdate, scopedWhere, syncFollowups } = require('../../backend/services/jobCardFollowups')
const { registerJobCardFollowupRoutes, workbook, pdf, reportData } = require('../../backend/routes/jobCardFollowups')
const { Pool } = require('../../backend/node_modules/pg')
const express = require('../../backend/node_modules/express')
const ExcelJS = require('../../backend/node_modules/exceljs')

async function run() {
  const sample = { followupid:1,kind:'QUOTE',status:'OPEN',raised_at:'2026-09-01T12:00:00Z',due_date:'2026-09-24',version:1 }
  const row = enrich(sample,'2026-09-25')
  assert.equal(row.age_days,24);assert.equal(row.age_band,'15–30');assert.equal(row.overdue,true)
  assert.equal(enrich({...sample,status:'HANDED_OVER',closed_at:'2026-09-03T12:00:00Z'},'2026-09-25').age_days,2)
  assert.equal(enrich({...sample,due_date:'2026-09-25'},'2026-09-25').overdue,false)
  assert.equal(enrich({...sample,raised_at:'2026-08-31T22:30:00Z'},'2026-09-25').raised_date,'2026-09-01')
  for (const [age,band] of [[0,'0–7'],[7,'0–7'],[8,'8–14'],[14,'8–14'],[15,'15–30'],[30,'15–30'],[31,'Over 30']]) {
    assert.equal(enrich({...sample,raised_at:new Date(Date.parse('2026-09-25T10:00Z')-age*86400000)},'2026-09-25').age_band,band)
  }
  assert.throws(()=>validateUpdate(row,{status:'HANDED_OVER',version:0}),/changed/)
  assert.throws(()=>validateUpdate(row,{status:'RESOLVED',version:1}),/Invalid/)
  assert.throws(()=>validateUpdate({...row,kind:'REBOOK'},{status:'BOOKED',version:1}),/return visit date/)
  assert.throws(()=>validateUpdate({...row,kind:'ATTENTION'},{status:'RESOLVED',version:1}),/resolution/)
  assert.throws(()=>validateUpdate(row,{status:'OPEN',version:1,due_date:'2026-02-30'}),/valid date/)
  assert.throws(()=>filterRows([row],{from:'2026-09-25',to:'2026-09-01'}),/Start date/)
  assert.equal(filterRows([row],{state:'CLOSED'}).length,0)
  assert.equal(summary([row]).awaiting_handover,1)
  assert.equal(summary([{...row,kind:'ATTENTION',assetid:7},{...row,kind:'ATTENTION',assetid:7}]).attention,1)
  assert.throws(()=>scopedWhere({role:'INSPECTOR',user_id:2},[]),/Only Admins/)
  const sortable = [
    { followupid:1,raised_date:'2026-08-21',clientname:'Zinc',asset_label:'Crane 10',kind:'QUOTE',responsible_name:'Zoe',status:'OPEN' },
    { followupid:2,raised_date:'2026-08-20',clientname:'Alpha',asset_label:'Crane 10',kind:'REBOOK',responsible_name:'Amy',status:'COMPLETED' },
    { followupid:3,raised_date:'2026-08-20',clientname:'Alpha',asset_label:'Crane 2',kind:'ATTENTION',responsible_name:'Ben',status:'WAITING' }
  ]
  const order=(key,direction)=>sortRows([...sortable],key,direction).map(r=>r.followupid)
  assert.deepEqual(order('date','asc'),[2,3,1]);assert.deepEqual(order('date','desc'),[1,2,3])
  assert.deepEqual(order('customer','asc'),[3,2,1]);assert.deepEqual(order('responsible','desc'),[1,3,2])
  assert.deepEqual(order('status','asc'),[2,1,3]);assert.deepEqual(order('followup','asc'),[3,1,2])
  assert.equal(sortRows([{followupid:1,raised_date:null},...sortable],'date','desc').at(-1).raised_date,null)
  console.log('Follow-up ageing, validation, filters and summary tests passed')
  if (!process.argv.includes('--database')) return

  // Dedicated disposable cluster only. Never load application credentials or a production .env.
  const config={host:'127.0.0.1',port:55439,user:'postgres',database:'postgres'}
  const control=new Pool(config)
  const dbName=`followup_test_${Date.now()}`
  let pool,server,vite,browser
  try {
    await control.query(`CREATE DATABASE ${dbName}`)
    pool=new Pool({...config,database:dbName})
    await pool.query(`CREATE SCHEMA atec;
      CREATE TABLE atec.tblusers(userid integer PRIMARY KEY,fullname text,username text,role text,is_active boolean);
      CREATE TABLE atec.tblclients(clientid integer PRIMARY KEY,clientname text);
      CREATE TABLE atec.tblsites(siteid integer PRIMARY KEY,sitename text);
      CREATE TABLE atec.tblasset(assetid integer PRIMARY KEY,assettagno text,serialno text);
      CREATE TABLE atec.tblusermanagerassignment(employee_user_id integer,manager_user_id integer);
      CREATE TABLE atec.tbljobcard(jobcardid integer PRIMARY KEY,jobcard_reference text,customer_reference text,clientid integer,siteid integer,
        assigned_to_user_id integer,status text,equipment_status text,equipment_status_reason text,recommendations text,submitted_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE atec.tbljobcardasset(jobcardid integer,assetid integer);
      CREATE TABLE atec.tbljobcardmaterial(materialid integer,jobcardid integer,quantity numeric,description text,material_status text);
      INSERT INTO atec.tblusers VALUES (1,'Admin','admin','ADMIN',true),(2,'Technician','tech','INSPECTOR',true),(3,'Manager','manager','MANAGER',true),(4,'Other manager','other','MANAGER',true);
      INSERT INTO atec.tblclients VALUES(1,'Example Engineering');INSERT INTO atec.tblsites VALUES(1,'Main workshop'),(2,'Other site');
      INSERT INTO atec.tblasset VALUES(1,'CRANE-01','SER-01'),(2,'CRANE-02','SER-02');
      INSERT INTO atec.tblusermanagerassignment VALUES(2,3);
      INSERT INTO atec.tbljobcard(jobcardid,jobcard_reference,customer_reference,clientid,siteid,assigned_to_user_id,status,equipment_status,equipment_status_reason,recommendations)
        VALUES(1,'JC-TEST-001','12345',1,1,2,'APPROVED','OUT_OF_SERVICE','Brake does not hold; isolated pending repair.','Replace brake assembly.'),
        (2,'JC-TEST-002','12346',1,1,2,'ASSIGNED','NOT_TESTED','',''),(3,'JC-TEST-003','12347',1,2,2,'ASSIGNED','NOT_TESTED','','');
      INSERT INTO atec.tbljobcardasset VALUES(1,1),(1,2),(2,1);
      INSERT INTO atec.tbljobcardmaterial VALUES(1,1,1,'Brake assembly','REQUIRED');`)
    const migration=fs.readFileSync(path.join(root,'database/2026-09-25-job-card-followups.sql'),'utf8')
    await pool.query(migration);await pool.query(migration)
    assert.equal((await pool.query('SELECT * FROM atec.tbljobcardfollowup')).rowCount,2)
    await syncFollowups(pool,1,{quote_required:true,return_visit_required:true,return_visit_reason:'Fit brake and test; waiting for parts'},1)
    await syncFollowups(pool,1,{},1)
    assert.equal((await pool.query('SELECT * FROM atec.tbljobcardfollowup')).rowCount,4)
    const app=express();app.use(express.json())
    app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);req.user={role:req.headers['x-test-role']||'ADMIN',user_id:Number(req.headers['x-test-user']||1)};next()})
    registerJobCardFollowupRoutes(app,{pool,asyncRoute:fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next)})
    app.use((error,req,res,next)=>res.status(error.statusCode||500).json({error:error.message}))
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))})
    const base=`http://127.0.0.1:${server.address().port}`
    const api=async(url,options={})=>{const response=await fetch(base+url,options);return {status:response.status,data:await response.json()}}
    const manager={'x-test-role':'MANAGER','x-test-user':'3'}
    const other={'x-test-role':'MANAGER','x-test-user':'4'}
    let report=await api('/job-cards/followups')
    assert.equal(report.data.rows.length,4);assert.equal(report.data.summary.attention,2)
    assert.equal((await api('/job-cards/followups',{headers:manager})).data.rows.length,4)
    assert.equal((await api('/job-cards/followups',{headers:other})).data.rows.length,0)
    for (const role of ['INSPECTOR','CUSTOMER','HR','VIEWER']) assert.equal((await api('/job-cards/followups',{headers:{'x-test-role':role}})).status,403)
    const quote=report.data.rows.find(r=>r.kind==='QUOTE');const attention=report.data.rows.find(r=>r.kind==='ATTENTION');const rebook=report.data.rows.find(r=>r.kind==='REBOOK')
    const update=(r,body,headers={})=>api(`/job-cards/followups/${r.followupid}`,{method:'PUT',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({status:r.status,version:r.version,...body})})
    assert.equal((await update(quote,{status:'HANDED_OVER'},other)).status,404)
    assert.equal((await update(quote,{status:'HANDED_OVER',accelo_reference:'ACC-789',responsible_user_id:3},manager)).status,200)
    assert.equal((await update(quote,{status:'OPEN'})).status,409)
    assert.equal((await update(attention,{status:'RESOLVED'})).status,400)
    assert.equal((await update(attention,{status:'RESOLVED',notes:'Repaired and verified; evidence on return job card.'})).status,200)
    assert.equal((await update(rebook,{status:'BOOKED',booked_date:'2026-10-01',return_jobcardid:3})).status,400)
    assert.equal((await update(rebook,{status:'BOOKED',booked_date:'2026-10-01',return_jobcardid:1})).status,400)
    assert.equal((await update(rebook,{status:'BOOKED',booked_date:'2026-10-01',return_jobcardid:2})).status,200)
    await syncFollowups(pool,1,{quote_required:false,return_visit_required:false},1)
    report=await api('/job-cards/followups')
    assert.equal(report.data.rows.find(r=>r.followupid===quote.followupid).status,'HANDED_OVER')
    assert.equal(report.data.rows.find(r=>r.followupid===attention.followupid).status,'RESOLVED')
    assert.equal(report.data.summary.attention,1)
    assert.equal((await api('/job-cards/followups?state=CLOSED')).data.rows.length,2)
    assert.equal((await api('/job-cards/followups?kind=QUOTE&owner=3')).data.rows.length,1)
    // Beyond the operational queue cap, exports and totals must include every matching item.
    await pool.query(`INSERT INTO atec.tbljobcard(jobcardid,jobcard_reference,clientid,siteid,assigned_to_user_id,status) SELECT x,'JC-'||x,1,1,2,'INVOICED' FROM generate_series(10,270) x;
      INSERT INTO atec.tbljobcardfollowup(jobcardid,kind,description) SELECT x,'QUOTE','Review quotation '||x FROM generate_series(10,270) x`)
    report=await api('/job-cards/followups');assert.equal(report.data.rows.length,265)
    const xlsxResponse=await fetch(base+'/job-cards/followups/export/xlsx?kind=QUOTE')
    if (!xlsxResponse.ok) throw new Error(await xlsxResponse.text())
    const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await xlsxResponse.arrayBuffer()))
    assert.equal(book.getWorksheet('Follow-ups').rowCount,263)
    assert.equal((await fetch(base+'/job-cards/followups/export/pdf',{headers:other})).status,200)
    const qa=path.join(root,'tmp/followups-qa');fs.mkdirSync(qa,{recursive:true})
    const preview=await reportData(pool,{role:'ADMIN',user_id:1},{kind:'ATTENTION'})
    fs.writeFileSync(path.join(qa,'report.pdf'),await pdf(preview))
    fs.writeFileSync(path.join(qa,'report.xlsx'),await workbook(preview))
    const long={...preview,rows:[{...preview.rows[0],description:('Long technical findings with work required and supporting details. ').repeat(250)}]}
    fs.writeFileSync(path.join(qa,'long-report.pdf'),await pdf(long))
    console.log('Database migration, repeat saves, permissions, updates, conflicts, history, filters and full-size export tests passed')
    if (process.argv.includes('--browser')) {
      const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href)
      vite=await createServer({root:path.join(root,'frontend'),server:{host:'127.0.0.1',port:0},plugins:[{name:'followup-test-harness',configureServer(v){v.middlewares.use('/followups-test',(req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="page"></main><script type="module">import '/src/style.css';import {showJobCardFollowups} from '/src/pages/JobCardFollowups.js';showJobCardFollowups({apiBase:${JSON.stringify(base)},page:document.querySelector('#page'),onBack:()=>{},onOpenJob:id=>{window.openedJob=id}});</script></body></html>`)})}}]})
      await vite.listen()
      const puppeteer=require('../../backend/node_modules/puppeteer-core')
      browser=await puppeteer.launch({executablePath:process.env.FOLLOWUP_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']})
      const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
      await page.setViewport({width:1440,height:1000});await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/followups-test`)
      await page.waitForSelector('[data-review]');await page.screenshot({path:path.join(qa,'desktop.png'),fullPage:true})
      await page.click('[data-sort="date"]');await page.waitForFunction(()=>document.querySelector('[data-sort="date"]').closest('th').getAttribute('aria-sort')==='ascending')
      await page.click('#jfNext');await page.click('[data-sort="customer"]');await page.waitForFunction(()=>document.querySelector('[data-sort="customer"]').closest('th').getAttribute('aria-sort')==='ascending')
      assert.equal(await page.$eval('#jfPrevious',b=>b.disabled),true)
      await page.click('[data-sort="customer"]');await page.waitForFunction(()=>document.querySelector('[data-sort="customer"]').closest('th').getAttribute('aria-sort')==='descending')
      await page.click('[data-tab="REBOOK"]');await page.waitForFunction(()=>document.querySelector('[data-tab="REBOOK"]')?.getAttribute('aria-pressed')==='true')
      await page.click('[data-review]');await page.waitForSelector('dialog[open]');await page.waitForSelector('[name="return_jobcardid"] option[value="2"]')
      await page.select('[name="status"]','COMPLETED');await page.type('[name="notes"]','Return work complete and tested; evidence on JC-TEST-002.');await page.click('#jfEdit [type="submit"]')
      await page.waitForFunction(()=>document.querySelector('.jf-table tbody')?.textContent.includes('No follow-ups match'))
      await page.select('[name="state"]','CLOSED');await page.click('#jfFilters [type="submit"]');await page.waitForFunction(()=>document.querySelector('.jf-table tbody')?.textContent.includes('Completed'))
      await page.click('[data-review]');await page.click('details summary');await page.screenshot({path:path.join(qa,'history.png'),fullPage:true})
      await page.click('#jfClose');await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(qa,'mobile.png'),fullPage:true})
      assert.deepEqual(errors,[])
      console.log('Desktop/mobile report view and real browser completion/history workflow passed')
    }
  } finally {
    if(browser)await browser.close();if(vite)await vite.close();if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end()
    await control.query(`DROP DATABASE IF EXISTS ${dbName}`);await control.end()
  }
}
run().catch(error=>{console.error(error);process.exitCode=1})
