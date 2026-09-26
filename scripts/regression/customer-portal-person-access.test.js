const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { loadCustomerPortalScope, portalScopeSql, portalCanReadRecord } = require('../../backend/services/customerPortalAccess')

async function main() {
  const user = { user_id: 10, role: 'CUSTOMER', clientid: 1, email: 'someone.else@example.test' }
  const row = { clientid: 1, portal_personid: 7, personid: 7, person_clientid: 1, person_archived: false, client_archived: false, siteid: 99 }
  const db = { query: async (sql, values) => sql.includes('FROM atec.tblusers') ? { rows: [row] } : { rows: [{ sectionid: 21 }, { sectionid: 22 }] } }
  user.portal_scope = await loadCustomerPortalScope(db, user)
  assert.equal(user.portal_scope.responsibleid, 7)
  assert.equal(user.portal_scope.siteid, null, 'Person can span sites')
  assert(portalCanReadRecord(user, { clientid: 1, siteid: 100, sectionid: 21 }))
  assert(portalCanReadRecord(user, { clientid: 1, siteid: 200, sectionid: 22 }))
  assert(!portalCanReadRecord(user, { clientid: 1, sectionid: 23 }))
  assert(!portalCanReadRecord(user, { clientid: 2, sectionid: 21 }))
  assert(!portalCanReadRecord(user, { clientid: 1 }))
  const params = ['search']
  assert.equal(portalScopeSql(user, params), ' AND a.clientid = $2 AND a.sectionid = ANY($3::bigint[])')
  assert.deepEqual(params, ['search', 1, ['21', '22']])
  user.email = 'another.person@example.test'
  assert.equal((await loadCustomerPortalScope(db, user)).responsibleid, 7, 'Self-service email cannot change ownership')
  user.portal_scope.sectionIds = []
  assert(!portalCanReadRecord(user, { clientid: 1, sectionid: 21 }), 'Empty assignments must not grant customer-wide access')
  assert.equal(portalScopeSql({ role: 'CUSTOMER' }, []), ' AND false')
  row.person_archived = true
  await assert.rejects(loadCustomerPortalScope(db, user), { statusCode: 403 })
  row.person_archived = false
  row.person_clientid = 2
  await assert.rejects(loadCustomerPortalScope(db, user), { statusCode: 403 })
  await assert.rejects(loadCustomerPortalScope({ query: async () => ({ rows: [] }) }, user), { statusCode: 403 })
  row.person_clientid = 1
  row.portal_personid = null
  user.portal_scope = await loadCustomerPortalScope(db, user)
  assert(!portalCanReadRecord(user, { clientid: 1, siteid: 100, sectionid: 21 }))
  assert(portalCanReadRecord(user, { clientid: 1, siteid: 99, sectionid: 21 }))
  const source = fs.readFileSync(path.join(__dirname, '../../backend/server.js'), 'utf8')
  let recipientQueries = 0, reportFilters
  const notificationContext = {
    pool: { query: async (sql, values) => {
      recipientQueries++
      assert.deepEqual(Array.from(values), [1, 7])
      return { rows: [{ email: 'person@example.test', full_name: 'Person' }] }
    } },
    getCustomerDetailedReport: async filters => { reportFilters = filters; return { assets: [{ assetid: 12 }] } },
    notificationAssetPriority: () => 'OVERDUE',
    notificationEmailSubject: () => 'subject', notificationEmailText: () => 'text', notificationEmailHtml: () => 'html'
  }
  vm.createContext(notificationContext)
  vm.runInContext(source.slice(source.indexOf('async function getNotificationRecipients('), source.indexOf('function notificationEmailSubject(')), notificationContext)
  vm.runInContext(source.slice(source.indexOf('async function buildNotificationPreviewFromRow('), source.indexOf('async function recordNotificationDelivery(')), notificationContext)
  assert.equal((await notificationContext.getNotificationRecipients({clientid:1,siteid:2})).length, 0)
  assert.equal(recipientQueries, 0, 'A site-only request must not select every site recipient')
  const recipients = await notificationContext.getNotificationRecipients({clientid:1,responsibleid:7})
  assert.equal(recipients.length, 1)
  const preview = await notificationContext.buildNotificationPreviewFromRow({clientid:1,responsibleid:7},recipients)
  assert.equal(reportFilters.responsibleid, 7)
  assert.equal(reportFilters.clientid, 1)
  assert.equal(preview.attentionAssets.length, 1)
  reportFilters = null
  assert.equal((await notificationContext.buildNotificationPreviewFromRow({clientid:1},[])).attentionAssets.length, 0)
  assert.equal(reportFilters, null, 'Unassigned notifications must not build a whole-customer attachment')
  console.log('Customer portal person access: cross-site ownership, denied access, empty assignments, archived links and mutable email tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
