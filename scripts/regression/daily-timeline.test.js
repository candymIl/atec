const { test } = require('node:test')
const assert = require('node:assert/strict')
const model = import('../../frontend/src/pages/dailyTimelineModel.mjs')
const entry = (id,start,end) => ({timeentryid:id,started_at:`2026-09-29T${start}:00+02:00`,ended_at:`2026-09-29T${end}:00+02:00`})
test('touching entries are contiguous; nested overlaps do not create false gaps',async()=>{
  const {analyseTimeline}=await model
  const result=analyseTimeline([entry(1,'07:00','11:00'),entry(2,'08:00','09:00'),entry(3,'11:00','12:00'),entry(4,'12:15','13:00')])
  assert.deepEqual(result.overlaps.map(o=>o.ids),[[1,2]])
  assert.equal(result.gaps.length,1)
  assert.equal(result.gaps[0].end-result.gaps[0].start,15*60000)
})
test('all simultaneous pairs are flagged and incomplete times remain visible',async()=>{
  const {analyseTimeline}=await model
  const result=analyseTimeline([entry(1,'07:00','10:00'),entry(2,'07:30','09:00'),entry(3,'08:00','09:30'),{timeentryid:4,started_at:'bad',ended_at:null}])
  assert.equal(result.overlaps.length,3)
  assert.equal(result.invalid[0].timeentryid,4)
  assert.equal(result.gaps.length,0)
  assert.deepEqual(analyseTimeline([]),{valid:[],invalid:[],overlaps:[],gaps:[]})
})
test('dragging snaps to five minutes and moving preserves duration; resizing cannot invert entry',async()=>{
  const {moveTimelineEntry}=await model
  assert.deepEqual(moveTimelineEntry(0,3600000,420000,'move'),{start:300000,end:3900000})
  assert.deepEqual(moveTimelineEntry(0,3600000,7200000,'start'),{start:3540000,end:3600000})
  assert.deepEqual(moveTimelineEntry(0,3600000,-7200000,'end'),{start:0,end:60000})
})
