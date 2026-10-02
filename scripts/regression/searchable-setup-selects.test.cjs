const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('C:/Users/JacquesJonker/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<label>Customer<select id="assetClient"><option value="">Select customer</option><option value="1">Alpha Company</option><option value="2">CG BOLTS</option></select></label><select id="assetSite"><option value="">Select site</option></select><select id="assetResponsibleSelect" style="display:none"><option value="1">Person</option></select>')
    const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/searchableSetupSelects.js'), 'utf8').replaceAll('export ', '')
    await page.addScriptTag({ content: source })
    await page.evaluate(() => {
      window.changes = 0
      document.querySelector('#assetClient').onchange = () => {
        window.changes++
        document.querySelector('#assetSite').innerHTML = '<option value="">Select site</option><option value="3">Duvha Powerstation</option><option value="4">Other Site</option>'
      }
    })
    const search = page.getByRole('searchbox', { name: 'Search customers' })
    await search.fill('cg bolts')
    assert.deepEqual(await page.locator('#assetClient option').allTextContents(), ['Select customer', 'CG BOLTS'])
    assert.equal(await page.evaluate(() => window.changes), 0, 'Typing must not allocate or trigger dependent changes')
    await page.selectOption('#assetClient', '2')
    assert.equal(await page.evaluate(() => window.changes), 1)
    assert.equal(await search.inputValue(), '')
    assert.equal(await page.locator('#assetClient option').count(), 3)
    const siteSearch = page.getByRole('searchbox', { name: 'Search sites' })
    await siteSearch.fill('duvha')
    assert.deepEqual(await page.locator('#assetSite option').allTextContents(), ['Select site', 'Duvha Powerstation'])
    await search.fill('does not exist')
    assert.equal(await page.locator('#assetClient').inputValue(), '2', 'Search retains current allocation')
    assert.match(await page.locator('.setup-select-search-status').first().innerText(), /0 matching customers/)
    await search.fill('')
    assert.equal(await page.locator('#assetClient option').count(), 3)
    await page.evaluate(() => { document.querySelector('#assetSite').innerHTML = '<option value="">Select site</option><option value="5">New Site</option>' })
    await page.waitForFunction(() => document.querySelector('[aria-controls="assetSite"]').value === '')
    await siteSearch.fill('new')
    assert.deepEqual(await page.locator('#assetSite option').allTextContents(), ['Select site', 'New Site'])
    assert.equal(await page.locator('[aria-controls="assetResponsibleSelect"]').isVisible(), false)
    await page.evaluate(() => { document.querySelector('#assetResponsibleSelect').style.display = '' })
    await page.locator('[aria-controls="assetResponsibleSelect"]').waitFor({ state: 'visible' })
    await page.evaluate(() => { document.querySelector('#assetSite').disabled = true })
    await page.waitForFunction(() => document.querySelector('[aria-controls="assetSite"]').disabled)
    await page.evaluate(() => {
      const select = document.createElement('select')
      select.id = 'sectionClient'
      select.innerHTML = '<option value="1">New Customer</option>'
      document.body.append(select)
    })
    await page.locator('[aria-controls="sectionClient"]').waitFor()
    assert.equal(await page.locator('[aria-controls="sectionClient"]').count(), 1)
    assert.deepEqual(errors, [])
    console.log('Searchable setup select browser checks passed (mobile viewport).')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
