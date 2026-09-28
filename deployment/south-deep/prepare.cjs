// Read-only export of schema and explicitly allowed reference data.
// Customer records, users, signatures, uploads and credentials are never exported.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const dotenv = require(path.join(root, 'backend/node_modules/dotenv'))
const { Client } = require(path.join(root, 'backend/node_modules/pg'))
const allowed = ['tblroles', 'tblequipgroup', 'tblequiptype', 'tblequiptypecriteria', 'tblpublicholiday']
const output = path.resolve(process.argv[2] || path.join(root, 'tmp/south-deep-release'))
const pgDump = process.env.PILOT_PG_DUMP || path.join(root, '.local/postgresql-18.4/pgsql/bin/pg_dump.exe')
const config = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `${command} failed`)
  return result.stdout
}
async function main() {
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.DB_HOST)) throw new Error('Source must be a local database.')
  if (fs.existsSync(output)) throw new Error('Output already exists; choose a new directory. No files were overwritten.')
  const client = new Client({ host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME,
    user: config.DB_USER, password: config.DB_PASSWORD, connectionTimeoutMillis: 5000 })
  await client.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const contract = JSON.parse(fs.readFileSync(path.join(root, 'deployment/production-schema-contract.json')))
    const columns = (await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='atec'")).rows
    for (const requirement of contract.requirements) {
      for (const column of requirement.columns) {
        if (!columns.some(row => row.table_name === requirement.table && row.column_name === column)) throw new Error(`Source missing ${requirement.table}.${column}`)
      }
    }
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot
    const reference = {}
    for (const table of allowed) reference[table] = (await client.query(`SELECT * FROM atec."${table}"`)).rows
    fs.mkdirSync(path.join(output, 'app'), { recursive: true })
    run(pgDump, ['--schema-only', '--schema=atec', '--no-owner', '--no-acl', `--snapshot=${snapshot}`,
      '--file', path.join(output, 'schema.sql')], { env: { ...process.env, PGHOST: config.DB_HOST,
      PGPORT: config.DB_PORT || '5432', PGDATABASE: config.DB_NAME, PGUSER: config.DB_USER, PGPASSWORD: config.DB_PASSWORD } })
    await client.query('COMMIT')
    const archive = path.join(output, 'source.tar')
    run('git', ['archive', '--format=tar', '--output', archive, 'HEAD', 'backend', 'frontend', 'database', 'scripts', 'deployment', 'package.json', 'package-lock.json'])
    run('tar', ['-xf', archive, '-C', path.join(output, 'app')])
    // Overlay the opt-in environment label, leaving the existing production defaults unchanged.
    for (const file of ['frontend/src/main.js', 'frontend/src/workspaceNotice.js']) {
      fs.copyFileSync(path.join(root, file), path.join(output, 'app', file))
    }
    fs.writeFileSync(path.join(output, 'reference.json'), JSON.stringify(reference, null, 2))
    fs.copyFileSync(path.join(__dirname, 'provision.cjs'), path.join(output, 'provision.cjs'))
    fs.copyFileSync(path.join(__dirname, 'README.md'), path.join(output, 'README.md'))
    const manifest = {
      preparedAt: new Date().toISOString(), sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(),
      purpose: 'Full ATEC South Deep pilot; not a verified production deployment. SAP is not connected.',
      dataIncluded: Object.fromEntries(Object.entries(reference).map(([table, rows]) => [table, rows.length])),
      overlays: ['frontend/src/main.js', 'frontend/src/workspaceNotice.js'], files: {}
    }
    function hashDirectory(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) hashDirectory(file)
        else manifest.files[path.relative(output, file).replaceAll('\\', '/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      }
    }
    hashDirectory(output)
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
    console.log(JSON.stringify({ output, sourceCommit: manifest.sourceCommit, referenceRows: manifest.dataIncluded, customerRowsCopied: 0, usersCopied: 0, uploadsCopied: 0 }))
  } finally { await client.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
