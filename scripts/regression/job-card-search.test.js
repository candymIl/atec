const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'frontend/src/main.js'), 'utf8')
const queue = source.slice(source.indexOf('let jobCardListRows = []'), source.indexOf('async function loadJobCardAssets'))
const elements = {
  '#jobCardList': { innerHTML: '' },
  '#jobCardSearch': { value: '', selectionStart: 0, selectionEnd: 0, selectionDirection: 'none',
    focus() { document.activeElement = this },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end } },
  '#jobCardStatusFilter': { value: '' },
  '#jobCardTechnicianFilter': { value: '' },
  '#jobCardSort': { value: 'UPDATED_DESC' }
}
const document = { querySelector: id => elements[id], activeElement: elements['#jobCardSearch'] }
let pending
const context = vm.createContext({
  window: {}, document, API_BASE: '/api', escapeHtml: String, safeAttr: String,
  setTimeout: callback => { pending = callback; return 1 }, clearTimeout: () => { pending = null }
})
vm.runInContext(queue, context)
const cards = [
  { jobcardid: 1, jobcard_reference: 'JC-ACTIVE', clientname: 'Other Customer', status: 'IN_PROGRESS' },
  { jobcardid: 2, jobcard_reference: 'JC-ROCBOLT', clientname: 'Rocbolt', status: 'APPROVED', customer_reference: '12179', assigned_to_name: 'Inspector One' },
  { jobcardid: 3, jobcard_reference: 'JC-REVIEW', clientname: 'Rocbolt', status: 'SUBMITTED' }
]
context.cards = cards
vm.runInContext('jobCardListRows = cards; renderJobCardList()', context)
const html = () => elements['#jobCardList'].innerHTML
assert.ok(!html().includes('JC-ROCBOLT'), 'Active queue initially excludes completed cards')
elements['#jobCardStatusFilter'].value = 'IN_PROGRESS'
elements['#jobCardTechnicianFilter'].value = 'Someone Else'
elements['#jobCardSearch'].value = 'Rocbolt '
elements['#jobCardSearch'].selectionStart = 3
elements['#jobCardSearch'].selectionEnd = 3
context.window.jobCardListSearchChanged()
pending()
assert.ok(html().includes('JC-ROCBOLT'), 'Customer search must find completed Rocbolt cards from Active')
assert.ok(html().includes('JC-REVIEW'), 'Search must include cards awaiting review')
assert.ok(!html().includes('JC-ACTIVE'), 'Unrelated customers must be excluded')
assert.ok(html().includes('value="Rocbolt "'), 'Rendering must preserve case and trailing spaces while typing')
assert.equal(elements['#jobCardSearch'].selectionStart, 3, 'Editing must preserve the caret position')
assert.equal(elements['#jobCardStatusFilter'].value, '', 'Starting a search clears a restrictive status')
assert.equal(elements['#jobCardTechnicianFilter'].value, '', 'Starting a search clears a restrictive inspector')
context.window.setJobCardListView('COMPLETED')
assert.ok(html().includes('JC-ROCBOLT'))
assert.ok(!html().includes('JC-REVIEW'), 'Users may explicitly narrow search results by tab')
context.window.clearJobCardListFilters()
elements['#jobCardSearch'].value = '12179'
document.activeElement = elements['#jobCardStatusFilter']
context.window.jobCardListSearchChanged()
pending()
assert.ok(html().includes('JC-ROCBOLT'), 'Accelo number search must still work')
assert.equal(document.activeElement, elements['#jobCardStatusFilter'], 'Delayed search must not steal focus')
context.cards = Array.from({ length: 260 }, (_, index) => ({ ...cards[0], jobcardid: index + 10 }))
context.cards.push(cards[1])
vm.runInContext('jobCardListRows = cards', context)
context.window.clearJobCardListFilters()
elements['#jobCardSearch'].value = 'rocbolt'
context.window.jobCardListSearchChanged()
pending()
assert.ok(html().includes('JC-ROCBOLT'), 'Search must find matches beyond the first 250 records')
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8')
const route = server.slice(server.indexOf('app.get("/job-cards",'), server.indexOf('app.get("/job-cards-technicians",'))
assert.ok(!/LIMIT\s+250/i.test(route), 'The API must not silently truncate searchable job cards')
assert.ok(route.includes('req.user.role === "INSPECTOR"') && route.includes('req.user.role === "MANAGER"'), 'Role restrictions must remain in place')

context.sortCards = [
  { jobcardid: 1, jobcard_reference: 'JC-10', customer_reference: '10', clientname: 'zebra', sitename: 'West', assigned_to_name: 'Zoe', status: 'SUBMITTED', planned_at: '2026-09-29', updated_at: '2026-09-29' },
  { jobcardid: 2, jobcard_reference: 'JC-2', customer_reference: '2', clientname: 'Alpha', sitename: 'East', assigned_to_name: 'Amy', status: 'APPROVED', planned_at: '2026-09-01', updated_at: '2026-09-01' },
  { jobcardid: 3, jobcard_reference: 'JC-3', customer_reference: '', clientname: '', sitename: '', assigned_to_name: '', status: 'DRAFT', planned_at: null, updated_at: 'invalid' }
]
for (const key of ['REFERENCE', 'ACCELO', 'CUSTOMER', 'SITE', 'INSPECTOR', 'PLANNED', 'UPDATED', 'STATUS']) {
  for (const direction of ['ASC', 'DESC']) {
    const result = vm.runInContext(`[...sortCards].sort((a, b) => compareJobCardRows(a, b, '${key}_${direction}')).map(card => card.jobcardid).join(',')`, context)
    const expected = key === 'REFERENCE' || key === 'INSPECTOR' || key === 'STATUS'
      ? (direction === 'ASC' ? '2,3,1' : '1,3,2') : (direction === 'ASC' ? '2,1,3' : '1,2,3')
    assert.equal(result, expected, `${key} ${direction}: natural sorting, with absent/invalid values last`)
  }
}
context.window.clearJobCardListFilters()
context.cards = Array.from({ length: 20 }, (_, index) => ({ ...cards[0], jobcardid: index + 1, jobcard_reference: `JC-${index + 1}`, clientname: `Customer ${20 - index}` }))
vm.runInContext('jobCardListRows = cards; jobCardListView = "ALL"; jobCardListPage = 2', context)
context.window.sortJobCardColumn('CUSTOMER')
assert.equal(elements['#jobCardSort'].value, 'CUSTOMER_ASC')
assert.equal(vm.runInContext('jobCardListPage', context), 1, 'Sorting resets pagination')
assert.ok(html().indexOf('>Customer 1<') < html().indexOf('>Customer 2<'), 'Sort all results before pagination')
assert.ok(!html().includes('>Customer 20<'), 'Last sorted result belongs on the next page')
assert.ok(html().includes('aria-sort="ascending"'), 'Announce the active sort direction')
context.window.sortJobCardColumn('CUSTOMER')
assert.equal(elements['#jobCardSort'].value, 'CUSTOMER_DESC')
assert.ok(html().indexOf('>Customer 20<') < html().indexOf('>Customer 19<'))
for (const view of ['ACTIVE', 'REVIEW', 'COMPLETED', 'CANCELLED', 'ALL']) {
  context.window.setJobCardListView(view)
  assert.equal(elements['#jobCardSort'].value, 'CUSTOMER_DESC', 'Changing tabs preserves sorting')
  assert.equal((html().match(/data-job-card-sort=/g) || []).length, 8, `${view} exposes every sortable heading, including empty views`)
}
console.log('Job-card search regression checks passed')
