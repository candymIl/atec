import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'

export function renderCertificateSearch(customers = [], sites = [], sections = []) {
  document.querySelector('#page').innerHTML = `
    <h1>Certificates</h1>
    <p>Search, view and manage inspection and load test certificates.</p>

    <div class="filter-card">
      <h2>Search Certificates</h2>

      <div class="asset-form-grid">
        <div class="form-group">
          <label>Broad Search</label>
          <input
            id="certSearch"
            type="text"
            placeholder="Test ID, tag, serial, client, site, asset description..."
          >
        </div>

        <div class="form-group">
          <label>Inspection Type</label>
          <select id="certInspectionType">
            <option value="">All Types</option>
            <option value="VISUAL">Visual Inspection</option>
            <option value="LOADTEST">Load Test</option>
          </select>
        </div>

        <div class="form-group">
          <label>Status</label>
          <select id="certStatus">
            <option value="">All Statuses</option>
            <option value="SAFE">SAFE</option>
            <option value="NOT SAFE">NOT SAFE</option>
          </select>
        </div>

        <div class="form-group">
          <label>Client</label>
          <select id="certClient">
            <option value="">All Clients</option>
            ${customers.map(c => `
              <option value="${c.clientid}">${c.clientname}</option>
            `).join("")}
          </select>
        </div>

        <div class="form-group">
          <label>Site</label>
          <select id="certSite">
            <option value="">All Sites</option>
          </select>
        </div>

        <div class="form-group">
          <label>Section</label>
          <select id="certSection">
            <option value="">All Sections</option>
          </select>
        </div>

        <div class="form-group">
          <label>Date From</label>
          <input id="certDateFrom" type="date">
        </div>

        <div class="form-group">
          <label>Date To</label>
          <input id="certDateTo" type="date">
        </div>
      </div>

      <div class="form-actions">
        <button id="certSearchBtn">Search</button>
        <button id="certClearBtn">Clear Filters</button>
      </div>
    </div>

    <div class="certificate-dashboard-grid">
      <div class="filter-card">
        <h2>Search Results</h2>
        <div id="certificateResults">
          <p>Loading certificates...</p>
        </div>
      </div>

      <div>
        <div class="filter-card">
          <h2>Quick Stats</h2>
          <div id="certificateStats">
            <p>No search loaded yet.</p>
          </div>
        </div>

        <div class="filter-card" id="certificatePreviewPanel">
          <h2>Certificate Preview</h2>
          <p>Select Preview on a certificate to view quick details here.</p>
        </div>
      </div>
    </div>
  `

  window.certificateCustomers = customers
  window.certificateSites = sites
  window.certificateSections = sections

  document.querySelector('#certSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      window.searchCertificates()
    }
  })

  document.querySelector('#certClient').addEventListener('change', window.filterCertificateSites)
  document.querySelector('#certSite').addEventListener('change', window.filterCertificateSections)
  document.querySelector('#certSearchBtn').addEventListener('click', window.searchCertificates)
  document.querySelector('#certClearBtn').addEventListener('click', window.clearCertificateSearch)

  window.searchCertificates()
}

window.filterCertificateSites = function () {
  const clientid = document.querySelector('#certClient').value
  const siteSelect = document.querySelector('#certSite')
  const sectionSelect = document.querySelector('#certSection')

  sectionSelect.innerHTML = `<option value="">All Sections</option>`

  const filteredSites = clientid
    ? window.certificateSites.filter(site => String(site.clientid) === String(clientid))
    : window.certificateSites

  siteSelect.innerHTML = `
    <option value="">All Sites</option>
    ${filteredSites.map(site => `
      <option value="${site.siteid}">${site.sitename}</option>
    `).join("")}
  `
}

window.filterCertificateSections = function () {
  const siteid = document.querySelector('#certSite').value
  const sectionSelect = document.querySelector('#certSection')

  const filteredSections = siteid
    ? window.certificateSections.filter(section => String(section.siteid) === String(siteid))
    : window.certificateSections

  sectionSelect.innerHTML = `
    <option value="">All Sections</option>
    ${filteredSections.map(section => `
      <option value="${section.sectionid}">${section.sectionname}</option>
    `).join("")}
  `
}

window.clearCertificateSearch = function () {
  document.querySelector('#certSearch').value = ""
  document.querySelector('#certInspectionType').value = ""
  document.querySelector('#certStatus').value = ""
  document.querySelector('#certClient').value = ""
  document.querySelector('#certSite').innerHTML = `<option value="">All Sites</option>`
  document.querySelector('#certSection').innerHTML = `<option value="">All Sections</option>`
  document.querySelector('#certDateFrom').value = ""
  document.querySelector('#certDateTo').value = ""
  window.certCurrentPage = 1

  window.searchCertificates()
}

window.searchCertificates = async function (resetPage = true) {
  if (resetPage) {
    window.certCurrentPage = 1
  }

  const params = new URLSearchParams()

  params.append("search", document.querySelector('#certSearch')?.value || "")
  params.append("inspectiontype", document.querySelector('#certInspectionType')?.value || "")
  params.append("status", document.querySelector('#certStatus')?.value || "")
  params.append("clientid", document.querySelector('#certClient')?.value || "")
  params.append("siteid", document.querySelector('#certSite')?.value || "")
  params.append("sectionid", document.querySelector('#certSection')?.value || "")
  params.append("datefrom", document.querySelector('#certDateFrom')?.value || "")
  params.append("dateto", document.querySelector('#certDateTo')?.value || "")

  const response = await fetch(
    `http://localhost:5000/certificates/search?${params.toString()}`
  )

  const certificates = await response.json()

  if (!response.ok) {
    alert("Error searching certificates: " + certificates.error)
    return
  }

  renderCertificateStats(certificates)
  window.currentCertificateResults = certificates
  renderCertificateResults(certificates)
}

function renderCertificateStats(certificates) {
  const safeCount = certificates.filter(c => c.status === "SAFE").length
  const notSafeCount = certificates.filter(c => c.status === "NOT SAFE").length
  const loadTestCount = certificates.filter(c => c.inspectiontype === "LOADTEST").length
  const visualCount = certificates.filter(c => c.inspectiontype === "VISUAL").length

  document.querySelector('#certificateStats').innerHTML = `
    <p><strong>Total:</strong> ${certificates.length}</p>
    <p><strong>Safe:</strong> ${safeCount}</p>
    <p><strong>Not Safe:</strong> ${notSafeCount}</p>
    <p><strong>Visual:</strong> ${visualCount}</p>
    <p><strong>Load Tests:</strong> ${loadTestCount}</p>
  `
}

function renderCertificateResults(certificates) {
  if (certificates.length === 0) {
    document.querySelector('#certificateResults').innerHTML = `<p>No certificates found.</p>`
    return
  }

  const sortedCertificates = sortTableRows(certificates, 'certificates', {
    testid: cert => cert.testid,
    tagnumber: cert => cert.tagnumber,
    clientname: cert => cert.clientname,
    sitename: cert => cert.sitename,
    description: cert => cert.description,
    serialno: cert => cert.serialno,
    inspectiontype: cert => cert.inspectiontype,
    testdate: cert => cert.testdate,
    status: cert => cert.status,
    inspector: cert => cert.inspector
  }, 'testid')
  const pagination = getPaginationState(sortedCertificates, "certCurrentPage", "certRowsPerPage")

  document.querySelector('#certificateResults').innerHTML = `
    ${renderPaginationControls({
      ...pagination,
      label: "certificates",
      onPage: "goToCertificatePage",
      onPageSize: "setCertificateRowsPerPage"
    })}

    <table>
      <thead>
        <tr>
          <th>${sortHeader('Test ID', 'certificates', 'testid', 'rerenderCertificateResults')}</th>
          <th>${sortHeader('Tag No', 'certificates', 'tagnumber', 'rerenderCertificateResults')}</th>
          <th>${sortHeader('Client', 'certificates', 'clientname', 'rerenderCertificateResults')}</th>
          <th>${sortHeader('Site', 'certificates', 'sitename', 'rerenderCertificateResults')}</th>
          <th>${sortHeader('Asset', 'certificates', 'description', 'rerenderCertificateResults')}</th>
          <th>${sortHeader('Serial No', 'certificates', 'serialno', 'rerenderCertificateResults')}</th>
          <th>${sortHeader('Type', 'certificates', 'inspectiontype', 'rerenderCertificateResults')}</th>
          <th>${sortHeader('Date', 'certificates', 'testdate', 'rerenderCertificateResults')}</th>
          <th>${sortHeader('Status', 'certificates', 'status', 'rerenderCertificateResults')}</th>
          <th>${sortHeader('Inspector', 'certificates', 'inspector', 'rerenderCertificateResults')}</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        ${pagination.rows.map(cert => `
          <tr data-testid="${cert.testid}">
            <td>${cert.testid}</td>
            <td>${cert.tagnumber || "-"}</td>
            <td>${cert.clientname || ""}</td>
            <td>${cert.sitename || ""}</td>
            <td>${cert.description || ""}</td>
            <td>${cert.serialno || ""}</td>
            <td>${cert.inspectiontype || ""}</td>
            <td>${formatDate(cert.testdate)}</td>
            <td>
              <strong class="${cert.status === "SAFE" ? "status-safe" : "status-unsafe"}">
                ${cert.status || ""}
              </strong>
            </td>
            <td>${cert.inspector || "-"}</td>
            <td>
              <button type="button" class="cert-preview-btn" data-testid="${cert.testid}">
                Preview
              </button>

              <button type="button" class="cert-view-btn" data-testid="${cert.testid}">
                View
              </button>

              <a
                class="cert-action-link"
                href="http://localhost:5000/inspections/${cert.testid}/certificate.pdf"
                download="certificate-${cert.testid}.pdf"
                onclick="event.stopPropagation()"
              >
                Download PDF
              </a>

              <button type="button" class="cert-mail-btn" data-testid="${cert.testid}">
                Mail
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `

  bindCertificateResultEvents()
}

window.setCertificateRowsPerPage = function (value) {
  window.certRowsPerPage = Number(value) || 25
  window.certCurrentPage = 1
  renderCertificateResults(window.currentCertificateResults || [])
}

window.rerenderCertificateResults = function () {
  window.certCurrentPage = 1
  renderCertificateResults(window.currentCertificateResults || [])
}

window.goToCertificatePage = function (page) {
  window.certCurrentPage = Math.max(1, Number(page) || 1)
  renderCertificateResults(window.currentCertificateResults || [])
}

function bindCertificateResultEvents() {
  document.querySelectorAll('#certificateResults tbody tr').forEach(row => {
    row.addEventListener('click', () => {
      window.selectCertificateRow(row, row.dataset.testid)
    })
  })

  document.querySelectorAll('.cert-preview-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      window.previewCertificate(button.dataset.testid)
    })
  })

  document.querySelectorAll('.cert-view-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      window.openCertificateModal(button.dataset.testid)
    })
  })

  document.querySelectorAll('.cert-mail-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      window.mailCertificate(button.dataset.testid)
    })
  })
}

window.selectCertificateRow = function (rowElement, testid) {
  document
    .querySelectorAll('#certificateResults tbody tr')
    .forEach(row => row.classList.remove('selected-certificate-row'))

  rowElement.classList.add('selected-certificate-row')

  window.previewCertificate(testid)
}

window.previewCertificate = async function (testid) {
  const response = await fetch(
    `http://localhost:5000/inspections/${testid}/certificate`
  )

  const data = await response.json()

  if (!response.ok) {
    alert("Error loading certificate preview: " + data.error)
    return
  }

  const inspection = data.inspection
  const results = data.results || []

  const failCount = results.filter(r => r.result === "FAIL").length
  const passCount = results.filter(r => r.result === "PASS").length

  const statusClass =
    inspection.status === "SAFE"
      ? "status-safe"
      : "status-unsafe"

  document.querySelector('#certificatePreviewPanel').innerHTML = `
    <h2>Certificate Preview</h2>

    <div class="certificate-preview-status ${statusClass}">
      ${inspection.status || "-"}
    </div>

    <div class="certificate-preview-row">
      <span>Certificate No</span>
      <strong>${inspection.testid}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Tag No</span>
      <strong>${inspection.tagnumber || "-"}</strong>
    </div>

    <hr>

    <div class="certificate-preview-row">
      <span>Client</span>
      <strong>${inspection.clientname || "-"}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Site</span>
      <strong>${inspection.sitename || "-"}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Section</span>
      <strong>${inspection.sectionname || "-"}</strong>
    </div>

    <hr>

    <p><strong>Asset</strong><br>${inspection.description || "-"}</p>
    <p><strong>Equipment Type</strong><br>${inspection.equipmenttype || "-"}</p>
    <p><strong>Serial No</strong><br>${inspection.serialno || "-"}</p>

    <hr>

    <div class="certificate-preview-row">
      <span>Type</span>
      <strong>${inspection.inspectiontype || "-"}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Date</span>
      <strong>${formatDate(inspection.testdate)}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Certificate Expiry Date</span>
      <strong>${formatDate(inspection.validdate)}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Inspector</span>
      <strong>${inspection.inspector || "-"}</strong>
    </div>

    <hr>

    <div class="certificate-preview-summary">
      <div>
        <span>Passed</span>
        <strong>${passCount}</strong>
      </div>

      <div>
        <span>Failed</span>
        <strong>${failCount}</strong>
      </div>
    </div>

    <div class="form-actions">
      <button type="button" id="previewOpenCertificateBtn">Open</button>
      <button type="button" id="previewPrintCertificateBtn">Print</button>
    </div>
  `

  document
    .querySelector('#previewOpenCertificateBtn')
    .addEventListener('click', () => window.openCertificateModal(inspection.testid))

  document
    .querySelector('#previewPrintCertificateBtn')
    .addEventListener('click', async () => {
      await window.openCertificateModal(inspection.testid)
      setTimeout(() => {
        prepareCertificatePrint()
        window.print()
      }, 250)
    })
}

window.openCertificateModal = async function (testid) {
  const response = await fetch(
    `http://localhost:5000/inspections/${testid}/certificate`
  )

  const data = await response.json()

  if (!response.ok) {
    alert("Error loading certificate: " + data.error)
    return
  }

  const inspection = data.inspection
  const results = data.results || []
  const inspectionPhotos = getCertificatePhotos(inspection, data.photos || [])
  const assetDetails = getCertificateAssetDetails(inspection)
  const certificateTitle = getCertificateTitle(inspection)
  const drivenMachineryNote = getDrivenMachineryCertificateNote(inspection)
  const sans500Note = getSans500CertificateNote(inspection)

  const existingModal = document.querySelector("#certificateModal")
  if (existingModal) existingModal.remove()

  const modal = document.createElement("div")
  modal.id = "certificateModal"
  modal.className = "certificate-modal-overlay"

  modal.innerHTML = `
    <div class="certificate-modal certificate-original-layout">

      <div class="certificate-modal-header screen-only">
        <h2>Certificate ${inspection.testid}</h2>
        <div class="form-actions">
          <a
            id="certificatePrintBtn"
            class="cert-action-link"
            href="http://localhost:5000/inspections/${inspection.testid}/certificate.pdf?inline=1"
            target="_blank"
          >
            Print
          </a>
          <a
            id="certificateDownloadPdfBtn"
            class="cert-action-link"
            href="http://localhost:5000/inspections/${inspection.testid}/certificate.pdf"
            download="certificate-${inspection.testid}.pdf"
          >
            Download PDF
          </a>
          <button type="button" id="certificateMailBtn">Mail</button>
          <button type="button" id="certificateCloseBtn">Close</button>
        </div>
      </div>

      <div class="certificate-modal-body" id="certificatePrintArea">

        <div class="fb-cert-page">

          <img src="/header.jpg" class="fb-cert-header" alt="FB Cranes Header">

          <div class="fb-cert-title">
            <h1>${certificateTitle}</h1>
          </div>

          <div class="fb-cert-meta">
            <div>
              <strong>Certificate No:</strong>
              <span>${inspection.testid}</span>
            </div>

            <div>
              <strong>Tag Number:</strong>
              <span>${inspection.tagnumber || "-"}</span>
            </div>

            <div>
              <strong>Status:</strong>
              <span class="${inspection.status === "SAFE" ? "status-safe" : "status-unsafe"}">
                ${inspection.status || "-"}
              </span>
            </div>
          </div>

          <div class="fb-cert-section">
            <h3>Customer Details</h3>
            <div class="fb-cert-grid">
              <p><strong>Client:</strong> ${inspection.clientname || "-"}</p>
              <p><strong>Site:</strong> ${inspection.sitename || "-"}</p>
              <p><strong>Section:</strong> ${inspection.sectionname || "-"}</p>
            </div>
          </div>

          <div class="fb-cert-section">
            <h3>Asset Details</h3>
            <div class="fb-cert-grid">
              <p><strong>Asset ID:</strong> ${inspection.assetid || "-"}</p>
              <p><strong>Asset Tag No:</strong> ${inspection.assettagno || "-"}</p>
              <p><strong>Equipment Type:</strong> ${inspection.equipmenttype || "-"}</p>
              <p><strong>Description:</strong> ${inspection.description || "-"}</p>
              <p><strong>Serial No:</strong> ${inspection.serialno || "-"}</p>
              <p><strong>Manufacturer:</strong> ${inspection.manufacturer || "-"}</p>
            </div>
          </div>

          ${assetDetails.length ? `
            <div class="fb-cert-section">
              <h3>Asset Specifications</h3>
              <div class="fb-cert-grid">
                ${assetDetails.map(([label, value]) => `
                  <p><strong>${label}:</strong> ${value}</p>
                `).join("")}
              </div>
            </div>
          ` : ""}

          <div class="fb-cert-section">
            <h3>Inspection Details</h3>
            <div class="fb-cert-grid">
              <p><strong>Inspection Type:</strong> ${inspection.inspectiontype || "-"}</p>
              <p><strong>Inspection Date:</strong> ${formatDate(inspection.testdate)}</p>
              <p><strong>Certificate Expiry Date:</strong> ${formatDate(inspection.validdate)}</p>
              <p><strong>Inspector:</strong> ${inspection.inspector || "-"}</p>
              <p><strong>LMI Number:</strong> ${inspection.inspector_lmi_number || "-"}</p>
            </div>
          </div>

          <div class="fb-cert-section">
            <h3>Inspection Photos</h3>
            <div class="fb-cert-photo-grid">
              ${inspectionPhotos.length ? inspectionPhotos.slice(0, 4).map((photo, index) => `
                <div>
                  <img src="http://localhost:5000${photo.photo_path}">
                  <p>${photo.photo_type ? photo.photo_type.replaceAll("_", " ") : `Photo ${index + 1}`}</p>
                  ${photo.caption ? `<p>${photo.caption}</p>` : ""}
                </div>
              `).join("") : `
                <div class="fb-cert-no-photo">No inspection photos</div>
              `}
            </div>
          </div>

          <div class="fb-cert-section">
            <h3>Inspection Results</h3>

            <table class="fb-cert-results-table">
              <thead>
                <tr>
                  <th>Criteria</th>
                  <th>Asset Value</th>
                  <th>Measured Value</th>
                  <th>Result</th>
                  <th>Remarks</th>
                </tr>
              </thead>

              <tbody>
                ${results.map(row => `
                  <tr>
                    <td>${row.criterianame || ""}</td>
                    <td>${row.assetvalue || ""}</td>
                    <td>${row.measuredvalue || ""}</td>
                    <td>
                      <strong class="${
                        row.result === "PASS"
                          ? "status-safe"
                          : row.result === "FAIL"
                            ? "status-unsafe"
                            : ""
                      }">
                        ${row.result || ""}
                      </strong>
                    </td>
                    <td>${row.remarks || ""}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>

          ${drivenMachineryNote ? `
            <p class="fb-cert-driven-note">
              ${drivenMachineryNote}
            </p>
          ` : ""}

          ${sans500Note ? `
            <p class="fb-cert-driven-note">
              ${sans500Note}
            </p>
          ` : ""}

          <div class="fb-cert-signature-section">
            <div>
              <strong>Inspector Signature</strong>
              ${inspection.inspector_signature_image ? `
                <img
                  class="fb-cert-signature-image"
                  src="http://localhost:5000${inspection.inspector_signature_image}"
                  alt="Inspector Signature"
                >
              ` : ""}
              <div class="fb-cert-signature-line"></div>
            </div>

           <img src="/footer.jpg" class="fb-cert-footer" alt="FB Cranes Footer">

        </div>

      </div>
    </div>
  `

  document.body.appendChild(modal)

  document
    .querySelector('#certificateCloseBtn')
    .addEventListener('click', window.closeCertificateModal)

  document
    .querySelector('#certificateMailBtn')
    .addEventListener('click', () => {
      window.mailCertificate(inspection.testid)
    })
}

window.printCertificatePdf = function (testid) {
  window.open(
    `http://localhost:5000/inspections/${testid}/certificate.pdf?inline=1`,
    "_blank"
  )
}

window.downloadCertificatePdf = async function (testid) {
  const response = await fetch(
    `http://localhost:5000/inspections/${testid}/certificate.pdf`
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Unable to download certificate PDF"
    }))

    alert("Error downloading certificate PDF: " + error.error)
    return
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = `certificate-${testid}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

window.mailCertificate = async function (testid) {
  const response = await fetch(
    `http://localhost:5000/inspections/${testid}/certificate`
  )

  const data = await response.json()

  if (!response.ok) {
    alert("Error loading certificate email details: " + data.error)
    return
  }

  const inspection = data.inspection
  const subject = `Certificate ${inspection.testid}`
  const body = [
    `Certificate No: ${inspection.testid}`,
    `Client: ${inspection.clientname || "-"}`,
    `Site: ${inspection.sitename || "-"}`,
    `Asset: ${inspection.description || "-"}`,
    `Serial No: ${inspection.serialno || "-"}`,
    `Inspection Type: ${inspection.inspectiontype || "-"}`,
    `Inspection Date: ${formatDate(inspection.testdate)}`,
    `Status: ${inspection.status || "-"}`,
    "",
    "The PDF certificate has been downloaded. Please attach it before sending."
  ].join("\n")

  await window.downloadCertificatePdf(testid)

  window.location.href =
    `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

window.closeCertificateModal = function () {
  const modal = document.querySelector("#certificateModal")
  if (modal) modal.remove()
}

function getCertificatePhotos(inspection, savedPhotos = []) {
  if (savedPhotos.length) {
    return savedPhotos
  }

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

function getCertificateAssetDetails(inspection) {
  return [
    ["WLL", inspection.wll ? `${inspection.wll} kg` : ""],
    ["Height of Lift", inspection.heightoflift ? `${inspection.heightoflift} mm` : ""],
    ["Number of Chain Falls", inspection.numberofchainfalls],
    ["OEM Top Hook Size", inspection.oemtophooksize ? `${inspection.oemtophooksize} mm` : ""],
    ["OEM Bottom Hook Size", inspection.oembottomhooksize ? `${inspection.oembottomhooksize} mm` : ""],
    ["Load Chain Diameter", inspection.loadchaindiameter ? `${inspection.loadchaindiameter} mm` : ""],
    ["Effective Length", inspection.effectivelength ? `${inspection.effectivelength} mm` : ""],
    ["Span/Jib", inspection.span ? `${inspection.span} mm` : ""],
    ["Permissible Deflection", inspection.permissibledeflection ? `${inspection.permissibledeflection} mm` : ""],
    ["Hook Size", inspection.hooksize ? `${inspection.hooksize} mm` : ""],
    ["Steel Wire Rope", inspection.steelwireropemm ? `${inspection.steelwireropemm} mm` : ""],
    ["Hoist Description", inspection.hoistdescription],
    ["Hoist Serial No", inspection.hoistserialno],
    ["Manufacture Date", formatDate(inspection.manufactdate)]
  ].filter(([, value]) => value && value !== "-")
}

function getCertificateTitle(inspection) {
  return inspection.inspectiontype === "LOADTEST"
    ? "CERTIFICATE OF EXAMINATION AND TEST"
    : "CERTIFICATE OF INSPECTION"
}

function getDrivenMachineryCertificateNote(inspection) {
  const shouldShowNote = ["400", "500"].includes(String(inspection.equipgroupid || ""))

  return shouldShowNote
    ? "Certification that the item has been inspected in accordance with the requirements of Driven Machinery and SANS Regulations and the responsible person has been informed of all defects."
    : ""
}

function getSans500CertificateNote(inspection) {
  const shouldShowNote = ["101", "102"].includes(String(inspection.equiptypeid || ""))

  return shouldShowNote
    ? "EXAMINED IN ACCORDANCE WITH SANS 500"
    : ""
}

function prepareCertificatePrint() {
  const page = document.querySelector("#certificateModal .fb-cert-page")
  if (!page) return

  page.style.removeProperty("--cert-print-scale")
}

function formatDate(value) {
  if (!value) return "-"
  return String(value).split("T")[0]
}
