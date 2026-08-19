const PDFDocument = require("pdfkit")
const fs = require("fs")
const path = require("path")

function text(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value)
}

function formatDate(value, includeTime = false) {
  if (!value) return "-"
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return text(value)
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {})
  }).format(parsed).replace(",", "")
}

function drawCell(doc, value, x, y, width, height, options = {}) {
  doc.rect(x, y, width, height).strokeColor("#aab5c3").stroke()
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size || 7)
    .fillColor(options.color || "#17263c")
    .text(text(value), x + 4, y + 4, { width: width - 8, height: height - 8, ellipsis: true, valign: "center" })
}

function addPageFrame(doc, data, logoPath, footerPath, pageNumber) {
  const left = 28
  const width = doc.page.width - 56
  if (logoPath && fs.existsSync(logoPath)) doc.image(logoPath, left, 22, { fit: [92, 48] })
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#15375f").text("DAILY TIME SHEET", left + 105, 28, { width: width - 210, align: "center" })
  doc.fontSize(8).fillColor("#26384f").text("FBC009-10", left + width - 95, 28, { width: 95, align: "right" })
  doc.font("Helvetica").text(`Page ${pageNumber}`, left + width - 95, 43, { width: 95, align: "right" })
  doc.moveTo(left, 76).lineTo(left + width, 76).lineWidth(1.2).strokeColor("#15375f").stroke()
  if (footerPath && fs.existsSync(footerPath)) {
    doc.image(footerPath, left, doc.page.height - 56, { width, height: 34 })
  } else {
    doc.moveTo(left, doc.page.height - 44).lineTo(left + width, doc.page.height - 44).lineWidth(0.7).strokeColor("#cbd5e1").stroke()
    doc.fontSize(7).fillColor("#526174").text("ATEC Inspection Platform - controlled employee time record", left, doc.page.height - 37, { width, align: "center", lineBreak: false })
  }
}

function createTimesheetPdfBuffer(data, { brandRoot } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 28, bufferPages: true, info: { Title: `Daily Time Sheet ${data.timesheet_date}` } })
    const chunks = []
    doc.on("data", chunk => chunks.push(chunk))
    doc.on("error", reject)
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    const logoPath = brandRoot ? path.join(brandRoot, "logo.jpg") : null
    const footerPath = brandRoot ? path.join(brandRoot, "footer.jpg") : null
    let pageNumber = 1
    addPageFrame(doc, data, logoPath, footerPath, pageNumber)

    const left = 28
    const width = doc.page.width - 56
    let y = 86
    const summary = [
      ["Employee", data.employee_name, "Employee no.", data.employee_number],
      ["Date", formatDate(data.timesheet_date), "Status", String(data.status).replaceAll("_", " ")],
      ["Schedule", data.schedule_snapshot?.schedule_name || "Not assigned", "Manager", data.manager_name]
    ]
    for (const row of summary) {
      drawCell(doc, row[0], left, y, 78, 24, { bold: true })
      drawCell(doc, row[1], left + 78, y, 190, 24)
      drawCell(doc, row[2], left + 268, y, 78, 24, { bold: true })
      drawCell(doc, row[3], left + 346, y, width - 346, 24)
      y += 24
    }

    y += 12
    const columns = [
      ["Task", 28], ["Activity", 54], ["From", 52], ["To", 52], ["Customer / Job", 120],
      ["Details", 116], ["Normal", 60], ["Overtime", 57]
    ]
    const drawHeader = () => {
      let x = left
      for (const [label, cellWidth] of columns) {
        doc.rect(x, y, cellWidth, 24).fill("#15375f")
        drawCell(doc, label, x, y, cellWidth, 24, { bold: true, color: "#ffffff" })
        x += cellWidth
      }
      y += 24
    }
    drawHeader()
    for (const line of data.lines || []) {
      const values = [
        line.task_number, line.activity_type,
        new Date(line.started_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", hour:"2-digit", minute:"2-digit" }),
        new Date(line.ended_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", hour:"2-digit", minute:"2-digit" }),
        [line.customer_name, line.job_number ? `Job ${line.job_number}` : ""].filter(Boolean).join(" / "),
        line.brief_details, Number(line.normal_hours || 0).toFixed(2), Number(line.overtime_hours || 0).toFixed(2)
      ]
      const rowHeight = Math.max(34, ...values.map((value, index) =>
        doc.font("Helvetica").fontSize(7).heightOfString(text(value), { width: columns[index][1] - 8 }) + 10
      ))
      if (y + rowHeight > doc.page.height - 76) {
        doc.addPage()
        pageNumber += 1
        addPageFrame(doc, data, logoPath, footerPath, pageNumber)
        y = 86
        drawHeader()
      }
      let x = left
      values.forEach((value, index) => {
        drawCell(doc, value, x, y, columns[index][1], rowHeight)
        x += columns[index][1]
      })
      y += rowHeight
    }

    y += 10
    const totals = [
      ["Normal hours", data.final_normal_hours],
      ["Overtime hours", data.final_overtime_hours],
      ["Travel hours", data.final_travel_hours],
      ["Standby hours", data.final_standby_hours]
    ]
    let x = left
    for (const [label, value] of totals) {
      drawCell(doc, label, x, y, 78, 22, { bold:true })
      drawCell(doc, Number(value || 0).toFixed(2), x + 78, y, 48, 22)
      x += 126
    }
    y += 34
    if (y + 116 > doc.page.height - 76) {
      doc.addPage()
      pageNumber += 1
      addPageFrame(doc, data, logoPath, footerPath, pageNumber)
      y = 90
    }
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#15375f").text("APPROVAL RECORD", left, y)
    doc.moveTo(left, y + 15).lineTo(left + width, y + 15).lineWidth(0.8).strokeColor("#b9c5d6").stroke()
    y += 24
    const approvals = [
      ["Employee submitted", formatDate(data.employee_submitted_at, true)],
      ["Manager approved", formatDate(data.manager_approved_at, true)],
      ["HR accepted", formatDate(data.hr_accepted_at, true)],
      ["Underground allowance", data.underground_allowance ? "Yes" : "No"]
    ]
    const approvalGap = 10
    const approvalWidth = (width - approvalGap) / 2
    approvals.forEach(([label, value], index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
      const cardX = left + column * (approvalWidth + approvalGap)
      const cardY = y + row * 40
      doc.roundedRect(cardX, cardY, approvalWidth, 32, 3).fillAndStroke("#f8fafc", "#d3dce8")
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#64748b")
        .text(label.toUpperCase(), cardX + 8, cardY + 6, { width: approvalWidth - 16, lineBreak: false })
      doc.font("Helvetica").fontSize(8).fillColor("#17263c")
        .text(value, cardX + 8, cardY + 17, { width: approvalWidth - 16, lineBreak: false, ellipsis: true })
    })

    doc.end()
  })
}

module.exports = { createTimesheetPdfBuffer }
