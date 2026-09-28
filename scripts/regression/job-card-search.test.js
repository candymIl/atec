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
console.log('Job-card search regression checks passed')
