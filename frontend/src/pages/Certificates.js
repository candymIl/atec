import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { getTableSortState, sortTableRows } from '../tableSort.js'
import { API_BASE, assetUrl } from '../api.js'

async function readCertificateJson(response) {
  const text = await response.text()

  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch (err) {
    return {
      error: response.ok
        ? "The server returned an unexpected certificate response."
        : "The server returned an unexpected error while loading the certificate."
    }
  }
}

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

    <div class="filter-card bulk-certificate-card">
      <h2>Bulk Print Certificates</h2>
      <p>Select a customer and date range, then choose the certificates to print together.</p>

      <div class="asset-form-grid">
        <div class="form-group">
          <label>Customer</label>
          <select id="bulkCertClient">
            <option value="">Select Customer</option>
            ${customers.map(c => `
              <option value="${c.clientid}">${c.clientname}</option>
            `).join("")}
          </select>
        </div>

        <div class="form-group">
          <label>Date From</label>
          <input id="bulkCertDateFrom" type="date">
        </div>

        <div class="form-group">
          <label>Date To</label>
          <input id="bulkCertDateTo" type="date">
        </div>

        <div class="form-group">
          <label>Site</label>
          <select id="bulkCertSite">
            <option value="">All Sites</option>
          </select>
        </div>

        <div class="form-group">
          <label>Inspection Type</label>
          <select id="bulkCertInspectionType">
            <option value="ALL">All Types</option>
            <option value="VISUAL">Visual Inspection</option>
            <option value="LOADTEST">Load Test</option>
          </select>
        </div>

        <div class="form-group">
          <label>Status</label>
          <select id="bulkCertStatus">
            <option value="ALL">All Statuses</option>
            <option value="SAFE">SAFE</option>
            <option value="NOT SAFE">NOT SAFE</option>
          </select>
        </div>
      </div>

      <div class="form-actions">
        <button id="bulkCertSearchBtn" type="button">Load Certificates</button>
        <button id="bulkCertPrintBtn" type="button" disabled>Print Selected Certificates</button>
        <button id="bulkCertDownloadSelectedBtn" type="button" disabled>Download Selected as PDF</button>
        <button id="bulkCertDownloadAllBtn" type="button" disabled>Download All Results as PDF</button>
      </div>

      <div id="bulkCertificateResults" class="bulk-certificate-results">
        <p>No bulk search loaded yet.</p>
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
  installCertificatePageActions()

  document.querySelector('#certSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      window.searchCertificates()
    }
  })

  document.querySelector('#certClient').addEventListener('change', window.filterCertificateSites)
  document.querySelector('#certSite').addEventListener('change', window.filterCertificateSections)
  document.querySelector('#certSearchBtn').addEventListener('click', window.searchCertificates)
  document.querySelector('#certClearBtn').addEventListener('click', window.clearCertificateSearch)
  document.querySelector('#bulkCertClient').addEventListener('change', window.filterBulkCertificateSites)
  document.querySelector('#bulkCertSearchBtn').addEventListener('click', window.searchBulkCertificates)
  document.querySelector('#bulkCertPrintBtn').addEventListener('click', window.printSelectedBulkCertificates)
  document.querySelector('#bulkCertDownloadSelectedBtn').addEventListener('click', window.downloadSelectedBulkCertificatesPdf)
  document.querySelector('#bulkCertDownloadAllBtn').addEventListener('click', window.downloadAllBulkCertificatesPdf)

  window.searchCertificates()
}

function installCertificatePageActions() {
  Object.assign(window, certificatePageActions)
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

window.filterBulkCertificateSites = function () {
  const clientid = document.querySelector('#bulkCertClient').value
  const siteSelect = document.querySelector('#bulkCertSite')

  const filteredSites = clientid
    ? window.certificateSites.filter(site => String(site.clientid) === String(clientid))
    : []

  siteSelect.innerHTML = `
    <option value="">All Sites</option>
    ${filteredSites.map(site => `
      <option value="${site.siteid}">${site.sitename}</option>
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
    `${API_BASE}/certificates/search?${params.toString()}`
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

function certificateSortHeader(label, key) {
  const sort = getTableSortState('certificates', 'testid', 'desc')
  const isActive = sort.key === key
  const arrow = isActive
    ? sort.direction === 'desc' ? 'v' : '^'
    : '^v'

  return `
    <span class="certificate-sort-heading">
      <span>${label}</span>
      <button
        type="button"
        class="certificate-sort-btn ${isActive ? 'active' : ''}"
        onclick="sortTable('certificates', '${key}', 'rerenderCertificateResults')"
        aria-label="Sort ${label}"
        title="Sort ${label}"
      >${arrow}</button>
    </span>
  `
}

function renderCertificateResults(certificates) {
  if (certificates.length === 0) {
    document.querySelector('#certificateResults').innerHTML = `<p>No certificates found.</p>`
    return
  }

  const canDeleteCertificates = window.currentUser?.role === "ADMIN"

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
  }, 'testid', 'desc')
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
          <th>${certificateSortHeader('Test ID', 'testid')}</th>
          <th>${certificateSortHeader('Tag No', 'tagnumber')}</th>
          <th>${certificateSortHeader('Client', 'clientname')}</th>
          <th>${certificateSortHeader('Site', 'sitename')}</th>
          <th>${certificateSortHeader('Asset', 'description')}</th>
          <th>${certificateSortHeader('Serial No', 'serialno')}</th>
          <th>${certificateSortHeader('Type', 'inspectiontype')}</th>
          <th>${certificateSortHeader('Date', 'testdate')}</th>
          <th>${certificateSortHeader('Status', 'status')}</th>
          <th>${certificateSortHeader('Inspector', 'inspector')}</th>
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
                class="cert-action-link cert-download-btn"
                href="${API_BASE}/inspections/${cert.testid}/certificate.pdf?t=${Date.now()}"
                download="certificate-${cert.testid}.pdf"
                onclick="event.stopPropagation()"
              >
                Download PDF
              </a>

              <button type="button" class="cert-mail-btn" data-testid="${cert.testid}">
                Mail
              </button>

              ${canDeleteCertificates ? `
                <button type="button" class="cert-delete-btn" data-testid="${cert.testid}">
                  Delete
                </button>
              ` : ""}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `

  bindCertificateResultEvents()
}

window.searchBulkCertificates = async function () {
  const clientid = document.querySelector('#bulkCertClient').value
  const datefrom = document.querySelector('#bulkCertDateFrom').value
  const dateto = document.querySelector('#bulkCertDateTo').value
  const siteid = document.querySelector('#bulkCertSite').value
  const inspectiontype = document.querySelector('#bulkCertInspectionType').value
  const status = document.querySelector('#bulkCertStatus').value

  if (!clientid || !datefrom || !dateto) {
    alert("Please select a customer, Date From and Date To for bulk printing.")
    return
  }

  const params = new URLSearchParams({
    clientid,
    datefrom,
    dateto
  })

  if (siteid) params.set("siteid", siteid)
  if (inspectiontype && inspectiontype !== "ALL") params.set("inspectiontype", inspectiontype)
  if (status && status !== "ALL") params.set("status", status)

  const resultsContainer = document.querySelector('#bulkCertificateResults')
  const printButton = document.querySelector('#bulkCertPrintBtn')
  const downloadSelectedButton = document.querySelector('#bulkCertDownloadSelectedBtn')
  const downloadAllButton = document.querySelector('#bulkCertDownloadAllBtn')

  resultsContainer.innerHTML = `<p>Loading matching certificates...</p>`
  printButton.disabled = true
  downloadSelectedButton.disabled = true
  downloadAllButton.disabled = true

  const response = await fetch(
    `${API_BASE}/certificates/bulk-print?${params.toString()}`
  )

  const data = await response.json()

  if (!response.ok) {
    resultsContainer.innerHTML = `<p>No bulk search loaded yet.</p>`
    alert("Error loading bulk certificates: " + (data.error || "Unable to load certificates"))
    return
  }

  window.bulkCertificateResults = data.certificates || []
  renderBulkCertificateResults(window.bulkCertificateResults)
}

function renderBulkCertificateResults(certificates) {
  const resultsContainer = document.querySelector('#bulkCertificateResults')
  const printButton = document.querySelector('#bulkCertPrintBtn')
  const downloadSelectedButton = document.querySelector('#bulkCertDownloadSelectedBtn')
  const downloadAllButton = document.querySelector('#bulkCertDownloadAllBtn')

  if (!certificates.length) {
    resultsContainer.innerHTML = `<p>No certificates found for the selected customer and date range.</p>`
    printButton.disabled = true
    downloadSelectedButton.disabled = true
    downloadAllButton.disabled = true
    return
  }

  resultsContainer.innerHTML = `
    <div class="bulk-certificate-summary">
      <strong>${certificates.length}</strong> matching certificate${certificates.length === 1 ? "" : "s"} found.
    </div>

    <div class="table-scroll bulk-certificate-table-wrap">
      <table class="bulk-certificate-table">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                id="bulkCertSelectAll"
                checked
                aria-label="Select all certificates"
              >
            </th>
            <th>Certificate No</th>
            <th>Date</th>
            <th>Valid Date</th>
            <th>Type</th>
            <th>Status</th>
            <th>Asset</th>
            <th>Asset Tag</th>
            <th>Serial No</th>
            <th>Site</th>
            <th>Inspector</th>
          </tr>
        </thead>

        <tbody>
          ${certificates.map(certificate => {
            const inspection = certificate.inspection || {}

            return `
              <tr>
                <td>
                  <input
                    type="checkbox"
                    class="bulk-cert-check"
                    value="${inspection.testid}"
                    checked
                    aria-label="Select certificate ${inspection.testid}"
                  >
                </td>
                <td>${inspection.testid || ""}</td>
                <td>${formatDate(inspection.testdate)}</td>
                <td>${formatDate(inspection.validdate)}</td>
                <td>${inspection.inspectiontype || ""}</td>
                <td>
                  <strong class="${inspection.status === "SAFE" ? "status-safe" : "status-unsafe"}">
                    ${inspection.status || ""}
                  </strong>
                </td>
                <td>${inspection.description || ""}</td>
                <td>${inspection.assettagno || inspection.tagnumber || "-"}</td>
                <td>${inspection.serialno || ""}</td>
                <td>${inspection.sitename || ""}</td>
                <td>${inspection.inspector || "-"}</td>
              </tr>
            `
          }).join("")}
        </tbody>
      </table>
    </div>
  `

  document
    .querySelector('#bulkCertSelectAll')
    .addEventListener('change', event => {
      document
        .querySelectorAll('.bulk-cert-check')
        .forEach(checkbox => {
          checkbox.checked = event.target.checked
        })

      updateBulkPrintButtonState()
    })

  document
    .querySelectorAll('.bulk-cert-check')
    .forEach(checkbox => {
      checkbox.addEventListener('change', updateBulkPrintButtonState)
    })

  updateBulkPrintButtonState()
  downloadAllButton.disabled = false
}

function updateBulkPrintButtonState() {
  const selectedCount = document.querySelectorAll('.bulk-cert-check:checked').length
  const printButton = document.querySelector('#bulkCertPrintBtn')
  const downloadSelectedButton = document.querySelector('#bulkCertDownloadSelectedBtn')
  const selectAll = document.querySelector('#bulkCertSelectAll')

  if (printButton) {
    printButton.disabled = selectedCount === 0
    printButton.textContent = selectedCount
      ? `Print Selected Certificates (${selectedCount})`
      : "Print Selected Certificates"
  }

  if (downloadSelectedButton) {
    downloadSelectedButton.disabled = selectedCount === 0
    downloadSelectedButton.textContent = selectedCount
      ? `Download Selected PDFs (${selectedCount})`
      : "Download Selected PDFs"
  }

  if (selectAll) {
    const totalCount = document.querySelectorAll('.bulk-cert-check').length
    selectAll.checked = selectedCount > 0 && selectedCount === totalCount
    selectAll.indeterminate = selectedCount > 0 && selectedCount < totalCount
  }
}

window.printSelectedBulkCertificates = function () {
  const selectedTestIds = Array.from(document.querySelectorAll('.bulk-cert-check:checked'))
    .map(checkbox => String(checkbox.value))

  if (!selectedTestIds.length) {
    alert("Select at least one certificate to print.")
    return
  }

  const selectedCertificates = (window.bulkCertificateResults || [])
    .filter(certificate => selectedTestIds.includes(String(certificate.inspection?.testid)))

  if (!selectedCertificates.length) {
    alert("No selected certificates could be prepared for printing.")
    return
  }

  const existingView = document.querySelector("#bulkCertificatePrintView")
  if (existingView) existingView.remove()

  const printView = document.createElement("div")
  printView.id = "bulkCertificatePrintView"
  printView.className = "bulk-certificate-print-view"

  printView.innerHTML = `
    <div class="bulk-print-toolbar screen-only">
      <h2>Bulk Certificate Print</h2>
      <div class="form-actions">
        <button type="button" id="bulkPrintNowBtn">Print</button>
        <button type="button" id="bulkPrintCloseBtn">Close</button>
      </div>
    </div>

    <div class="bulk-certificate-print-pages">
      ${selectedCertificates.map(certificate => `
        <section class="bulk-certificate-page">
          ${renderCertificateDocument(certificate)}
        </section>
      `).join("")}
    </div>
  `

  document.body.appendChild(printView)
  document.body.classList.add("bulk-print-mode")

  document
    .querySelector('#bulkPrintCloseBtn')
    .addEventListener('click', window.closeBulkCertificatePrintView)

  document
    .querySelector('#bulkPrintNowBtn')
    .addEventListener('click', () => {
      window.print()
    })

  setTimeout(() => window.print(), 250)
}

window.closeBulkCertificatePrintView = function () {
  const printView = document.querySelector("#bulkCertificatePrintView")
  if (printView) printView.remove()
  document.body.classList.remove("bulk-print-mode")
}

function getBulkCertificateFilterParams() {
  const clientid = document.querySelector('#bulkCertClient').value
  const datefrom = document.querySelector('#bulkCertDateFrom').value
  const dateto = document.querySelector('#bulkCertDateTo').value
  const siteid = document.querySelector('#bulkCertSite').value
  const inspectiontype = document.querySelector('#bulkCertInspectionType').value
  const status = document.querySelector('#bulkCertStatus').value

  if (!clientid || !datefrom || !dateto) {
    alert("Please select a customer, Date From and Date To before downloading PDFs.")
    return null
  }

  const params = new URLSearchParams({
    clientid,
    datefrom,
    dateto
  })

  if (siteid) params.set("siteid", siteid)
  if (inspectiontype && inspectiontype !== "ALL") params.set("inspectiontype", inspectiontype)
  if (status && status !== "ALL") params.set("status", status)

  return params
}

function getSelectedBulkCertificateTestIds() {
  return Array.from(document.querySelectorAll('.bulk-cert-check:checked'))
    .map(checkbox => String(checkbox.value))
}

window.downloadSelectedBulkCertificatesPdf = async function () {
  const selectedTestIds = getSelectedBulkCertificateTestIds()

  if (!selectedTestIds.length) {
    alert("Select at least one certificate to download.")
    return
  }

  await downloadIndividualCertificatePdfs(selectedTestIds)
}

window.downloadAllBulkCertificatesPdf = async function () {
  if (!(window.bulkCertificateResults || []).length) {
    alert("No certificates found to download. Load certificates first.")
    return
  }

  const params = getBulkCertificateFilterParams()
  if (!params) return

  await downloadBulkCertificatesPdf(params)
}

async function downloadBulkCertificatesPdf(params) {
  const response = await fetch(
    `${API_BASE}/certificates/bulk-pdf?${params.toString()}`
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Unable to download bulk certificates"
    }))
    alert(error.error || "Unable to download bulk certificates")
    return
  }

  const blob = await response.blob()
  const filename = getDownloadFilename(
    response.headers.get("content-disposition"),
    "FB-Certificates.pdf"
  )
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function getDownloadFilename(contentDisposition, fallback) {
  const match = String(contentDisposition || "").match(/filename="?([^"]+)"?/i)
  return match ? match[1] : fallback
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

  document.querySelectorAll('.cert-delete-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      window.deleteCertificate(button.dataset.testid)
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
    `${API_BASE}/inspections/${testid}/certificate`
  )

  const data = await readCertificateJson(response)

  if (!response.ok) {
    alert("Error loading certificate preview: " + data.error)
    return
  }

  const inspection = data.inspection
  const results = data.results || []

  const failCount = results.filter(r => r.result === "FAIL").length
  const passCount = results.filter(r => r.result === "PASS").length
  const certificateRegulationNotes = getCertificateRegulationNotes(inspection)

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

    ${certificateRegulationNotes.map(note => `
      <p class="fb-cert-driven-note">
        ${note}
      </p>
    `).join("")}

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
    `${API_BASE}/inspections/${testid}/certificate`
  )

  const data = await readCertificateJson(response)

  if (!response.ok) {
    alert("Error loading certificate: " + data.error)
    return
  }

  const inspection = data.inspection

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
            href="${API_BASE}/inspections/${inspection.testid}/certificate.pdf?inline=1&t=${Date.now()}"
            target="_blank"
          >
            Print
          </a>
          <a
            id="certificateDownloadPdfBtn"
            class="cert-action-link"
            href="${API_BASE}/inspections/${inspection.testid}/certificate.pdf?t=${Date.now()}"
            download="certificate-${inspection.testid}.pdf"
          >
            Download PDF
          </a>
          <button type="button" id="certificateMailBtn">Mail</button>
          <button type="button" id="certificateCloseBtn">Close</button>
        </div>
      </div>

      <div class="certificate-modal-body" id="certificatePrintArea">
        ${renderCertificateDocument(data)}
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

function renderCertificateDocument(certificate) {
  const inspection = certificate.inspection || {}
  const results = getCertificateResultsForDisplay(certificate.results || [], inspection)
  const inspectionPhotos = getCertificatePhotos(inspection, certificate.photos || [])
  const assetDetails = getCertificateAssetDetails(inspection)
  const certificateTitle = getCertificateTitle(inspection)
  const certificateRegulationNotes = getCertificateRegulationNotes(inspection)

  return `
    <div class="fb-cert-page">
      <img src="${assetUrl('header.jpg')}" class="fb-cert-header" alt="FB Cranes Header">

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
          <p class="fb-cert-serial-line"><strong>Serial No:</strong> <span>${inspection.serialno || "-"}</span></p>
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
              <img src="${API_BASE}${photo.photo_path}">
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
            ${results.map(row => `
              <tr>
                <td>${row.criterianame || ""}</td>
                <td>
                  <strong class="${
                    getCertificateResultDisplay(row) === "YES" || getCertificateResultDisplay(row) === "PASS"
                      ? "status-safe"
                      : getCertificateResultDisplay(row) === "NO" || getCertificateResultDisplay(row) === "FAIL"
                        ? "status-unsafe"
                        : ""
                  }">
                    ${getCertificateResultDisplay(row)}
                  </strong>
                </td>
                <td>${row.assetvalue || ""}</td>
                <td>${row.measuredvalue || ""}</td>
                <td>${row.remarks || ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="fb-cert-signature-section">
        <div>
          <strong>Inspector Signature</strong>
          ${inspection.inspector_signature_image ? `
            <img
              class="fb-cert-signature-image"
              src="${API_BASE}${inspection.inspector_signature_image}"
              alt="Inspector Signature"
            >
          ` : ""}
          <div class="fb-cert-signature-line"></div>
        </div>
      </div>

      ${certificateRegulationNotes.map(note => `
        <p class="fb-cert-driven-note">
          ${note}
        </p>
      `).join("")}

      <img src="${assetUrl('footer.jpg')}" class="fb-cert-footer" alt="FB Cranes Footer">
    </div>
  `
}

window.printCertificatePdf = function (testid) {
  window.open(
    `${API_BASE}/inspections/${testid}/certificate.pdf?inline=1&t=${Date.now()}`,
    "_blank"
  )
}

window.downloadCertificatePdf = async function (testid) {
  const response = await fetch(
    `${API_BASE}/inspections/${testid}/certificate.pdf?t=${Date.now()}`
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
  const recipient = window.prompt("Enter recipient email address")

  if (!recipient) {
    return
  }

  try {
    const response = await fetch(
      `${API_BASE}/certificates/${testid}/email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ to: recipient.trim() })
      }
    )

    const data = await response.json().catch(() => ({
      error: "Unable to read the email error from the server."
    }))

    if (!response.ok) {
      alert(data.error || "Unable to email certificate")
      return
    }

    alert("Certificate emailed successfully")
  } catch (err) {
    alert(`Unable to email certificate: ${err.message}`)
  }
}

window.deleteCertificate = async function (testid) {
  if (window.currentUser?.role !== "ADMIN") {
    alert("Only admins may delete certificates.")
    return
  }

  const confirmed = window.confirm(
    `Delete certificate ${testid}? This removes it from ATEC and cannot be undone.`
  )

  if (!confirmed) {
    return
  }

  const response = await fetch(
    `${API_BASE}/certificates/${testid}`,
    { method: "DELETE" }
  )

  const data = await readCertificateJson(response)

  if (!response.ok) {
    alert(data.error || `Unable to delete certificate ${testid}.`)
    return
  }

  window.currentCertificateResults = (window.currentCertificateResults || [])
    .filter(certificate => String(certificate.testid) !== String(testid))

  renderCertificateResults(window.currentCertificateResults)
  renderCertificateStats(window.currentCertificateResults)

  const previewPanel = document.querySelector('#certificatePreviewPanel')
  if (previewPanel) {
    previewPanel.innerHTML = `
      <h2>Certificate Preview</h2>
      <p>Certificate ${testid} deleted.</p>
    `
  }

  alert(`Certificate ${testid} deleted successfully.`)
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
    ["Auxiliary Hoist Description", inspection.auxhoistdescription],
    ["Auxiliary Hoist Serial No", inspection.auxhoistserialno],
    ["Auxiliary Hoist WLL", inspection.auxhoistwll ? `${inspection.auxhoistwll} kg` : ""],
    ["Auxiliary Hoist Hook Size", inspection.auxhoisthooksize ? `${inspection.auxhoisthooksize} mm` : ""],
    ["Auxiliary Hoist Steel Wire Rope", inspection.auxhoistropemm ? `${inspection.auxhoistropemm} mm` : ""],
    ["Manufacture Date", formatDate(inspection.manufactdate)]
  ].filter(([, value]) => value && value !== "-")
}

function getCertificateTitle(inspection) {
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

function isEmptyLoadTestMeasurementRow(row, inspection) {
  if (inspection?.inspectiontype !== "LOADTEST") return false

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

function getCertificateResultsForDisplay(results, inspection = {}) {
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

const DRIVEN_MACHINERY_CERTIFICATE_NOTE =
  "Certification that the item has been inspected in accordance with the requirements of Driven Machinery and SANS Regulations and the responsible person has been informed of all defects."

const DRIVEN_MACHINERY_ITEMS_CERTIFICATE_NOTE =
  "Certification that the items have been inspected in accordance with the requirements of Driven Machinery and SANS Regulations and the responsible person has been informed of all defects."

const SANS_500_CERTIFICATE_NOTE =
  "EXAMINED AND TESTED IN ACCORDANCE WITH SANS 500"

const REGULATION_18_CERTIFICATE_NOTE =
  "EXAMINED AND TESTED IN ACCORDANCE WITH REGULATION 18 OF OHS ACT 85 OF 1993"

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

function getCertificateRegulationNotes(inspection) {
  const notes = []
  const equiptypeid = String(inspection.equiptypeid || "")

  if (["400", "500"].includes(String(inspection.equipgroupid || ""))) {
    notes.push(DRIVEN_MACHINERY_CERTIFICATE_NOTE)
  }

  if (equiptypeid === "102") {
    notes.push(SANS_500_CERTIFICATE_NOTE)
  }

  if (["103", "105"].includes(equiptypeid)) {
    notes.push(REGULATION_18_CERTIFICATE_NOTE)
  }

  if (DRIVEN_MACHINERY_ITEMS_EQUIPTYPE_IDS.has(equiptypeid)) {
    notes.push(DRIVEN_MACHINERY_ITEMS_CERTIFICATE_NOTE)
  }

  return notes
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

async function downloadIndividualCertificatePdfs(testIds) {
  const selectedCertificates = (window.bulkCertificateResults || [])
    .filter(certificate => testIds.includes(String(certificate.inspection?.testid)))

  if (!selectedCertificates.length) {
    alert("No selected certificates could be prepared for download.")
    return
  }

  for (const certificate of selectedCertificates) {
    const testid = certificate.inspection?.testid
    const response = await fetch(`${API_BASE}/inspections/${testid}/certificate.pdf?t=${Date.now()}`, {
      credentials: "include"
    })

    if (!response.ok) {
      alert(`Unable to download certificate ${testid}.`)
      continue
    }

    const blob = await response.blob()
    const filename = getDownloadFilename(
      response.headers.get("content-disposition"),
      `certificate-${testid}.pdf`
    )
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")

    link.href = url
    link.download = filename
    link.style.display = "none"
    document.body.appendChild(link)
    link.click()
    link.remove()

    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
  }
}

const certificatePageActions = {
  filterCertificateSites: window.filterCertificateSites,
  filterCertificateSections: window.filterCertificateSections,
  filterBulkCertificateSites: window.filterBulkCertificateSites,
  clearCertificateSearch: window.clearCertificateSearch,
  searchCertificates: window.searchCertificates,
  rerenderCertificateResults: window.rerenderCertificateResults,
  goToCertificatePage: window.goToCertificatePage,
  setCertificateRowsPerPage: window.setCertificateRowsPerPage,
  previewCertificate: window.previewCertificate,
  openCertificateModal: window.openCertificateModal,
  closeCertificateModal: window.closeCertificateModal,
  downloadCertificatePdf: window.downloadCertificatePdf,
  mailCertificate: window.mailCertificate,
  searchBulkCertificates: window.searchBulkCertificates,
  printSelectedBulkCertificates: window.printSelectedBulkCertificates,
  closeBulkCertificatePrintView: window.closeBulkCertificatePrintView,
  downloadSelectedBulkCertificatesPdf: window.downloadSelectedBulkCertificatesPdf,
  downloadAllBulkCertificatesPdf: window.downloadAllBulkCertificatesPdf,
  toggleBulkCertificateSelection: window.toggleBulkCertificateSelection,
  updateBulkCertificateButtons: window.updateBulkCertificateButtons
}


