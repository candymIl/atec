import { escapeHtml, safeAttr } from '../utils/security.js'
import { analyseTimeline, moveTimelineEntry } from './dailyTimelineModel.mjs'
import './dailyTimeline.css'

const localInput = value => {
  const d = new Date(value)
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)
}
const time = value => new Date(value).toLocaleString('en-ZA',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
const label = e => [e.customer_name_snapshot,e.job_number_snapshot ? `Accelo ${e.job_number_snapshot}` : '',e.brief_details].filter(Boolean).join(' · ') || e.activity_type
const colour = activity => activity === 'TRAVEL' ? 'travel' : ['STANDBY','WAITING'].includes(activity) ? 'standby' : activity === 'BREAK' ? 'break' : 'work'

export function mountDailyTimeline(root,data,onSave) {
  const originals = data.entries.map(e => ({...e}))
  let entries = originals.map(e => ({...e})), selected = null, previewed = false, busy = false
  let reason = ''
  const dayStart = new Date(`${String(data.timesheet.timesheet_date).slice(0,10)}T00:00:00`).getTime()
  const defaultStart = dayStart+6*3600000, defaultEnd=dayStart+18*3600000
  const initial = analyseTimeline(entries)
  let axisStart = Math.floor(Math.min(defaultStart,...initial.valid.map(e=>e.start))/3600000)*3600000
  let axisEnd = Math.ceil(Math.max(defaultEnd,...initial.valid.map(e=>e.end))/3600000)*3600000
  let width = axisEnd-axisStart
  const pct = n => (n-axisStart)/width*100
  const changed = () => entries.filter(e => {
    const original = originals.find(o=>o.timeentryid===e.timeentryid)
    return !Object.is(new Date(e.started_at).getTime(),new Date(original.started_at).getTime()) || !Object.is(new Date(e.ended_at).getTime(),new Date(original.ended_at).getTime())
  })
  function draw() {
    const model = analyseTimeline(entries)
    axisStart = Math.floor(Math.min(defaultStart,...model.valid.map(e=>e.start))/3600000)*3600000
    axisEnd = Math.ceil(Math.max(defaultEnd,...model.valid.map(e=>e.end))/3600000)*3600000
    // Keep a mistyped date from creating years of hourly ticks.
    if(axisEnd-axisStart>48*3600000) {axisStart=defaultStart;axisEnd=defaultEnd}
    width = axisEnd-axisStart
    const selectedEntry = entries.find(e=>String(e.timeentryid)===String(selected))
    const changes = changed()
    const dateIssues = model.valid.filter(e=>localInput(e.start).slice(0,10)!==String(data.timesheet.timesheet_date).slice(0,10))
    const issue = (item,type) => `<li class="dt-issue ${type}"><strong>${Math.round((item.end-item.start)/60000)} min ${type} · ${escapeHtml(time(item.start))}–${escapeHtml(time(item.end))}</strong>${item.ids ? item.ids.map(id=>`<button type="button" data-select="${safeAttr(id)}">Review entry ${safeAttr(id)}</button>`).join('') : '<span>Check whether this was a break or missing time.</span>'}</li>`
    const activities = [...new Set(model.valid.map(e=>e.activity_type))]
    let ticks = ''
    for(let n=axisStart; n<=axisEnd; n+=3600000) ticks += `<span style="left:${pct(n)}%">${escapeHtml(localInput(n).slice(0,10)!==String(data.timesheet.timesheet_date).slice(0,10)?time(n):new Date(n).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}))}</span>`
    root.innerHTML = `<section class="daily-timeline"><h3>Inspector daily timeline</h3><p>${escapeHtml(data.timesheet.employee_name)} · ${escapeHtml(data.timesheet.timesheet_date)} · All recorded jobs for this day</p><p class="dt-tip">Click a block to adjust exact dates and times. Drag a block to move it; drag its edges to resize (5-minute steps). Changes are drafts until saved.</p><div class="dt-scroll"><div class="dt-chart"><div class="dt-axis"><div>${ticks}</div></div>${activities.map(activity=>{
      const row = model.valid.filter(e=>e.activity_type===activity && e.end>axisStart && e.start<axisEnd), ends=[]
      const blocks = row.map(e=>{
        let lane=ends.findIndex(end=>end<=e.start); if(lane<0) lane=ends.length; ends[lane]=e.end
        const conflict=model.overlaps.some(o=>o.ids.includes(e.timeentryid))
        return `<div class="dt-block ${colour(activity)} ${conflict?'conflict':''} ${String(selected)===String(e.timeentryid)?'selected':''}" data-entry="${safeAttr(e.timeentryid)}" style="left:${pct(e.start)}%;width:${(e.end-e.start)/width*100}%;top:${lane*62+8}px" title="${safeAttr(`${label(e)}: ${time(e.start)} to ${time(e.end)}`)}"><span class="dt-handle start" data-mode="start" aria-hidden="true"></span><button type="button" data-select="${safeAttr(e.timeentryid)}">${escapeHtml(label(e))}<small>${escapeHtml(new Date(e.start).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}))}–${escapeHtml(new Date(e.end).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}))}</small></button><span class="dt-handle end" data-mode="end" aria-hidden="true"></span></div>`
      }).join('')
      return `<div class="dt-row"><strong>${escapeHtml(activity.replaceAll('_',' '))}</strong><div class="dt-track" style="--dt-hours:${width/3600000};height:${Math.max(1,ends.length)*62+16}px">${model.gaps.map(g=>`<div class="dt-gap" style="left:${pct(g.start)}%;width:${(g.end-g.start)/width*100}%"></div>`).join('')}${blocks}</div></div>`
    }).join('') || '<p>No valid time entries to display.</p>'}</div></div><div class="dt-legend"><span class="travel">Travel</span><span class="standby">Standby / waiting</span><span class="work">Work / other</span><span class="break">Break</span><span class="conflict">Overlap</span><span>Grey shading: gap between recorded entries</span></div><div class="dt-panels"><section><h4>Issues to review ${previewed?'· proposed times':''}</h4><ul>${dateIssues.map(e=>`<li class="dt-issue overlap"><strong>Different date · ${escapeHtml(time(e.start))}</strong>${escapeHtml(label(e))}<button type="button" data-select="${safeAttr(e.timeentryid)}">Review date</button></li>`).join('')}${model.overlaps.map(o=>issue(o,'overlap')).join('')}${model.gaps.map(g=>issue(g,'gap')).join('')}${model.invalid.map(e=>`<li class="dt-issue overlap">Invalid or incomplete time: ${escapeHtml(label(e))}<button type="button" data-select="${safeAttr(e.timeentryid)}">Review entry</button></li>`).join('')}${!model.overlaps.length && !model.gaps.length && !model.invalid.length && !dateIssues.length ? '<li>No gaps or overlaps between recorded entries.</li>' : ''}</ul><p class="dt-tip">Gaps are prompts to investigate, not proof of missing work. Matching entries may be duplicates; verify before deleting in the detailed table.</p></section><section><h4>Adjust selected entry</h4>${selectedEntry ? `<strong>${escapeHtml(label(selectedEntry))} · ${escapeHtml(selectedEntry.activity_type)}</strong><div class="dt-inputs"><label>Start<input data-field="start" type="datetime-local" value="${safeAttr(Number.isFinite(new Date(selectedEntry.started_at).getTime())?localInput(selectedEntry.started_at):'')}"></label><label>End<input data-field="end" type="datetime-local" value="${safeAttr(Number.isFinite(new Date(selectedEntry.ended_at).getTime())?localInput(selectedEntry.ended_at):'')}"></label></div>` : '<p>Select an entry in the timeline or issue list.</p>'}<label>Reason for correction<input data-field="reason" minlength="5" value="${safeAttr(reason)}" placeholder="Explain the change"></label><div class="dt-actions"><button type="button" data-action="preview" ${!selectedEntry||busy?'disabled':''}>Preview change</button><button type="button" data-action="cancel" ${busy?'disabled':''}>Cancel draft</button></div><div role="status" class="dt-message"></div>${previewed && changes.length ? `<div class="dt-preview"><h4>Proposed correction</h4>${changes.map(e=>{
      const old=originals.find(o=>o.timeentryid===e.timeentryid)
      return `<p>${escapeHtml(label(e))}<br>Previous: ${escapeHtml(time(old.started_at))}–${escapeHtml(time(old.ended_at))}<br>Proposed: ${escapeHtml(time(e.started_at))}–${escapeHtml(time(e.ended_at))}</p>`
    }).join('')}<p>${model.overlaps.length} overlap(s) remain. Review them before saving.</p><button type="button" data-action="save" ${busy?'disabled':''}>${busy?'Saving…':'Save correction'}</button></div>` : ''}</section></div></section>`
    root.querySelectorAll('[data-select]').forEach(button=>button.addEventListener('click',()=>{
      if(busy) return
      if(changes.length && String(selected)!==button.dataset.select) { message('Save or cancel the current draft before selecting another entry.'); return }
      selected=button.dataset.select; draw()
    }))
    root.querySelector('[data-field="reason"]').addEventListener('input',event=>{reason=event.target.value})
    root.querySelectorAll('[data-field="start"],[data-field="end"]').forEach(input=>input.addEventListener('input',()=>{previewed=false; root.querySelector('.dt-preview')?.remove()}))
    root.querySelector('[data-action="preview"]').addEventListener('click',()=>{
      const start = new Date(root.querySelector('[data-field="start"]').value), end = new Date(root.querySelector('[data-field="end"]').value)
      if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end-start>86400000) {message('Enter valid dates and times, with end after start and a duration of at most 24 hours.');return}
      selectedEntry.started_at=start.toISOString(); selectedEntry.ended_at=end.toISOString(); previewed=true; draw()
      if(!changed().length) message('Change a start or end time before saving.')
    })
    root.querySelector('[data-action="cancel"]').addEventListener('click',()=>{entries=originals.map(e=>({...e}));previewed=false;reason='';draw()})
    root.querySelector('[data-action="save"]')?.addEventListener('click',async()=>{
      if(busy) return
      if(reason.trim().length<5) {message('Enter a clear reason of at least 5 characters.');return}
      busy=true;draw()
      try {const e=changed()[0]; await onSave(e,reason.trim());busy=false;draw()} catch(error) {busy=false;draw();message(error.message)}
    })
    root.querySelectorAll('[data-entry]').forEach(block=>block.addEventListener('pointerdown',event=>{
      if(busy||event.button!==0) return
      const entry=model.valid.find(e=>String(e.timeentryid)===block.dataset.entry)
      if(changes.length && String(selected)!==String(entry.timeentryid)) {message('Save or cancel the current draft first.');return}
      const x=event.clientX, trackWidth=block.parentElement.getBoundingClientRect().width, mode=event.target.dataset.mode || 'move'
      block.setPointerCapture(event.pointerId)
      let moved=false, result
      const move=ev=>{
        if(Math.abs(ev.clientX-x)<4 && !moved) return
        moved=true;result=moveTimelineEntry(entry.start,entry.end,(ev.clientX-x)/trackWidth*width,mode)
        if(result.start<axisStart || result.end>axisEnd || result.end-result.start>86400000) {result=null;return}
        block.style.left=`${pct(result.start)}%`;block.style.width=`${(result.end-result.start)/width*100}%`
      }
      const finish=ev=>{
        block.removeEventListener('pointermove',move);block.removeEventListener('pointerup',finish);block.removeEventListener('pointercancel',cancel)
        if(moved) {
          selected=entry.timeentryid
          if(result && ev.type==='pointerup') {const e=entries.find(e=>e.timeentryid===entry.timeentryid);e.started_at=new Date(result.start).toISOString();e.ended_at=new Date(result.end).toISOString()}
          previewed=false;draw()
        } else if(ev.type==='pointerup') {selected=entry.timeentryid;draw()}
      }
      const cancel=ev=>finish(ev)
      block.addEventListener('pointermove',move);block.addEventListener('pointerup',finish);block.addEventListener('pointercancel',cancel)
    }))
  }
  function message(text) {root.querySelector('.dt-message').textContent=text}
  draw()
}
