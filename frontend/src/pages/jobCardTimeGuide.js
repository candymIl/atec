import { escapeHtml } from '../utils/security.js'

const format = value => new Date(value).toLocaleString('en-ZA',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
const signature = review => JSON.stringify(review?.corrections || [])

export function mountJobCardTimeGuide(root,data,{request,refresh,role}) {
  if(!data.time_review) return
  const review=data.time_review, sheet=data.timesheet
  const canApprove=role==='ADMIN'||(role==='MANAGER' && sheet.status==='EMPLOYEE_SUBMITTED')
  const pending=review.corrections.length>0 || review.problems.length>0
  const action=sheet.status==='AWAITING_EMPLOYEE' ? 'Submit and approve this day (Admin)' : 'Approve this day'
  root.innerHTML=`<section class="time-guide"><h3>What needs doing?</h3>
    ${review.problems.length ? `<ul>${review.problems.map(p=>`<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
    ${review.corrections.length ? `<p><strong>${review.corrections.length} recorded period(s) differ from the approved job cards.</strong> If those job-card times are correct, use the correction below.</p><div class="table-scroll"><table><thead><tr><th>Job / activity</th><th>Timesheet now</th><th>Approved job card</th></tr></thead><tbody>${review.corrections.map(c=>`<tr><td>${escapeHtml(c.jobcard_reference)} · ${escapeHtml(c.activity_type)}</td><td>${escapeHtml(format(c.before_started_at))}–${escapeHtml(format(c.before_ended_at))}</td><td>${escapeHtml(format(c.started_at))}–${escapeHtml(format(c.ended_at))}</td></tr>`).join('')}</tbody></table></div>` : !review.problems.length ? '<p><strong>Recorded job times match their approved job cards.</strong> No time or date changes are needed.</p>' : ''}
    <p><strong>Next step:</strong> ${pending ? 'Resolve the differences above, then review and approve the day.' : sheet.status==='AWAITING_EMPLOYEE' ? 'Employee submission is outstanding. An Admin can submit and approve the reviewed day here.' : sheet.status==='EMPLOYEE_SUBMITTED'||sheet.status==='RETURNED' ? 'Review the full day, then approve it here.' : 'The day is already manager approved; HR acceptance remains separate.'}</p>
    ${review.can_match || (canApprove && !pending && ['AWAITING_EMPLOYEE','EMPLOYEE_SUBMITTED','RETURNED'].includes(sheet.status)) ? '<label>Review / correction reason<input data-guide-reason minlength="5" placeholder="Confirm what you checked"></label>' : ''}
    <div class="form-actions">${review.can_match ? '<button type="button" data-guide-match>Match the job card times</button>' : ''}${canApprove && !pending && ['AWAITING_EMPLOYEE','EMPLOYEE_SUBMITTED','RETURNED'].includes(sheet.status) ? `<button type="button" data-guide-approve>${action}</button>` : ''}</div><p class="muted-text">Approval covers ${escapeHtml(sheet.employee_name)}’s entire day, including other jobs and non-job entries. Review the timeline below. These actions do not send an Accelo email or accept payroll.</p><p data-guide-feedback role="status"></p></section>`
  if(root.querySelector('[data-guide-match],[data-guide-approve]')) {
    root.querySelector('.form-actions').insertAdjacentHTML('beforebegin',`<label class="time-guide-confirm"><input type="checkbox" data-guide-confirm> ${review.can_match ? 'I confirm the approved job-card times shown above are correct.' : 'I have reviewed the complete day, including other jobs, breaks and exceptions.'}</label>`)
  }
  let busy=false
  const execute=async handler=>{
    if(busy) return
    const reason=root.querySelector('[data-guide-reason]')?.value.trim() || ''
    const feedback=root.querySelector('[data-guide-feedback]')
    if(reason.length<5) {feedback.textContent='Enter a clear review reason of at least 5 characters.';return}
    if(!root.querySelector('[data-guide-confirm]')?.checked) {feedback.textContent='Tick the review confirmation before continuing.';return}
    busy=true;root.querySelectorAll('button').forEach(b=>{b.disabled=true})
    try {await handler(reason,feedback)} catch(error) {feedback.textContent=error.message}
    finally {busy=false;root.querySelectorAll('button').forEach(b=>{b.disabled=false})}
  }
  root.querySelector('[data-guide-match]')?.addEventListener('click',()=>execute(async(reason,feedback)=>{
    const current=await request(`/workforce/timesheets/${sheet.timesheetid}/manager-edit`)
    if(!current.time_review?.can_match || signature(current.time_review)!==signature(review)) throw new Error('The times changed since this comparison. Reopen the review before applying corrections.')
    let saved=0
    try {
      for(const change of review.corrections) {
        await request(`/workforce/timesheets/${sheet.timesheetid}/time-entries/${change.timeentryid}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({started_at:change.started_at,ended_at:change.ended_at,expected_started_at:change.before_started_at,expected_ended_at:change.before_ended_at,reason})})
        saved++
      }
      await refresh(true)
    } catch(error) {feedback.textContent=`${saved} of ${review.corrections.length} corrections saved. ${error.message} Reopen the review before retrying.`}
  }))
  root.querySelector('[data-guide-approve]')?.addEventListener('click',()=>execute(async(reason,feedback)=>{
    const current=await request(`/workforce/timesheets/${sheet.timesheetid}/manager-edit`)
    if(current.timesheet.status!==sheet.status || !current.time_review || current.time_review.problems.length || current.time_review.corrections.length) throw new Error('The day or its times changed. Reopen and review the current day before approving.')
    let submitted=false
    try {
      if(sheet.status==='AWAITING_EMPLOYEE') {
        await request(`/workforce/timesheets/${sheet.timesheetid}/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'SUBMIT_EMPLOYEE',reason})})
        submitted=true
      }
      await request(`/workforce/timesheets/${sheet.timesheetid}/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'APPROVE',reason})})
      await refresh(false)
    } catch(error) {feedback.textContent=`${submitted?'Employee submission succeeded; approval remains outstanding. ':''}${error.message} Reopen the review to retry the remaining step.`}
  }))
}
