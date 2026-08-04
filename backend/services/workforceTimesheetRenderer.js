const PDFDocument = require("pdfkit")
const fs = require("fs")
const path = require("path")

function text(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value)
}

function drawCell(doc, value, x, y, width, height, options = {}) {
  doc.rect(x, y, width, height).strokeColor("#aab5c3").stroke()
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size || 7)
    .fillColor(options.color || "#17263c")
    .text(text(value), x + 4, y + 4, { width: width - 8, height: height - 8, ellipsis: true, valign: "center" })
}

function addPageFrame(doc, data, logoPath, pageNumber) {
  const left = 28
  const width = doc.page.width - 56
  if (logoPath && fs.existsSync(logoPath)) doc.image(logoPath, left, 22, { fit: [92, 48] })
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#15375f").text("DAILY TIME SHEET", left + 105, 28, { width: width - 210, align: "center" })
  doc.fontSize(8).fillColor("#26384f").text("FBC009-10", left + width - 95, 28, { width: 95, align: "right" })
  doc.font("Helvetica").text(`Page ${pageNumber}`, left + width - 95, 43, { width: 95, align: "right" })
  doc.moveTo(left, 76).lineTo(left + width, 76).lineWidth(1.2).strokeColor("#15375f").stroke()
  doc.fontSize(7).fillColor("#526174").text("ATEC Inspection Platform - controlled employee time record", left, doc.page.height - 42, { width, align: "center", lineBreak: false })
}

function createTimesheetPdfBuffer(data, { brandRoot } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 28, bufferPages: true, info: { Title: `Daily Time Sheet ${data.timesheet_date}` } })
    const chunks = []
    doc.on("data", chunk => chunks.push(chunk))
    doc.on("error", reject)
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    const logoPath = brandRoot ? path.join(brandRoot, "logo.jpg") : null
    let pageNumber = 1
    addPageFrame(doc, data, logoPath, pageNumber)

    const left = 28
    const width = doc.page.width - 56
    let y = 86
    const summary = [
      ["Employee", data.employee_name, "Employee no.", data.employee_number],
      ["Date", String(data.timesheet_date).slice(0, 10), "Status", String(data.status).replaceAll("_", " ")],
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
      ["Task", 30], ["Activity", 57], ["From", 57], ["To", 57], ["Customer / Job", 115],
      ["Details", 104], ["Normal", 45], ["OT", 40]
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
      if (y + 38 > doc.page.height - 42) {
        doc.addPage()
        pageNumber += 1
        addPageFrame(doc, data, logoPath, pageNumber)
        y = 86
        drawHeader()
      }
      const values = [
        line.task_number, line.activity_type,
        new Date(line.started_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", hour:"2-digit", minute:"2-digit" }),
        new Date(line.ended_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", hour:"2-digit", minute:"2-digit" }),
        [line.customer_name, line.job_number ? `Job ${line.job_number}` : ""].filter(Boolean).join(" / "),
        line.brief_details, Number(line.normal_hours || 0).toFixed(2), Number(line.overtime_hours || 0).toFixed(2)
      ]
      let x = left
      values.forEach((value, index) => {
        drawCell(doc, value, x, y, columns[index][1], 38)
        x += columns[index][1]
      })
      y += 38
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
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#17263c")
      .text(`Employee submitted: ${text(data.employee_submitted_at)}`, left, y)
      .text(`Manager approved: ${text(data.manager_approved_at)}`, left + 255, y)
    y += 16
    doc.text(`HR accepted: ${text(data.hr_accepted_at)}`, left, y)
      .text(`Underground allowance: ${data.underground_allowance ? "Yes" : "No"}`, left + 255, y)

    doc.end()
  })
}

module.exports = { createTimesheetPdfBuffer }
