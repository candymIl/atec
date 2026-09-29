import { API_BASE } from '../api.js'
import { escapeHtml } from '../utils/security.js'

const stageLabels = {
  DRAFT:'Not submitted', AWAITING_EMPLOYEE:'Awaiting employee submission',
  EMPLOYEE_SUBMITTED:'Awaiting manager approval', RETURNED:'Returned for correction',
  MANAGER_APPROVED:'Manager approved', HR_ACCEPTED:'HR accepted', EXPORTED:'Exported'
}
let reviewContext = null

export async function renderAcceloTimesheetReview(jobcardid, timesheets, role) {
  const context = { jobcardid:Number(jobcardid), sheets:timesheets, allowed:new Set(), pending:new Set() }
  reviewContext = context
  let permissionError = false
  if (['ADMIN','MANAGER'].includes(role) && timesheets.some(sheet => sheet.status === 'EMPLOYEE_SUBMITTED')) {
    try {
      const response = await fetch(`${API_BASE}/workforce/approvals`)
      if (!response.ok) throw new Error('Could not load approvals')
      const approvals = await response.json()
      context.allowed = new Set(approvals.filter(sheet => sheet.status === 'EMPLOYEE_SUBMITTED').map(sheet => Number(sheet.timesheetid)))
    } catch { permissionError = true }
  }
  if (!timesheets.length) return '<p class="muted-text">No linked crew timesheets are available to review yet.</p>'
  return `<div class="accelo-timesheet-review"><h4>Crew timesheets</h4>
    <p class="muted-text">View the timesheet before approving. Approval covers the employee’s full day, including time on other job cards.</p>
    ${permissionError ? '<p class="login-error">Approval access could not be checked. You can still view the timesheets. Check readiness again to retry.</p>' : ''}
    <div class="table-scroll"><table><thead><tr><th scope="col">Employee</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Review / approve</th></tr></thead><tbody>
    ${timesheets.map(sheet => {
      const id = Number(sheet.timesheetid)
      const canApprove = context.allowed.has(id) && sheet.status === 'EMPLOYEE_SUBMITTED'
      const hint = sheet.status === 'RETURNED' ? 'Correct and resubmit through Timesheet Approvals.'
        : ['AWAITING_EMPLOYEE','DRAFT'].includes(sheet.status) ? 'Employee submission is required before approval.'
        : sheet.status === 'EMPLOYEE_SUBMITTED' && !canApprove && !permissionError ? 'Approval is required from the assigned manager or an Admin.' : ''
      return `<tr><td>${escapeHtml(sheet.employee_name)}</td><td>${escapeHtml(String(sheet.timesheet_date).slice(0,10))}</td><td>${escapeHtml(stageLabels[sheet.status] || sheet.status)}</td>
        <td><div class="form-actions"><a class="accelo-timesheet-link" href="${API_BASE}/workforce/timesheets/${id}/pdf" target="_blank" rel="noopener">View timesheet</a>
        ${canApprove ? `<button type="button" class="load-test-btn" onclick="approveAcceloTimesheet(${context.jobcardid},${id},this)">Approve timesheet</button>` : ''}</div>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</td></tr>`
    }).join('')}</tbody></table></div><p id="acceloTimesheetFeedback" role="status"></p></div>`
}

export async function approveAcceloTimesheet(jobcardid, timesheetid, button, refresh) {
  const context = reviewContext
  const id = Number(timesheetid)
  if (!context || context.jobcardid !== Number(jobcardid) || !context.allowed.has(id) || context.pending.has(id)) return
  const sheet = context.sheets.find(item => Number(item.timesheetid) === id)
  if (!sheet || !window.confirm(`Approve ${sheet.employee_name}'s full daily timesheet for ${String(sheet.timesheet_date).slice(0,10)}? This includes time on other job cards. Confirm that you have reviewed the timesheet.`)) return
  const feedback = document.querySelector('#acceloTimesheetFeedback')
  context.pending.add(id)
  button.disabled = true
  button.textContent = 'Approving...'
  if (feedback) feedback.textContent = ''
  try {
    const response = await fetch(`${API_BASE}/workforce/timesheets/${id}/action`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'APPROVE',reason:''})
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not approve this timesheet.')
    context.allowed.delete(id)
    button.textContent = 'Approved'
    if (feedback) feedback.textContent = 'Timesheet approved. Updating package readiness...'
    try { await refresh(Number(jobcardid)) }
    catch { if (feedback?.isConnected) feedback.textContent = 'Timesheet approved. Use Check readiness to refresh the package status.' }
  } catch (error) {
    if (feedback) feedback.textContent = error.message
    button.disabled = false
    button.textContent = 'Approve timesheet'
  } finally { context.pending.delete(id) }
}
