const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
process.chdir(path.join(root, 'backend'))
const db = require(path.join(root, 'backend/db'))
const source = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8')
const route = source.slice(source.indexOf('app.get("/responsible-persons"'), source.indexOf('app.post("/responsible-persons"'))
const query = route.match(/pool\.query\(`([\s\S]*?)`\)/)[1].replaceAll('atec.', 'pg_temp.')

;(async () => {
  assert(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST), 'Run fixtures only against a local database')
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TEMP TABLE tblpeople (personid int, clientid int, name text, archived boolean) ON COMMIT DROP;
      CREATE TEMP TABLE tblclients (clientid int, clientname text, archived boolean) ON COMMIT DROP;
      CREATE TEMP TABLE tblsites (siteid int, clientid int, sitename text, archived boolean) ON COMMIT DROP;
      CREATE TEMP TABLE tblsection (sectionid int, clientid int, siteid int, sectionname text, responsibleid int, archived boolean) ON COMMIT DROP;
      CREATE TEMP TABLE tblasset (sectionid int, responsibleid int, archived boolean) ON COMMIT DROP;
      INSERT INTO tblclients VALUES (1, 'Customer', false);
      INSERT INTO tblpeople VALUES (500, 1, 'Phemelo', false), (501, 1, 'Other', false), (502, 1, 'Unlinked', false);
      INSERT INTO tblsites VALUES (1, 1, 'City Deep', false), (2, 1, 'Archived site', true), (3, 2, 'Wrong customer', false);
      INSERT INTO tblsection VALUES
        (1256, 1, 1, 'Stores', NULL, false),
        (2, 1, 1, 'Explicit', 500, false),
        (3, 1, 1, 'Ambiguous', NULL, false),
        (4, 1, 1, 'Archived section', 500, true),
        (5, 1, 1, 'Archived assets only', NULL, false),
        (6, 1, 2, 'Old site section', 500, false),
        (7, 1, 3, 'Mismatched site section', 500, false);
      INSERT INTO tblasset VALUES
        (1256, 500, false), (1256, 500, false), (1256, NULL, false), (1256, 501, true),
        (2, 501, false), (3, 500, false), (3, 501, false), (5, 500, true);
    `)
    const rows = (await client.query(query)).rows
    assert.equal(rows.length, 3, 'One result per person')
    const person = rows.find(row => row.personid === 500)
    assert.equal(person.sitename, 'City Deep', 'Sites are unique, active, and customer-matched')
    assert.equal(person.sectionname, 'Explicit, Mismatched site section, Old site section, Stores')
    for (const id of [501, 502]) {
      const unlinked = rows.find(row => row.personid === id)
      assert.equal(unlinked.sitename, null)
      assert.equal(unlinked.sectionname, null, 'Explicit ownership wins; conflicting or archived assets do not infer an owner')
    }
    console.log('Responsible person SQL link tests passed: asset fallback, explicit precedence, ambiguity, archives, site scope, deduplication, unlinked people.')
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => db.end())
