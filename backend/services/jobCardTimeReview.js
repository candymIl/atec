const stamp = value => value == null ? NaN : new Date(value).getTime()
const day = value => new Date(stamp(value)+7200000).toISOString().slice(0,10)

function reviewJobCardTimes(entries,cards,date) {
  const corrections=[],problems=[],matchedCards=[]
  if(!entries.length) problems.push('No time entries have been recorded for this day.')
  if(entries.some(e=>!Number.isFinite(stamp(e.started_at))||!Number.isFinite(stamp(e.ended_at))||stamp(e.ended_at)<=stamp(e.started_at))) problems.push('An incomplete or invalid time entry needs manual review.')
  for(const card of cards) {
    const name=card.jobcard_reference
    if(!['APPROVED','INVOICED'].includes(card.status)) {problems.push(`${name}: review the job card before using its times.`);continue}
    const segments=[['TRAVEL',card.departed_at,card.arrived_at],['STANDBY',card.arrived_at,card.work_started_at],['WORK',card.work_started_at,card.work_completed_at],['TRAVEL',card.work_completed_at,card.travel_completed_at]]
    if(segments.some(([,a,b])=>!Number.isFinite(stamp(a))||!Number.isFinite(stamp(b))||stamp(b)<stamp(a))) {problems.push(`${name}: the job-card timeline is incomplete or out of order.`);continue}
    const expected=segments.filter(([,a,b])=>stamp(b)>stamp(a) && day(a)===date)
    const actual=entries.filter(e=>Number(e.jobcardid)===Number(card.jobcardid))
    if(!expected.length) {problems.push(`${name}: its recorded work date differs from this timesheet. Review the date; no automatic correction offered.`);continue}
    const beforeCount=corrections.length
    for(const activity of new Set([...expected.map(s=>s[0]),...actual.map(e=>e.activity_type)])) {
      const target=expected.filter(s=>s[0]===activity).sort((a,b)=>stamp(a[1])-stamp(b[1]))
      const found=actual.filter(e=>e.activity_type===activity).sort((a,b)=>stamp(a.started_at)-stamp(b.started_at))
      if(target.length!==found.length) {problems.push(`${name}: ${activity.toLowerCase()} has ${found.length} entries; the job card requires ${target.length}. Check missing or duplicate entries.`);continue}
      target.forEach((s,i)=>{
        const entry=found[i]
        if(!Number.isFinite(stamp(entry.started_at))||!Number.isFinite(stamp(entry.ended_at))) {problems.push(`${name}: incomplete employee time needs manual review.`);return}
        if(stamp(entry.started_at)!==stamp(s[1])||stamp(entry.ended_at)!==stamp(s[2])) corrections.push({timeentryid:entry.timeentryid,jobcardid:card.jobcardid,jobcard_reference:name,activity_type:activity,before_started_at:entry.started_at,before_ended_at:entry.ended_at,started_at:s[1],ended_at:s[2]})
      })
    }
    if(corrections.length===beforeCount && !problems.some(p=>p.startsWith(`${name}:`))) matchedCards.push(name)
  }
  const proposed=entries.map(e=>{
    const change=corrections.find(c=>c.timeentryid===e.timeentryid)
    return {...e,start:stamp(change?.started_at??e.started_at),end:stamp(change?.ended_at??e.ended_at)}
  }).sort((a,b)=>a.start-b.start)
  for(let i=0;i<proposed.length;i++) for(let j=i+1;j<proposed.length && proposed[j].start<proposed[i].end;j++) {
    problems.push('Matching the job cards would leave overlapping time in this day. Review the conflicting entries first.')
    i=proposed.length;break
  }
  return {corrections,problems:[...new Set(problems)],matched_cards:matchedCards,can_match:corrections.length>0 && problems.length===0}
}
module.exports={reviewJobCardTimes}
