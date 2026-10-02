const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8')
const listSource = server.slice(server.indexOf('const assetSortColumns ='), server.indexOf('app.get("/assets",'))
const detailSource = server.slice(server.indexOf('app.get("/assets/:id",'), server.indexOf('app.post("/assets",'))
const pageSource = fs.readFileSync(path.join(root, 'frontend/src/pages/AssetSetup.js'), 'utf8')
const renderSource = pageSource.slice(pageSource.indexOf('export function renderAssetRow('), pageSource.indexOf('\nexport ', pageSource.indexOf('export function renderAssetRow(') + 1)).replace('export function', 'function')

async function checkPerson(name) {
  const calls = []
  let detailHandler
  const context = {
    console,
    parsePositiveInteger: (value, fallback) => Number(value) || fallback,
    pool: { query: async (sql) => {
      calls.push(sql)
      if (/SELECT COUNT/.test(sql)) return { rows: [{ total: 1 }] }
      // Emulate the projection: a joined name only reaches JSON when selected.
      assert.match(sql, /LEFT JOIN atec\.tblpeople p ON a\.responsibleid = p\.personid/)
      const row = { assetid: 71346, responsibleid: name ? 42 : null }
      if (/p\.name AS responsiblename/.test(sql)) row.responsiblename = name
      return { rows: [row] }
    } },
    app: { get: (_route, handler) => { detailHandler = handler } },
    window: { currentUser: { role: 'CUSTOMER' } },
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    assetSupportsLoadTest: () => false
  }
  vm.createContext(context)
  vm.runInContext(`${listSource}\n${detailSource}\n${renderSource}\nthis.list = getPagedAssets; this.render = renderAssetRow`, context)
  const req = { query: { search: 'Person', searchBy: 'responsiblename', sortKey: 'responsiblename' }, user: { role: 'ADMIN' }, params: { id: '71346' } }
  const list = await context.list(req)
  assert.equal(list.rows[0].responsiblename, name, 'Asset list must return the allocated name')
  assert.equal(list.total, 1)
  assert.match(calls[0], /LOWER\(COALESCE\(p\.name/)
  assert.match(calls[1], /ORDER BY p\.name/)
  let detail
  await detailHandler(req, { json: row => { detail = row }, status: () => { throw new Error('Unexpected error response') } })
  assert.equal(detail.responsiblename, name, 'Asset detail must return the same allocated name')
  const html = context.render(list.rows[0])
  assert.ok(html.includes(`<td data-label="Responsible">${name ? 'Test &amp; Person' : '-'}</td>`), 'Asset card must display the name, escaping markup, or a dash when unassigned')
}

(async () => {
  await checkPerson('Test & Person')
  await checkPerson(null)
  console.log('Asset responsible-person display regression checks passed.')
})().catch(error => { console.error(error); process.exitCode = 1 })
