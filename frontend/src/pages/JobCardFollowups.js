import './jobCardFollowups.css'

const labels = { QUOTE: 'To Quote', ATTENTION: 'Assets Needing Attention', REBOOK: 'To Rebook', OPEN: 'Open', HANDED_OVER: 'Handed to Accelo', RESOLVED: 'Resolved', WAITING: 'Waiting', BOOKED: 'Booked', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }
const statuses = { QUOTE: ['OPEN','HANDED_OVER','CANCELLED'], ATTENTION: ['OPEN','RESOLVED','CANCELLED'], REBOOK: ['OPEN','WAITING','BOOKED','COMPLETED','CANCELLED'] }
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
const option = (value, label, selected) => `<option value="${escape(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${escape(label)}</option>`
const historyLabels = { status:'Status',responsible_user_id:'Responsible person',due_date:'Due date',accelo_reference:'Accelo reference',booked_date:'Return visit',return_jobcardid:'Return job card',notes:'Notes / resolution' }

export async function showJobCardFollowups({ apiBase, page, onBack, onOpenJob }) {
  let data, active = '', pageNumber = 1, busy = false, requestNumber = 0
  let filters = { state: 'OPEN' }
  const pageSize = 25
  page.innerHTML = `<div class="page-heading"><div><h2>Job Card Follow-ups</h2><p>Office actions and management review. Quoting stays in Accelo.</p></div><button id="jfBack">Back to Job Cards</button></div><div id="jfContent" aria-live="polite">Loading follow-ups…</div>`
  page.querySelector('#jfBack').onclick = onBack
  const content = page.querySelector('#jfContent')
  const query = () => new URLSearchParams(Object.entries({ ...filters, kind: active }).filter(([,v]) => v)).toString()
  async function request(url, options) {
    const response = await fetch(url,options)
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || 'Could not load follow-ups') }
    return response
  }
  function formFilters() {
    const form = content.querySelector('#jfFilters')
    if (form) filters = Object.fromEntries(new FormData(form).entries())
  }
  async function load() {
    const requestId = ++requestNumber
    try {
      const response = await request(`${apiBase}/job-cards/followups?${query()}`)
      const result = await response.json()
      if (requestId !== requestNumber || !content.isConnected) return
      data = result; render()
    } catch(error) {
      if (requestId !== requestNumber || !content.isConnected) return
      if (data) alert(error.message)
      else { content.innerHTML = `<p class="login-error">${escape(error.message)}</p><button id="jfRetry">Retry</button>`; content.querySelector('#jfRetry').onclick = load }
    }
  }
  function render() {
    const { summary: s, options: o } = data
    const maxPage = Math.max(1,Math.ceil(data.rows.length/pageSize)); pageNumber = Math.min(pageNumber,maxPage)
    const visible = data.rows.slice((pageNumber-1)*pageSize,pageNumber*pageSize)
    content.innerHTML = `<nav class="jf-tabs" aria-label="Follow-up reports">${[['','Management Overview'],['QUOTE',labels.QUOTE],['ATTENTION',labels.ATTENTION],['REBOOK',labels.REBOOK]].map(([key,label]) => `<button type="button" data-tab="${key}" aria-pressed="${active===key}">${label}</button>`).join('')}</nav>
      <form id="jfFilters" class="filter-card jf-filters">
        <label>Raised from<input type="date" name="from" value="${escape(filters.from)}"></label><label>Raised to<input type="date" name="to" value="${escape(filters.to)}"></label>
        <label>Customer<select name="clientid">${option('','All customers',filters.clientid)}${o.customers.map(x => option(x.id,x.name,filters.clientid)).join('')}</select></label>
        <label>Site<select name="siteid">${option('','All sites',filters.siteid)}${o.sites.filter(x => !filters.clientid || String(x.clientid)===filters.clientid).map(x => option(x.id,x.name,filters.siteid)).join('')}</select></label>
        <label>Responsible person<select name="owner">${option('','All people',filters.owner)}${o.owners.map(x => option(x.id,x.name,filters.owner)).join('')}</select></label>
        <label>Show<select name="state">${[['OPEN','Outstanding'],['CLOSED','Closed / handed over'],['ALL','All including history']].map(([v,l]) => option(v,l,filters.state)).join('')}</select></label>
        <label>Due dates<select name="overdue">${option('','All due dates',filters.overdue)}${option('true','Overdue only',filters.overdue)}</select></label>
        <button type="submit">Apply filters</button><button type="button" id="jfReset">Reset</button>
      </form>
      <p class="muted-text">Dates filter when an item was raised. Totals and exports use the selected filters. Open ageing counts calendar days; closed-item age stops at closure.</p>
      <div class="jf-summary">${[['Awaiting Accelo handover',s.awaiting_handover],['Assets needing attention',s.attention],['Awaiting rebooking',s.awaiting_rebooking],['Overdue actions',s.overdue]].map(([l,n])=>`<div class="filter-card"><strong>${n}</strong><span>${l}</span></div>`).join('')}</div>
      <div class="filter-card jf-review"><span><b>${s.total}</b> total · <b>${s.open}</b> open · <b>${s.closed}</b> closed / handed over · <b>${s.booked}</b> return visits booked</span><span>Open ageing: ${Object.entries(s.ageing).map(([b,n])=>`${b} days: <b>${n}</b>`).join(' · ')}</span></div>
      <p class="muted-text">Attention items reflect the condition recorded on the source job card, not a new safety assessment. Historical items require review. Closing a job card does not close its follow-ups.</p>
      <div class="jf-toolbar"><span>${data.rows.length} matching items</span><button type="button" data-export="xlsx">Export Excel</button><button type="button" data-export="pdf">Export PDF</button></div>
      <div class="jf-table-wrap"><table class="jf-table"><thead><tr><th>Customer / asset</th><th>Follow-up</th><th>Responsibility / dates</th><th>Status</th><th>Review</th></tr></thead><tbody>${visible.map(r => `<tr>
        <td><strong>${escape(r.clientname)}</strong><br>${escape(r.sitename)}<br>${escape(r.asset_label || r.job_assets)}<br><button type="button" data-job="${r.jobcardid}">${escape(r.jobcard_reference)}</button><small>Accelo job: ${escape(r.customer_reference)} · Job card: ${escape(r.job_status.replaceAll('_',' '))}</small></td>
        <td><strong>${labels[r.kind]}</strong><p class="jf-description">${escape(r.description)}</p>${r.reported_condition ? `<small>Reported: ${escape(r.reported_condition.replaceAll('_',' '))}</small>` : ''}${r.required_parts ? `<small>Parts required: ${escape(r.required_parts)}</small>` : ''}</td>
        <td>${escape(r.responsible_name)}<small>Raised: ${escape(r.raised_date)}<br>Due: ${escape(r.due_date || 'Not set')}<br>${r.age_days} days ${r.closed ? 'to closure' : 'open'}</small></td>
        <td><strong>${labels[r.status]}</strong>${r.overdue ? '<small class="login-error">Overdue</small>' : ''}${r.booked_date ? `<small>Return: ${escape(r.booked_date)}</small>` : ''}${r.accelo_reference ? `<small>Accelo: ${escape(r.accelo_reference)}</small>` : ''}</td>
        <td><button type="button" data-review="${r.followupid}">Review / update</button></td></tr>`).join('') || '<tr><td colspan="5">No follow-ups match these filters.</td></tr>'}</tbody></table></div>
      <div class="jf-toolbar"><button id="jfPrevious" ${pageNumber===1?'disabled':''}>Previous</button><span>Page ${pageNumber} of ${maxPage}</span><button id="jfNext" ${pageNumber===maxPage?'disabled':''}>Next</button></div>
      <dialog id="jfDialog" class="jf-dialog"></dialog>`
    content.querySelector('#jfFilters').onsubmit = e => { e.preventDefault(); formFilters(); pageNumber=1; load() }
    content.querySelector('[name="clientid"]').onchange = e => {
      const select = content.querySelector('[name="siteid"]')
      select.innerHTML = option('','All sites','') + o.sites.filter(x => !e.target.value || String(x.clientid)===e.target.value).map(x=>option(x.id,x.name,'')).join('')
    }
    content.querySelector('#jfReset').onclick=()=>{filters={state:'OPEN'};pageNumber=1;load()}
    content.querySelectorAll('[data-tab]').forEach(button => { button.onclick=()=>{formFilters();active=button.dataset.tab;pageNumber=1;load()} })
    content.querySelectorAll('[data-job]').forEach(button => { button.onclick=()=>onOpenJob(Number(button.dataset.job)) })
    content.querySelectorAll('[data-review]').forEach(button => { button.onclick=()=>edit(data.rows.find(r=>String(r.followupid)===button.dataset.review)) })
    content.querySelectorAll('[data-export]').forEach(button => { button.onclick=()=>download(button) })
    content.querySelector('#jfPrevious').onclick=()=>{pageNumber--;render()}
    content.querySelector('#jfNext').onclick=()=>{pageNumber++;render()}
  }
  async function download(button) {
    button.disabled=true
    try {
      // Export the applied report, not unsaved filter edits.
      const response=await request(`${apiBase}/job-cards/followups/export/${button.dataset.export}?${new URLSearchParams(data.filters).toString()}`)
      const url=URL.createObjectURL(await response.blob());const link=document.createElement('a')
      link.href=url;link.download=`job-card-followups.${button.dataset.export}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
    } catch(error) { alert(error.message) } finally { button.disabled=false }
  }
  function edit(row) {
    const dialog=content.querySelector('#jfDialog')
    const users=[...data.options.users]
    const historyValue=(key,value)=>{
      if(!value)return 'Not set'
      if(key==='status')return labels[value] || value
      if(key==='responsible_user_id')return users.find(u=>String(u.user_id)===String(value))?.name || 'Previously assigned person'
      if(key==='return_jobcardid')return String(value)===String(row.return_jobcardid) ? row.return_reference || 'Linked job card' : 'Previously linked job card'
      return value
    }
    if (row.responsible_user_id && !users.some(u=>u.user_id===row.responsible_user_id)) users.push({user_id:row.responsible_user_id,name:`${row.responsible_name} (inactive — reassign)`})
    dialog.innerHTML=`<form id="jfEdit"><h3>${labels[row.kind]} · ${escape(row.jobcard_reference)}</h3><p>${escape(row.asset_label || row.job_assets)}</p><p class="jf-description">${escape(row.description)}</p>
      <div class="jf-filters"><label>Status<select name="status">${statuses[row.kind].map(s=>option(s,labels[s],row.status)).join('')}</select></label>
      <label>Responsible person<select name="responsible_user_id">${option('','Unassigned',row.responsible_user_id)}${users.map(u=>option(u.user_id,u.name,row.responsible_user_id)).join('')}</select></label>
      <label>Due date<input type="date" name="due_date" value="${escape(row.due_date)}"></label>
      ${row.kind==='QUOTE'?`<label>Accelo handover reference (optional)<input name="accelo_reference" maxlength="200" value="${escape(row.accelo_reference)}"></label><p>Mark handed over after recording this work in Accelo.</p>`:''}
      ${row.kind==='REBOOK'?`<label>Return visit date<input type="date" name="booked_date" value="${escape(row.booked_date)}"></label><label>Return job card (optional)<select name="return_jobcardid">${option('','Not linked',row.return_jobcardid)}${row.return_jobcardid?option(row.return_jobcardid,row.return_reference,row.return_jobcardid):''}</select><small>Choose a return job card for this customer and site.</small></label>`:''}</div>
      <label>Notes / resolution<textarea name="notes" rows="4" maxlength="10000">${escape(row.notes)}</textarea></label>
      <p class="muted-text">Record a reason when waiting or cancelling, and evidence of the work or verification when resolving or completing. Reopen an item by selecting Open.</p>
      <p id="jfError" class="login-error" role="alert"></p><div class="jf-toolbar"><button type="submit">Save update</button><button type="button" id="jfClose">Close</button></div>
      <details><summary>History (${row.history?.length || 0})</summary>${(row.history || []).slice().reverse().map(h=>`<div class="jf-history"><strong>${escape(h.action)}</strong><small>${escape(new Date(h.at).toLocaleString('en-ZA'))} · ${escape(h.user_name || users.find(u=>u.user_id===h.user_id)?.name || 'System')}</small><p>${escape(h.note || '')}</p>${h.changes?Object.entries(h.changes).map(([k,v])=>`<small>${escape(historyLabels[k] || k)}: ${escape(historyValue(k,v))}</small>`).join(''):''}</div>`).join('')}</details></form>`
    dialog.querySelector('#jfClose').onclick=()=>dialog.close()
    dialog.querySelector('#jfEdit').onsubmit=async e=>{
      e.preventDefault();if(busy)return;busy=true
      const button=e.target.querySelector('[type="submit"]');button.disabled=true
      try {
        await request(`${apiBase}/job-cards/followups/${row.followupid}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...Object.fromEntries(new FormData(e.target)),version:row.version})})
        dialog.close();await load()
      } catch(error) { dialog.querySelector('#jfError').textContent=error.message } finally { busy=false;button.disabled=false }
    }
    dialog.showModal()
    if (row.kind==='REBOOK') request(`${apiBase}/job-cards/followups/return-jobs?clientid=${row.clientid}&siteid=${row.siteid}`)
      .then(response=>response.json()).then(jobs=>{
        if (!dialog.open) return
        dialog.querySelector('[name="return_jobcardid"]').innerHTML=option('','Not linked',row.return_jobcardid)+jobs.filter(j=>j.jobcardid!==row.jobcardid).map(j=>option(j.jobcardid,`${j.jobcard_reference} — ${j.status.replaceAll('_',' ')}`,row.return_jobcardid)).join('')
      }).catch(error=>{if(dialog.open)dialog.querySelector('#jfError').textContent=error.message})
  }
  await load()
}
