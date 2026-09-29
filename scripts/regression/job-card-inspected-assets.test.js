const { test } = require('node:test')
const assert = require('node:assert/strict')
const { inspectedAssetIdsForJob, validWorkDate } = require('../../backend/services/jobCardInspectionAssets')

const modulePromise = import('../../frontend/src/jobCardInspectionAssets.js')
const body = { clientid: 1, siteid: 2, assigned_to_user_id: 10, inspection_work_date: '2026-09-29', customer_reference: '11927' }

test('matching uses a single work day, job and crew for service jobs too', async () => {
  let call
  const client = { query: async (sql, values) => { call = { sql, values }; return { rows: [{ assetid: 20 }, { assetid: 20 }, { assetid: 21 }] } } }
  assert.deepEqual(await inspectedAssetIdsForJob(client, { ...body, job_type: 'SERVICES', crew: [{ user_id: 11 }, { user_id: 10 }] }), [20, 21])
  assert.deepEqual(call.values, [1, 2, null, [10, 11], '2026-09-29', '11927'])
  await inspectedAssetIdsForJob(client, { ...body, customer_reference: '' })
  assert.equal(call.values[5], '')
  await assert.rejects(inspectedAssetIdsForJob(client, { ...body, inspection_work_date: '2026-02-30' }), /valid inspection work date/)
  await assert.rejects(inspectedAssetIdsForJob(client, { ...body, customer_reference: '11927x' }), /numeric/)
  assert.equal(validWorkDate('2026-02-30'), false)
})

test('manual exclusions survive refresh and reopening; manual assets survive scope changes', async () => {
  const { InspectionAssetSelection } = await modulePromise
  const state = new InspectionAssetSelection()
  const inputs = [1, 2, 3].map(id => ({ value: String(id), checked: id === 3 }))
  assert.equal(state.apply([1, 1, 2], inputs), 2)
  inputs[0].checked = false; state.manual(1, false)
  assert.equal(state.apply([1, 2], inputs), 0)
  const reopened = new InspectionAssetSelection([...state.excluded])
  assert.equal(reopened.apply([1, 2], inputs), 0)
  state.clearAutomatic(inputs)
  assert.deepEqual(inputs.map(i => i.checked), [false, false, true])
  state.manual(1, true); inputs[0].checked = true
  assert.equal(state.excluded.has('1'), false)
})

test('calendar dates use South African midnight and preserve date-only inputs', async () => {
  const { southAfricanDate } = await modulePromise
  assert.equal(southAfricanDate('2026-09-28T22:30:00Z'), '2026-09-29')
  assert.equal(southAfricanDate('2026-09-28T21:30:00Z'), '2026-09-28')
  assert.equal(southAfricanDate('2026-09-29'), '2026-09-29')
  assert.equal(southAfricanDate('2026-09-29T00:15'), '2026-09-29')
})

function fakeForm() {
  const nodes = Object.fromEntries(Object.entries({ jcClient: '1', jcSite: '2', jcSection: '', jcReference: '11927', jcInspectionDate: '2026-09-29', jcAssigned: '10',
    jcInspectedAssetNote: '', jcApplyInspectedAssets: '', jcRefreshInspectedAssets: '' }).map(([id, value]) => [id, { value, hidden: false, textContent: '', listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn } }]))
  const assets = [1, 2, 3].map(id => ({ value: String(id), checked: false }))
  return { nodes, assets, isConnected: true, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn },
    querySelector(selector) { return nodes[selector.slice(1)] },
    querySelectorAll(selector) { return selector.includes('jcAsset') ? assets : [] } }
}

test('stale responses are ignored, date-only matches need a click, locked cards do not fetch', async () => {
  const { initialiseInspectionAssetSelection } = await modulePromise
  const originalFetch = global.fetch, calls = []
  global.fetch = () => new Promise(resolve => calls.push(resolve))
  try {
    const form = fakeForm()
    const controller = initialiseInspectionAssetSelection({ form, card: { status: 'DRAFT' }, apiBase: '', readResponse: async response => response, updateSummary() {} })
    form.nodes.jcReference.value = '11928'
    const newer = controller.refresh()
    calls[1]({ ok: true, assetids: [2], requires_confirmation: false }); await newer
    calls[0]({ ok: true, assetids: [1], requires_confirmation: false }); await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(form.assets.map(i => i.checked), [false, true, false])
    form.nodes.jcReference.value = ''
    const daily = controller.refresh()
    calls[2]({ ok: true, assetids: [1, 3], requires_confirmation: true }); await daily
    assert.deepEqual(form.assets.map(i => i.checked), [false, false, false])
    form.nodes.jcApplyInspectedAssets.listeners.click()
    assert.deepEqual(form.assets.map(i => i.checked), [true, false, true])
    initialiseInspectionAssetSelection({ form: fakeForm(), card: { status: 'APPROVED' }, apiBase: '', readResponse: async r => r, updateSummary() {} })
    assert.equal(calls.length, 3)
  } finally { global.fetch = originalFetch }
})
