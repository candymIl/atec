const CLOSED = new Set(['HANDED_OVER', 'RESOLVED', 'COMPLETED', 'CANCELLED'])
const STATUSES = { QUOTE: ['OPEN', 'HANDED_OVER', 'CANCELLED'], ATTENTION: ['OPEN', 'RESOLVED', 'CANCELLED'], REBOOK: ['OPEN', 'WAITING', 'BOOKED', 'COMPLETED', 'CANCELLED'] }
const LABELS = { QUOTE: 'To Quote', ATTENTION: 'Assets Needing Attention', REBOOK: 'To Rebook', OPEN: 'Open', HANDED_OVER: 'Handed to Accelo', RESOLVED: 'Resolved', WAITING: 'Waiting', BOOKED: 'Booked', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }
function invalid(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }) }
function day(value) { return value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }) : null }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value }
function positiveId(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw invalid('Invalid record reference'); return n }
function scopedWhere(user, values, alias = 'j') {
  if (user.role === 'ADMIN') return 'TRUE'
  values.push(user.user_id)
  if (user.role === 'MANAGER') return `EXISTS (SELECT 1 FROM atec.tblusermanagerassignment m WHERE m.employee_user_id=${alias}.assigned_to_user_id AND m.manager_user_id=$${values.length})`
  throw invalid('Only Admins and Managers can review follow-ups', 403)
}
function enrich(row, today = day(new Date())) {
  const raised = day(row.raised_at)
  const closed = CLOSED.has(row.status)
  const end = closed && row.closed_at ? day(row.closed_at) : today
  const age_days = Math.max(0, Math.round((Date.parse(end) - Date.parse(raised)) / 86400000))
  return { ...row, raised_date: raised, due_date: day(row.due_date), booked_date: day(row.booked_date), closed,
    age_days, age_band: age_days <= 7 ? '0–7' : age_days <= 14 ? '8–14' : age_days <= 30 ? '15–30' : 'Over 30',
    overdue: !closed && Boolean(row.due_date) && day(row.due_date) < today }
}
function filterRows(rows, filters = {}) {
  for (const key of ['from', 'to']) if (filters[key] && !validDate(filters[key])) throw invalid('Use a valid report date')
  if (filters.from && filters.to && filters.from > filters.to) throw invalid('Start date must precede end date')
  return rows.filter(r => (!filters.kind || r.kind === filters.kind) && (!filters.clientid || String(r.clientid) === String(filters.clientid)) &&
    (!filters.siteid || String(r.siteid) === String(filters.siteid)) && (!filters.owner || String(r.responsible_user_id || 'UNASSIGNED') === String(filters.owner)) &&
    (!filters.from || r.raised_date >= filters.from) && (!filters.to || r.raised_date <= filters.to) &&
    (!filters.state || filters.state === 'ALL' || (filters.state === 'OPEN' ? !r.closed : r.closed)) &&
    (filters.overdue !== 'true' || r.overdue))
}
function summary(rows) {
  const attentionAssets = new Set()
  const result = { total: rows.length, open: 0, closed: 0, overdue: 0, awaiting_handover: 0, attention: 0, awaiting_rebooking: 0, booked: 0, ageing: { '0–7': 0, '8–14': 0, '15–30': 0, 'Over 30': 0 } }
  for (const r of rows) {
    if (r.closed) { result.closed++; continue }
    result.open++; result.ageing[r.age_band]++; if (r.overdue) result.overdue++
    if (r.kind === 'QUOTE') result.awaiting_handover++
    if (r.kind === 'ATTENTION') attentionAssets.add(r.assetid)
    if (r.kind === 'REBOOK') r.status === 'BOOKED' ? result.booked++ : result.awaiting_rebooking++
  }
  result.attention = attentionAssets.size
  return result
}
function sortRows(rows, sort, direction = 'asc') {
  const keys = {
    date: r => [r.raised_date],
    customer: r => [r.clientname, r.sitename, r.asset_label || r.job_assets],
    followup: r => [LABELS[r.kind], r.description],
    responsible: r => [r.responsible_name],
    status: r => [LABELS[r.status]]
  }
  if (!keys[sort]) return rows
  const sign = direction === 'desc' ? -1 : 1
  const compare = new Intl.Collator('en-ZA', { numeric: true, sensitivity: 'base' }).compare
  return rows.sort((a, b) => {
    const left = keys[sort](a), right = keys[sort](b)
    for (let i = 0; i < left.length; i++) {
      if (!left[i] && right[i]) return 1
      if (left[i] && !right[i]) return -1
      const order = compare(String(left[i] || ''), String(right[i] || ''))
      if (order) return order * sign
    }
    return a.followupid - b.followupid
  })
}
function validateUpdate(row, body) {
  if (!STATUSES[row.kind]?.includes(body.status)) throw invalid('Invalid follow-up status')
  if (Number(body.version) !== Number(row.version)) throw invalid('This item changed. Reload it before saving.', 409)
  for (const key of ['due_date', 'booked_date']) if (body[key] && !validDate(body[key])) throw invalid('Use a valid date')
  if (['RESOLVED', 'COMPLETED', 'CANCELLED', 'WAITING'].includes(body.status) && !String(body.notes || '').trim()) throw invalid('Record the resolution, waiting reason or cancellation reason in the notes')
  if (body.status === 'BOOKED' && !body.booked_date) throw invalid('Enter the return visit date')
  const text = key => { const value = String(body[key] || '').trim(); if (value.length > 10000) throw invalid('Notes are too long'); return value }
  return { status: body.status, responsible_user_id: body.responsible_user_id ? positiveId(body.responsible_user_id) : null,
    due_date: body.due_date || null, accelo_reference: row.kind === 'QUOTE' ? text('accelo_reference') : '',
    booked_date: row.kind === 'REBOOK' ? body.booked_date || null : null,
    return_jobcardid: row.kind === 'REBOOK' && body.return_jobcardid ? positiveId(body.return_jobcardid) : null, notes: text('notes') }
}

// Called inside the job-card transaction. Existing items are never implicitly closed or reopened.
async function syncFollowups(client, jobcardid, body, userId) {
  for (const key of ['quote_required', 'return_visit_required']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw invalid('Follow-up selections must be yes or no')
  await client.query(`UPDATE atec.tbljobcard SET quote_required=COALESCE($2,quote_required),
    return_visit_required=COALESCE($3,return_visit_required),return_visit_reason=COALESCE($4,return_visit_reason) WHERE jobcardid=$1`,
  [jobcardid, body.quote_required ?? null, body.return_visit_required ?? null, body.return_visit_reason ?? null])
  const { rows: [card] } = await client.query('SELECT * FROM atec.tbljobcard WHERE jobcardid=$1', [jobcardid])
  if (card.status === 'CANCELLED') return
  if (card.quote_required && !String(card.recommendations || '').trim()) throw invalid('Describe the recommendation requiring a quote')
  if (card.return_visit_required && !String(card.return_visit_reason || '').trim()) throw invalid('Describe the unfinished work and why a return visit is needed')
  const items = []
  if (card.quote_required) items.push({ kind: 'QUOTE', description: card.recommendations })
  if (card.return_visit_required) items.push({ kind: 'REBOOK', description: card.return_visit_reason })
  if (['OUT_OF_SERVICE', 'RESTRICTED'].includes(card.equipment_status)) {
    const { rows } = await client.query(`SELECT ja.assetid,COALESCE(NULLIF(a.assettagno,''),NULLIF(a.serialno,''),'Asset '||ja.assetid) AS label
      FROM atec.tbljobcardasset ja JOIN atec.tblasset a ON a.assetid=ja.assetid WHERE ja.jobcardid=$1`, [jobcardid])
    for (const asset of rows) items.push({ kind: 'ATTENTION', assetid: asset.assetid, label: asset.label, description: card.equipment_status_reason, condition: card.equipment_status })
  }
  for (const item of items) {
    await client.query(`INSERT INTO atec.tbljobcardfollowup
    (jobcardid,kind,assetid,asset_label,description,reported_condition,history) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    ON CONFLICT DO NOTHING`, [jobcardid, item.kind, item.assetid || null, item.label || '', item.description, item.condition || '',
    JSON.stringify([{ at: new Date().toISOString(), user_id: userId, action: 'Raised', note: item.description }])])
    await client.query(`UPDATE atec.tbljobcardfollowup SET description=$4,reported_condition=$5,updated_at=now(),version=version+1,
      history=history||$6::jsonb WHERE jobcardid=$1 AND kind=$2 AND COALESCE(assetid,0)=$3
      AND status IN ('OPEN','WAITING','BOOKED') AND (description IS DISTINCT FROM $4 OR reported_condition IS DISTINCT FROM $5)`,
    [jobcardid,item.kind,item.assetid || 0,item.description,item.condition || '',JSON.stringify([{at:new Date().toISOString(),user_id:userId,action:'Source job card updated',note:item.description}])])
  }
}
module.exports = { CLOSED, STATUSES, LABELS, invalid, positiveId, scopedWhere, enrich, filterRows, summary, sortRows, validateUpdate, syncFollowups }
