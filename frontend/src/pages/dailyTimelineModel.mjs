export function analyseTimeline(entries) {
  const valid = [], invalid = []
  for (const entry of entries) {
    const start = new Date(entry.started_at).getTime(), end = new Date(entry.ended_at).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) invalid.push(entry)
    else valid.push({ ...entry, start, end })
  }
  valid.sort((a,b) => a.start-b.start || a.end-b.end)
  const overlaps = [], gaps = []
  for (let i=0; i<valid.length; i++) {
    for (let j=i+1; j<valid.length && valid[j].start<valid[i].end; j++) {
      overlaps.push({ start:valid[j].start, end:Math.min(valid[i].end,valid[j].end), ids:[valid[i].timeentryid,valid[j].timeentryid] })
    }
  }
  let coveredEnd = valid[0]?.end
  for (const entry of valid.slice(1)) {
    if (entry.start>coveredEnd) gaps.push({ start:coveredEnd, end:entry.start })
    coveredEnd = Math.max(coveredEnd,entry.end)
  }
  return { valid, invalid, overlaps, gaps }
}

export function moveTimelineEntry(start,end,delta,mode) {
  const snapped = Math.round(delta / 300000) * 300000
  if (mode === 'start') return { start:Math.min(start+snapped,end-60000),end }
  if (mode === 'end') return { start,end:Math.max(end+snapped,start+60000) }
  return { start:start+snapped,end:end+snapped }
}
