export function southAfricanDate(value = new Date()) {
  // Unzoned date/time inputs already describe the user's chosen calendar day.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}$)/.test(value)) return value.slice(0, 10)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return southAfricanDate()
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export class InspectionAssetSelection {
  constructor(excluded = []) {
    this.excluded = new Set(excluded.map(String))
    this.automatic = new Set()
  }
  manual(id, checked) {
    id = String(id)
    this.automatic.delete(id)
    if (checked) this.excluded.delete(id)
    else this.excluded.add(id)
  }
  clearAutomatic(inputs) {
    for (const input of inputs) if (this.automatic.has(input.value)) input.checked = false
    this.automatic.clear()
  }
  apply(ids, inputs) {
    const matches = new Set(ids.map(String))
    let added = 0
    for (const input of inputs) {
      if (matches.has(input.value) && !this.excluded.has(input.value) && !input.checked) {
        input.checked = true
        this.automatic.add(input.value)
        added++
      }
    }
    return added
  }
}

export function initialiseInspectionAssetSelection({ form, card, apiBase, readResponse, updateSummary }) {
  const state = new InspectionAssetSelection(card.inspection_asset_exclusions || [])
  const note = form.querySelector('#jcInspectedAssetNote')
  const button = form.querySelector('#jcApplyInspectedAssets')
  const inputs = () => [...form.querySelectorAll('[name="jcAsset"]')]
  const value = id => form.querySelector(`#${id}`)?.value || ''
  const locked = ['SUBMITTED', 'APPROVED', 'INVOICED', 'CANCELLED'].includes(card.status)
  let request = 0, lastKey = '', pending = Promise.resolve(), candidates = []
  function scope() {
    return { jobcardid: card.jobcardid, clientid: value('jcClient'), siteid: value('jcSite'), sectionid: value('jcSection'),
      customer_reference: value('jcReference').trim(), inspection_work_date: value('jcInspectionDate'),
      assigned_to_user_id: value('jcAssigned'), crew: [...form.querySelectorAll('[name="jcCrew"]:checked')].map(input => ({ user_id: Number(input.value) })) }
  }
  function refresh(force = false) {
    if (locked || !form.isConnected) return Promise.resolve()
    const body = scope(), key = JSON.stringify(body)
    if (!force && key === lastKey) return pending
    lastKey = key
    const ticket = ++request
    candidates = []; button.hidden = true
    state.clearAutomatic(inputs()); updateSummary()
    if (!body.clientid || !body.siteid || !body.assigned_to_user_id || !body.inspection_work_date) {
      note.textContent = 'Choose the customer, site, technician and inspection work date to find inspected assets.'
      return (pending = Promise.resolve())
    }
    note.textContent = 'Finding inspected assets…'
    pending = (async () => {
      try {
        const response = await fetch(`${apiBase}/job-cards/inspection-assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const result = await readResponse(response)
        if (ticket !== request || !form.isConnected || JSON.stringify(scope()) !== key) return
        if (!response.ok) throw new Error(result.error || 'Could not find inspected assets')
        candidates = result.assetids || []
        if (result.requires_confirmation) {
          note.textContent = `${candidates.length} inspected assets found for this day and crew. No job number entered: review the scope, then choose “Select daily matches”.`
          button.hidden = candidates.length === 0
        } else {
          const added = state.apply(candidates, inputs())
          note.textContent = `${candidates.length} inspected assets match job ${body.customer_reference} on ${body.inspection_work_date}; ${added} newly selected. Review the selection below. Unticked assets stay excluded.`
          updateSummary()
        }
      } catch (error) {
        if (ticket === request && form.isConnected) note.textContent = `${error.message}. Select assets manually or use Refresh.`
      }
    })()
    return pending
  }
  button.addEventListener('click', () => {
    if (locked) return
    const added = state.apply(candidates, inputs())
    note.textContent = `${added} daily matches selected. Review the assets below and enter the Accelo job number before saving.`
    button.hidden = true; updateSummary()
  })
  form.querySelector('#jcRefreshInspectedAssets').addEventListener('click', () => refresh(true))
  const scopeFields = new Set(['jcClient', 'jcSite', 'jcSection', 'jcReference', 'jcAssigned', 'jcInspectionDate'])
  form.addEventListener('input', event => { if (scopeFields.has(event.target.id)) refresh() })
  form.addEventListener('change', event => {
    if (event.target.name === 'jcAsset') state.manual(event.target.value, event.target.checked)
    if (scopeFields.has(event.target.id) || event.target.name === 'jcCrew') refresh()
  })
  if (locked) note.textContent = 'Saved asset selection retained. Return the job for changes before adding inspected assets.'
  else refresh()
  return { refresh, state }
}
