// Keep native mobile pickers and existing change handlers, with a quick search above them.
export const setupSelectLabels = {
  siteClient: 'customers', responsibleClient: 'customers', sectionClient: 'customers',
  sectionSite: 'sites', sectionResponsible: 'responsible people', editSectionResponsible: 'responsible people',
  assetClient: 'customers', assetSite: 'sites', assetSection: 'sections',
  assetResponsibleSelect: 'responsible people', assetEquipType: 'equipment types',
  editAssetEquipType: 'equipment types', moveAssetSite: 'sites', moveAssetSection: 'sections',
  allocateAssetResponsible: 'responsible people', assetEquipmentGroupFilter: 'equipment groups',
  assetEquipmentTypeFilter: 'equipment types'
}

const controls = new WeakMap()
const signature = select => Array.from(select.options, option => option.outerHTML).join('')

export function initialiseSearchableSetupSelects(root = document) {
  function refresh() {
    for (const [id, label] of Object.entries(setupSelectLabels)) {
      const select = root.querySelector(`#${id}`)
      if (!select) continue
      let control = controls.get(select)
      if (!control) {
        const search = document.createElement('input')
        search.type = 'search'
        search.className = 'setup-select-search'
        search.placeholder = `Search ${label}…`
        search.setAttribute('aria-label', `Search ${label}`)
        search.setAttribute('aria-controls', id)
        search.autocomplete = 'off'
        const status = document.createElement('small')
        status.className = 'setup-select-search-status'
        status.setAttribute('role', 'status')
        select.before(search, status)
        control = { search, status, options: [], rendered: null }
        controls.set(select, control)
        search.addEventListener('input', () => {
          const value = select.value
          const query = search.value.trim().toLocaleLowerCase()
          const matches = control.options.filter(option => option.value && option.textContent.toLocaleLowerCase().includes(query))
          const visible = control.options.filter(option => !option.value || option.value === value || matches.includes(option))
          select.replaceChildren(...visible.map(option => option.cloneNode(true)))
          select.value = value
          control.rendered = signature(select)
          status.textContent = query ? `${matches.length} matching ${label}${value && !matches.some(option => option.value === value) ? ' · current selection retained' : ''}` : ''
        })
        select.addEventListener('change', () => {
          // Restore the full source before dependent handlers or later edits reuse the list.
          const value = select.value
          search.value = ''
          select.replaceChildren(...control.options.map(option => option.cloneNode(true)))
          select.value = value
          control.rendered = signature(select)
          status.textContent = ''
        })
      }
      const current = signature(select)
      if (current !== control.rendered) {
        control.options = Array.from(select.options, option => option.cloneNode(true))
        control.rendered = current
        control.search.value = ''
        control.status.textContent = ''
      }
      const hidden = select.hidden || select.style.display === 'none'
      if (control.search.hidden !== hidden) control.search.hidden = hidden
      if (control.status.hidden !== hidden) control.status.hidden = hidden
      if (control.search.disabled !== select.disabled) control.search.disabled = select.disabled
    }
  }
  refresh()
  const observer = new MutationObserver(refresh)
  observer.observe(root === document ? document.body : root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'style'] })
  return observer
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initialiseSearchableSetupSelects(), { once: true })
  else initialiseSearchableSetupSelects()
}
