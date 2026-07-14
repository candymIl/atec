const fs = require("fs")
const os = require("os")
const path = require("path")
const puppeteer = require("puppeteer-core")
const sharp = require("sharp")

const DRIVEN_MACHINERY_CERTIFICATE_NOTE =
  "Certification that the item has been inspected in accordance with the requirements of Driven Machinery and SANS Regulations and the responsible person has been informed of all defects."

const DRIVEN_MACHINERY_ITEMS_CERTIFICATE_NOTE =
  "Certification that the items have been inspected in accordance with the requirements of Driven Machinery and SANS Regulations and the responsible person has been informed of all defects."

const SANS_500_CERTIFICATE_NOTE =
  "EXAMINED AND TESTED IN ACCORDANCE WITH SANS 500"

const REGULATION_18_CERTIFICATE_NOTE =
  "EXAMINED AND TESTED IN ACCORDANCE WITH REGULATION 18 OF OHS ACT 85 OF 1993"

const SANS_500_EQUIPTYPE_IDS = new Set(["101", "102"])

const DRIVEN_MACHINERY_ITEMS_EQUIPTYPE_IDS = new Set([
  "201",
  "202",
  "203",
  "301",
  "302",
  "303",
  "304",
  "305",
  "309",
  "312",
  "314",
  "315",
  "317",
  "319",
  "320",
  "323",
  "324",
  "338",
  "339"
])

function formatPdfDate(value) {
  if (!value) return "-"

  if (value instanceof Date) {
    return value.toISOString().split("T")[0]
  }

  return String(value).split("T")[0]
}

function formatInspectionFrequency(value) {
  const normalized = String(value || "").toUpperCase()
  if (normalized === "ANNUAL") return "Annual"
  if (normalized === "FREQUENT") return "Frequent"
  return ""
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function getProjectRoot(options = {}) {
  return path.resolve(options.projectRoot || path.join(__dirname, "..", ".."))
}

function getUploadsRoot(options = {}) {
  return path.resolve(
    options.uploadsRoot ||
    process.env.UPLOAD_ROOT ||
    process.env.UPLOADS_PATH ||
    path.join(getProjectRoot(options), "backend", "uploads")
  )
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()

  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream"
}

function fileDataUrlIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return ""

  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return ""

  return `data:${mimeTypeForFile(filePath)};base64,${fs.readFileSync(filePath).toString("base64")}`
}

function resolveUploadFilePath(uploadPath, options = {}) {
  if (!uploadPath) return null

  const uploadsRoot = getUploadsRoot(options)
  const rawPath = String(uploadPath).trim().replace(/\\/g, "/")
  const uploadRelativePath = rawPath
    .replace(/^\/?uploads\//, "")
    .replace(/^\/+/, "")
  const normalizedPath = path.posix.normalize(uploadRelativePath)

  if (
    !normalizedPath ||
    normalizedPath.startsWith("../") ||
    normalizedPath === ".." ||
    path.posix.isAbsolute(normalizedPath)
  ) {
    return null
  }

  const fullPath = path.resolve(uploadsRoot, normalizedPath)

  return fullPath.startsWith(uploadsRoot + path.sep) ? fullPath : null
}

function uploadPathToDataUrl(uploadPath, imageDataUrlCache = null, options = {}) {
  const fullPath = resolveUploadFilePath(uploadPath, options)

  if (!fullPath) return ""

  if (imageDataUrlCache?.has(fullPath)) {
    return imageDataUrlCache.get(fullPath)
  }

  return fileDataUrlIfExists(fullPath)
}

function brandImageDataUrl(fileName, options = {}) {
  const filePath = path.join(getProjectRoot(options), "frontend", "public", fileName)
  return fileDataUrlIfExists(filePath)
}

function getCertificateTitle(inspection) {
  if (
    inspection.inspectiontype !== "LOADTEST" &&
    String(inspection.equipgroupid || "") === "400"
  ) {
    return "SERVICE AND INSPECTION"
  }

  return inspection.inspectiontype === "LOADTEST"
    ? "CERTIFICATE OF EXAMINATION AND TEST"
    : "CERTIFICATE OF INSPECTION"
}

function isCertificateSafeServiceRow(row) {
  const name = String(row?.criterianame || row?.criteriadescription || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()

  return name.includes("safe for service") ||
    name.includes("safe for continued operation") ||
    name.includes("safe for review")
}

function isEmptyLoadTestMeasurementRow(row, inspection = {}) {
  if (inspection.inspectiontype !== "LOADTEST") return false

  const result = String(row?.result || "").trim().toUpperCase()
  const measuredValue = String(row?.measuredvalue || "").trim()
  const remarks = String(row?.remarks || "").trim()

  return result === "RECORDED" && !measuredValue && !remarks
}

function isHookWearCertificateRow(row) {
  const text = [
    row?.criterianame,
    row?.criteriadescription
  ].filter(Boolean).join(" ").toLowerCase()

  return text.includes("hook wear does not exceed allowable limits")
}

function isHookMeasuredSizeCertificateRow(row) {
  const text = [
    row?.criterianame,
    row?.criteriadescription
  ].filter(Boolean).join(" ").toLowerCase()

  return text.includes("hook measured size") ||
    text.includes("measured hook throat opening")
}

function enrichCertificateResultRow(row, inspection = {}) {
  if (!isHookMeasuredSizeCertificateRow(row)) return row

  return {
    ...row,
    measuredvalue: row.measuredvalue || inspection.hooksize || ""
  }
}

function getCertificateResultsForDisplay(results = [], inspection = {}) {
  return results
    .map(row => enrichCertificateResultRow(row, inspection))
    .filter(row => !isHookWearCertificateRow(row))
    .filter(row => !isEmptyLoadTestMeasurementRow(row, inspection))
    .sort((left, right) => {
      const leftSafe = isCertificateSafeServiceRow(left)
      const rightSafe = isCertificateSafeServiceRow(right)

      if (leftSafe && !rightSafe) return 1
      if (!leftSafe && rightSafe) return -1
      return 0
    })
}

function getCertificateResultDisplay(row) {
  const result = String(row?.result || "").trim().toUpperCase()

  if (result === "RECORDED") return "PASS"
  if (!isCertificateSafeServiceRow(row)) return result
  if (["NO", "FAIL", "NOT SAFE", "UNSAFE"].includes(result)) return "NO"
  if (["YES", "PASS", "SAFE"].includes(result)) return "YES"

  return result || "-"
}

function getCertificatePhotosForHtml(inspection, savedPhotos = []) {
  if (savedPhotos.length) return savedPhotos

  return [
    inspection.photo1 || inspection.media1,
    inspection.photo2 || inspection.media2
  ]
    .filter(Boolean)
    .map((photoPath, index) => ({
      photo_path: photoPath,
      photo_type: `Photo ${index + 1}`,
      caption: ""
    }))
}

function certificateAssetDetails(inspection) {
  return [
    ["WLL", inspection.wll ? `${inspection.wll} kg` : ""],
    ["Height of Lift", inspection.heightoflift ? `${inspection.heightoflift} mm` : ""],
    ["Number of Chain Falls", inspection.numberofchainfalls],
    ["OEM Top Hook Size", inspection.oemtophooksize ? `${inspection.oemtophooksize} mm` : ""],
    ["OEM Bottom Hook Size", inspection.oembottomhooksize ? `${inspection.oembottomhooksize} mm` : ""],
    ["Load Chain Diameter", inspection.loadchaindiameter ? `${inspection.loadchaindiameter} mm` : ""],
    ["Effective Length", inspection.effectivelength ? `${inspection.effectivelength} mm` : ""],
    ["Span", inspection.span ? `${inspection.span} mm` : ""],
    ["Permissible Deflection", inspection.permissibledeflection ? `${inspection.permissibledeflection} mm` : ""],
    ["Hook Size", inspection.hooksize ? `${inspection.hooksize} mm` : ""],
    ["Steel Wire Rope", inspection.steelwireropemm ? `${inspection.steelwireropemm} mm` : ""],
    ["Hoist Description", inspection.hoistdescription],
    ["Hoist Serial No", inspection.hoistserialno],
    ["Auxiliary Hoist Description", inspection.auxhoistdescription],
    ["Auxiliary Hoist Serial No", inspection.auxhoistserialno],
    ["Auxiliary Hoist WLL", inspection.auxhoistwll ? `${inspection.auxhoistwll} kg` : ""],
    ["Auxiliary Hoist Hook Size", inspection.auxhoisthooksize ? `${inspection.auxhoisthooksize} mm` : ""],
    ["Auxiliary Hoist Steel Wire Rope", inspection.auxhoistropemm ? `${inspection.auxhoistropemm} mm` : ""]
  ].filter(([, value]) => value !== null && value !== undefined && value !== "")
}

function getCertificateRegulationNotes(inspection) {
  const notes = []
  const equipgroupid = String(inspection.equipgroupid || "")
  const equiptypeid = String(inspection.equiptypeid || "")

  if (["400", "500"].includes(equipgroupid)) {
    notes.push(DRIVEN_MACHINERY_CERTIFICATE_NOTE)
  }

  if (SANS_500_EQUIPTYPE_IDS.has(equiptypeid)) {
    notes.push(SANS_500_CERTIFICATE_NOTE)
  }

  if (["103", "105"].includes(equiptypeid)) {
    notes.push(REGULATION_18_CERTIFICATE_NOTE)
  }

  if (
    ["200", "300"].includes(equipgroupid) ||
    DRIVEN_MACHINERY_ITEMS_EQUIPTYPE_IDS.has(equiptypeid)
  ) {
    notes.push(DRIVEN_MACHINERY_ITEMS_CERTIFICATE_NOTE)
  }

  return notes
}

function getCertificateLayoutDensity(results = [], assetDetails = [], photos = []) {
  const contentWeight = results.length + Math.ceil(assetDetails.length / 2) + photos.length

  if (results.length <= 8 && contentWeight <= 14) return "spacious"
  if (results.length <= 16 && contentWeight <= 24) return "balanced"
  return "compact"
}

function allowsTwoPageCertificate(inspection = {}) {
  return String(inspection.equipgroupid || "") === "400"
}

function collectCertificatePhotoFilePaths(certificate, options = {}) {
  const inspection = certificate.inspection || {}
  const photos = getCertificatePhotosForHtml(inspection, certificate.photos || []).slice(0, 4)

  return photos
    .map(photo => resolveUploadFilePath(photo.photo_path, options))
    .filter(filePath => filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile())
}

async function compressImageForCertificatePdf(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return ""

  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return ""

  const buffer = await sharp(filePath)
    .rotate()
    .resize({
      width: 1100,
      height: 850,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: 68,
      mozjpeg: true
    })
    .toBuffer()

  return `data:image/jpeg;base64,${buffer.toString("base64")}`
}

async function buildCertificatePdfImageCache(certificate, options = {}) {
  const imageDataUrlCache = new Map()

  for (const filePath of collectCertificatePhotoFilePaths(certificate, options)) {
    try {
      const compressedDataUrl = await compressImageForCertificatePdf(filePath)

      if (compressedDataUrl) {
        imageDataUrlCache.set(filePath, compressedDataUrl)
      }
    } catch (err) {
      console.warn(`Could not compress certificate image ${filePath}: ${err.message}`)
    }
  }

  return imageDataUrlCache
}

function renderCertificateHeaderTemplate(options = {}) {
  const headerUrl = brandImageDataUrl("header.jpg", options)

  return `
    <div style="width:100%;height:40mm;padding:0 5mm;margin:0;box-sizing:border-box;overflow:hidden;font-size:0;">
      ${headerUrl ? `
        <img
          src="${headerUrl}"
          style="display:block;width:100%;height:40mm;margin:0;object-fit:fill;object-position:center top;"
        >
      ` : ""}
    </div>
  `
}

function renderCertificateFooterTemplate(options = {}) {
  const footerUrl = brandImageDataUrl("footer.jpg", options)

  return `
    <div style="width:100%;height:22mm;padding:0 6mm;margin:0;box-sizing:border-box;overflow:hidden;font-family:Arial,Helvetica,sans-serif;font-size:6px;">
      ${footerUrl ? `
        <img
          src="${footerUrl}"
          style="display:block;width:100%;height:19mm;margin:0;object-fit:fill;object-position:center bottom;"
        >
      ` : ""}
      <div style="height:3mm;text-align:right;color:#475569;line-height:3mm;">
        Page <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>
    </div>
  `
}

function renderCertificateInlineHeader(options = {}) {
  const headerUrl = brandImageDataUrl("header.jpg", options)

  return headerUrl
    ? `<img class="fb-cert-inline-header" src="${headerUrl}" alt="FB Cranes Header">`
    : ""
}

function renderCertificateInlineFooter(options = {}) {
  const footerUrl = brandImageDataUrl("footer.jpg", options)

  return footerUrl
    ? `<img class="fb-cert-inline-footer" src="${footerUrl}" alt="FB Cranes Footer">`
    : ""
}

function renderCertificateBodyHtml(certificate, imageDataUrlCache = null, options = {}) {
  const inspection = certificate.inspection || {}
  const results = getCertificateResultsForDisplay(certificate.results || [], inspection)
  const photos = getCertificatePhotosForHtml(inspection, certificate.photos || []).slice(0, 4)
  const signatureUrl = uploadPathToDataUrl(inspection.inspector_signature_image, null, options)
  const assetDetails = certificateAssetDetails(inspection)
  const regulationNotes = getCertificateRegulationNotes(inspection)
  const layoutDensity = getCertificateLayoutDensity(results, assetDetails, photos)
  const pageMode = allowsTwoPageCertificate(inspection)
    ? "fb-cert-allow-two-pages"
    : "fb-cert-force-one-page"

  return `
    <main class="fb-cert-content fb-cert-layout-${layoutDensity} ${pageMode}">
      <div class="fb-cert-title">
        <h1>${htmlEscape(getCertificateTitle(inspection))}</h1>
      </div>

      <div class="fb-cert-meta">
        <div><strong>Certificate No:</strong><span>${htmlEscape(inspection.testid || "-")}</span></div>
        <div><strong>Tag Number:</strong><span>${htmlEscape(inspection.tagnumber || "-")}</span></div>
        <div>
          <strong>Status:</strong>
          <span class="${inspection.status === "SAFE" ? "status-safe" : "status-unsafe"}">
            ${htmlEscape(inspection.status || "-")}
          </span>
        </div>
      </div>

      <section class="fb-cert-section">
        <h3>Customer Details</h3>
        <div class="fb-cert-grid">
          <p><strong>Client:</strong> ${htmlEscape(inspection.clientname || "-")}</p>
          <p><strong>Site:</strong> ${htmlEscape(inspection.sitename || "-")}</p>
          <p><strong>Section:</strong> ${htmlEscape(inspection.sectionname || "-")}</p>
        </div>
      </section>

      <section class="fb-cert-section">
        <h3>Asset Details</h3>
        <div class="fb-cert-grid">
          <p><strong>Asset ID:</strong> ${htmlEscape(inspection.assetid || "-")}</p>
          <p><strong>Asset Tag No:</strong> ${htmlEscape(inspection.assettagno || "-")}</p>
          <p><strong>Equipment Type:</strong> ${htmlEscape(inspection.equipmenttype || "-")}</p>
          <p><strong>Description:</strong> ${htmlEscape(inspection.description || "-")}</p>
          <p class="fb-cert-serial-line"><strong>Serial No:</strong> <span>${htmlEscape(inspection.serialno || "-")}</span></p>
          <p><strong>Manufacturer:</strong> ${htmlEscape(inspection.manufacturer || "-")}</p>
        </div>
      </section>

      ${assetDetails.length ? `
        <section class="fb-cert-section">
          <h3>Asset Specifications</h3>
          <div class="fb-cert-grid">
            ${assetDetails.map(([label, value]) => `
              <p><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</p>
            `).join("")}
          </div>
        </section>
      ` : ""}

      <section class="fb-cert-section">
        <h3>Inspection Details</h3>
        <div class="fb-cert-grid">
          <p><strong>Inspection Type:</strong> ${htmlEscape(inspection.inspectiontype || "-")}</p>
          ${formatInspectionFrequency(inspection.inspectionfrequency) ? `<p><strong>Frequency:</strong> ${htmlEscape(formatInspectionFrequency(inspection.inspectionfrequency))}</p>` : ""}
          <p><strong>Inspection Date:</strong> ${htmlEscape(formatPdfDate(inspection.testdate))}</p>
          <p><strong>Certificate Expiry Date:</strong> ${htmlEscape(formatPdfDate(inspection.validdate))}</p>
          <p><strong>Inspector:</strong> ${htmlEscape(inspection.inspector || "-")}</p>
          <p><strong>LMI Number:</strong> ${htmlEscape(inspection.inspector_lmi_number || "-")}</p>
        </div>
      </section>

      <section class="fb-cert-section">
        <h3>Inspection Photos</h3>
        <div class="fb-cert-photo-grid">
          ${photos.length ? photos.map((photo, index) => {
            const photoUrl = uploadPathToDataUrl(photo.photo_path, imageDataUrlCache, options)

            return `
              <div>
                ${photoUrl ? `<img src="${photoUrl}" alt="Inspection Photo">` : ""}
                <p>${htmlEscape(photo.photo_type ? String(photo.photo_type).replaceAll("_", " ") : `Photo ${index + 1}`)}</p>
                ${photo.caption ? `<p>${htmlEscape(photo.caption)}</p>` : ""}
              </div>
            `
          }).join("") : `
            <div class="fb-cert-no-photo">No inspection photos</div>
          `}
        </div>
      </section>

      <section class="fb-cert-section">
        <h3>Inspection Results</h3>
        <table class="fb-cert-results-table">
          <colgroup>
            <col class="fb-cert-results-criteria-col">
            <col class="fb-cert-results-result-col">
            <col class="fb-cert-results-standard-col">
            <col class="fb-cert-results-measured-col">
            <col class="fb-cert-results-remarks-col">
          </colgroup>
          <thead>
            <tr>
              <th>Criteria</th>
              <th>Result</th>
              <th>Std. Dimension</th>
              <th>Measured</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(row => {
              const displayResult = getCertificateResultDisplay(row)

              return `
                <tr>
                  <td>${htmlEscape(row.criterianame || "")}</td>
                  <td>
                    <strong class="${
                      displayResult === "YES" || displayResult === "PASS"
                        ? "status-safe"
                        : displayResult === "NO" || displayResult === "FAIL"
                          ? "status-unsafe"
                          : ""
                    }">${htmlEscape(displayResult)}</strong>
                  </td>
                  <td>${htmlEscape(row.assetvalue || "")}</td>
                  <td>${htmlEscape(row.measuredvalue || "")}</td>
                  <td>${htmlEscape(row.remarks || "")}</td>
                </tr>
              `
            }).join("")}
          </tbody>
        </table>
      </section>

      <section class="fb-cert-signature-section ${signatureUrl ? "fb-cert-signature-has-image" : "fb-cert-signature-manual"}">
        <strong>Inspector Signature</strong>
        ${signatureUrl ? `<img class="fb-cert-signature-image" src="${signatureUrl}" alt="Inspector Signature">` : ""}
        ${signatureUrl ? "" : `<div class="fb-cert-signature-manual-space"></div>`}
        <div class="fb-cert-signature-line"></div>
      </section>

      ${regulationNotes.map(note => `
        <p class="fb-cert-driven-note">${htmlEscape(note)}</p>
      `).join("")}
    </main>
  `
}

function renderSingleCertificateHtmlDocument(certificate, imageDataUrlCache = null, options = {}) {
  const includeInlineBranding = options.includeInlineBranding === true

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Certificate ${htmlEscape(certificate.inspection?.testid || "")}</title>
        <style>
          * { box-sizing: border-box; }
          @page { size: A4; }
          html, body {
            margin: 0;
            padding: 0;
            background: ${includeInlineBranding ? "#f3f4f6" : "#fff"};
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
          }
          .fb-cert-preview-page {
            background: #fff;
            display: flex;
            flex-direction: column;
            margin: 0 auto;
            min-height: 297mm;
            padding: 5mm 8mm;
            width: 210mm;
          }
          .fb-cert-inline-header,
          .fb-cert-inline-footer {
            display: block;
            max-width: 100%;
            object-fit: fill;
            width: 100%;
          }
          .fb-cert-inline-header {
            height: 40mm;
            margin: 0 0 6mm;
            object-position: center top;
          }
          .fb-cert-inline-footer {
            height: 22mm;
            margin-top: auto;
            object-position: center bottom;
          }
          .fb-cert-content {
            font-size: 8.8px;
            line-height: 1.05;
            padding-top: 0;
            width: 100%;
          }
          .fb-cert-layout-balanced {
            font-size: 9.7px;
            line-height: 1.13;
          }
          .fb-cert-layout-spacious {
            font-size: 10.6px;
            line-height: 1.2;
          }
          .fb-cert-title {
            margin: 0 0 3mm;
            text-align: center;
          }
          .fb-cert-title h1 {
            color: #0f172a !important;
            font-size: 18px;
            font-weight: 800;
            letter-spacing: 0.5px;
            margin: 0;
            text-transform: uppercase;
            -webkit-text-fill-color: #0f172a !important;
          }
          .fb-cert-meta {
            border-bottom: 1px solid #7c8aa0;
            border-top: 1px solid #7c8aa0;
            display: grid;
            gap: 6px;
            grid-template-columns: 1fr 1fr 1fr;
            margin-bottom: 2px;
            padding: 2px 0;
          }
          .fb-cert-meta span {
            margin-left: 4px;
          }
          .fb-cert-section {
            margin: 2px 0;
            break-inside: avoid;
          }
          .fb-cert-allow-two-pages .fb-cert-section {
            break-inside: auto;
          }
          .fb-cert-force-one-page {
            font-size: 7.7px;
            line-height: 1;
          }
          .fb-cert-force-one-page.fb-cert-layout-balanced,
          .fb-cert-force-one-page.fb-cert-layout-spacious {
            font-size: 8.2px;
            line-height: 1.04;
          }
          .fb-cert-force-one-page.fb-cert-layout-compact {
            font-size: 7.2px;
            line-height: 0.98;
          }
          .fb-cert-layout-balanced .fb-cert-section {
            margin: 3px 0;
          }
          .fb-cert-layout-spacious .fb-cert-section {
            margin: 4px 0;
          }
          .fb-cert-force-one-page .fb-cert-section,
          .fb-cert-force-one-page.fb-cert-layout-balanced .fb-cert-section,
          .fb-cert-force-one-page.fb-cert-layout-spacious .fb-cert-section {
            margin: 1px 0;
          }
          .fb-cert-section h3 {
            border-bottom: 1px solid #d9e1ec;
            color: #1f3b5c;
            font-size: 10.5px;
            margin: 0 0 2px;
            padding-bottom: 1px;
          }
          .fb-cert-grid {
            display: grid;
            gap: 1px 16px;
            grid-template-columns: 1fr 1fr;
          }
          .fb-cert-layout-balanced .fb-cert-grid {
            gap: 2px 17px;
          }
          .fb-cert-layout-spacious .fb-cert-grid {
            gap: 3px 18px;
          }
          .fb-cert-grid p {
            margin: 1px 0;
          }
          .fb-cert-serial-line {
            background: #fff7d6;
            border: 1px solid #f2c94c;
            border-radius: 3px;
            color: #111827;
            font-size: 11px;
            font-weight: 700;
            padding: 2px 4px;
          }
          .fb-cert-serial-line span {
            color: #b45309;
            font-size: 12px;
          }
          .fb-cert-photo-grid {
            display: grid;
            gap: 4px;
            grid-template-columns: 1fr 1fr;
          }
          .fb-cert-photo-grid div {
            border: 1px solid #d9e1ec;
            min-height: 34mm;
            padding: 2px;
            text-align: center;
          }
          .fb-cert-force-one-page .fb-cert-photo-grid div {
            min-height: 23mm;
            padding: 1px;
          }
          .fb-cert-photo-grid img {
            display: block;
            margin: 0 auto;
            max-height: 42mm;
            max-width: 100%;
            object-fit: contain;
          }
          .fb-cert-force-one-page .fb-cert-photo-grid img {
            max-height: 27mm;
          }
          .fb-cert-photo-grid p {
            margin: 1px 0;
          }
          .fb-cert-no-photo {
            align-items: center;
            background: #f8fafc;
            color: #6b7280;
            display: flex;
            justify-content: center;
          }
          .fb-cert-results-table {
            border-collapse: collapse;
            font-size: 7.8px;
            line-height: 1;
            width: 100%;
          }
          .fb-cert-layout-balanced .fb-cert-results-table {
            font-size: 8.8px;
            line-height: 1.08;
          }
          .fb-cert-layout-spacious .fb-cert-results-table {
            font-size: 9.8px;
            line-height: 1.16;
          }
          .fb-cert-force-one-page .fb-cert-results-table,
          .fb-cert-force-one-page.fb-cert-layout-balanced .fb-cert-results-table,
          .fb-cert-force-one-page.fb-cert-layout-spacious .fb-cert-results-table {
            font-size: 7.6px;
            line-height: 1.08;
          }
          .fb-cert-results-table thead {
            display: table-header-group;
          }
          .fb-cert-results-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .fb-cert-results-criteria-col { width: 41%; }
          .fb-cert-results-result-col { width: 9%; }
          .fb-cert-results-standard-col { width: 10%; }
          .fb-cert-results-measured-col { width: 10%; }
          .fb-cert-results-remarks-col { width: 30%; }
          .fb-cert-force-one-page .fb-cert-results-criteria-col { width: 39%; }
          .fb-cert-force-one-page .fb-cert-results-result-col { width: 11%; }
          .fb-cert-force-one-page .fb-cert-results-standard-col { width: 9%; }
          .fb-cert-force-one-page .fb-cert-results-measured-col { width: 9%; }
          .fb-cert-force-one-page .fb-cert-results-remarks-col { width: 32%; }
          .fb-cert-results-table th {
            background: #1f3b5c;
            color: #fff;
            padding: 1px 2px;
          }
          .fb-cert-results-table td {
            border: 1px solid #d9e1ec;
            padding: 1px 2px;
            vertical-align: top;
          }
          .fb-cert-layout-balanced .fb-cert-results-table th,
          .fb-cert-layout-balanced .fb-cert-results-table td {
            padding: 2px 3px;
          }
          .fb-cert-layout-spacious .fb-cert-results-table th,
          .fb-cert-layout-spacious .fb-cert-results-table td {
            padding: 3px 4px;
          }
          .fb-cert-layout-spacious .fb-cert-results-table tr {
            height: 6.5mm;
          }
          .fb-cert-layout-spacious .fb-cert-results-table td {
            min-height: 6.5mm;
          }
          .fb-cert-force-one-page .fb-cert-results-table th,
          .fb-cert-force-one-page .fb-cert-results-table td,
          .fb-cert-force-one-page.fb-cert-layout-balanced .fb-cert-results-table th,
          .fb-cert-force-one-page.fb-cert-layout-balanced .fb-cert-results-table td,
          .fb-cert-force-one-page.fb-cert-layout-spacious .fb-cert-results-table th,
          .fb-cert-force-one-page.fb-cert-layout-spacious .fb-cert-results-table td {
            padding: 1px 2px;
          }
          .fb-cert-force-one-page.fb-cert-layout-spacious .fb-cert-results-table tr {
            height: auto;
          }
          .fb-cert-results-table th:nth-child(2),
          .fb-cert-results-table td:nth-child(2) {
            text-align: center;
          }
          .fb-cert-results-table th:nth-child(3),
          .fb-cert-results-table td:nth-child(3),
          .fb-cert-results-table th:nth-child(4),
          .fb-cert-results-table td:nth-child(4) {
            text-align: right;
          }
          .fb-cert-results-table th:nth-child(5),
          .fb-cert-results-table td:nth-child(5) {
            padding-left: 6px;
            text-align: left;
          }
          .fb-cert-signature-section {
            break-inside: avoid;
            margin: 3px 0 1px;
            max-width: 80mm;
          }
          .fb-cert-force-one-page .fb-cert-signature-section {
            margin: 2px 0 1px;
            min-height: 18mm;
          }
          .fb-cert-signature-manual {
            min-height: 28mm;
          }
          .fb-cert-force-one-page .fb-cert-signature-manual {
            min-height: 20mm;
          }
          .fb-cert-signature-manual-space {
            height: 22mm;
          }
          .fb-cert-force-one-page .fb-cert-signature-manual-space {
            height: 14mm;
          }
          .fb-cert-signature-image {
            display: block;
            height: 24mm;
            margin-top: 1px;
            max-width: 72mm;
            object-fit: contain;
          }
          .fb-cert-force-one-page .fb-cert-signature-image {
            height: 16mm;
            max-width: 62mm;
          }
          .fb-cert-signature-line {
            border-bottom: 1px solid #111827;
            height: 3px;
            margin-top: 1px;
            width: 72mm;
          }
          .fb-cert-driven-note {
            break-inside: avoid;
            color: #d00000;
            font-size: 7px;
            font-style: italic;
            font-weight: 700;
            line-height: 1.15;
            margin: 5mm 0 1px;
            text-align: center;
          }
          .status-safe {
            color: #0a8f2a;
            font-weight: 700;
          }
          .status-unsafe {
            color: #d00000;
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        ${includeInlineBranding ? `
          <div class="fb-cert-preview-page">
            ${renderCertificateInlineHeader(options)}
            ${renderCertificateBodyHtml(certificate, imageDataUrlCache, options)}
            ${renderCertificateInlineFooter(options)}
          </div>
        ` : renderCertificateBodyHtml(certificate, imageDataUrlCache, options)}
      </body>
    </html>
  `
}

function certificateDocumentStyles(includeInlineBranding = false) {
  const html = renderSingleCertificateHtmlDocument({ inspection: {} }, null, {
    includeInlineBranding
  })
  const match = html.match(/<style>([\s\S]*?)<\/style>/)

  return match ? match[1] : ""
}

async function buildBulkCertificatePdfImageCache(certificates = [], options = {}) {
  const imageDataUrlCache = new Map()

  for (const certificate of certificates) {
    for (const filePath of collectCertificatePhotoFilePaths(certificate, options)) {
      if (imageDataUrlCache.has(filePath)) continue

      try {
        const compressedDataUrl = await compressImageForCertificatePdf(filePath)

        if (compressedDataUrl) {
          imageDataUrlCache.set(filePath, compressedDataUrl)
        }
      } catch (err) {
        console.warn(`Could not compress certificate image ${filePath}: ${err.message}`)
      }
    }
  }

  return imageDataUrlCache
}

function renderBulkCertificatesHtmlDocument(certificates = [], imageDataUrlCache = null, options = {}) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>FB Certificates</title>
        <style>
          ${certificateDocumentStyles(false)}
          .fb-cert-bulk-item {
            break-after: page;
            page-break-after: always;
          }
          .fb-cert-bulk-item:last-child {
            break-after: auto;
            page-break-after: auto;
          }
        </style>
      </head>
      <body>
        ${certificates.map(certificate => `
          <section class="fb-cert-bulk-item">
            ${renderCertificateBodyHtml(certificate, imageDataUrlCache, options)}
          </section>
        `).join("")}
      </body>
    </html>
  `
}

function findChromiumExecutable() {
  const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH

  const candidates = [
    configuredPath,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean)

  return candidates.find(candidate => fs.existsSync(candidate))
}

function singleCertificatePdfOptions(options = {}) {
  return {
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: renderCertificateHeaderTemplate(options),
    footerTemplate: renderCertificateFooterTemplate(options),
    margin: {
      top: "54mm",
      right: "8mm",
      bottom: "25mm",
      left: "8mm"
    }
  }
}

async function createSingleCertificatePdfBuffer(certificate, options = {}) {
  const executablePath = findChromiumExecutable()

  if (!executablePath) {
    const error = new Error("PDF browser engine not found. Set PUPPETEER_EXECUTABLE_PATH in backend/.env to Chrome or Edge.")
    error.statusCode = 500
    throw error
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atec-pdf-"))
  let browser
  let page

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: "new",
      userDataDir,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--allow-file-access-from-files"]
    })

    const imageDataUrlCache = await buildCertificatePdfImageCache(certificate, options)
    page = await browser.newPage()
    page.setDefaultTimeout(120000)
    page.setDefaultNavigationTimeout(120000)

    await page.setContent(renderSingleCertificateHtmlDocument(certificate, imageDataUrlCache, options), {
      waitUntil: "load",
      timeout: 120000
    })
    await page.emulateMediaType("print")

    return await page.pdf(singleCertificatePdfOptions(options))
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }

    if (browser) {
      await browser.close()
    }

    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

async function createBulkCertificatesPdfBuffer(certificates = [], options = {}) {
  const executablePath = findChromiumExecutable()

  if (!executablePath) {
    const error = new Error("PDF browser engine not found. Set PUPPETEER_EXECUTABLE_PATH in backend/.env to Chrome or Edge.")
    error.statusCode = 500
    throw error
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atec-pdf-"))
  let browser
  let page

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: "new",
      userDataDir,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--allow-file-access-from-files"]
    })

    const imageDataUrlCache = await buildBulkCertificatePdfImageCache(certificates, options)
    page = await browser.newPage()
    page.setDefaultTimeout(120000)
    page.setDefaultNavigationTimeout(120000)

    await page.setContent(renderBulkCertificatesHtmlDocument(certificates, imageDataUrlCache, options), {
      waitUntil: "load",
      timeout: 120000
    })
    await page.emulateMediaType("print")

    return await page.pdf(singleCertificatePdfOptions(options))
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }

    if (browser) {
      await browser.close()
    }

    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

async function renderSingleCertificatePreviewHtml(certificate, options = {}) {
  const imageDataUrlCache = await buildCertificatePdfImageCache(certificate, options)

  return renderSingleCertificateHtmlDocument(certificate, imageDataUrlCache, {
    ...options,
    includeInlineBranding: true
  })
}

module.exports = {
  createBulkCertificatesPdfBuffer,
  createSingleCertificatePdfBuffer,
  renderSingleCertificatePreviewHtml,
  renderSingleCertificateHtmlDocument
}
