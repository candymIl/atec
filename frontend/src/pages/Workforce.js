import { API_BASE } from '../api.js'
import { escapeHtml, safeAttr } from '../utils/security.js'

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options)
  const text = await response.text()
  let body = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { error: 'The server returned an unexpected response' } }
  if (!response.ok) throw new Error(body.error || 'The request could not be completed')
  return body
}

function today() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function hours(value) {
  return Number(value || 0).toFixed(2)
}

export async function renderMyDay() {
  const page = document.querySelector('#page')
  const date = document.querySelector('#workforceDate')?.value || today()
  page.innerHTML = `<div class="page-heading"><div><h2>My Day</h2><p>Confirm the time copied from job cards and add only exceptions or non-job activities.</p></div></div>
    <section class="filter-card"><label>Date <input id="workforceDate" type="date" value="${safeAttr(date)}" onchange="showMyDay()"></label></section>
    <section id="workforceDay" class="filter-card">Loading your day...</section>`
  try {
    const data = await api(`/workforce/my-day?date=${encodeURIComponent(date)}`)
    const lines = data.lines || []
    const status = data.timesheet?.status || 'DRAFT'
    const locked = ['EMPLOYEE_SUBMITTED','MANAGER_APPROVED','HR_ACCEPTED','EXPORTED'].includes(status)
    document.querySelector('#workforceDay').innerHTML = `
      <div class="section-heading"><div><h3>${escapeHtml(date)}</h3><p class="muted-text">${escapeHtml(data.schedule?.schedule_name || 'No assigned schedule')} · Status: <strong>${escapeHtml(status.replaceAll('_',' '))}</strong></p></div>
        <div><strong>Normal ${hours(data.normal_hours)}</strong> &nbsp; <strong>Overtime ${hours(data.overtime_hours)}</strong></div></div>
      ${status === 'RETURNED' && data.timesheet?.returned_reason ? `<p class="login-error"><strong>Returned by reviewer:</strong> ${escapeHtml(data.timesheet.returned_reason)}</p>` : ''}
      <div class="table-scroll"><table><thead><tr><th>Activity</th><th>From</th><th>To</th><th>Customer / Job</th><th>Normal</th><th>Overtime</th>${locked ? '' : '<th>Correction</th>'}</tr></thead><tbody>
        ${lines.map(line => `<tr><td>${escapeHtml(line.activity_type)}</td><td>${escapeHtml(new Date(line.started_at).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}))}</td><td>${escapeHtml(new Date(line.ended_at).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}))}</td><td>${escapeHtml([line.customer_name_snapshot,line.job_number_snapshot].filter(Boolean).join(' / ') || line.brief_details || '-')}</td><td>${hours(line.normal_hours)}</td><td>${hours(line.overtime_hours)}</td>${locked ? '' : `<td><button type="button" onclick="editMyTimeEntry(${safeAttr(line.timeentryid)},'${safeAttr(datetimeLocalValue(line.started_at))}','${safeAttr(datetimeLocalValue(line.ended_at))}')">Edit</button><button type="button" class="danger-btn" onclick="deleteMyTimeEntry(${safeAttr(line.timeentryid)})">Delete</button></td>`}</tr>`).join('') || `<tr><td colspan="${locked ? 6 : 7}">No time recorded for this date.</td></tr>`}
      </tbody></table></div>
      ${locked ? '<p class="muted-text">This timesheet has been submitted and is read-only. It remains available here and in your history below.</p>' : `<details class="workforce-entry-disclosure"><summary><span class="workforce-entry-summary-copy"><strong>Add an exception or non-job activity</strong><small class="workforce-entry-closed-copy">Click here to display the time-entry form</small><small class="workforce-entry-open-copy">Time-entry form is open</small></span><span class="workforce-entry-chevron" aria-hidden="true">›</span></summary><div class="job-card-grid workforce-entry-form">
        <label>Activity<select id="timeActivity">${['WORK','TRAVEL','STANDBY','BREAK','WORKSHOP','TRAINING','MEETING','ADMIN','WAITING','LEAVE','SICK_LEAVE','UNPAID','OTHER'].map(value => `<option>${value}</option>`).join('')}</select></label>
        <label>Accelo Job Number<input id="timeJobNumber" inputmode="numeric" pattern="[0-9]+" placeholder="Required for job-related time"></label>
        <label>Started<input id="timeStarted" type="datetime-local"></label><label>Ended<input id="timeEnded" type="datetime-local"></label>
        <label class="job-card-wide">Details<input id="timeDetails"></label><label><span><input id="timeUnderground" type="checkbox"> Underground allowance</span></label>
        <button type="button" onclick="addWorkforceTime()">Add time to this day</button></div></details>`}
      <div class="form-actions">${locked ? '' : `<button class="load-test-btn" type="button" onclick="submitMyDay('${safeAttr(date)}')">Confirm and submit to manager</button>`}${data.timesheet?.timesheetid ? `<button type="button" onclick="window.open('${API_BASE}/workforce/timesheets/${data.timesheet.timesheetid}/pdf','_blank','noopener')">Open FBC009-10 PDF</button>` : ''}</div>
      <hr><h3>My timesheet history</h3><div id="myTimesheetHistory">Loading history...</div>`
    const history = await api(`/workforce/timesheets/history?mine=true&limit=31`)
    document.querySelector('#myTimesheetHistory').innerHTML = renderHistoryTable(history, false)
  } catch (error) {
    document.querySelector('#workforceDay').innerHTML = `<p class="login-error">${escapeHtml(error.message)}</p>`
  }
}

export async function addWorkforceTime() {
  try {
    const date = document.querySelector('#workforceDate').value
    await api('/workforce/time-entries', {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        activity_date: date,
        activity_type: document.querySelector('#timeActivity').value,
        job_number: document.querySelector('#timeJobNumber').value.trim(),
        started_at: document.querySelector('#timeStarted').value,
        ended_at: document.querySelector('#timeEnded').value,
        brief_details: document.querySelector('#timeDetails').value,
        underground: document.querySelector('#timeUnderground').checked
      })
    })
    await renderMyDay()
  } catch (error) { alert(error.message) }
}

export async function editMyTimeEntry(timeentryId, currentStart, currentEnd) {
  const startedAt = window.prompt('Correct start date and time (YYYY-MM-DDTHH:MM):', currentStart)
  if (startedAt === null) return
  const endedAt = window.prompt('Correct end date and time (YYYY-MM-DDTHH:MM):', currentEnd)
  if (endedAt === null) return
  const reason = window.prompt('Reason for correcting this time entry (minimum 5 characters):')
  if (reason === null) return
  try {
    await api(`/workforce/time-entries/${encodeURIComponent(timeentryId)}`, {
      method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({started_at:startedAt,ended_at:endedAt,reason})
    })
    await renderMyDay()
  } catch (error) { alert(error.message) }
}

export async function deleteMyTimeEntry(timeentryId) {
  const reason = window.prompt('Reason for deleting this time entry (minimum 5 characters):')
  if (reason === null) return
  if (!window.confirm('Delete this time entry? This action will be retained in the timesheet audit history.')) return
  try {
    await api(`/workforce/time-entries/${encodeURIComponent(timeentryId)}`, {
      method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})
    })
    await renderMyDay()
  } catch (error) { alert(error.message) }
}

function renderHistoryTable(rows, showEmployee = true) {
  return `<div class="table-scroll"><table><thead><tr><th>Date</th>${showEmployee ? '<th>Employee</th>' : ''}<th>Job Number</th><th>Status</th><th>Normal</th><th>Overtime</th><th>Travel</th><th>Standby</th><th>Report</th></tr></thead><tbody>
    ${rows.map(row => `<tr><td>${escapeHtml(String(row.timesheet_date).slice(0,10))}</td>${showEmployee ? `<td>${escapeHtml(row.employee_name || '')}</td>` : ''}<td>${escapeHtml(row.job_numbers || '-')}</td><td>${escapeHtml(String(row.status || '').replaceAll('_',' '))}</td><td>${hours(row.final_normal_hours)}</td><td>${hours(row.final_overtime_hours)}</td><td>${hours(row.final_travel_hours)}</td><td>${hours(row.final_standby_hours)}</td><td><button onclick="window.open('${API_BASE}/workforce/timesheets/${row.timesheetid}/pdf','_blank','noopener')">PDF</button></td></tr>`).join('') || `<tr><td colspan="${showEmployee ? 9 : 8}">No timesheets found.</td></tr>`}
  </tbody></table></div>`
}

let historyRows = []
let payrollEmployees = []

function localDateValue(date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0,10)
}

export function setPayrollPeriod(period) {
  const now = new Date()
  let from = new Date(now)
  let to = new Date(now)
  if (period === 'THIS_WEEK' || period === 'LAST_WEEK') {
    const day = (now.getDay() + 6) % 7
    from.setDate(now.getDate() - day - (period === 'LAST_WEEK' ? 7 : 0))
    to = new Date(from)
    to.setDate(from.getDate() + 6)
  } else if (period === 'THIS_MONTH') {
    from = new Date(now.getFullYear(),now.getMonth(),1)
    to = new Date(now.getFullYear(),now.getMonth() + 1,0)
  } else if (period === 'LAST_MONTH') {
    from = new Date(now.getFullYear(),now.getMonth() - 1,1)
    to = new Date(now.getFullYear(),now.getMonth(),0)
  }
  document.querySelector('#payrollFrom').value = localDateValue(from)
  document.querySelector('#payrollTo').value = localDateValue(to)
}

export function setAllPayrollEmployees(selected) {
  document.querySelectorAll('.payroll-employee').forEach(input => { input.checked = selected })
}

export async function exportPayrollExcel() {
  const from = document.querySelector('#payrollFrom')?.value
  const to = document.querySelector('#payrollTo')?.value
  const selected = [...document.querySelectorAll('.payroll-employee:checked')].map(input => input.value)
  if (!from || !to) return alert('Select the payroll start and end dates.')
  if (!selected.length) return alert('Select at least one employee, or use Select all.')
  const params = new URLSearchParams({ date_from:from,date_to:to,user_ids:selected.join(',') })
  if (document.querySelector('#payrollIncludeExported')?.checked) params.set('include_exported','true')
  const button = document.querySelector('#payrollExportButton')
  try {
    button.disabled = true
    button.textContent = 'Preparing Excel...'
    const response = await fetch(`${API_BASE}/workforce/payroll-export.xlsx?${params}`)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || 'The Excel export could not be prepared.')
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(await response.blob())
    link.download = `ATEC-Payroll-${from}-to-${to}.xlsx`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href),1000)
  } catch (error) {
    alert(error.message)
  } finally {
    button.disabled = false
    button.textContent = 'Export selected employees to Excel'
  }
}

export async function renderTimesheetHistory() {
  const page = document.querySelector('#page')
  const defaultFrom = new Date()
  defaultFrom.setDate(defaultFrom.getDate() - 31)
  page.innerHTML = `<div class="page-heading"><div><h2>Timesheet History & Reports</h2><p>Search submitted and completed employee time without mixing it into the approval queue.</p></div></div>
    <section class="filter-card"><div class="job-card-grid">
      <label>Date from<input id="historyFrom" type="date" value="${defaultFrom.toISOString().slice(0,10)}"></label>
      <label>Date to<input id="historyTo" type="date" value="${today()}"></label>
      <label>Status<select id="historyStatus"><option value="">All statuses</option>${['DRAFT','AWAITING_EMPLOYEE','EMPLOYEE_SUBMITTED','MANAGER_APPROVED','HR_ACCEPTED','EXPORTED','RETURNED'].map(value => `<option value="${value}">${value.replaceAll('_',' ')}</option>`).join('')}</select></label>
      <label>Accelo Job Number<input id="historyJobNumber" inputmode="numeric"></label>
    </div><div class="form-actions"><button class="load-test-btn" onclick="loadTimesheetHistory()">Search</button><button onclick="exportTimesheetHistoryCsv()">Export CSV</button></div></section>
    <section class="filter-card"><div class="section-heading"><div><h3>Payroll Excel export</h3><p class="muted-text">Export HR-accepted weekly or monthly time for selected employees. Previously exported time can be included when reproducing a report.</p></div></div>
      <div class="job-card-grid">
        <label>Date from<input id="payrollFrom" type="date"></label><label>Date to<input id="payrollTo" type="date"></label>
        <label><span><input id="payrollIncludeExported" type="checkbox"> Include previously exported timesheets</span></label>
      </div>
      <div class="form-actions"><button onclick="setPayrollPeriod('THIS_WEEK')">This week</button><button onclick="setPayrollPeriod('LAST_WEEK')">Last week</button><button onclick="setPayrollPeriod('THIS_MONTH')">This month</button><button onclick="setPayrollPeriod('LAST_MONTH')">Last month</button></div>
      <h4>Select employees</h4><div class="form-actions"><button onclick="setAllPayrollEmployees(true)">Select all</button><button onclick="setAllPayrollEmployees(false)">Clear all</button></div>
      <div id="payrollEmployees" class="job-card-grid"><p>Loading employees...</p></div>
      <div class="form-actions"><button id="payrollExportButton" class="load-test-btn" onclick="exportPayrollExcel()">Export selected employees to Excel</button></div>
      <p class="muted-text">The workbook includes Payroll Summary, Daily Totals, Time Detail and Read Me sheets. Direct VIP import mapping will be finalised once HR provides the VIP import template or column specification.</p>
    </section>
    <section id="timesheetHistoryResults" class="filter-card">Choose filters and search.</section>`
  setPayrollPeriod('THIS_MONTH')
  try {
    payrollEmployees = await api('/workforce/employees')
    document.querySelector('#payrollEmployees').innerHTML = payrollEmployees.map(row =>
      `<label><span><input class="payroll-employee" type="checkbox" value="${safeAttr(row.user_id)}" checked> ${escapeHtml(row.full_name)} <small>(${escapeHtml(row.employee_number || row.role)})</small></span></label>`
    ).join('') || '<p>No active employees are available.</p>'
  } catch (error) {
    document.querySelector('#payrollEmployees').innerHTML = `<p class="login-error">${escapeHtml(error.message)}</p>`
  }
  await loadTimesheetHistory()
}

export async function loadTimesheetHistory() {
  const params = new URLSearchParams()
  const from = document.querySelector('#historyFrom')?.value
  const to = document.querySelector('#historyTo')?.value
  const status = document.querySelector('#historyStatus')?.value
  const job = document.querySelector('#historyJobNumber')?.value.trim()
  if (from) params.set('date_from',from)
  if (to) params.set('date_to',to)
  if (status) params.set('status',status)
  if (job) params.set('job_number',job)
  params.set('limit','500')
  const box = document.querySelector('#timesheetHistoryResults')
  try {
    historyRows = await api(`/workforce/timesheets/history?${params}`)
    const totals = historyRows.reduce((sum,row) => ({
      normal:sum.normal + Number(row.final_normal_hours || 0),
      overtime:sum.overtime + Number(row.final_overtime_hours || 0),
      travel:sum.travel + Number(row.final_travel_hours || 0),
      standby:sum.standby + Number(row.final_standby_hours || 0)
    }), {normal:0,overtime:0,travel:0,standby:0})
    box.innerHTML = `<p><strong>${historyRows.length}</strong> timesheet(s) · Normal ${hours(totals.normal)} · Overtime ${hours(totals.overtime)} · Travel ${hours(totals.travel)} · Standby ${hours(totals.standby)}</p>${renderHistoryTable(historyRows,true)}`
  } catch (error) { box.innerHTML = `<p class="login-error">${escapeHtml(error.message)}</p>` }
}

export function exportTimesheetHistoryCsv() {
  if (!historyRows.length) return alert('No timesheet history is available to export.')
  const values = [
    ['Date','Employee','Employee Number','Job Numbers','Status','Normal','Overtime','Travel','Standby','Manager'],
    ...historyRows.map(row => [String(row.timesheet_date).slice(0,10),row.employee_name,row.employee_number,row.job_numbers,row.status,row.final_normal_hours,row.final_overtime_hours,row.final_travel_hours,row.final_standby_hours,row.manager_name])
  ]
  const csv = values.map(row => row.map(value => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  link.download = `ATEC-timesheet-history-${today()}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

export async function submitMyDay(date) {
  if (!window.confirm('Confirm that your time for this day is complete and correct?')) return
  try {
    await api(`/workforce/timesheets/${encodeURIComponent(date)}/submit`, { method:'POST' })
    alert('Timesheet submitted to your manager.')
    await renderMyDay()
  } catch (error) { alert(error.message) }
}

export async function renderTimesheetApprovals() {
  const page = document.querySelector('#page')
  page.innerHTML = `<div class="page-heading"><div><h2>Timesheet Approvals</h2><p>Review exceptions, correct assigned employee time with an audit reason, then approve or return it.</p></div></div><section id="approvalList" class="filter-card">Loading...</section><section id="managerTimeEditor" class="filter-card" hidden></section>`
  try {
    const rows = await api('/workforce/approvals')
    const role = window.currentUser?.role
    const editableStatuses = role === 'ADMIN'
      ? ['AWAITING_EMPLOYEE','EMPLOYEE_SUBMITTED','MANAGER_APPROVED','RETURNED']
      : role === 'MANAGER' ? ['EMPLOYEE_SUBMITTED'] : ['EMPLOYEE_SUBMITTED','MANAGER_APPROVED','RETURNED']
    const canEditTime = ['ADMIN','MANAGER','HR'].includes(role)
    document.querySelector('#approvalList').innerHTML = `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Employee</th><th>Status</th><th>Normal</th><th>Overtime</th><th>Travel</th><th>Standby</th><th>Action</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td>${escapeHtml(String(row.timesheet_date).slice(0,10))}</td><td>${escapeHtml(row.employee_name)}</td><td>${escapeHtml(row.status.replaceAll('_',' '))}</td><td>${hours(row.final_normal_hours)}</td><td>${hours(row.final_overtime_hours)}</td><td>${hours(row.final_travel_hours)}</td><td>${hours(row.final_standby_hours)}</td><td><button onclick="window.open('${API_BASE}/workforce/timesheets/${row.timesheetid}/pdf','_blank','noopener')">PDF</button>${canEditTime && editableStatuses.includes(row.status) ? `<button onclick="editEmployeeTimes(${row.timesheetid})">Review / correct entries</button>` : ''}${row.status === 'AWAITING_EMPLOYEE' && role === 'ADMIN' ? `<button class="load-test-btn" onclick="workforceAction(${row.timesheetid},'SUBMIT_EMPLOYEE')">Submit for employee</button>` : ''}${row.status === 'EMPLOYEE_SUBMITTED' && ['ADMIN','MANAGER'].includes(role) ? `<button onclick="workforceAction(${row.timesheetid},'APPROVE')">Approve</button>` : ''}${row.status === 'RETURNED' && role === 'ADMIN' ? `<button class="load-test-btn" onclick="approveCorrectedTimesheet(${row.timesheetid})">Approve corrected timesheet</button>` : ''}${row.status === 'MANAGER_APPROVED' && ['ADMIN','HR'].includes(role) ? `<button onclick="workforceAction(${row.timesheetid},'ACCEPT')">HR accept</button>` : ''}${!['AWAITING_EMPLOYEE','RETURNED'].includes(row.status) ? `<button onclick="workforceAction(${row.timesheetid},'RETURN')">Return</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8">No timesheets need attention.</td></tr>'}
    </tbody></table></div>`
  } catch (error) { document.querySelector('#approvalList').innerHTML = `<p class="login-error">${escapeHtml(error.message)}</p>` }
}

function datetimeLocalValue(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0,16)
}

function managerAuditDetails(details) {
  if (!details) return {}
  if (typeof details === 'object') return details
  try { return JSON.parse(details) } catch { return {} }
}

export async function editEmployeeTimes(timesheetId) {
  const editor = document.querySelector('#managerTimeEditor')
  if (!editor) return
  editor.hidden = false
  editor.innerHTML = '<p>Loading employee time entries...</p>'
  try {
    const data = await api(`/workforce/timesheets/${encodeURIComponent(timesheetId)}/manager-edit`)
    editor.innerHTML = `<div class="section-heading"><div><h3>Correct employee time</h3><p><strong>${escapeHtml(data.timesheet.employee_name)}</strong> · ${escapeHtml(String(data.timesheet.timesheet_date).slice(0,10))} · ${escapeHtml(data.timesheet.status.replaceAll('_',' '))}</p><p class="muted-text">Change a start/end time or delete an incorrect duplicate. A reason is compulsory and every correction is retained in the audit history. HR-accepted and exported timesheets remain locked.</p></div><button type="button" onclick="closeEmployeeTimeEditor()">Close</button></div>
      <div class="table-scroll"><table class="manager-time-edit-table"><thead><tr><th>Activity</th><th>Customer / Job</th><th>Started</th><th>Ended</th><th>Reason for change</th><th>Action</th></tr></thead><tbody>
        ${data.entries.map(entry => `<tr><td>${escapeHtml(entry.activity_type)}</td><td>${escapeHtml([entry.customer_name_snapshot,entry.job_number_snapshot].filter(Boolean).join(' / ') || entry.brief_details || '-')}</td><td><input id="managerStarted-${safeAttr(entry.timeentryid)}" type="datetime-local" value="${safeAttr(datetimeLocalValue(entry.started_at))}"></td><td><input id="managerEnded-${safeAttr(entry.timeentryid)}" type="datetime-local" value="${safeAttr(datetimeLocalValue(entry.ended_at))}"></td><td><input id="managerReason-${safeAttr(entry.timeentryid)}" minlength="5" placeholder="Required audit reason"></td><td><button type="button" class="load-test-btn" onclick="saveEmployeeTimeEdit(${safeAttr(timesheetId)},${safeAttr(entry.timeentryid)})">Save change</button><button type="button" class="danger-btn" onclick="deleteEmployeeTimeEntry(${safeAttr(timesheetId)},${safeAttr(entry.timeentryid)})">Delete duplicate</button></td></tr>`).join('') || '<tr><td colspan="6">No editable time entries were found.</td></tr>'}
      </tbody></table></div>
      <h4>Correction history</h4><div class="table-scroll"><table><thead><tr><th>Changed at</th><th>Changed by</th><th>Previous time</th><th>New time</th><th>Reason</th></tr></thead><tbody>
        ${data.audits.map(audit => { const details = managerAuditDetails(audit.details); const before = details.before || details.deleted || {}; return `<tr><td>${escapeHtml(new Date(audit.created_at).toLocaleString('en-ZA'))}</td><td>${escapeHtml(audit.actor_name || '-')}</td><td>${escapeHtml(datetimeLocalValue(before.started_at || ''))} to ${escapeHtml(datetimeLocalValue(before.ended_at || ''))}</td><td>${details.deleted ? 'Deleted' : `${escapeHtml(datetimeLocalValue(details.after?.started_at || ''))} to ${escapeHtml(datetimeLocalValue(details.after?.ended_at || ''))}`}</td><td>${escapeHtml(details.reason || '-')}</td></tr>` }).join('') || '<tr><td colspan="5">No corrections have been recorded.</td></tr>'}
      </tbody></table></div>`
    editor.scrollIntoView({ behavior:'smooth', block:'start' })
  } catch (error) { editor.innerHTML = `<p class="login-error">${escapeHtml(error.message)}</p>` }
}

export function closeEmployeeTimeEditor() {
  const editor = document.querySelector('#managerTimeEditor')
  if (!editor) return
  editor.hidden = true
  editor.innerHTML = ''
}

export async function saveEmployeeTimeEdit(timesheetId, timeentryId) {
  const started = document.querySelector(`#managerStarted-${timeentryId}`)?.value
  const ended = document.querySelector(`#managerEnded-${timeentryId}`)?.value
  const reason = document.querySelector(`#managerReason-${timeentryId}`)?.value.trim() || ''
  if (reason.length < 5) return alert('Enter a clear reason of at least 5 characters for this change.')
  if (!started || !ended || new Date(ended) <= new Date(started)) return alert('Enter valid start and end times. End time must be after start time.')
  if (!window.confirm('Save this time change and record it in the audit history?')) return
  try {
    await api(`/workforce/timesheets/${encodeURIComponent(timesheetId)}/time-entries/${encodeURIComponent(timeentryId)}`, {
      method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        started_at:new Date(started).toISOString(),ended_at:new Date(ended).toISOString(),reason
      })
    })
    await renderTimesheetApprovals()
    await editEmployeeTimes(timesheetId)
  } catch (error) { alert(error.message) }
}

export async function deleteEmployeeTimeEntry(timesheetId, timeentryId) {
  const reason = document.querySelector(`#managerReason-${timeentryId}`)?.value.trim() || ''
  if (reason.length < 5) return alert('Enter a clear reason of at least 5 characters before deleting this entry.')
  if (!window.confirm('Delete this employee time entry and record the reason in the audit history?')) return
  try {
    await api(`/workforce/timesheets/${encodeURIComponent(timesheetId)}/time-entries/${encodeURIComponent(timeentryId)}`, {
      method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ reason })
    })
    await renderTimesheetApprovals()
    await editEmployeeTimes(timesheetId)
  } catch (error) { alert(error.message) }
}

export async function workforceAction(id, action) {
  const reason = action === 'RETURN'
    ? window.prompt('Reason for returning this timesheet:')
    : action === 'SUBMIT_EMPLOYEE'
      ? window.prompt('Reason for submitting this timesheet on behalf of the employee:')
      : ''
  if (['RETURN','SUBMIT_EMPLOYEE'].includes(action) && !reason) return
  if (action === 'SUBMIT_EMPLOYEE' && reason.trim().length < 5) return alert('Enter a clear reason of at least 5 characters.')
  if (action === 'SUBMIT_EMPLOYEE' && !window.confirm('Confirm that you reviewed this employee timesheet and want to submit it on their behalf?')) return
  try {
    await api(`/workforce/timesheets/${id}/action`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,reason}) })
    await renderTimesheetApprovals()
  } catch (error) { alert(error.message) }
}

export async function approveCorrectedTimesheet(id) {
  if (!window.confirm('Approve this corrected returned timesheet and move it to Manager Approved?')) return
  await workforceAction(id, 'APPROVE')
}

export async function renderHrTimesheets() {
  const page = document.querySelector('#page')
  page.innerHTML = `<div class="page-heading"><div><h2>HR Time Dashboard</h2><p>A single queue from employee confirmation through manager approval to payroll readiness.</p></div></div><section id="hrSummary" class="filter-card">Loading...</section>`
  try {
    const data = await api('/workforce/hr/dashboard')
    document.querySelector('#hrSummary').innerHTML = `<div class="dashboard-grid">
      <div class="dashboard-card"><span>Awaiting employees/managers</span><strong>${Number(data.awaiting_manager || 0)}</strong></div>
      <div class="dashboard-card"><span>Awaiting HR</span><strong>${Number(data.awaiting_hr || 0)}</strong></div>
      <div class="dashboard-card"><span>Payroll ready</span><strong>${Number(data.payroll_ready || 0)}</strong></div>
      <div class="dashboard-card"><span>Returned</span><strong>${Number(data.returned || 0)}</strong></div></div>
      <div class="form-actions"><button onclick="showTimesheetApprovals()">Open approval queue</button><button onclick="showWorkSchedules()">Manage work schedules</button></div>`
  } catch (error) { document.querySelector('#hrSummary').innerHTML = `<p class="login-error">${escapeHtml(error.message)}</p>` }
}

export async function renderWorkSchedules() {
  const page = document.querySelector('#page')
  page.innerHTML = `<div class="page-heading"><div><h2>Work Schedules</h2><p>View and edit each employee's normal working rules. Submitted timesheets retain their original schedule snapshot.</p></div></div><section id="scheduleForm" class="filter-card">Loading employees...</section>`
  try {
    const employees = await api('/workforce/employees?include_hr=true&work_schedule_scope=true')
    if (!employees.length) {
      document.querySelector('#scheduleForm').innerHTML = '<p class="muted-text">No employees are currently assigned to you. Ask HR or an Administrator to update employee assignments.</p>'
      return
    }
    document.querySelector('#scheduleForm').innerHTML = `<label>Employee<select id="scheduleEmployee" onchange="loadWorkSchedule()">${employees.map(row => `<option value="${safeAttr(row.user_id)}">${escapeHtml(row.full_name)} (${escapeHtml(row.role)})</option>`).join('')}</select></label>
      <div id="scheduleDetails"><p>Loading current schedule...</p></div>`
    await loadWorkSchedule()
  } catch (error) { document.querySelector('#scheduleForm').innerHTML = `<p class="login-error">${escapeHtml(error.message)}</p>` }
}

let currentScheduleId = null

function timeValue(value, fallback) {
  return value ? String(value).slice(0,5) : fallback
}

function paidHours(start, end, lunchMinutes) {
  const [startHour,startMinute] = String(start).split(':').map(Number)
  const [endHour,endMinute] = String(end).split(':').map(Number)
  return Math.max(0,((endHour * 60 + endMinute) - (startHour * 60 + startMinute) - Number(lunchMinutes || 0)) / 60).toFixed(2)
}

export function updateScheduleHours() {
  const weekdayHours = Number(paidHours(
    document.querySelector('#scheduleWeekStart')?.value,
    document.querySelector('#scheduleWeekEnd')?.value,
    document.querySelector('#scheduleWeekLunch')?.value
  ))
  const fridayHours = Number(paidHours(
    document.querySelector('#scheduleFridayStart')?.value,
    document.querySelector('#scheduleFridayEnd')?.value,
    document.querySelector('#scheduleFridayLunch')?.value
  ))
  const values = {
    scheduleWeekHours:weekdayHours,
    scheduleFridayHours:fridayHours,
    scheduleTotalHours:weekdayHours * 4 + fridayHours
  }
  Object.entries(values).forEach(([id,value]) => {
    const element = document.querySelector(`#${id}`)
    if (element) element.textContent = value.toFixed(2)
  })
}

function scheduleSummary(schedule) {
  const days = Object.fromEntries((schedule.days || []).map(day => [Number(day.weekday),day]))
  const weekday = days[1] || {}
  const friday = days[5] || {}
  return `Mon–Thu ${timeValue(weekday.normal_start,'-')}–${timeValue(weekday.normal_end,'-')}, ${Number(weekday.unpaid_break_minutes || 0)} min lunch; Friday ${timeValue(friday.normal_start,'-')}–${timeValue(friday.normal_end,'-')}, ${Number(friday.unpaid_break_minutes || 0)} min lunch`
}

export async function loadWorkSchedule() {
  const userId = document.querySelector('#scheduleEmployee')?.value
  const box = document.querySelector('#scheduleDetails')
  if (!userId || !box) return
  box.innerHTML = '<p>Loading current schedule...</p>'
  try {
    const schedules = await api(`/workforce/schedules/${encodeURIComponent(userId)}`)
    const date = today()
    const current = schedules.find(schedule => String(schedule.effective_from).slice(0,10) <= date &&
      (!schedule.effective_to || String(schedule.effective_to).slice(0,10) >= date)) || schedules[0] || null
    currentScheduleId = current?.scheduleid || null
    const days = Object.fromEntries((current?.days || []).map(day => [Number(day.weekday),day]))
    const weekday = days[1] || {}
    const friday = days[5] || {}
    const weekdayStart = timeValue(weekday.normal_start,'06:30')
    const weekdayEnd = timeValue(weekday.normal_end,'16:30')
    const weekdayLunch = Number(weekday.unpaid_break_minutes ?? 30)
    const fridayStart = timeValue(friday.normal_start,'06:30')
    const fridayEnd = timeValue(friday.normal_end,'13:30')
    const fridayLunch = Number(friday.unpaid_break_minutes ?? 0)
    box.innerHTML = `<div class="section-heading"><div><h3>${current ? 'Current schedule' : 'Create first schedule'}</h3><p class="muted-text">Changes affect new calculations only; submitted timesheets are not recalculated.</p></div></div>
      <div class="job-card-grid">
        <label>Schedule name<input id="scheduleName" value="${safeAttr(current?.schedule_name || 'Standard 06:30 schedule')}"></label>
        <label>Effective from<input id="scheduleFrom" type="date" value="${safeAttr(String(current?.effective_from || today()).slice(0,10))}"></label>
        <label>Effective to (optional)<input id="scheduleTo" type="date" value="${safeAttr(current?.effective_to ? String(current.effective_to).slice(0,10) : '')}"></label>
        <label>Rounding<select id="scheduleRounding">${[1,5,10,15,30].map(value => `<option value="${value}" ${Number(current?.rounding_minutes || 1) === value ? 'selected' : ''}>${value} minute${value === 1 ? '' : 's'}</option>`).join('')}</select></label>
      </div>
      <h4>Monday to Thursday</h4><div class="job-card-grid">
        <label>Start<input id="scheduleWeekStart" type="time" value="${safeAttr(weekdayStart)}" oninput="updateScheduleHours()"></label>
        <label>End<input id="scheduleWeekEnd" type="time" value="${safeAttr(weekdayEnd)}" oninput="updateScheduleHours()"></label>
        <label>Unpaid lunch (minutes)<input id="scheduleWeekLunch" type="number" min="0" max="180" step="5" value="${weekdayLunch}" oninput="updateScheduleHours()"></label>
        <div><span class="muted-text">Normal paid hours</span><br><strong id="scheduleWeekHours">${paidHours(weekdayStart,weekdayEnd,weekdayLunch)}</strong></div>
      </div>
      <h4>Friday</h4><div class="job-card-grid">
        <label>Start<input id="scheduleFridayStart" type="time" value="${safeAttr(fridayStart)}" oninput="updateScheduleHours()"></label>
        <label>End<input id="scheduleFridayEnd" type="time" value="${safeAttr(fridayEnd)}" oninput="updateScheduleHours()"></label>
        <label>Unpaid lunch (minutes)<input id="scheduleFridayLunch" type="number" min="0" max="180" step="5" value="${fridayLunch}" oninput="updateScheduleHours()"></label>
        <div><span class="muted-text">Normal paid hours</span><br><strong id="scheduleFridayHours">${paidHours(fridayStart,fridayEnd,fridayLunch)}</strong></div>
      </div>
      <div class="work-schedule-total"><span>Weekly normal paid hours</span><strong id="scheduleTotalHours">${(Number(paidHours(weekdayStart,weekdayEnd,weekdayLunch)) * 4 + Number(paidHours(fridayStart,fridayEnd,fridayLunch))).toFixed(2)}</strong><small>Monday to Thursday × 4, plus Friday</small></div>
      <div class="form-actions"><button type="button" class="load-test-btn" onclick="saveWorkSchedule()">${current ? 'Update current schedule' : 'Create schedule'}</button></div>
      <hr><h3>Schedule history</h3><div class="table-scroll"><table><thead><tr><th>Name</th><th>Effective from</th><th>Effective to</th><th>Rules</th></tr></thead><tbody>
        ${schedules.map(schedule => `<tr><td>${escapeHtml(schedule.schedule_name)}</td><td>${escapeHtml(String(schedule.effective_from).slice(0,10))}</td><td>${escapeHtml(schedule.effective_to ? String(schedule.effective_to).slice(0,10) : 'Current')}</td><td>${escapeHtml(scheduleSummary(schedule))}</td></tr>`).join('') || '<tr><td colspan="4">No schedule history.</td></tr>'}
      </tbody></table></div>`
  } catch (error) { box.innerHTML = `<p class="login-error">${escapeHtml(error.message)}</p>` }
}

export async function saveWorkSchedule() {
  try {
    const weekStart = document.querySelector('#scheduleWeekStart').value
    const weekEnd = document.querySelector('#scheduleWeekEnd').value
    const fridayStart = document.querySelector('#scheduleFridayStart').value
    const fridayEnd = document.querySelector('#scheduleFridayEnd').value
    if (weekEnd <= weekStart || fridayEnd <= fridayStart) throw new Error('Each end time must be after its start time.')
    const payload = {
      employee_user_id:Number(document.querySelector('#scheduleEmployee').value),
      schedule_name:document.querySelector('#scheduleName').value,
      effective_from:document.querySelector('#scheduleFrom').value,
      effective_to:document.querySelector('#scheduleTo').value || null,
      rounding_minutes:Number(document.querySelector('#scheduleRounding').value),
      days:[1,2,3,4].map(weekday => ({weekday,normal_start:weekStart,normal_end:weekEnd,unpaid_break_minutes:Number(document.querySelector('#scheduleWeekLunch').value || 0),is_overtime_day:false})).concat([
        {weekday:5,normal_start:fridayStart,normal_end:fridayEnd,unpaid_break_minutes:Number(document.querySelector('#scheduleFridayLunch').value || 0),is_overtime_day:false}
      ])
    }
    await api(currentScheduleId ? `/workforce/schedules/${currentScheduleId}` : '/workforce/schedules', {
      method:currentScheduleId ? 'PUT' : 'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        ...payload
      })
    })
    alert('Work schedule saved successfully.')
    await loadWorkSchedule()
  } catch (error) { alert(error.message) }
}
