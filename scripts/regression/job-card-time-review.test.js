const {test}=require('node:test')
const assert=require('node:assert/strict')
const {reviewJobCardTimes}=require('../../backend/services/jobCardTimeReview')
const t=s=>`2026-09-29T${s}:00+02:00`
const card={jobcardid:228,jobcard_reference:'JC-2026-00228',status:'APPROVED',departed_at:t('12:00'),arrived_at:t('12:30'),work_started_at:t('12:40'),work_completed_at:t('13:15'),travel_completed_at:t('13:45')}
const entries=[['TRAVEL','12:00','12:30'],['STANDBY','12:30','12:40'],['WORK','12:40','13:15'],['TRAVEL','13:15','13:45']].map(([activity_type,start,end],i)=>({timeentryid:i+1,jobcardid:228,activity_type,started_at:t(start),ended_at:t(end)}))
test('matching day needs approval, not invented time changes',()=>{
  const r=reviewJobCardTimes(entries,[card],'2026-09-29')
  assert.deepEqual(r.corrections,[]);assert.deepEqual(r.problems,[]);assert.deepEqual(r.matched_cards,['JC-2026-00228']);assert.equal(r.can_match,false)
})
test('shifted return travel identifies exact audited before and after',()=>{
  const rows=entries.map(e=>({...e}));rows[3].started_at=t('13:45');rows[3].ended_at=t('14:15')
  const r=reviewJobCardTimes(rows,[card],'2026-09-29')
  assert.equal(r.can_match,true);assert.equal(r.corrections.length,1);assert.equal(r.corrections[0].timeentryid,4);assert.equal(r.corrections[0].started_at,t('13:15'))
})
test('missing/duplicate periods, wrong dates and overlapping other work stop automatic matching',()=>{
  assert.equal(reviewJobCardTimes(entries.slice(0,3),[card],'2026-09-29').problems.length,1)
  assert.equal(reviewJobCardTimes([...entries,entries[3]],[card],'2026-09-29').can_match,false)
  assert.match(reviewJobCardTimes(entries,[card],'2026-09-28').problems[0],/date/)
  const rows=entries.map(e=>({...e}));rows[3].started_at=t('13:45');rows[3].ended_at=t('14:15')
  rows.push({timeentryid:50,activity_type:'WORK',started_at:t('13:20'),ended_at:t('13:35')})
  assert.equal(reviewJobCardTimes(rows,[card],'2026-09-29').can_match,false)
})
test('unapproved cards, incomplete timelines and invalid entries are not auto-corrected',()=>{
  assert.equal(reviewJobCardTimes(entries,[{...card,status:'DRAFT'}],'2026-09-29').can_match,false)
  assert.ok(reviewJobCardTimes(entries,[{...card,travel_completed_at:null}],'2026-09-29').problems.length)
  assert.ok(reviewJobCardTimes([...entries,{started_at:null,ended_at:null}],[card],'2026-09-29').problems.length)
})
