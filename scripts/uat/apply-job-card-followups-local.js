const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const dotenv = require('../../backend/node_modules/dotenv')
const { Client } = require('../../backend/node_modules/pg')
const { reportData } = require('../../backend/routes/jobCardFollowups')

async function main() {
  const env = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')))
  if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST) || env.NODE_ENV === 'production') {
    throw new Error('This helper only supports a local development database')
  }
  const client = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT || 5432), database: env.DB_NAME,
    user: env.DB_USER, password: env.DB_PASSWORD, application_name: 'atec-followups-local-setup' })
  await client.connect()
  try {
    const name = '2026-09-25-job-card-followups.sql'
    const sql = fs.readFileSync(path.join(root, 'database', name), 'utf8')
    const checksum = crypto.createHash('sha256').update(sql).digest('hex')
    if (process.argv.includes('--apply')) {
      await client.query('BEGIN')
      try {
        await client.query(sql.replace(/^\s*BEGIN\s*;\s*/i, '').replace(/\s*COMMIT\s*;\s*$/i, ''))
        await client.query(`INSERT INTO atec.schema_migrations (migration_name,checksum,notes)
          VALUES ($1,$2,'Applied to local development database for job-card follow-up verification')
          ON CONFLICT (migration_name) DO UPDATE SET checksum=EXCLUDED.checksum,notes=EXCLUDED.notes`, [name,checksum])
        // Verify against the actual development schema before committing the migration.
        const report = await reportData(client, { role: 'ADMIN' }, { state: 'OPEN' })
        await client.query('COMMIT')
        console.log(JSON.stringify({ applied: name, openItems: report.rows.length, summary: report.summary }))
      } catch (error) { await client.query('ROLLBACK'); throw error }
    } else {
      const report = await reportData(client, { role: 'ADMIN' }, { state: 'OPEN' })
      console.log(JSON.stringify({ verified: true, openItems: report.rows.length, summary: report.summary }))
    }
  } finally { await client.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
