const PAID_ACTIVITY_TYPES = new Set([
  "TRAVEL", "WORK", "STANDBY", "BREAK", "WORKSHOP", "TRAINING", "MEETING", "ADMIN", "WAITING", "LEAVE", "SICK_LEAVE", "OTHER"
])

function roundHours(hours, roundingMinutes = 1) {
  const increment = Math.max(1, Number(roundingMinutes) || 1) / 60
  return Math.round((hours + Number.EPSILON) / increment) * increment
}

function localDateKey(date) {
  const value = new Date(date)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

function minutesFromTime(value) {
  if (!value) return null
  const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null
}

function dateAtMinutes(date, minutes) {
  const result = new Date(date)
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return result
}

function overlapMilliseconds(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA.getTime(), endB.getTime()) - Math.max(startA.getTime(), startB.getTime()))
}

function splitIntervalBySchedule(startValue, endValue, activityType, schedule = {}, holidays = new Set(), options = {}) {
  const start = new Date(startValue)
  const end = new Date(endValue)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error("Time entry end must be after its start.")
  }

  const totalHours = (end - start) / 3600000
  if (!PAID_ACTIVITY_TYPES.has(activityType)) {
    return { totalHours, normalHours: 0, overtimeHours: 0, doubleTimeHours: 0 }
  }

  if (activityType === "TRAVEL" && schedule.travel_treatment === "ALWAYS_NORMAL") {
    return { totalHours, normalHours: totalHours, overtimeHours: 0, doubleTimeHours: 0 }
  }
  if (activityType === "TRAVEL" && schedule.travel_treatment === "ALWAYS_OVERTIME") {
    return { totalHours, normalHours: 0, overtimeHours: totalHours, doubleTimeHours: 0 }
  }

  const days = schedule.days || {}
  let cursor = new Date(start)
  cursor.setHours(0, 0, 0, 0)
  let normalMilliseconds = 0
  let doubleTimeMilliseconds = 0

  while (cursor < end) {
    const nextDay = new Date(cursor)
    nextDay.setDate(nextDay.getDate() + 1)
    const dayStart = new Date(Math.max(start.getTime(), cursor.getTime()))
    const dayEnd = new Date(Math.min(end.getTime(), nextDay.getTime()))
    const dayRule = days[cursor.getDay()] || null
    const holiday = holidays.has(localDateKey(cursor))

    if (options.doubleTime === true && (cursor.getDay() === 0 || holiday)) {
      doubleTimeMilliseconds += Math.max(0, dayEnd.getTime() - dayStart.getTime())
    } else if (dayRule && !dayRule.is_overtime_day && !holiday) {
      const normalStartMinutes = minutesFromTime(dayRule.normal_start)
      const normalEndMinutes = minutesFromTime(dayRule.normal_end)
      if (normalStartMinutes !== null && normalEndMinutes !== null && normalEndMinutes > normalStartMinutes) {
        normalMilliseconds += overlapMilliseconds(
          dayStart,
          dayEnd,
          dateAtMinutes(cursor, normalStartMinutes),
          dateAtMinutes(cursor, normalEndMinutes)
        )
      }
    }
    cursor = nextDay
  }

  const normalHours = Math.min(totalHours, normalMilliseconds / 3600000)
  const doubleTimeHours = Math.min(totalHours - normalHours, doubleTimeMilliseconds / 3600000)
  return {
    totalHours,
    normalHours,
    overtimeHours: Math.max(0, totalHours - normalHours - doubleTimeHours),
    doubleTimeHours
  }
}

function calculateTimeEntries(entries = [], schedule = {}, holidays = new Set(), options = {}) {
  const roundingMinutes = schedule.rounding_minutes || 1
  const lines = entries.map((entry, index) => {
    const split = splitIntervalBySchedule(entry.started_at, entry.ended_at, entry.activity_type, schedule, holidays, options)
    const factor = entry.activity_type === "BREAK" ? -1 : 1
    return {
      ...entry,
      task_number: index + 1,
      total_hours: roundHours(split.totalHours, roundingMinutes),
      normal_hours: roundHours(split.normalHours * factor, roundingMinutes),
      overtime_hours: roundHours(split.overtimeHours * factor, roundingMinutes),
      double_time_hours: roundHours(split.doubleTimeHours * factor, roundingMinutes)
    }
  })

  const sum = (selector) => roundHours(lines.reduce((total, line) => total + selector(line), 0), roundingMinutes)
  let automaticBreakHours = 0
  const paidLines = lines.filter(line => PAID_ACTIVITY_TYPES.has(line.activity_type) && line.activity_type !== "BREAK")
  const hasRecordedBreak = lines.some(line => line.activity_type === "BREAK")
  if (!hasRecordedBreak && paidLines.length) {
    const firstStart = new Date(Math.min(...paidLines.map(line => new Date(line.started_at).getTime())))
    const lastEnd = new Date(Math.max(...paidLines.map(line => new Date(line.ended_at).getTime())))
    const dayRule = schedule.days?.[firstStart.getDay()]
    const scheduledBreakHours = Math.max(0,Number(dayRule?.unpaid_break_minutes || 0)) / 60
    const span = splitIntervalBySchedule(firstStart,lastEnd,"WORK",schedule,holidays,options)
    const paidNormalHours = paidLines.reduce((total,line) => total + Math.max(0,line.normal_hours),0)
    const uncoveredNormalHours = Math.max(0,span.normalHours - paidNormalHours)
    if (span.totalHours >= 5 && scheduledBreakHours > uncoveredNormalHours) {
      automaticBreakHours = roundHours(scheduledBreakHours - uncoveredNormalHours,roundingMinutes)
    }
  }
  if (automaticBreakHours > 0) {
    const deductionLine = paidLines.reduce((largest,line) => line.normal_hours > (largest?.normal_hours || 0) ? line : largest,null)
    if (deductionLine) {
      deductionLine.normal_hours = roundHours(Math.max(0,deductionLine.normal_hours - automaticBreakHours),roundingMinutes)
      deductionLine.automatic_break_deduction = automaticBreakHours
    }
  }
  const summedNormalHours = sum(line => line.normal_hours)
  return {
    lines,
    normal_hours: Math.max(0,summedNormalHours),
    overtime_hours: Math.max(0, sum(line => line.overtime_hours)),
    double_time_hours: Math.max(0, sum(line => line.double_time_hours)),
    travel_hours: sum(line => line.activity_type === "TRAVEL" ? line.total_hours : 0),
    standby_hours: sum(line => line.activity_type === "STANDBY" ? line.total_hours : 0),
    underground_allowance: lines.some(line => line.underground),
    automatic_break_hours: automaticBreakHours
  }
}

module.exports = {
  calculateTimeEntries,
  localDateKey,
  roundHours,
  splitIntervalBySchedule
}
