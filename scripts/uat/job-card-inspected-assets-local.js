// Local-only PostgreSQL verification. All fixtures and migration changes roll back.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
require(path.join(root, 'backend/node_modules/dotenv')).config({ path: path.join(root, 'backend/.env'), quiet: true })
const { Client } = require(path.join(root, 'backend/node_modules/pg'))
const { inspectedAssetIdsForJob } = require('../../backend/services/jobCardInspectionAssets')

async function main() {
  if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST) || process.env.NODE_ENV === 'production') throw new Error('Local development database required')
  const client = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectionTimeoutMillis: 5000, statement_timeout: 10000 })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout='2s'")
    const migration = fs.readFileSync(path.join(root, 'database/2026-09-29-job-card-inspected-assets.sql'), 'utf8').replace(/^BEGIN;/, '').replace(/COMMIT;\s*$/, '')
    await client.query(migration)
    await client.query(migration) // Repeatability.
    await client.query(`CREATE TEMP TABLE test_jobcard (LIKE atec.tbljobcard INCLUDING DEFAULTS)`)
    const columns = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='atec'
      AND table_name='tbljobcard' AND column_name IN ('inspection_work_date','inspection_asset_exclusions')`)
    assert.equal(columns.rows.length, 2)
    await client.query(`CREATE TEMP TABLE test_asset (assetid int, clientid int, siteid int, sectionid int, archived boolean);
      CREATE TEMP TABLE test_inspection (assetid int, inspector_user_id int, testdate date, job_number text, record_status text);
      INSERT INTO test_asset SELECT n, CASE WHEN n=6 THEN 2 ELSE 1 END, CASE WHEN n=7 THEN 3 ELSE 2 END,
        CASE WHEN n=10 THEN 6 ELSE 5 END, n=8 FROM generate_series(1,10) n;
      INSERT INTO test_inspection VALUES
        (1,10,'2026-09-29','11927','ACTIVE'), (1,10,'2026-09-29','11927','ACTIVE'),
        (2,11,'2026-09-29','11927','ACTIVE'), (3,10,'2026-09-28','11927','ACTIVE'),
        (4,10,'2026-09-29','11928','ACTIVE'), (5,12,'2026-09-29','11927','ACTIVE'),
        (6,10,'2026-09-29','11927','ACTIVE'), (7,10,'2026-09-29','11927','ACTIVE'),
        (8,10,'2026-09-29','11927','ACTIVE'), (9,10,'2026-09-29','11927','VOID'),
        (10,10,'2026-09-29','11927','ACTIVE')`)
    const queryClient = { query: (sql, args) => client.query(sql.replaceAll('atec.tblinspection', 'test_inspection').replaceAll('atec.tblasset', 'test_asset'), args) }
    const scope = { clientid: 1, siteid: 2, sectionid: 5, assigned_to_user_id: 10, crew: [{ user_id: 11 }], inspection_work_date: '2026-09-29', customer_reference: '11927' }
    assert.deepEqual(await inspectedAssetIdsForJob(queryClient, scope), [1, 2])
    assert.deepEqual(await inspectedAssetIdsForJob(queryClient, { ...scope, customer_reference: '' }), [1, 2, 4])
    assert.deepEqual(await inspectedAssetIdsForJob(queryClient, { ...scope, crew: [] }), [1])
    assert.deepEqual(await inspectedAssetIdsForJob(queryClient, { ...scope, sectionid: null }), [1, 2, 10])
    assert.deepEqual(await inspectedAssetIdsForJob(queryClient, { ...scope, inspection_work_date: '2026-09-28' }), [3])
    console.log('Local PostgreSQL matching and repeatable migration checks passed. Fixtures and migration rolled back.')
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
