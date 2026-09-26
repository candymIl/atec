// Default is a read-only plan. --apply reads the bootstrap password from stdin;
// never pass a password as an argument or write it to the plan/output files.
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('../backend/node_modules/pg')
const bcrypt = require('../backend/node_modules/bcryptjs')
const dotenv = require('../backend/node_modules/dotenv')
const args = process.argv.slice(2)
const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : null
const normalize = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
const normalizeEmail = value => String(value || '').trim().toLowerCase()
const apply = args.includes('--apply')

async function main() {
  const envFile = option('--env'), planFile = option('--plan'), outputFile = option('--output')
  if (!envFile || !planFile || !outputFile || !option('--expected-host') || !option('--expected-db')) throw Error('Supply --env, --plan, --output, --expected-host and --expected-db')
  const e = dotenv.parse(fs.readFileSync(envFile))
  if (e.DB_HOST !== option('--expected-host') || e.DB_NAME !== option('--expected-db')) throw Error('Database target does not match the reviewed target')
  if (apply && !args.includes('--access-code-verified')) throw Error('Verify person access code before enabling accounts')
  if (apply && String(e.NOTIFICATION_AUTO_SEND_ENABLED).toLowerCase() === 'true') throw Error('Automatic emails must be paused while provisioning accounts')
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  const rows = plan.rows.filter(row => row.allocated_email)
  if (new Set(rows.map(row => normalizeEmail(row.allocated_email))).size !== rows.length) throw Error('Duplicate planned email addresses')
  const db = new Client({host:e.DB_HOST,port:e.DB_PORT||5432,database:e.DB_NAME,user:e.DB_USER,password:e.DB_PASSWORD,connectionTimeoutMillis:10000})
  let password
  const results = []
  try {
    await db.connect()
    await db.query(apply ? 'BEGIN' : 'BEGIN READ ONLY')
    if (apply) await db.query('LOCK TABLE atec.tblusers IN SHARE ROW EXCLUSIVE MODE')
    const columns = (await db.query("SELECT column_name, character_maximum_length FROM information_schema.columns WHERE table_schema='atec' AND table_name='tblusers'")).rows
    if (!columns.some(c => c.column_name === 'portal_personid')) throw Error('Person-access migration is not installed')
    const maxLength = name => columns.find(c => c.column_name === name)?.character_maximum_length || Infinity
    const people = (await db.query(`SELECT p.personid,p.name,p.clientid,c.clientname FROM atec.tblpeople p
      JOIN atec.tblclients c ON c.clientid=p.clientid WHERE NOT COALESCE(p.archived,false) AND NOT COALESCE(c.archived,false)`)).rows
    const users = (await db.query('SELECT userid,username,email,fullname,clientid,portal_personid,role,is_active FROM atec.tblusers')).rows
    for (const row of rows) {
      const matches = people.filter(p => normalize(p.clientname) === normalize(row.clientname) && normalize(p.name) === normalize(row.name))
      const result = { source_personid:row.personid, name:row.name, customer:row.clientname, email:normalizeEmail(row.allocated_email) }
      if (matches.length !== 1) { results.push({...result,status:'PENDING_PERSON_NOT_UNIQUE_OR_ABSENT'}); continue }
      const person = matches[0]
      result.personid = person.personid; result.clientid = person.clientid
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email) || result.email.length > Math.min(maxLength('username'),maxLength('email')) || person.name.length > maxLength('fullname')) {
        results.push({...result,status:'PENDING_FIELD_VALIDATION'}); continue
      }
      const accounts = users.filter(u => normalizeEmail(u.email) === result.email || normalizeEmail(u.username) === result.email || String(u.portal_personid || '') === String(person.personid))
      if (accounts.length) {
        const u = accounts[0]
        if (accounts.length !== 1 || u.role !== 'CUSTOMER' || u.is_active === false || String(u.clientid) !== String(person.clientid) ||
            (u.portal_personid && String(u.portal_personid) !== String(person.personid)) || normalizeEmail(u.email) !== result.email) {
          results.push({...result,status:'PENDING_EXISTING_ACCOUNT_CONFLICT'}); continue
        }
        results.push({...result,userid:u.userid,status:u.portal_personid?'ALREADY_LINKED':'LINK_EXISTING',password_preserved:true})
      } else {
        const otherNamedAccount = users.some(u => String(u.clientid)===String(person.clientid) && normalize(u.fullname)===normalize(person.name))
        results.push({...result,status:otherNamedAccount?'PENDING_EXISTING_NAME_DIFFERENT_EMAIL':'CREATE'})
      }
    }
    const planned = { mode:apply?'applying':'dry-run',host:e.DB_HOST,database:e.DB_NAME,source:path.basename(planFile),generated_at:new Date().toISOString(),results }
    // Reserve an evidence file before any mutation, without credentials or hashes.
    fs.writeFileSync(outputFile, JSON.stringify(planned,null,2), {flag:'wx'})
    if (apply) {
      password = fs.readFileSync(0,'utf8').replace(/\r?\n$/, '')
      if (password.trim().length===0 || password.length<8 || Buffer.byteLength(password,'utf8')>72) throw Error('Invalid bootstrap password length')
      for (const result of results) {
        if (result.status === 'LINK_EXISTING') {
          await db.query('UPDATE atec.tblusers SET portal_personid=$1,updated_at=now() WHERE userid=$2',[result.personid,result.userid])
          result.status = 'LINKED_EXISTING'
        } else if (result.status === 'CREATE') {
          const hash = await bcrypt.hash(password,12)
          const created = await db.query(`INSERT INTO atec.tblusers
            (userid,username,email,password,fullname,userlevel,role,clientid,siteid,sectionid,is_active,portal_personid,update_pw)
            VALUES ((SELECT COALESCE(MAX(userid),0)+1 FROM atec.tblusers),$1,$1,$2,$3,5,'CUSTOMER',$4,NULL,NULL,true,$5,true)
            RETURNING userid`,[result.email,hash,result.name,result.clientid,result.personid])
          result.userid = created.rows[0].userid; result.status = 'CREATED'
        }
      }
      await db.query('COMMIT')
      planned.mode = 'applied'
      fs.writeFileSync(outputFile,JSON.stringify(planned,null,2))
    } else await db.query('ROLLBACK')
    const counts = results.reduce((all,r)=>(all[r.status]=(all[r.status]||0)+1,all),{})
    console.log(JSON.stringify({mode:planned.mode,counts,output:outputFile}))
  } catch (error) {
    await db.query('ROLLBACK').catch(()=>{})
    throw error
  } finally {password=undefined; await db.end()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
