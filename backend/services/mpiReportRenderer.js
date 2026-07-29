const fs = require("fs")
const path = require("path")
const PDFDocument = require("pdfkit")

const TEMPLATE_NUMBER = "FBC286"
const TEMPLATE_REVISION = 1
const INDICATION_DEFINITIONS = [
  "Linear indications have a length greater than three times their width.",
  "Rounded indications have a length equal to or less than three times their width."
]
const NDT_DISCLAIMER =
  "The statement No Relevant Indications (NRI) found does not imply that all possible indications or defects would have been found, since each NDT method has its own limitations. A defect-free component may still fail when subjected to loads beyond its design criteria."
const PAGE_MARGIN = { top: 164, right: 34, bottom: 108, left: 34 }

function pageLayout(outputType) {
  if (outputType === "CUSTOMER_REPORT") {
    return {
      margins: { top: 140, right: 34, bottom: 94, left: 34 },
      frameX: 72.5,
      frameWidth: 450,
      headerY: 8,
      separatorY: 132,
      footerY: 766,
      metaY: 746
    }
  }
  return {
    margins: PAGE_MARGIN,
    frameX: 34,
    frameWidth: 527.28,
    headerY: 10,
    separatorY: 151,
    footerY: 752.89,
    metaY: 739.89
  }
}

function text(value, fallback = "-") {
  const result = String(value ?? "").trim()
  return result || fallback
}

function displayCode(value) {
  return text(value).replaceAll("_", " ")
}

function displayDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return text(value)
  return new Intl.DateTimeFormat("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date)
}

function reportOutputNumber(report, outputType) {
  return `${report.report_number}-${outputType === "PRACTICAL_EXAM" ? "PE" : "CR"}`
}

function safeUploadPath(uploadRoot, uploadPath) {
  if (!uploadRoot || !uploadPath) return null
  const relative = String(uploadPath).replace(/^[/\\]*uploads[/\\]?/i, "")
  const resolvedRoot = path.resolve(uploadRoot)
  const resolved = path.resolve(resolvedRoot, relative)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : null
}

function createDocument(report, outputType, options) {
  const layout = pageLayout(outputType)
  const doc = new PDFDocument({
    size: "A4",
    margins: layout.margins,
    bufferPages: true,
    info: {
      Title: "ATEC Magnetic Particle Test Report",
      Author: "ATEC"
    }
  })
  drawStaticPageFrame(doc, options, outputType)
  doc.on("pageAdded", () => drawStaticPageFrame(doc, options, outputType))
  return doc
}

function collectPdf(doc, draw) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on("data", chunk => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    try {
      draw()
      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

function brandPath(options, filename) {
  const candidate = path.join(options.brandRoot || "", filename)
  return options.brandRoot && fs.existsSync(candidate) ? candidate : null
}

function drawStaticPageFrame(doc, options, outputType) {
  const width = doc.page.width
  const layout = pageLayout(outputType)
  const header = brandPath(options, "header.jpg")
  const footer = brandPath(options, "footer.jpg")
  const savedX = doc.x
  const savedY = doc.y
  const savedBottomMargin = doc.page.margins.bottom
  doc.page.margins.bottom = 0

  if (header) {
    doc.image(header, layout.frameX, layout.headerY, { width: layout.frameWidth })
  } else {
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#17365d")
      .text("ATEC INSPECTIONS", 34, 25, { width: width - 68, align: "center" })
  }

  doc.strokeColor("#94a3b8").lineWidth(0.6).moveTo(34, layout.separatorY).lineTo(width - 34, layout.separatorY).stroke()
  if (footer) {
    doc.image(footer, layout.frameX, layout.footerY, { width: layout.frameWidth })
  }
  doc.fillColor("#111827")
  doc.page.margins.bottom = savedBottomMargin
  doc.x = savedX
  doc.y = savedY
}

function drawPageNumber(doc, report, outputType, pageNumber, pageCount) {
  const layout = pageLayout(outputType)
  const contentWidth = doc.page.width - 68
  const savedX = doc.x
  const savedY = doc.y
  const savedBottomMargin = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.font("Helvetica").fontSize(6.5).fillColor("#475569")
    .text(
      `${reportOutputNumber(report, outputType)} | Rev ${report.report_revision} | Template ${TEMPLATE_NUMBER} Rev ${TEMPLATE_REVISION}`,
      34,
      layout.metaY,
      { width: contentWidth / 2, lineBreak: false }
    )
    .text(`Page ${pageNumber} of ${pageCount}`, 34 + (contentWidth / 2), layout.metaY, {
      width: contentWidth / 2,
      align: "right",
      lineBreak: false
    })

  doc.fillColor("#111827")
  doc.page.margins.bottom = savedBottomMargin
  doc.x = savedX
  doc.y = savedY
}

function applyPageFrames(doc, report, outputType, options) {
  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index)
    drawPageNumber(doc, report, outputType, index + 1, range.count)
  }
}

function ensureSpace(doc, height) {
  if (doc.y + height <= doc.page.height - doc.page.margins.bottom - 4) return
  doc.addPage()
}

function title(doc, value, subtitle = "") {
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#17365d")
    .text(value, { align: "center" })
  if (subtitle) {
    doc.moveDown(0.25).font("Helvetica").fontSize(8).fillColor("#475569")
      .text(subtitle, { align: "center" })
  }
  doc.fillColor("#111827").moveDown(0.8)
}

function sectionHeading(doc, value) {
  ensureSpace(doc, 27)
  const x = doc.page.margins.left
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const y = doc.y
  doc.rect(x, y, width, 20).fill("#d9e2f3")
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#17365d")
    .text(value.toUpperCase(), x + 7, y + 6, { width: width - 14 })
  doc.fillColor("#111827")
  doc.y = y + 24
}

function keyValueGrid(doc, fields, columns = 2, options = {}) {
  const x = doc.page.margins.left
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const columnWidth = width / columns
  const padding = 6
  const rows = []
  for (let index = 0; index < fields.length; index += columns) rows.push(fields.slice(index, index + columns))

  for (const row of rows) {
    const heights = row.map(([label, value]) => {
      doc.font("Helvetica").fontSize(8)
      const valueHeight = doc.heightOfString(text(value), { width: columnWidth - (padding * 2) })
      return Math.max(options.compact ? 27 : 32, valueHeight + (options.compact ? 15 : 18))
    })
    const height = Math.max(...heights, options.compact ? 27 : 32)
    ensureSpace(doc, height)
    const y = doc.y
    row.forEach(([label, value], column) => {
      const cellX = x + (column * columnWidth)
      doc.rect(cellX, y, columnWidth, height).stroke("#cbd5e1")
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#64748b")
        .text(String(label).toUpperCase(), cellX + padding, y + 5, { width: columnWidth - (padding * 2) })
      doc.font("Helvetica").fontSize(8).fillColor("#111827")
        .text(text(value), cellX + padding, y + 15, { width: columnWidth - (padding * 2) })
    })
    doc.y = y + height
  }
  doc.moveDown(0.5)
}

function table(doc, headers, rows, widths, options = {}) {
  const x = doc.page.margins.left
  const padding = 4
  const headerFontSize = options.headerFontSize || 6.5
  doc.font("Helvetica-Bold").fontSize(headerFontSize)
  const headerHeight = Math.max(
    25,
    ...headers.map((header, index) =>
      doc.heightOfString(header, { width: widths[index] - (padding * 2), lineGap: 1 })
    )
  ) + (padding * 2)
  const drawHeader = () => {
    ensureSpace(doc, headerHeight + 22)
    const y = doc.y
    let cursor = x
    headers.forEach((header, index) => {
      doc.rect(cursor, y, widths[index], headerHeight).fillAndStroke("#d9e2f3", "#94a3b8")
      doc.font("Helvetica-Bold").fontSize(headerFontSize).fillColor("#17365d")
        .text(header, cursor + padding, y + 6, {
          width: widths[index] - (padding * 2),
          align: options.alignments?.[index] || "left",
          lineGap: 1
        })
      cursor += widths[index]
    })
    doc.fillColor("#111827")
    doc.y = y + headerHeight
  }

  drawHeader()
  for (const row of rows) {
    doc.font("Helvetica").fontSize(options.fontSize || 7)
    const heights = row.map((value, index) =>
      doc.heightOfString(text(value, ""), {
        width: widths[index] - (padding * 2),
        align: options.alignments?.[index] || "left",
        lineGap: 1
      })
    )
    const height = Math.max(options.minimumRowHeight || 20, Math.max(...heights) + (padding * 2))
    if (doc.y + height > doc.page.height - doc.page.margins.bottom - 4) {
      doc.addPage()
      drawHeader()
    }
    const y = doc.y
    let cursor = x
    row.forEach((value, index) => {
      doc.rect(cursor, y, widths[index], height).stroke("#cbd5e1")
      doc.font("Helvetica").fontSize(options.fontSize || 7).fillColor("#111827")
        .text(text(value, ""), cursor + padding, y + padding, {
          width: widths[index] - (padding * 2),
          align: options.alignments?.[index] || "left",
          lineGap: 1
        })
      cursor += widths[index]
    })
    doc.y = y + height
  }
  doc.moveDown(0.6)
}

function paragraphBox(doc, label, value, options = {}) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const body = text(value, "None recorded")
  const height = Math.max(
    options.compact ? 32 : 44,
    doc.heightOfString(body, { width: width - 12 }) + (options.compact ? 21 : 26)
  )
  ensureSpace(doc, height)
  const y = doc.y
  doc.rect(doc.page.margins.left, y, width, height).stroke("#cbd5e1")
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#17365d")
    .text(label.toUpperCase(), doc.page.margins.left + 6, y + 5, { width: width - 12 })
  doc.font("Helvetica").fontSize(8).fillColor("#111827")
    .text(body, doc.page.margins.left + 6, y + 17, { width: width - 12 })
  doc.y = y + height + 6
}

function drawWeldDiagram(doc, indication, index) {
  const x = doc.page.margins.left + 18
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right - 36
  const height = 116
  ensureSpace(doc, height + 28)
  const y = doc.y

  doc.font("Helvetica-Bold").fontSize(7).fillColor("#17365d")
    .text(`INDICATION ${index + 1} LOCATION`, doc.page.margins.left, y, { width: width + 36 })
  doc.rect(x, y + 15, width, height).stroke("#111827")
  doc.rect(x, y + 50, width, 46).fillAndStroke("#f1f5f9", "#64748b")
  doc.dash(6, { space: 5 }).moveTo(x, y + 73).lineTo(x + width, y + 73).stroke("#111827").undash()
  doc.font("Helvetica").fontSize(7).fillColor("#475569")
    .text("Weld centreline", x + (width / 2) - 38, y + 66, { width: 76, align: "center" })
    .text("Datum", x + 4, y + 102, { width: 36 })

  if (indication.diagram_x !== null && indication.diagram_y !== null) {
    const markerX = x + (Number(indication.diagram_x) * width)
    const markerY = y + 15 + (Number(indication.diagram_y) * height)
    doc.circle(markerX, markerY, 5).fillAndStroke("#dc2626", "#991b1b")
    doc.font("Helvetica-Bold").fontSize(6).fillColor("#991b1b")
      .text(String(index + 1), markerX - 3, markerY - 3, { width: 6, align: "center" })
  }
  doc.fillColor("#111827")
  doc.y = y + height + 23
}

function drawEvidencePages(doc, record, options) {
  const evidence = (record.attachments || [])
    .map(attachment => ({
      ...attachment,
      localPath: safeUploadPath(options.uploadRoot, attachment.file_path)
    }))
    .filter(attachment => attachment.localPath)
  if (!evidence.length) return

  const perPage = 4
  for (let start = 0; start < evidence.length; start += perPage) {
    doc.addPage()
    sectionHeading(doc, "Photographs and evidence")
    const pageRows = evidence.slice(start, start + perPage)
    const x = doc.page.margins.left
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const gap = 10
    const columnCount = pageRows.length === 1 ? 1 : 2
    const rowCount = Math.ceil(pageRows.length / columnCount)
    const cellWidth = (width - (gap * (columnCount - 1))) / columnCount
    const availableHeight = doc.page.height - doc.page.margins.bottom - doc.y - 4
    const cellHeight = Math.min(
      pageRows.length === 1 ? 430 : 270,
      (availableHeight - (gap * (rowCount - 1))) / rowCount
    )
    pageRows.forEach((attachment, index) => {
      const column = index % columnCount
      const row = Math.floor(index / columnCount)
      const cellX = x + (column * (cellWidth + gap))
      const cellY = doc.y + (row * (cellHeight + gap))
      doc.roundedRect(cellX, cellY, cellWidth, cellHeight, 4).fillAndStroke("#f8fafc", "#cbd5e1")
      doc.image(attachment.localPath, cellX + 6, cellY + 6, {
        fit: [cellWidth - 12, cellHeight - 42],
        align: "center",
        valign: "center"
      })
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#17365d")
        .text(displayCode(attachment.attachment_type), cellX + 6, cellY + cellHeight - 31, {
          width: cellWidth - 12,
          align: "center"
        })
      doc.font("Helvetica").fontSize(6.5).fillColor("#111827")
        .text(text(attachment.caption, attachment.original_filename || ""), cellX + 6, cellY + cellHeight - 20, {
          width: cellWidth - 12,
          height: 15,
          align: "center",
          ellipsis: true
        })
    })
    doc.y += (Math.ceil(pageRows.length / 2) * (cellHeight + gap))
  }
}

function signatureBlock(doc, record, options) {
  const report = record.report
  const performers = report.performing_snapshot || {}
  const certifier = report.certifying_snapshot || {}
  sectionHeading(doc, "Certification")
  const x = doc.page.margins.left
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const columnWidth = width / 2
  const height = 96
  ensureSpace(doc, height)
  const y = doc.y

  const drawSigner = (snapshot, label, signedAt, column) => {
    const cellX = x + (column * columnWidth)
    doc.rect(cellX, y, columnWidth, height).stroke("#94a3b8")
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#17365d")
      .text(label.toUpperCase(), cellX + 7, y + 6, { width: columnWidth - 14 })
    doc.font("Helvetica").fontSize(8).fillColor("#111827")
      .text(text(snapshot.full_name), cellX + 7, y + 19, { width: columnWidth - 14 })
      .text(
        snapshot.qualification_level
          ? `${text(snapshot.qualification_scheme)} | MT Level ${snapshot.qualification_level} | ${text(snapshot.certificate_number)}`
          : "Qualification not recorded",
        cellX + 7,
        y + 31,
        { width: columnWidth - 14 }
      )
      .text(`Signed: ${displayDate(signedAt)}`, cellX + 7, y + 47, { width: columnWidth - 14 })
    const signature = safeUploadPath(options.uploadRoot, snapshot.signature_image)
    if (signature) doc.image(signature, cellX + 7, y + 59, { fit: [columnWidth - 14, 28], align: "left" })
  }

  drawSigner(performers, "Performing technician", report.technician_signed_at, 0)
  drawSigner(
    certifier,
    report.level2_certification_required ? "Level 2 certifying authority" : "Certification",
    report.certified_at,
    1
  )
  doc.y = y + height + 6
}

function compactCustomerCertification(doc, record, options) {
  const report = record.report
  const performer = report.performing_snapshot || {}
  const certifier = report.certifying_snapshot || {}
  const height = 50
  if (doc.y + height + 26 > doc.page.height - doc.page.margins.bottom - 4) {
    doc.addPage()
    drawStaticPageFrame(doc, options, "CUSTOMER_REPORT")
    doc.y = doc.page.margins.top
  }
  sectionHeading(doc, "Certification")
  const x = doc.page.margins.left
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const columnWidth = width / 2
  const y = doc.y

  ;[
    ["Performing technician", performer, report.technician_signed_at],
    [report.level2_certification_required ? "Level 2 certifying authority" : "Certification", certifier, report.certified_at]
  ].forEach(([label, snapshot, signedAt], column) => {
    const cellX = x + (column * columnWidth)
    doc.rect(cellX, y, columnWidth, height).stroke("#94a3b8")
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#17365d")
      .text(String(label).toUpperCase(), cellX + 6, y + 5, { width: columnWidth - 12 })
    doc.font("Helvetica").fontSize(7.3).fillColor("#111827")
      .text(
        `${text(snapshot.full_name)} | MT Level ${text(snapshot.qualification_level)} | ${text(snapshot.certificate_number)}`,
        cellX + 6,
        y + 17,
        { width: columnWidth - 12 }
      )
      .text(`Signed: ${displayDate(signedAt)}`, cellX + 6, y + 32, { width: columnWidth - 12 })
  })
  doc.y = y + height + 4
}

function drawPracticalExam(record, options) {
  const doc = createDocument(record.report, "PRACTICAL_EXAM", options)
  const report = record.report
  const detail = record.mpi_detail || {}
  return collectPdf(doc, () => {
    title(doc, "MAGNETIC PARTICLE TEST REPORT", "PRACTICAL EXAMINATION")
    keyValueGrid(doc, [
      ["Report No", reportOutputNumber(report, "PRACTICAL_EXAM")],
      ["Date of Test", displayDate(report.test_date)],
      ["Client", report.client_name_snapshot],
      ["Address", report.address_snapshot],
      ["Item description", `${text(report.item_description)}${report.item_size ? ` | Size: ${report.item_size}` : ""}`],
      ["Serial No", report.serial_number],
      ["Material specification", report.material_specification],
      ["Drawing / weld reference", report.drawing_weld_reference],
      ["Procedure used", report.procedure_used],
      ["Acceptance standard", report.acceptance_standard],
      ["Area/s tested", report.area_tested],
      ["Surface condition", report.surface_condition]
    ])

    sectionHeading(doc, "Inspection technique and consumables")
    keyValueGrid(doc, [
      ["Current type", detail.current_type],
      ["Particle medium", displayCode(detail.particle_medium)],
      ["Viewing method", displayCode(detail.viewing_method)],
      ["Magnetising method", displayCode(detail.magnetising_method)],
      ["Pre-cleaning", detail.precleaning_method],
      ["White background", displayCode(detail.white_background_application)],
      ["Post clean", detail.post_cleaning_required ? text(detail.post_cleaning_method, "Required") : "Not required"],
      ["Surface temperature", detail.surface_temperature_c === null ? "-" : `${detail.surface_temperature_c} deg C`],
      ["Visible light", detail.visible_light_lux === null ? "-" : `${detail.visible_light_lux} lux`],
      ["UV-A intensity", detail.uva_intensity_uw_cm2 === null ? "-" : `${detail.uva_intensity_uw_cm2} uW/cm2`],
      ["Demagnetisation", detail.demagnetisation_gauss === null ? "-" : `${detail.demagnetisation_gauss} gauss`],
      ["Flux indicator", `${displayCode(detail.flux_indicator_type)} | ${text(detail.flux_indicator_result)}`]
    ])

    sectionHeading(doc, "Test equipment")
    table(
      doc,
      ["Equipment", "Manufacturer / Serial", "Calibration / Certificate", "Reading / Result", "Compliant"],
      record.equipment.map(row => [
        row.equipment_type,
        `${text(row.manufacturer_snapshot, "")} ${text(row.serial_number_snapshot, "")}`.trim(),
        `${displayDate(row.calibration_due_snapshot)}\n${text(row.certificate_number_snapshot, "")}`,
        `${row.reading_value === null ? "" : row.reading_value} ${text(row.reading_unit, "")}\n${text(row.verification_result, "")}`.trim(),
        row.compliant_at_test ? "YES" : "NO"
      ]),
      [92, 110, 123, 148, 54],
      { fontSize: 6.6, alignments: ["left", "left", "left", "left", "center"] }
    )

    sectionHeading(doc, "Consumables")
    table(
      doc,
      ["Type", "Manufacturer", "Product code", "Batch", "Expiry", "Compliant"],
      record.consumables.map(row => [
        displayCode(row.consumable_type),
        row.manufacturer,
        row.product_code,
        row.batch_number,
        displayDate(row.expires_on),
        row.compliant_at_test ? "YES" : "NO"
      ]),
      [92, 95, 90, 85, 100, 65],
      { fontSize: 6.7, alignments: ["left", "left", "left", "left", "center", "center"] }
    )

    sectionHeading(doc, "Equipment pre-use checks")
    table(
      doc,
      ["Check", "Limit", "Compliance", "Remarks"],
      record.checks.map(row => [
        row.check_label_snapshot,
        row.limit_snapshot,
        displayCode(row.result),
        row.result_note
      ]),
      [145, 210, 62, 110],
      { fontSize: 6.7, alignments: ["left", "left", "center", "left"] }
    )

    sectionHeading(doc, "Details of indications / defects")
    if (record.indications.length) {
      table(
        doc,
        ["No", "Datum mm", "Centreline mm", "Length", "Width", "Type", "Disposition"],
        record.indications.map(row => [
          row.sequence_number,
          row.distance_from_datum_mm,
          row.distance_from_centreline_mm,
          row.length_mm,
          row.width_mm,
          displayCode(row.confirmed_classification),
          displayCode(row.code_disposition)
        ]),
        [30, 82, 94, 65, 65, 92, 99],
        { fontSize: 6.5, alignments: ["center", "center", "center", "center", "center", "center", "center"] }
      )
      record.indications.forEach((indication, index) => drawWeldDiagram(doc, indication, index))
    } else {
      paragraphBox(doc, "Finding", "No relevant indications recorded.")
    }

    paragraphBox(doc, "Limitations", report.limitations)
    paragraphBox(doc, "Notes", report.notes)
    paragraphBox(doc, "Outcome", `${displayCode(report.primary_outcome)} | ${displayCode(report.indication_summary)}`)
    paragraphBox(doc, "Definitions", INDICATION_DEFINITIONS.join("\n"))
    paragraphBox(doc, "Disclaimer", NDT_DISCLAIMER)
    signatureBlock(doc, record, options)
    drawEvidencePages(doc, record, options)
    applyPageFrames(doc, report, "PRACTICAL_EXAM", options)
  })
}

function drawCustomerReport(record, options) {
  const doc = createDocument(record.report, "CUSTOMER_REPORT", options)
  const report = record.report
  const detail = record.mpi_detail || {}
  return collectPdf(doc, () => {
    title(doc, "MAGNETIC PARTICLE INSPECTION", "CUSTOMER OUTCOME REPORT")
    keyValueGrid(doc, [
      ["Customer report", reportOutputNumber(report, "CUSTOMER_REPORT")],
      ["Revision", report.report_revision],
      ["Customer", report.client_name_snapshot],
      ["Site / location", `${text(report.site_name_snapshot, "")} ${text(report.address_snapshot, "")}`.trim()],
      ["Item examined", report.item_description],
      ["Serial / identification", report.serial_number],
      ["Customer reference", report.customer_reference],
      ["Drawing / weld reference", report.drawing_weld_reference],
      ["Date examined", displayDate(report.test_date)],
      ["Material specification", report.material_specification]
    ], 2, { compact: true })

    sectionHeading(doc, "Examination scope")
    keyValueGrid(doc, [
      ["Procedure", report.procedure_used],
      ["Acceptance standard", report.acceptance_standard],
      ["Area tested", report.area_tested],
      ["Surface condition", report.surface_condition],
      ["Technique", `${displayCode(detail.particle_medium)} | ${displayCode(detail.viewing_method)} | ${displayCode(detail.magnetising_method)}`],
      ["Coverage", report.examination_scope]
    ], 2, { compact: true })

    sectionHeading(doc, "Outcome")
    const x = doc.page.margins.left
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const outcome = report.primary_outcome || "INCONCLUSIVE"
    const fill = outcome === "ACCEPTABLE" ? "#dcfce7" : outcome === "REJECTED" ? "#fee2e2" : "#fef3c7"
    const colour = outcome === "ACCEPTABLE" ? "#166534" : outcome === "REJECTED" ? "#991b1b" : "#92400e"
    const outcomeY = doc.y
    doc.roundedRect(x, outcomeY, width, 58, 5).fillAndStroke(fill, colour)
    doc.font("Helvetica-Bold").fontSize(18).fillColor(colour)
      .text(displayCode(outcome), x + 10, outcomeY + 9, { width: width - 20, align: "center" })
    doc.font("Helvetica-Bold").fontSize(8).fillColor(colour)
      .text(displayCode(report.indication_summary), x + 10, outcomeY + 34, { width: width - 20, align: "center" })
    doc.fillColor("#111827")
    doc.y = outcomeY + 68

    if (record.indications.length) {
      sectionHeading(doc, "Findings summary")
      table(
        doc,
        ["No", "Location", "Size", "Classification", "Disposition"],
        record.indications.map(row => [
          row.sequence_number,
          `${text(row.distance_from_datum_mm, "")} mm from datum; ${text(row.distance_from_centreline_mm, "")} mm from centreline`,
          `${text(row.length_mm, "")} x ${text(row.width_mm, "")} mm`,
          displayCode(row.confirmed_classification),
          displayCode(row.code_disposition)
        ]),
        [30, 200, 92, 105, 100],
        { fontSize: 7, alignments: ["center", "left", "center", "center", "center"] }
      )
    } else {
      paragraphBox(doc, "Findings summary", "No relevant indications recorded.", { compact: true })
    }

    paragraphBox(doc, "Limitations", report.limitations, { compact: true })
    paragraphBox(doc, "Technical notes", report.notes, { compact: true })
    paragraphBox(doc, "NDT limitation", NDT_DISCLAIMER, { compact: true })
    compactCustomerCertification(doc, record, options)
    applyPageFrames(doc, report, "CUSTOMER_REPORT", options)
  })
}

module.exports = {
  buildCustomerReportPdf: drawCustomerReport,
  buildPracticalExamPdf: drawPracticalExam,
  reportOutputNumber
}
