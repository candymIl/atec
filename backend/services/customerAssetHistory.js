function textValue(value, fallback = "-") {
  const text = String(value ?? "").trim()
  return text || fallback
}

function normalizedStatus(value) {
  return String(value || "").trim().toUpperCase()
}

function isFailedResult(row = {}) {
  const failedValues = new Set(["FAIL", "NO", "NOT SAFE", "UNSAFE"])
  return failedValues.has(normalizedStatus(row.result)) || failedValues.has(normalizedStatus(row.measuredvalue))
}

function daysBetween(fromValue, toValue) {
  const from = new Date(fromValue)
  const to = new Date(toValue)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000))
}

function buildCustomerAssetHistory(asset, inspections = []) {
  const events = inspections.map(inspection => {
    const results = Array.isArray(inspection.results) ? inspection.results : []
    const failures = results.filter(isFailedResult).map(row => ({
      criteria: textValue(row.criterianame, "Inspection criterion"),
      result: textValue(row.result || row.measuredvalue, "Failed"),
      measuredValue: textValue(row.measuredvalue, ""),
      remarks: textValue(row.remarks, "Reason not recorded")
    }))

    return {
      ...inspection,
      inspectiontype: normalizedStatus(inspection.inspectiontype),
      status: normalizedStatus(inspection.status) || "UNKNOWN",
      failures,
      resolvedBy: null,
      resolvesTestIds: [],
      unresolved: false
    }
  }).sort((left, right) => {
    const dateDifference = new Date(left.testdate || 0) - new Date(right.testdate || 0)
    if (dateDifference) return dateDifference
    return Number(left.testid || 0) - Number(right.testid || 0)
  })

  const unresolvedByType = new Map()
  events.forEach(event => {
    const type = event.inspectiontype || "OTHER"
    const unresolved = unresolvedByType.get(type) || []

    if (event.status === "NOT SAFE") {
      unresolved.push(event)
      unresolvedByType.set(type, unresolved)
      return
    }

    if (event.status === "SAFE" && unresolved.length) {
      event.resolvesTestIds = unresolved.map(failure => failure.testid)
      unresolved.forEach(failure => {
        failure.resolvedBy = {
          testid: event.testid,
          testdate: event.testdate,
          daysToSafe: daysBetween(failure.testdate, event.testdate)
        }
      })
      unresolvedByType.set(type, [])
    }
  })

  unresolvedByType.forEach(unresolved => {
    unresolved.forEach(event => { event.unresolved = true })
  })

  const visualEvents = events.filter(event => event.inspectiontype === "VISUAL")
  const loadEvents = events.filter(event => event.inspectiontype === "LOADTEST")
  const latestVisual = visualEvents.at(-1) || null
  const latestLoad = loadEvents.at(-1) || null
  const notSafeEvents = events.filter(event => event.status === "NOT SAFE")

  return {
    generatedAt: new Date().toISOString(),
    asset,
    summary: {
      totalInspections: events.length,
      visualInspections: visualEvents.length,
      loadTests: loadEvents.length,
      safeOutcomes: events.filter(event => event.status === "SAFE").length,
      notSafeOutcomes: notSafeEvents.length,
      resolvedFailures: notSafeEvents.filter(event => event.resolvedBy).length,
      unresolvedFailures: notSafeEvents.filter(event => event.unresolved).length,
      firstInspectionDate: events[0]?.testdate || null,
      latestInspectionDate: events.at(-1)?.testdate || null,
      currentVisualStatus: latestVisual?.status || "NO VISUAL",
      currentLoadStatus: latestLoad?.status || "NO LOAD TEST"
    },
    events: [...events].reverse()
  }
}

function pdfDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return textValue(value)
  return date.toISOString().slice(0, 10)
}

function drawCustomerAssetHistoryPdf(doc, history) {
  const colors = {
    navy: "#1f3b5c",
    text: "#1f2937",
    muted: "#52606d",
    border: "#d9e1ec",
    soft: "#f8fafc",
    safe: "#00843d",
    safeSoft: "#dcfce7",
    danger: "#b91c1c",
    dangerSoft: "#fee2e2"
  }
  const margin = 38
  const pageWidth = doc.page.width
  const contentWidth = pageWidth - (margin * 2)
  let y = 34

  const ensureSpace = height => {
    if (y + height <= doc.page.height - 54) return
    doc.addPage()
    y = 36
  }

  const writePair = (label, value, x, width) => {
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(colors.muted).text(label, x, y, { width })
    doc.font("Helvetica").fontSize(9).fillColor(colors.text).text(textValue(value), x, y + 11, { width })
  }

  doc.font("Helvetica-Bold").fontSize(20).fillColor(colors.navy)
    .text("Asset History Review", margin, y, { width: contentWidth })
  y += 28
  doc.font("Helvetica").fontSize(8).fillColor(colors.muted)
    .text(`Generated ${pdfDate(history.generatedAt)}`, margin, y)
  y += 20

  const assetBoxY = y
  doc.roundedRect(margin, assetBoxY, contentWidth, 94, 6).fillAndStroke(colors.soft, colors.border)
  y = assetBoxY + 12
  const pairWidth = contentWidth / 3
  const pairY = y
  writePair("Asset ID", history.asset.assetid, margin + 12, pairWidth - 20)
  y = pairY
  writePair("Serial Number", history.asset.serialno, margin + pairWidth + 6, pairWidth - 20)
  y = pairY
  writePair("Asset Tag", history.asset.assettagno, margin + (pairWidth * 2), pairWidth - 20)
  y = pairY + 42
  writePair("Equipment Type", history.asset.equipmenttype, margin + 12, pairWidth - 20)
  y = pairY + 42
  writePair("Site / Section", `${textValue(history.asset.sitename)} / ${textValue(history.asset.sectionname)}`, margin + pairWidth + 6, pairWidth - 20)
  y = pairY + 42
  writePair("Description", history.asset.description, margin + (pairWidth * 2), pairWidth - 20)
  y = assetBoxY + 104

  const metrics = [
    ["Total Inspections", history.summary.totalInspections],
    ["Visual Inspections", history.summary.visualInspections],
    ["Load Tests", history.summary.loadTests],
    ["Not Safe Outcomes", history.summary.notSafeOutcomes],
    ["Resolved Failures", history.summary.resolvedFailures],
    ["Unresolved Failures", history.summary.unresolvedFailures]
  ]
  const metricGap = 7
  const metricWidth = (contentWidth - (metricGap * 2)) / 3
  metrics.forEach(([label, value], index) => {
    const row = Math.floor(index / 3)
    const column = index % 3
    const boxX = margin + (column * (metricWidth + metricGap))
    const boxY = y + (row * 43)
    doc.roundedRect(boxX, boxY, metricWidth, 35, 5).fillAndStroke("#ffffff", colors.border)
    doc.font("Helvetica").fontSize(7.5).fillColor(colors.muted).text(label, boxX + 8, boxY + 7, { width: metricWidth - 50 })
    doc.font("Helvetica-Bold").fontSize(13).fillColor(colors.navy).text(String(value), boxX + metricWidth - 42, boxY + 7, { width: 34, align: "right" })
  })
  y += 94

  doc.font("Helvetica-Bold").fontSize(13).fillColor(colors.navy).text("Inspection Timeline", margin, y)
  y += 18

  if (!history.events.length) {
    doc.font("Helvetica").fontSize(9).fillColor(colors.muted).text("No inspection or load-test records are available for this asset.", margin, y)
  }

  history.events.forEach(event => {
    const failureLines = event.status === "NOT SAFE"
      ? (event.failures.length ? event.failures : [{ criteria: "Failure reason", result: "Not Safe", remarks: "Reason not recorded" }])
      : []
    doc.font("Helvetica-Bold").fontSize(8)
    const failureHeight = failureLines.reduce((height, failure) => {
      const headingHeight = doc.heightOfString(`${textValue(failure.criteria)}: ${textValue(failure.result)}`, { width: contentWidth - 36 })
      doc.font("Helvetica").fontSize(8)
      const reasonHeight = doc.heightOfString(`Reason: ${textValue(failure.remarks, "Reason not recorded")}`, { width: contentWidth - 48 })
      doc.font("Helvetica-Bold").fontSize(8)
      return height + headingHeight + reasonHeight + 8
    }, 0)
    const recoveryHeight = event.resolvedBy || event.unresolved || event.resolvesTestIds.length ? 22 : 0
    const estimatedHeight = Math.max(62, 50 + failureHeight + recoveryHeight)
    ensureSpace(estimatedHeight)
    const cardY = y
    const statusColor = event.status === "NOT SAFE" ? colors.danger : colors.safe
    const statusFill = event.status === "NOT SAFE" ? colors.dangerSoft : colors.safeSoft

    doc.roundedRect(margin, cardY, contentWidth, estimatedHeight, 6).fillAndStroke("#ffffff", colors.border)
    doc.roundedRect(margin + 10, cardY + 10, 76, 21, 10).fill(statusFill)
    doc.font("Helvetica-Bold").fontSize(8).fillColor(statusColor).text(event.status, margin + 15, cardY + 16, { width: 66, align: "center" })
    doc.font("Helvetica-Bold").fontSize(10).fillColor(colors.navy)
      .text(`${pdfDate(event.testdate)} - ${textValue(event.inspectiontype)}`, margin + 98, cardY + 10, { width: contentWidth - 210 })
    doc.font("Helvetica").fontSize(8).fillColor(colors.muted)
      .text(`Certificate ${textValue(event.testid)} | Inspector: ${textValue(event.inspector)}${event.job_number ? ` | Job: ${event.job_number}` : ""}`, margin + 98, cardY + 25, { width: contentWidth - 112 })

    let detailY = cardY + 43
    failureLines.forEach(failure => {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(colors.danger)
        .text(`${textValue(failure.criteria)}: ${textValue(failure.result)}`, margin + 18, detailY, { width: contentWidth - 36 })
      detailY = doc.y + 2
      doc.font("Helvetica").fontSize(8).fillColor(colors.text)
        .text(`Reason: ${textValue(failure.remarks, "Reason not recorded")}`, margin + 28, detailY, { width: contentWidth - 48 })
      detailY = doc.y + 6
    })

    if (event.resolvedBy) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(colors.safe)
        .text(`Returned to safe by ${event.inspectiontype} certificate ${event.resolvedBy.testid} on ${pdfDate(event.resolvedBy.testdate)}${event.resolvedBy.daysToSafe === null ? "" : ` after ${event.resolvedBy.daysToSafe} day(s)`}.`, margin + 18, detailY, { width: contentWidth - 36 })
    } else if (event.unresolved) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(colors.danger)
        .text("Unresolved Not Safe Event - no later safe inspection of the same type is recorded.", margin + 18, detailY, { width: contentWidth - 36 })
    } else if (event.resolvesTestIds.length) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(colors.safe)
        .text(`Returned ${event.resolvesTestIds.length} earlier ${event.inspectiontype} failure(s) to safe.`, margin + 18, detailY, { width: contentWidth - 36 })
    }
    y = cardY + estimatedHeight + 8
  })

}

module.exports = {
  buildCustomerAssetHistory,
  drawCustomerAssetHistoryPdf,
  isFailedResult
}
