// Run in a prepared bundle. Creates a NEW database and role; never drops or resets one.
// Supply PostgreSQL administrator connection through PGHOST/PGPORT/PGUSER/PGPASSWORD.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const localRequire = createRequire(path.join(__dirname, 'app/backend/package.json'))
const { Client } = localRequire('pg')
const bcrypt = localRequire('bcryptjs')
const database = process.env.PILOT_DATABASE || 'atec_south_deep_pilot'
const role = `${database}_app`
const origin = process.env.PILOT_ORIGIN
const localMode = process.env.PILOT_LOCAL === 'true'
const port = Number(process.env.PILOT_PORT || 5101)
// Provisioning may use local peer authentication, while the application uses its own TCP login.
const appDbHost = process.env.PILOT_APP_DB_HOST || process.env.PGHOST || '127.0.0.1'
const quote = value => `"${String(value).replaceAll('"', '""')}"`
const literal = value => `'${String(value).replaceAll("'", "''")}'`
const allowed = ['tblroles', 'tblequipgroup', 'tblequiptype', 'tblequiptypecriteria', 'tblpublicholiday']

async function main() {
  if (!/^atec_south_deep_pilot(?:_[a-z0-9]+)?$/.test(database)) throw new Error('Database name must identify the isolated South Deep pilot.')
  const url = new URL(origin)
  if (url.origin !== origin || (!localMode && url.protocol !== 'https:')) throw new Error('PILOT_ORIGIN must be an exact HTTPS origin; local test mode permits HTTP.')
  if (localMode && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Local mode only permits loopback.')
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid pilot backend port.')
  const envFile = path.join(__dirname, 'app/backend/.env')
  const credentialFile = path.join(__dirname, 'pilot-access.json')
  if (fs.existsSync(envFile) || fs.existsSync(credentialFile)) throw new Error('An existing environment or credential file was found; refusing to overwrite it.')
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json')))
  for (const [relative, hash] of Object.entries(manifest.files)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, relative))).digest('hex')
    if (actual !== hash) throw new Error(`Bundle integrity mismatch: ${relative}`)
  }
  const references = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json')))
  if (Object.keys(references).some(key => !allowed.includes(key)) || allowed.some(key => !Array.isArray(references[key]))) throw new Error('Unexpected reference data.')
  const admin = new Client({ database: process.env.PGDATABASE || 'postgres', connectionTimeoutMillis: 5000 })
  await admin.connect()
  const password = crypto.randomBytes(32).toString('hex')
  const adminPassword = `SD!${crypto.randomBytes(18).toString('base64url')}9a`
  let target
  try {
    if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) throw new Error('Pilot database already exists. Nothing changed.')
    if ((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) throw new Error('Pilot role already exists. Nothing changed.')
    await admin.query(`CREATE ROLE ${quote(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`)
    // Write recovery credentials before creating/restoring the database. Reruns intentionally fail closed.
    fs.writeFileSync(credentialFile, JSON.stringify({ database, databaseUser: role, databasePassword: password,
      username: 'southdeep.admin', password: adminPassword, origin }, null, 2), { mode: 0o600, flag: 'wx' })
    await admin.query(`CREATE DATABASE ${quote(database)} OWNER ${quote(role)} TEMPLATE template0`)
    await admin.query(`REVOKE ALL ON DATABASE ${quote(database)} FROM PUBLIC`)
    target = new Client({ host: appDbHost, database, user: role, password, connectionTimeoutMillis: 5000 })
    await target.connect()
    // Search indexes in the ATEC schema depend on this trusted PostgreSQL extension.
    await target.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public')
    const psql = process.env.PILOT_PSQL || 'psql'
    const restored = spawnSync(psql, ['-X', '--set=ON_ERROR_STOP=1', '--single-transaction', '--file', path.join(__dirname, 'schema.sql')], {
      encoding: 'utf8', env: { ...process.env, PGHOST: appDbHost, PGDATABASE: database, PGUSER: role, PGPASSWORD: password }
    })
    if (restored.error || restored.status !== 0) throw new Error(restored.error?.message || restored.stderr || 'Schema restore failed')
    await target.query('BEGIN')
    for (const table of allowed) {
      for (const row of references[table]) {
        const keys = Object.keys(row)
        await target.query(`INSERT INTO atec.${quote(table)} (${keys.map(quote).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row))
      }
    }
    // Fictional starter records are deliberately identified as DEMO, not live mine data.
    const customer = (await target.query("INSERT INTO atec.tblclients(clientname,clientaddr,notify_expiring_certificates,notify_overdue_assets,notify_failed_assets,notify_visit_exceptions) VALUES ('South Deep - DEMO','Pilot demonstration data; not the live register',false,false,false,false) RETURNING clientid")).rows[0].clientid
    const site = (await target.query("INSERT INTO atec.tblsites(clientid,sitename) VALUES ($1,'Demonstration site') RETURNING siteid", [customer])).rows[0].siteid
    const section = (await target.query("INSERT INTO atec.tblsection(clientid,siteid,sectionname) VALUES ($1,$2,'Demonstration workshop') RETURNING sectionid", [customer, site])).rows[0].sectionid
    const types = (await target.query("SELECT equiptypeid,description FROM atec.tblequiptype WHERE description ILIKE '%chain%hoist%' OR description ILIKE '%shackle%' OR description ILIKE '%lever%hoist%' ORDER BY equiptypeid LIMIT 3")).rows
    for (const [index, type] of types.entries()) {
      await target.query("INSERT INTO atec.tblasset(clientid,siteid,sectionid,equiptypeid,serialno,assettagno,description,wll) VALUES ($1,$2,$3,$4,$5,$6,$7,'1000')",
        [customer, site, section, type.equiptypeid, `DEMO-SD-${index + 1}`, `DEMO-${index + 1}`, `DEMO ONLY - ${type.description}`])
    }
    await target.query("INSERT INTO atec.tblusers(username,password,userlevel,fullname,role,is_active,update_pw) VALUES ($1,$2,1,'South Deep Pilot Administrator','ADMIN',true,true)", ['southdeep.admin', await bcrypt.hash(adminPassword, 12)])
    // Reset only sequences in the newly created database, after the explicit-ID reference import.
    const sequences = (await target.query("SELECT table_name,column_name,pg_get_serial_sequence(format('%I.%I',table_schema,table_name),column_name) AS seq FROM information_schema.columns WHERE table_schema='atec' AND column_default LIKE 'nextval(%'")).rows
    for (const row of sequences) {
      if (row.seq) await target.query(`SELECT setval($1::regclass, COALESCE(MAX(${quote(row.column_name)}),1), MAX(${quote(row.column_name)}) IS NOT NULL) FROM atec.${quote(row.table_name)}`, [row.seq])
    }
    await target.query('COMMIT')
    const uploadRoot = path.join(__dirname, 'uploads').replaceAll('\\', '/')
    fs.mkdirSync(uploadRoot, { recursive: true })
    const environment = {
      DB_HOST: appDbHost, DB_PORT: process.env.PGPORT || '5432', DB_NAME: database, DB_USER: role, DB_PASSWORD: password, DB_SCHEMA: 'atec',
      DB_POOL_MAX: '5', DB_APPLICATION_NAME: 'atec-south-deep-pilot', PORT: port, NODE_ENV: localMode ? 'development' : 'production',
      FRONTEND_ORIGIN: origin, PUBLIC_APP_URL: origin, PUBLIC_BASE_PATH: '/', BACKEND_API_PREFIX: '/api',
      JWT_SECRET: crypto.randomBytes(48).toString('hex'), JWT_EXPIRES_IN: '8h', COOKIE_SECURE: localMode ? 'false' : 'true', COOKIE_SAME_SITE: 'lax', COOKIE_PATH: '/',
      TRUST_PROXY: localMode ? '' : '1', UPLOAD_ROOT: uploadRoot, UPLOADS_PATH: uploadRoot, NOTIFICATION_AUTO_SEND_ENABLED: 'false',
      COMPLIANCE_EXPIRY_REMINDERS_ENABLED: 'false',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', GRAPH_TENANT_ID: '', GRAPH_CLIENT_ID: '', GRAPH_CLIENT_SECRET: '', GRAPH_SENDER: '',
      BUILD_ID: `south-deep-pilot-${manifest.sourceCommit.slice(0, 8)}`
    }
    fs.writeFileSync(envFile, Object.entries(environment).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' })
    fs.writeFileSync(path.join(__dirname, 'app/frontend/.env.production'), [
      `VITE_API_URL=${origin}/api`, 'VITE_BASE_PATH=/', 'VITE_WORKSPACE_LABEL=South Deep | Pilot',
      'VITE_WORKSPACE_NOTICE=Demonstration records - SAP not connected', 'VITE_GOOGLE_MAPS_API_KEY='
    ].join('\n') + '\n', { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify({ database, role, sampleAssets: types.length, origin, credentialFile, sapConnected: false, emailConfigured: false }))
  } finally {
    if (target) await target.end()
    await admin.end()
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
