const { CLOSED, LABELS, invalid, positiveId, scopedWhere, enrich, filterRows, summary, sortRows, validateUpdate } = require('../services/jobCardFollowups')
const ExcelJS = require('exceljs')
const PDFDocument = require('pdfkit')

async function reportData(pool, user, filters) {
  const values = []
  const scope = scopedWhere(user, values)
  // Deliberately independent of the 250-card operational queue limit.
  const { rows } = await pool.query(`SELECT f.*,j.jobcard_reference,j.customer_reference,j.status AS job_status,
    j.clientid,j.siteid,c.clientname,s.sitename,COALESCE(NULLIF(u.fullname,''),u.username,'Unassigned') AS responsible_name,
    r.jobcard_reference AS return_reference,
    COALESCE((SELECT string_agg(COALESCE(NULLIF(a.assettagno,''),NULLIF(a.serialno,''),'Asset '||a.assetid),', ' ORDER BY a.assetid)
      FROM atec.tbljobcardasset ja JOIN atec.tblasset a ON a.assetid=ja.assetid WHERE ja.jobcardid=j.jobcardid),'') AS job_assets,
    COALESCE((SELECT string_agg(m.quantity||' x '||m.description, '; ' ORDER BY m.materialid)
      FROM atec.tbljobcardmaterial m WHERE m.jobcardid=j.jobcardid AND m.material_status='REQUIRED'),'') AS required_parts
    FROM atec.tbljobcardfollowup f JOIN atec.tbljobcard j ON j.jobcardid=f.jobcardid
    JOIN atec.tblclients c ON c.clientid=j.clientid JOIN atec.tblsites s ON s.siteid=j.siteid
    LEFT JOIN atec.tblusers u ON u.userid=f.responsible_user_id
    LEFT JOIN atec.tbljobcard r ON r.jobcardid=f.return_jobcardid
    WHERE ${scope} ORDER BY f.raised_at,f.followupid`, values)
  const all = rows.map(r => enrich(r))
  const filtered = filterRows(all, filters)
  filtered.sort((a, b) => Number(a.closed) - Number(b.closed) || Number(b.overdue) - Number(a.overdue) || a.followupid - b.followupid)
  sortRows(filtered, filters.sort, filters.direction)
  const users = await pool.query(`SELECT userid AS user_id,COALESCE(NULLIF(fullname,''),username) AS name FROM atec.tblusers
    WHERE COALESCE(is_active,true)=true AND role IN ('ADMIN','MANAGER','INSPECTOR') ORDER BY name`)
  return { rows: filtered, summary: summary(filtered), generated_at: new Date().toISOString(), filters,
    options: { customers: [...new Map(all.map(r => [r.clientid, { id: r.clientid, name: r.clientname }])).values()],
      sites: [...new Map(all.map(r => [r.siteid, { id: r.siteid, clientid: r.clientid, name: r.sitename }])).values()],
      owners: [...new Map(all.map(r => [r.responsible_user_id || 'UNASSIGNED', { id: r.responsible_user_id || 'UNASSIGNED', name: r.responsible_name }])).values()], users: users.rows } }
}
const columns = [
  ['Type', r => LABELS[r.kind]], ['Job card', r => r.jobcard_reference], ['Accelo job', r => r.customer_reference],
  ['Customer', r => r.clientname], ['Site', r => r.sitename], ['Asset(s)', r => r.asset_label || r.job_assets],
  ['Work / reason', r => r.description], ['Reported condition', r => r.reported_condition?.replaceAll('_',' ')], ['Job card status', r => r.job_status?.replaceAll('_',' ')],
  ['Status', r => LABELS[r.status]], ['Responsible person', r => r.responsible_name], ['Raised', r => r.raised_date],
  ['Due', r => r.due_date], ['Days open / to close', r => r.age_days], ['Age band', r => r.age_band], ['Overdue', r => r.overdue ? 'Yes' : 'No'],
  ['Accelo handover reference', r => r.accelo_reference], ['Return date', r => r.booked_date], ['Return job card', r => r.return_reference],
  ['Required parts', r => r.required_parts], ['Notes / resolution', r => r.notes], ['Closed', r => r.closed_at ? new Date(r.closed_at).toISOString() : '']
]
function filterDescription(data) {
  const f = data.filters
  return `Raised: ${f.from || 'Any date'} to ${f.to || 'Any date'} | Type: ${LABELS[f.kind] || 'All'} | Status: ${f.state || 'All'} | Customer: ${data.options.customers.find(x => String(x.id) === f.clientid)?.name || 'All'} | Site: ${data.options.sites.find(x => String(x.id) === f.siteid)?.name || 'All'} | Owner: ${data.options.owners.find(x => String(x.id) === f.owner)?.name || 'All'}${f.overdue === 'true' ? ' | Overdue only' : ''}`
}
async function workbook(data) {
  const book = new ExcelJS.Workbook()
  const overview = book.addWorksheet('Management summary')
  overview.columns = [{ width: 38 }, { width: 110 }]
  overview.addRow(['Job Card Follow-ups', 'ATEC'])
  overview.addRow(['Generated', data.generated_at]); overview.addRow(['Filters', filterDescription(data)])
  for (const key of ['total','open','closed','overdue','awaiting_handover','attention','awaiting_rebooking','booked']) overview.addRow([key.replaceAll('_',' '), data.summary[key]])
  for (const [band, count] of Object.entries(data.summary.ageing)) overview.addRow([`Open: ${band} days`, count])
  const sheet = book.addWorksheet('Follow-ups', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = columns.map(([header]) => ({ header, width: ['Work / reason','Notes / resolution','Required parts'].includes(header) ? 55 : 23 }))
  for (const row of data.rows) sheet.addRow(columns.map(([, value]) => value(row) ?? ''))
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: columns.length } }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173653' } }
  sheet.eachRow(r => { r.alignment = { vertical: 'top', wrapText: true } })
  const history = book.addWorksheet('Action history')
  history.columns = ['Follow-up','Job card','When','Action','User','Details'].map(header => ({ header, width: header === 'Details' ? 100 : 25 }))
  for (const row of data.rows) for (const event of row.history || []) history.addRow([row.followupid,row.jobcard_reference,event.at,event.action,event.user_name || event.user_id || '',event.note || JSON.stringify(event.changes || {})])
  return book.xlsx.writeBuffer()
}
function pdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true })
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject)
    doc.font('Helvetica-Bold').fontSize(19).text('Job Card Follow-ups')
    doc.font('Helvetica').fontSize(9).text(`Generated: ${data.generated_at}`).text(filterDescription(data)).moveDown()
    const s = data.summary
    doc.fontSize(11).text(`Total: ${s.total}    Open: ${s.open}    Closed: ${s.closed}    Overdue: ${s.overdue}`)
    doc.fontSize(10).text(`Awaiting Accelo handover: ${s.awaiting_handover} | Attention: ${s.attention} | Awaiting rebooking: ${s.awaiting_rebooking} | Booked: ${s.booked}`)
    doc.text(`Open ageing: ${Object.entries(s.ageing).map(([k,v]) => `${k} days: ${v}`).join(' | ')}`).moveDown()
    doc.fontSize(9).text('Dates filter when items were raised. Closed-item age stops at closure. Equipment condition is the original job-card report; review resolution evidence for current condition.').moveDown()
    if (!data.rows.length) doc.text('No follow-ups match these filters.')
    for (const row of data.rows) {
      if (doc.y > 650) doc.addPage()
      doc.font('Helvetica-Bold').fontSize(12).text(`${LABELS[row.kind]} - ${row.jobcard_reference}`)
      doc.font('Helvetica').fontSize(9)
      for (const [label, value] of columns.slice(2)) if (value(row) !== '' && value(row) != null) doc.text(`${label}: ${value(row)}`)
      doc.moveDown()
    }
    const range = doc.bufferedPageRange()
    for (let i=0; i<range.count; i++) { doc.switchToPage(i); doc.fontSize(8).text(`ATEC | Page ${i+1} of ${range.count}`,40,810,{lineBreak:false}) }
    doc.end()
  })
}
function registerJobCardFollowupRoutes(app, { pool, asyncRoute }) {
  app.get('/job-cards/followups/return-jobs', asyncRoute(async (req,res) => {
    const values = [positiveId(req.query.clientid),positiveId(req.query.siteid)]
    const scope = scopedWhere(req.user,values)
    const { rows } = await pool.query(`SELECT j.jobcardid,j.jobcard_reference,j.status FROM atec.tbljobcard j
      WHERE j.clientid=$1 AND j.siteid=$2 AND j.status<>'CANCELLED' AND ${scope} ORDER BY j.jobcardid DESC`,values)
    res.json(rows)
  }))
  app.get('/job-cards/followups', asyncRoute(async (req,res) => res.json(await reportData(pool, req.user, req.query))))
  app.get('/job-cards/followups/export/:format', asyncRoute(async (req,res) => {
    if (!['xlsx','pdf'].includes(req.params.format)) throw invalid('Choose Excel or PDF')
    const data = await reportData(pool,req.user,req.query)
    const buffer = req.params.format === 'xlsx' ? await workbook(data) : await pdf(data)
    res.setHeader('Content-Type',req.params.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf')
    res.setHeader('Content-Disposition',`attachment; filename="job-card-followups.${req.params.format}"`)
    res.send(buffer)
  }))
  app.put('/job-cards/followups/:id', asyncRoute(async (req,res) => {
    const values = [positiveId(req.params.id)]
    const scope = scopedWhere(req.user,values)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows: [row] } = await client.query(`SELECT f.*,j.clientid,j.siteid FROM atec.tbljobcardfollowup f
        JOIN atec.tbljobcard j ON j.jobcardid=f.jobcardid WHERE f.followupid=$1 AND ${scope} FOR UPDATE OF f,j`,values)
      if (!row) throw invalid('Follow-up not found or access denied',404)
      const update = validateUpdate(row,req.body || {})
      if (update.responsible_user_id) {
        const owner = await client.query(`SELECT 1 FROM atec.tblusers WHERE userid=$1 AND COALESCE(is_active,true)=true AND role IN ('ADMIN','MANAGER','INSPECTOR')`,[update.responsible_user_id])
        if (!owner.rows.length) throw invalid('Choose an active responsible person')
      }
      if (update.return_jobcardid) {
        if (update.return_jobcardid === row.jobcardid) throw invalid('The return job card must be a different job card')
        const params = [update.return_jobcardid,row.clientid,row.siteid]
        const returnScope = scopedWhere(req.user,params)
        const linked = await client.query(`SELECT 1 FROM atec.tbljobcard j WHERE jobcardid=$1 AND clientid=$2 AND siteid=$3 AND status<>'CANCELLED' AND ${returnScope}`,params)
        if (!linked.rows.length) throw invalid('Choose an accessible return job card for the same customer and site')
      }
      const event = { at:new Date().toISOString(),user_id:req.user.user_id,user_name:req.user.fullname || req.user.username || '',action:row.status === update.status ? 'Updated' : `${LABELS[row.status]} → ${LABELS[update.status]}`,changes:update }
      const result = await client.query(`UPDATE atec.tbljobcardfollowup SET status=$2,responsible_user_id=$3,due_date=$4,
        accelo_reference=$5,booked_date=$6,return_jobcardid=$7,notes=$8,
        closed_at=CASE WHEN $9 THEN COALESCE(closed_at,now()) ELSE NULL END,
        updated_at=now(),version=version+1,history=history||$10::jsonb WHERE followupid=$1 RETURNING *`,
      [row.followupid,update.status,update.responsible_user_id,update.due_date,update.accelo_reference,update.booked_date,update.return_jobcardid,update.notes,CLOSED.has(update.status),JSON.stringify([event])])
      await client.query('COMMIT')
      res.json(enrich(result.rows[0]))
    } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }))
}
module.exports = { registerJobCardFollowupRoutes, reportData, workbook, pdf }
