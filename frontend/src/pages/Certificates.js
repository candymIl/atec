import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { getTableSortState, sortTableRows } from '../tableSort.js'
import { API_BASE, assetUrl } from '../api.js'
import { escapeHtml, safeAttr } from '../utils/security.js'

const certificateVoidRoles = ["ADMIN", "MANAGER", "INSPECTOR"]
const bulkCertificateBatchSize = 100

function canVoidCertificates() {
  return certificateVoidRoles.includes(window.currentUser?.role)
}

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

async function readCertificateHtml(response) {
  const text = await response.text()

  if (!response.ok) {
    let payload = null

    try {
      payload = JSON.parse(text)
    } catch (_) {
      // Older servers return a plain-text error from this endpoint.
    }

    const message = payload?.error || text ||
      "The server returned an unexpected error while loading the certificate."
    const reasons = Array.isArray(payload?.reasons)
      ? payload.reasons.filter(Boolean)
      : []

    return {
      html: "",
      error: reasons.length
        ? `${message}\n\nReason${reasons.length === 1 ? "" : "s"}:\n- ${reasons.join("\n- ")}`
        : message
    }
  }

  return {
    html: text,
    error: ""
  }
}

function certificateHtmlUrl(testid) {
  return `${API_BASE}/inspections/${encodeURIComponent(testid)}/certificate.html?t=${Date.now()}`
}

export function renderCertificateSearch(customers = [], sites = [], sections = []) {
  const isCustomerUser = window.currentUser?.role === "CUSTOMER"
  customers = customers.filter(item => item.archived !== true && item.archived !== 'true')
  sites = sites.filter(item => item.archived !== true && item.archived !== 'true')
  sections = sections.filter(item => item.archived !== true && item.archived !== 'true')
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
            placeholder="${isCustomerUser ? "Test ID, job number, tag, serial, site, asset description..." : "Test ID, job number, tag, serial, client, site, asset description..."}"
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

        ${isCustomerUser ? `<input id="certClient" type="hidden" value="">` : `
          <div class="form-group">
            <label>Client</label>
            <select id="certClient">
              <option value="">All Clients</option>
              ${customers.map(c => `
                <option value="${safeAttr(c.clientid)}">${escapeHtml(c.clientname)}</option>
              `).join("")}
            </select>
          </div>
        `}

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
      <p>${isCustomerUser ? "Select a date range, then choose the certificates to print together." : "Select a date range, then choose the certificates to print together. Customer is optional."}</p>

      <div class="asset-form-grid">
        ${isCustomerUser ? `<input id="bulkCertClient" type="hidden" value="">` : `
          <div class="form-group">
            <label>Customer</label>
            <select id="bulkCertClient">
              <option value="">All Customers</option>
              ${customers.map(c => `
                <option value="${safeAttr(c.clientid)}">${escapeHtml(c.clientname)}</option>
              `).join("")}
            </select>
          </div>
        `}

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

    ${window.currentUser?.role === "ADMIN" ? `
      <div class="filter-card voided-certificates-card">
        <div class="voided-certificates-heading">
          <div>
            <h2>Voided Certificates</h2>
            <p>Certificates removed as entered in error. These records are retained for audit purposes.</p>
          </div>
          <button id="refreshVoidedCertificatesBtn" type="button">Refresh</button>
        </div>
        <div id="voidedCertificateResults"><p>Loading voided certificates...</p></div>
      </div>
    ` : ""}
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

  document.querySelector('#refreshVoidedCertificatesBtn')?.addEventListener('click', window.loadVoidedCertificates)
  window.filterBulkCertificateSites()
  window.searchCertificates()
  if (window.currentUser?.role === "ADMIN") window.loadVoidedCertificates()
}

window.loadVoidedCertificates = async function () {
  const container = document.querySelector('#voidedCertificateResults')
  if (!container || window.currentUser?.role !== "ADMIN") return
  container.innerHTML = `<p>Loading voided certificates...</p>`

  const response = await fetch(`${API_BASE}/certificates/voided`)
  const records = await readCertificateJson(response)
  if (!response.ok) {
    container.innerHTML = `<p>${escapeHtml(records.error || "Unable to load voided certificates.")}</p>`
    return
  }
  if (!records.length) {
    container.innerHTML = `<p>No certificates have been voided.</p>`
    return
  }

  container.innerHTML = `
    <div class="voided-bulk-actions">
      <button type="button" id="restoreSelectedVoidedBtn" disabled>Restore Selected</button>
      <button type="button" id="deleteSelectedVoidedBtn" class="danger-btn" disabled>Permanently Delete Selected</button>
      <span id="voidedSelectionCount">0 selected</span>
    </div>
    <div class="table-scroll">
      <table class="voided-certificates-table">
        <thead><tr>
          <th><input type="checkbox" id="selectAllVoidedCertificates" aria-label="Select all voided certificates"></th>
          <th>Test ID</th><th>Client</th><th>Asset</th><th>Serial No</th><th>Type</th>
          <th>Inspection Date</th><th>Removed By</th><th>Removed At</th><th>Reason</th><th>Action</th>
        </tr></thead>
        <tbody>${records.map(record => `
          <tr>
            <td><input type="checkbox" class="voided-certificate-checkbox" value="${safeAttr(record.testid)}" aria-label="Select certificate ${safeAttr(record.testid)}"></td>
            <td>${escapeHtml(record.testid)}</td>
            <td>${escapeHtml(record.clientname || "-")}</td>
            <td>${escapeHtml(record.description || record.assettagno || "-")}</td>
            <td>${escapeHtml(record.serialno || "-")}</td>
            <td>${escapeHtml(record.inspectiontype || "-")}</td>
            <td>${escapeHtml(formatDate(record.testdate))}</td>
            <td>${escapeHtml(record.voided_by || "-")}</td>
            <td>${escapeHtml(record.voided_at || "-")}</td>
            <td class="void-reason-cell">${escapeHtml(record.void_reason || "-")}</td>
            <td class="voided-row-actions">
              <button type="button" class="restore-certificate-btn" data-testid="${safeAttr(record.testid)}">Restore</button>
              <button type="button" class="permanent-delete-certificate-btn" data-testid="${safeAttr(record.testid)}">Delete</button>
            </td>
          </tr>`).join("")}</tbody>
      </table>
    </div>`

  container.querySelectorAll('.restore-certificate-btn').forEach(button => {
    button.addEventListener('click', () => window.restoreCertificate(button.dataset.testid))
  })
  container.querySelectorAll('.permanent-delete-certificate-btn').forEach(button => {
    button.addEventListener('click', () => window.permanentlyDeleteCertificate(button.dataset.testid))
  })
  container.querySelectorAll('.voided-certificate-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', window.updateVoidedSelection)
  })
  container.querySelector('#selectAllVoidedCertificates').addEventListener('change', event => {
    container.querySelectorAll('.voided-certificate-checkbox').forEach(checkbox => { checkbox.checked = event.target.checked })
    window.updateVoidedSelection()
  })
  container.querySelector('#restoreSelectedVoidedBtn').addEventListener('click', window.restoreSelectedVoidedCertificates)
  container.querySelector('#deleteSelectedVoidedBtn').addEventListener('click', window.deleteSelectedVoidedCertificates)
}

function selectedVoidedCertificateIds() {
  return [...document.querySelectorAll('.voided-certificate-checkbox:checked')].map(checkbox => checkbox.value)
}

window.updateVoidedSelection = function () {
  const selected = selectedVoidedCertificateIds()
  const all = [...document.querySelectorAll('.voided-certificate-checkbox')]
  const selectAll = document.querySelector('#selectAllVoidedCertificates')
  if (selectAll) {
    selectAll.checked = all.length > 0 && selected.length === all.length
    selectAll.indeterminate = selected.length > 0 && selected.length < all.length
  }
  const count = document.querySelector('#voidedSelectionCount')
  if (count) count.textContent = `${selected.length} selected`
  const restore = document.querySelector('#restoreSelectedVoidedBtn')
  const remove = document.querySelector('#deleteSelectedVoidedBtn')
  if (restore) restore.disabled = selected.length === 0
  if (remove) remove.disabled = selected.length === 0
}

window.restoreCertificate = async function (testid) {
  if (!window.confirm(`Restore certificate ${testid} to the active certificate list?`)) return
  const requestRestore = force => fetch(`${API_BASE}/certificates/${encodeURIComponent(testid)}/restore`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force_restore: force })
  })
  let response = await requestRestore(false)
  let data = await readCertificateJson(response)

  if (response.status === 409 && data.code === "RESTORE_DUPLICATE") {
    if (!window.confirm(`Active inspection ${data.existing_testid} already matches this record. Restore ${testid} anyway?`)) return
    response = await requestRestore(true)
    data = await readCertificateJson(response)
  }
  if (!response.ok) {
    alert(data.error || `Unable to restore certificate ${testid}.`)
    return
  }
  alert(`Certificate ${testid} restored.`)
  await Promise.all([window.loadVoidedCertificates(), window.searchCertificates()])
}

window.permanentlyDeleteCertificate = async function (testid) {
  const confirmation = window.prompt(
    `Permanently delete certificate ${testid}, including its results and photo records?\n\nThis cannot be undone. Type DELETE to continue.`
  )
  if (confirmation !== "DELETE") return
  const response = await fetch(`${API_BASE}/certificates/${encodeURIComponent(testid)}/permanent`, { method: "DELETE" })
  const data = await readCertificateJson(response)
  if (!response.ok) return alert(data.error || `Unable to permanently delete certificate ${testid}.`)
  alert(`Certificate ${testid} permanently deleted.`)
  await window.loadVoidedCertificates()
}

window.restoreSelectedVoidedCertificates = async function () {
  const testids = selectedVoidedCertificateIds()
  if (!testids.length || !window.confirm(`Restore ${testids.length} selected certificate${testids.length === 1 ? "" : "s"}?`)) return

  const requestRestore = force => fetch(`${API_BASE}/certificates/voided/bulk-restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ testids, force_restore: force })
  })
  let response = await requestRestore(false)
  let data = await readCertificateJson(response)
  if (response.status === 409 && data.code === "RESTORE_DUPLICATES") {
    if (!window.confirm(`${data.conflicts?.length || "Some"} selected certificate(s) match active inspections. Restore them anyway?`)) return
    response = await requestRestore(true)
    data = await readCertificateJson(response)
  }
  if (!response.ok) return alert(data.error || "Unable to restore the selected certificates.")
  alert(`${data.restored?.length || 0} certificate(s) restored.`)
  await Promise.all([window.loadVoidedCertificates(), window.searchCertificates()])
}

window.deleteSelectedVoidedCertificates = async function () {
  const testids = selectedVoidedCertificateIds()
  if (!testids.length) return
  const confirmation = window.prompt(
    `Permanently delete ${testids.length} selected certificate${testids.length === 1 ? "" : "s"}, including results and photo records?\n\nThis cannot be undone. Type DELETE ${testids.length} to continue.`
  )
  if (confirmation !== `DELETE ${testids.length}`) return

  const response = await fetch(`${API_BASE}/certificates/voided/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ testids })
  })
  const data = await readCertificateJson(response)
  if (!response.ok) return alert(data.error || "Unable to permanently delete the selected certificates.")
  alert(`${data.deleted?.length || 0} certificate(s) permanently deleted.`)
  await window.loadVoidedCertificates()
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
      <option value="${safeAttr(site.siteid)}">${escapeHtml(site.sitename)}</option>
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
      <option value="${safeAttr(section.sectionid)}">${escapeHtml(section.sectionname)}</option>
    `).join("")}
  `
}

window.filterBulkCertificateSites = function () {
  const clientid = document.querySelector('#bulkCertClient').value
  const siteSelect = document.querySelector('#bulkCertSite')

  const filteredSites = clientid
    ? window.certificateSites.filter(site => String(site.clientid) === String(clientid))
    : window.certificateSites

  siteSelect.innerHTML = `
    <option value="">All Sites</option>
    ${filteredSites.map(site => `
      <option value="${safeAttr(site.siteid)}">${escapeHtml(site.sitename)}</option>
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
  params.append("page", String(window.certCurrentPage || 1))
  params.append("limit", String(window.certRowsPerPage || 25))

  const sort = getTableSortState('certificates', 'testid', 'desc')
  params.append("sortKey", sort.key || "testid")
  params.append("sortDir", sort.direction || "desc")

  const response = await fetch(
    `${API_BASE}/certificates/search?${params.toString()}`
  )

  const payload = await response.json()

  if (!response.ok) {
    alert("Error searching certificates: " + payload.error)
    return
  }

  const certificates = Array.isArray(payload) ? payload : payload.rows || []
  window.currentCertificateResults = certificates
  window.currentCertificatePageInfo = Array.isArray(payload)
    ? null
    : {
        currentPage: Number(payload.page || 1),
        pageSize: Number(payload.limit || window.certRowsPerPage || 25),
        totalRows: Number(payload.total || certificates.length),
        totalPages: Number(payload.totalPages || 1),
        startIndex: ((Number(payload.page || 1) - 1) * Number(payload.limit || window.certRowsPerPage || 25)),
        endIndex: ((Number(payload.page || 1) - 1) * Number(payload.limit || window.certRowsPerPage || 25)) + certificates.length
      }

  renderCertificateStats(certificates, payload.summary)
  renderCertificateResults(certificates)
}

function renderCertificateStats(certificates, summary = null) {
  const safeCount = summary ? summary.safe : certificates.filter(c => c.status === "SAFE").length
  const notSafeCount = summary ? summary.notSafe : certificates.filter(c => c.status === "NOT SAFE").length
  const loadTestCount = summary ? summary.loadTest : certificates.filter(c => c.inspectiontype === "LOADTEST").length
  const visualCount = summary ? summary.visual : certificates.filter(c => c.inspectiontype === "VISUAL").length
  const totalCount = summary
    ? Number(summary.total || window.currentCertificatePageInfo?.totalRows || certificates.length)
    : certificates.length

  document.querySelector('#certificateStats').innerHTML = `
    <p><strong>Total:</strong> ${totalCount || window.currentCertificatePageInfo?.totalRows || certificates.length}</p>
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

  const showVoidCertificateAction = canVoidCertificates()
  const isCustomerUser = window.currentUser?.role === "CUSTOMER"

  const sortedCertificates = window.currentCertificatePageInfo ? certificates : sortTableRows(certificates, 'certificates', {
    testid: cert => cert.testid,
    job_number: cert => cert.job_number,
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
  const pagination = window.currentCertificatePageInfo
    ? {
        ...window.currentCertificatePageInfo,
        rows: sortedCertificates
      }
    : getPaginationState(sortedCertificates, "certCurrentPage", "certRowsPerPage")

  document.querySelector('#certificateResults').innerHTML = `
    ${renderPaginationControls({
      ...pagination,
      label: "certificates",
      onPage: "goToCertificatePage",
      onPageSize: "setCertificateRowsPerPage"
    })}

    <div class="certificate-worklist ${isCustomerUser ? "customer-scoped" : ""}">
      <div class="certificate-worklist-header">
        <span>${certificateSortHeader(isCustomerUser ? 'Asset' : 'Tag / Asset', isCustomerUser ? 'description' : 'tagnumber')}</span>
        <span>${certificateSortHeader('Serial No', 'serialno')}</span>
        <span>${certificateSortHeader('Type', 'inspectiontype')}</span>
        <span>${certificateSortHeader('Date', 'testdate')}</span>
        <span>${certificateSortHeader('Status', 'status')}</span>
        <span>${certificateSortHeader('Inspector', 'inspector')}</span>
        <span>Actions</span>
      </div>
      <div class="certificate-worklist-body">
        ${pagination.rows.map(cert => {
          const testid = safeAttr(cert.testid)
          const status = escapeHtml(cert.status || "")
          const tag = escapeHtml(cert.tagnumber || "-")
          const asset = escapeHtml(cert.description || "-")

          return `
          <article class="certificate-worklist-row" data-testid="${testid}">
            <button
              type="button"
              class="certificate-row-summary"
              data-testid="${testid}"
              aria-expanded="false"
              aria-controls="certificate-details-${testid}"
            >
              <span class="certificate-worklist-identity">
                <strong>${isCustomerUser ? asset : tag}</strong>
                <small>${isCustomerUser ? `Certificate ${escapeHtml(cert.testid)}` : `${asset} · Cert ${escapeHtml(cert.testid)}`}</small>
              </span>
              <span class="certificate-worklist-serial" data-label="Serial No">${escapeHtml(cert.serialno || "-")}</span>
              <span class="certificate-worklist-type" data-label="Type">${escapeHtml(cert.inspectiontype || "-")}</span>
              <span class="certificate-worklist-date" data-label="Date">${escapeHtml(formatDate(cert.testdate))}</span>
              <span class="certificate-worklist-status" data-label="Status">
              <strong class="${cert.status === "SAFE" ? "status-safe" : "status-unsafe"}">
                ${status}
              </strong>
              </span>
              <span class="certificate-worklist-inspector" data-label="Inspector">${escapeHtml(cert.inspector || "-")}</span>
            </button>
            <div class="certificate-worklist-actions" data-label="Actions">
              <button type="button" class="cert-preview-btn" data-testid="${testid}">
                Preview
              </button>
              <a
                class="cert-action-link cert-download-btn"
                href="${API_BASE}/inspections/${encodeURIComponent(cert.testid)}/certificate.pdf?t=${Date.now()}"
                download="certificate-${testid}.pdf"
                onclick="event.stopPropagation()"
              >
                PDF
              </a>
              <button type="button" class="certificate-more-btn" data-testid="${testid}" aria-expanded="false" aria-controls="certificate-details-${testid}">More</button>
            </div>
            <div class="certificate-worklist-details" id="certificate-details-${testid}" hidden>
              ${isCustomerUser ? "" : `<span><small>Client</small>${escapeHtml(cert.clientname || "-")}</span>`}
              <span><small>Site</small>${escapeHtml(cert.sitename || "-")}</span>
              <span><small>Job Number</small>${escapeHtml(cert.job_number || "-")}</span>
              <span><small>Certificate ID</small>${escapeHtml(cert.testid)}</span>
              <div class="certificate-detail-actions">
                <button type="button" class="cert-view-btn" data-testid="${testid}">View Details</button>
                <button type="button" class="cert-mail-btn" data-testid="${testid}">Mail</button>
                ${showVoidCertificateAction ? `<button type="button" class="cert-delete-btn" data-testid="${testid}" title="Mark this certificate as entered in error and retain it in the audit history" aria-label="Mark certificate ${testid} as entered in error">Mark as Error</button>` : ""}
              </div>
            </div>
          </article>
        `}).join("")}
      </div>
    </div>
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

  if (!datefrom || !dateto) {
    alert("Please select Date From and Date To for bulk printing.")
    return
  }

  const params = new URLSearchParams({
    datefrom,
    dateto
  })

  if (clientid) params.set("clientid", clientid)
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
  window.bulkCertificateBlockedCount = Number(data.blockedCount || 0)
  window.bulkCertificateBlockedReasonCounts = data.blockedReasonCounts || {}
  window.bulkCertificateBlockedResults = data.blockedCertificates || []
  window.bulkCertificateTotalMatched = Number(data.totalMatched || window.bulkCertificateResults.length)
  renderBulkCertificateResults(window.bulkCertificateResults, {
    blockedCount: window.bulkCertificateBlockedCount,
    blockedReasonCounts: window.bulkCertificateBlockedReasonCounts,
    blockedCertificates: window.bulkCertificateBlockedResults,
    totalMatched: window.bulkCertificateTotalMatched
  })
}

function renderBlockedCertificateDetails(blockedCertificates = []) {
  if (!blockedCertificates.length) return ""
  const isCustomerUser = window.currentUser?.role === "CUSTOMER"

  return `
    <details class="bulk-certificate-skipped">
      <summary>Show skipped inspections (${escapeHtml(blockedCertificates.length)})</summary>
      <div class="table-scroll bulk-certificate-skipped-table-wrap">
        <table class="bulk-certificate-table bulk-certificate-skipped-table">
          <thead>
            <tr>
              <th>Inspection No</th>
              <th>Date</th>
              <th>Equipment Type</th>
              <th>Inspection Type</th>
              <th>Asset</th>
              ${isCustomerUser ? "" : `<th>Asset Tag</th>`}
              <th>Serial No</th>
              <th>Site</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            ${blockedCertificates.map(inspection => `
              <tr>
                <td>${escapeHtml(inspection.testid || "-")}</td>
                <td>${escapeHtml(formatDate(inspection.testdate))}</td>
                <td><strong>${escapeHtml(inspection.equipmenttype || "Unknown")}</strong></td>
                <td>${escapeHtml(inspection.inspectiontype || "-")}</td>
                <td>${escapeHtml(inspection.description || "-")}</td>
                ${isCustomerUser ? "" : `<td>${escapeHtml(inspection.assettagno || "-")}</td>`}
                <td>${escapeHtml(inspection.serialno || "-")}</td>
                <td>${escapeHtml(inspection.sitename || "-")}</td>
                <td class="bulk-certificate-skip-reason">${escapeHtml((inspection.reasons || []).join(" ") || "Certificate requirements are incomplete.")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </details>
  `
}

function renderBulkCertificateResults(certificates, summary = {}) {
  const isCustomerUser = window.currentUser?.role === "CUSTOMER"
  const resultsContainer = document.querySelector('#bulkCertificateResults')
  const printButton = document.querySelector('#bulkCertPrintBtn')
  const downloadSelectedButton = document.querySelector('#bulkCertDownloadSelectedBtn')
  const downloadAllButton = document.querySelector('#bulkCertDownloadAllBtn')
  const blockedCount = Number(summary.blockedCount || 0)
  const blockedReasonCounts = summary.blockedReasonCounts || {}
  const blockedCertificates = summary.blockedCertificates || []
  const totalMatched = Number(summary.totalMatched || certificates.length)
  const batchCount = Math.ceil(certificates.length / bulkCertificateBatchSize)
  const blockedReasons = Object.entries(blockedReasonCounts)
    .filter(([, count]) => Number(count) > 0)
    .map(([reason, count]) => `<li>${escapeHtml(count)}: ${escapeHtml(reason)}</li>`)
    .join("")

  if (!certificates.length) {
    resultsContainer.innerHTML = blockedCount
      ? `
        <p>${escapeHtml(totalMatched)} matching inspection${totalMatched === 1 ? "" : "s"} found, but none can produce certificates yet.</p>
        ${blockedReasons ? `<p><strong>What needs attention:</strong></p><ul>${blockedReasons}</ul>` : ""}
        ${renderBlockedCertificateDetails(blockedCertificates)}
      `
      : `<p>No certificates found for the selected customer and date range.</p>`
    printButton.disabled = true
    downloadSelectedButton.disabled = true
    downloadAllButton.disabled = true
    return
  }

  const skippedMessage = blockedCount
    ? `
      <span>${escapeHtml(blockedCount)} matching inspection${blockedCount === 1 ? "" : "s"} skipped because ${blockedCount === 1 ? "it cannot" : "they cannot"} produce certificates yet.</span>
      ${blockedReasons ? `<ul>${blockedReasons}</ul>` : ""}
    `
    : ""

  resultsContainer.innerHTML = `
    <div class="bulk-certificate-summary">
      <strong>${certificates.length}</strong> downloadable certificate${certificates.length === 1 ? "" : "s"} found.
      ${skippedMessage}
    </div>

    ${batchCount > 1 ? `
      <div class="bulk-certificate-batches">
        <strong>Select a download batch:</strong>
        ${Array.from({ length: batchCount }, (_, batchIndex) => {
          const first = batchIndex * bulkCertificateBatchSize + 1
          const last = Math.min(first + bulkCertificateBatchSize - 1, certificates.length)
          return `<button type="button" onclick="selectBulkCertificateBatch(${batchIndex})">${first}-${last}</button>`
        }).join("")}
        <span>Only one batch (maximum ${bulkCertificateBatchSize}) can be printed or downloaded at a time.</span>
      </div>
    ` : ""}

    ${renderBlockedCertificateDetails(blockedCertificates)}

    <div class="bulk-certificate-table-wrap bulk-certificate-worklist">
      <div class="bulk-certificate-worklist-header">
        <label class="bulk-certificate-select-all">
          <input
            type="checkbox"
            id="bulkCertSelectAll"
            ${certificates.length <= bulkCertificateBatchSize ? "checked" : ""}
            aria-label="Select all certificates"
          >
          <span>Select</span>
        </label>
        <span>Certificate / Asset</span>
        <span>Tag / Serial</span>
        <span>Inspection Dates</span>
        <span>Type / Status</span>
        <span>Site / Inspector</span>
      </div>
      <div class="bulk-certificate-worklist-body">
        ${certificates.map((certificate, certificateIndex) => {
            const inspection = certificate.inspection || {}
            const assetTag = inspection.assettagno || inspection.tagnumber || "-"

            return `
              <label class="bulk-certificate-worklist-row">
                <span class="bulk-certificate-check-cell">
                  <input
                      type="checkbox"
                      class="bulk-cert-check"
                      value="${safeAttr(inspection.testid)}"
                      ${certificateIndex < bulkCertificateBatchSize ? "checked" : ""}
                      aria-label="Select certificate ${safeAttr(inspection.testid)}"
                    >
                </span>
                <span class="bulk-certificate-primary">
                  <strong>${escapeHtml(inspection.testid || "-")}</strong>
                  <small>${escapeHtml(inspection.description || "-")} · Job ${escapeHtml(inspection.job_number || "-")}</small>
                </span>
                <span class="bulk-certificate-tag-serial">
                  ${isCustomerUser ? "" : `<span><small>Tag</small>${escapeHtml(assetTag)}</span>`}
                  <span><small>Serial</small>${escapeHtml(inspection.serialno || "-")}</span>
                </span>
                <span class="bulk-certificate-dates">
                  <span><small>Tested</small>${escapeHtml(formatDate(inspection.testdate))}</span>
                  <span><small>Valid to</small>${escapeHtml(formatDate(inspection.validdate))}</span>
                </span>
                <span class="bulk-certificate-type-status">
                  <span>${escapeHtml(inspection.inspectiontype || "-")}</span>
                  <strong class="${inspection.status === "SAFE" ? "status-safe" : "status-unsafe"}">
                    ${escapeHtml(inspection.status || "")}
                  </strong>
                </span>
                <span class="bulk-certificate-site-inspector">
                  <span>${escapeHtml(inspection.sitename || "-")}</span>
                  <small>${escapeHtml(inspection.inspector || "-")}</small>
                </span>
              </label>
            `
        }).join("")}
      </div>
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
  downloadAllButton.textContent = batchCount > 1
    ? `Download All in ${batchCount} Batches`
    : "Download All Results as PDF"
}

function updateBulkPrintButtonState() {
  const selectedCount = document.querySelectorAll('.bulk-cert-check:checked').length
  const selectionTooLarge = selectedCount > bulkCertificateBatchSize
  const printButton = document.querySelector('#bulkCertPrintBtn')
  const downloadSelectedButton = document.querySelector('#bulkCertDownloadSelectedBtn')
  const selectAll = document.querySelector('#bulkCertSelectAll')

  if (printButton) {
    printButton.disabled = selectedCount === 0 || selectionTooLarge
    printButton.textContent = selectedCount
      ? `${selectionTooLarge ? "Maximum 100 - Selected" : "Print Selected Certificates"} (${selectedCount})`
      : "Print Selected Certificates"
  }

  if (downloadSelectedButton) {
    downloadSelectedButton.disabled = selectedCount === 0 || selectionTooLarge
    downloadSelectedButton.textContent = selectedCount
      ? `${selectionTooLarge ? "Maximum 100 - Selected" : "Download Selected as PDF"} (${selectedCount})`
      : "Download Selected as PDF"
  }

  if (selectAll) {
    const totalCount = document.querySelectorAll('.bulk-cert-check').length
    selectAll.checked = selectedCount > 0 && selectedCount === totalCount
    selectAll.indeterminate = selectedCount > 0 && selectedCount < totalCount
  }
}

window.selectBulkCertificateBatch = function (batchIndex) {
  const firstIndex = Number(batchIndex) * bulkCertificateBatchSize
  const lastIndex = firstIndex + bulkCertificateBatchSize

  document.querySelectorAll('.bulk-cert-check').forEach((checkbox, index) => {
    checkbox.checked = index >= firstIndex && index < lastIndex
  })

  updateBulkPrintButtonState()
  document.querySelector('.bulk-certificate-table-wrap')?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  })
}

window.printSelectedBulkCertificates = function () {
  const selectedTestIds = Array.from(document.querySelectorAll('.bulk-cert-check:checked'))
    .map(checkbox => String(checkbox.value))

  if (!selectedTestIds.length) {
    alert("Select at least one certificate to print.")
    return
  }
  if (selectedTestIds.length > bulkCertificateBatchSize) {
    alert(`Select no more than ${bulkCertificateBatchSize} certificates at a time.`)
    return
  }

  const params = getBulkCertificateFilterParams()
  if (!params) return

  params.set("testids", selectedTestIds.join(","))
  params.set("inline", "1")

  window.open(`${API_BASE}/certificates/bulk-pdf?${params.toString()}`, "_blank")
}

function getBulkCertificateFilterParams() {
  const clientid = document.querySelector('#bulkCertClient').value
  const datefrom = document.querySelector('#bulkCertDateFrom').value
  const dateto = document.querySelector('#bulkCertDateTo').value
  const siteid = document.querySelector('#bulkCertSite').value
  const inspectiontype = document.querySelector('#bulkCertInspectionType').value
  const status = document.querySelector('#bulkCertStatus').value

  if (!datefrom || !dateto) {
    alert("Please select Date From and Date To before downloading PDFs.")
    return null
  }

  const params = new URLSearchParams({
    datefrom,
    dateto
  })

  if (clientid) params.set("clientid", clientid)
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
  if (selectedTestIds.length > bulkCertificateBatchSize) {
    alert(`Select no more than ${bulkCertificateBatchSize} certificates at a time.`)
    return
  }

  const params = getBulkCertificateFilterParams()
  if (!params) return

  params.set("testids", selectedTestIds.join(","))

  await downloadBulkCertificatesPdf(params)
}

window.downloadAllBulkCertificatesPdf = async function () {
  const loadedTestIds = (window.bulkCertificateResults || [])
    .map(certificate => certificate?.inspection?.testid)
    .filter(Boolean)
    .map(testid => String(testid))

  if (!loadedTestIds.length) {
    alert("No certificates found to download. Load certificates first.")
    return
  }

  const batches = []
  for (let index = 0; index < loadedTestIds.length; index += bulkCertificateBatchSize) {
    batches.push(loadedTestIds.slice(index, index + bulkCertificateBatchSize))
  }

  const downloadAllButton = document.querySelector('#bulkCertDownloadAllBtn')
  downloadAllButton.disabled = true

  try {
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      downloadAllButton.textContent = `Downloading Batch ${batchIndex + 1} of ${batches.length}...`
      const params = getBulkCertificateFilterParams()
      if (!params) return
      params.set("testids", batches[batchIndex].join(","))

      const downloaded = await downloadBulkCertificatesPdf(params, {
        batchNumber: batchIndex + 1,
        batchCount: batches.length
      })
      if (!downloaded) return
    }
  } finally {
    downloadAllButton.disabled = false
    downloadAllButton.textContent = batches.length > 1
      ? `Download All in ${batches.length} Batches`
      : "Download All Results as PDF"
  }
}

async function downloadBulkCertificatesPdf(params, batch = null) {
  const response = await fetch(
    `${API_BASE}/certificates/bulk-pdf?${params.toString()}`
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Unable to download bulk certificates"
    }))
    const details = Array.isArray(error.blocked) && error.blocked.length
      ? `\n\nFirst blocked certificate: ${error.blocked[0].testid || "Unknown"}`
      : ""
    alert((error.error || "Unable to download bulk certificates") + details)
    return false
  }

  const skippedCount = Number(response.headers.get("x-skipped-certificates") || 0)
  const blob = await response.blob()
  let filename = getDownloadFilename(
    response.headers.get("content-disposition"),
    "FB-Certificates.pdf"
  )
  if (batch?.batchCount > 1) {
    filename = filename.replace(/\.pdf$/i, `-Batch-${batch.batchNumber}-of-${batch.batchCount}.pdf`)
  }
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)

  if (skippedCount > 0) {
    alert(`${skippedCount} incomplete inspection${skippedCount === 1 ? " was" : "s were"} skipped. The remaining certificates were downloaded.`)
  }
  return true
}

function getDownloadFilename(contentDisposition, fallback) {
  const match = String(contentDisposition || "").match(/filename="?([^"]+)"?/i)
  return match ? match[1] : fallback
}

window.setCertificateRowsPerPage = function (value) {
  window.certRowsPerPage = Number(value) || 25
  window.certCurrentPage = 1
  window.searchCertificates(false)
}

window.rerenderCertificateResults = function () {
  window.certCurrentPage = 1
  window.searchCertificates(false)
}

window.goToCertificatePage = function (page) {
  window.certCurrentPage = Math.max(1, Number(page) || 1)
  window.searchCertificates(false)
}

function bindCertificateResultEvents() {
  const toggleDetails = button => {
    const row = button.closest('.certificate-worklist-row')
    const details = row?.querySelector('.certificate-worklist-details')
    if (!row || !details) return

    const expanded = details.hidden
    details.hidden = !expanded
    row.classList.toggle('expanded', expanded)
    row.querySelectorAll('.certificate-row-summary, .certificate-more-btn')
      .forEach(control => control.setAttribute('aria-expanded', String(expanded)))
  }

  document.querySelectorAll('.certificate-row-summary, .certificate-more-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      toggleDetails(button)
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
    .querySelectorAll('#certificateResults .certificate-worklist-row')
    .forEach(row => row.classList.remove('selected-certificate-row'))

  rowElement.classList.add('selected-certificate-row')

  window.previewCertificate(testid)
}

window.previewCertificate = async function (testid) {
  const panel = document.querySelector('#certificatePreviewPanel')

  if (!panel) return

  panel.innerHTML = `
    <h2>Certificate Preview</h2>
    <p>Loading certificate...</p>
  `

  const response = await fetch(certificateHtmlUrl(testid), {
    credentials: "include"
  })

  const { html, error } = await readCertificateHtml(response)

  if (!response.ok) {
    alert("Error loading certificate preview: " + error)
    panel.innerHTML = `
      <h2>Certificate Preview</h2>
      <p>Unable to load certificate preview.</p>
    `
    return
  }

  panel.innerHTML = `
    <h2>Certificate Preview</h2>

    <div class="certificate-preview-html-frame-wrap">
      <iframe
        class="certificate-preview-html-frame"
        title="Certificate ${escapeHtml(testid)} preview"
      ></iframe>
    </div>

    <div class="form-actions">
      <button type="button" id="previewOpenCertificateBtn">Open</button>
      <button type="button" id="previewPrintCertificateBtn">Print</button>
    </div>
  `

  const iframe = panel.querySelector("iframe")
  iframe.srcdoc = html

  document
    .querySelector('#previewOpenCertificateBtn')
    .addEventListener('click', () => window.openCertificateModal(testid))

  document
    .querySelector('#previewPrintCertificateBtn')
    .addEventListener('click', () => {
      window.printCertificatePdf(testid)
    })
}

window.openCertificateModal = async function (testid) {
  const response = await fetch(certificateHtmlUrl(testid), {
    credentials: "include"
  })

  const { html, error } = await readCertificateHtml(response)

  if (!response.ok) {
    alert("Error loading certificate: " + error)
    return
  }

  const existingModal = document.querySelector("#certificateModal")
  if (existingModal) existingModal.remove()

  const modal = document.createElement("div")
  modal.id = "certificateModal"
  modal.className = "certificate-modal-overlay"

  modal.innerHTML = `
    <div class="certificate-modal certificate-original-layout">

      <div class="certificate-modal-header screen-only">
        <h2>Certificate ${escapeHtml(testid)}</h2>
        <div class="form-actions">
          <a
            id="certificatePrintBtn"
            class="cert-action-link"
            href="${API_BASE}/inspections/${encodeURIComponent(testid)}/certificate.pdf?inline=1&t=${Date.now()}"
            target="_blank"
          >
            Print
          </a>
          <a
            id="certificateDownloadPdfBtn"
            class="cert-action-link"
            href="${API_BASE}/inspections/${encodeURIComponent(testid)}/certificate.pdf?t=${Date.now()}"
            download="certificate-${escapeHtml(testid)}.pdf"
          >
            Download PDF
          </a>
          <button type="button" id="certificateMailBtn">Mail</button>
          <button type="button" id="certificateCloseBtn">Close</button>
        </div>
      </div>

      <div class="certificate-modal-body" id="certificatePrintArea">
        <iframe
          class="certificate-modal-html-frame"
          title="Certificate ${escapeHtml(testid)}"
        ></iframe>
      </div>
    </div>
  `

  document.body.appendChild(modal)
  modal.querySelector("iframe").srcdoc = html

  document
    .querySelector('#certificateCloseBtn')
    .addEventListener('click', window.closeCertificateModal)

  document
    .querySelector('#certificateMailBtn')
    .addEventListener('click', () => {
      window.mailCertificate(testid)
    })
}

function renderCertificateDocument(certificate) {
  const inspection = certificate.inspection || {}
  const results = getCertificateResultsForDisplay(certificate.results || [], inspection)
  const inspectionPhotos = getCertificatePhotos(inspection, certificate.photos || [])
  const assetDetails = getCertificateAssetDetails(inspection)
  const certificateTitle = getCertificateTitle(inspection)
  const certificateRegulationNotes = getCertificateRegulationNotes(inspection)
  const layoutDensity = getCertificateLayoutDensity(results, assetDetails, inspectionPhotos.slice(0, 4))
  const pageMode = allowsTwoPageCertificate(inspection)
    ? "fb-cert-allow-two-pages"
    : "fb-cert-force-one-page"

  return `
    <div class="fb-cert-page fb-cert-layout-${layoutDensity} ${pageMode}">
      <img src="${assetUrl('header.jpg')}" class="fb-cert-header" alt="FB Cranes Header">

      <div class="fb-cert-title">
        <h1>${escapeHtml(certificateTitle)}</h1>
      </div>

      <div class="fb-cert-meta">
        <div>
          <strong>Certificate No:</strong>
          <span>${escapeHtml(inspection.testid)}</span>
        </div>

        <div>
          <strong>Tag Number:</strong>
          <span>${escapeHtml(inspection.tagnumber || "-")}</span>
        </div>

        <div>
          <strong>Status:</strong>
          <span class="${inspection.status === "SAFE" ? "status-safe" : "status-unsafe"}">
            ${escapeHtml(inspection.status || "-")}
          </span>
        </div>
      </div>

      <div class="fb-cert-section">
        <h3>Customer Details</h3>
        <div class="fb-cert-grid">
          <p><strong>Client:</strong> ${escapeHtml(inspection.clientname || "-")}</p>
          <p><strong>Site:</strong> ${escapeHtml(inspection.sitename || "-")}</p>
          <p><strong>Section:</strong> ${escapeHtml(inspection.sectionname || "-")}</p>
        </div>
      </div>

      <div class="fb-cert-section">
        <h3>Asset Details</h3>
        <div class="fb-cert-grid">
          <p><strong>Asset ID:</strong> ${escapeHtml(inspection.assetid || "-")}</p>
          <p><strong>Asset Tag No:</strong> ${escapeHtml(inspection.assettagno || "-")}</p>
          <p><strong>Equipment Type:</strong> ${escapeHtml(inspection.equipmenttype || "-")}</p>
          <p><strong>Description:</strong> ${escapeHtml(inspection.description || "-")}</p>
          <p class="fb-cert-serial-line"><strong>Serial No:</strong> <span>${escapeHtml(inspection.serialno || "-")}</span></p>
          <p><strong>Manufacturer:</strong> ${escapeHtml(inspection.manufacturer || "-")}</p>
        </div>
      </div>

      ${assetDetails.length ? `
        <div class="fb-cert-section">
          <h3>Asset Specifications</h3>
          <div class="fb-cert-grid">
            ${assetDetails.map(([label, value]) => `
              <p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <div class="fb-cert-section">
        <h3>Inspection Details</h3>
        <div class="fb-cert-grid">
          <p><strong>Inspection Type:</strong> ${escapeHtml(inspection.inspectiontype || "-")}</p>
          ${formatInspectionFrequency(inspection.inspectionfrequency) ? `<p><strong>Frequency:</strong> ${escapeHtml(formatInspectionFrequency(inspection.inspectionfrequency))}</p>` : ""}
          <p><strong>Inspection Date:</strong> ${escapeHtml(formatDate(inspection.testdate))}</p>
          <p><strong>Certificate Expiry Date:</strong> ${escapeHtml(formatDate(inspection.validdate))}</p>
          <p><strong>Inspector:</strong> ${escapeHtml(inspection.inspector || "-")}</p>
          <p><strong>LMI Number:</strong> ${escapeHtml(inspection.inspector_lmi_number || "-")}</p>
        </div>
      </div>

      <div class="fb-cert-section">
        <h3>Inspection Photos</h3>
        <div class="fb-cert-photo-grid">
          ${inspectionPhotos.length ? inspectionPhotos.slice(0, 4).map((photo, index) => `
            <div>
              <img src="${safeAttr(`${API_BASE}${photo.photo_path}`)}">
              <p>${escapeHtml(photo.photo_type ? photo.photo_type.replaceAll("_", " ") : `Photo ${index + 1}`)}</p>
              ${photo.caption ? `<p>${escapeHtml(photo.caption)}</p>` : ""}
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
                <td>${escapeHtml(row.criterianame || "")}</td>
                <td>
                  <strong class="${
                    getCertificateResultDisplay(row) === "YES" || getCertificateResultDisplay(row) === "PASS"
                      ? "status-safe"
                      : getCertificateResultDisplay(row) === "NO" || getCertificateResultDisplay(row) === "FAIL"
                        ? "status-unsafe"
                        : ""
                  }">
                    ${escapeHtml(getCertificateResultDisplay(row))}
                  </strong>
                </td>
                <td>${escapeHtml(row.assetvalue || "")}</td>
                <td>${escapeHtml(row.measuredvalue || "")}</td>
                <td>${escapeHtml(row.remarks || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="fb-cert-signature-section ${inspection.inspector_signature_image ? "fb-cert-signature-has-image" : "fb-cert-signature-manual"}">
        <div>
          <strong>Inspector Signature</strong>
          ${inspection.inspector_signature_image ? `
            <img
              class="fb-cert-signature-image"
              src="${safeAttr(`${API_BASE}${inspection.inspector_signature_image}`)}"
              alt="Inspector Signature"
            >
          ` : `<div class="fb-cert-signature-manual-space"></div>`}
          <div class="fb-cert-signature-line"></div>
        </div>
      </div>

      ${certificateRegulationNotes.map(note => `
        <p class="fb-cert-driven-note">
          ${escapeHtml(note)}
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

    const reasons = Array.isArray(error.reasons) && error.reasons.length
      ? `\n\nReason${error.reasons.length === 1 ? "" : "s"}:\n- ${error.reasons.join("\n- ")}`
      : ""

    alert("Error downloading certificate PDF: " + (error.error || "Unable to download certificate PDF") + reasons)
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
  if (!canVoidCertificates()) {
    alert("Only inspectors, managers, and administrators may mark certificates as entered in error.")
    return
  }

  const reason = window.prompt(
    `Why is certificate ${testid} being voided?\n\nThe inspection will be removed from normal lists but retained in the audit history.`,
    "Entered in error"
  )
  if (reason === null) return
  if (reason.trim().length < 3) {
    alert("Please enter a reason for voiding the certificate.")
    return
  }

  const response = await fetch(
    `${API_BASE}/certificates/${testid}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() })
    }
  )

  const data = await readCertificateJson(response)

  if (!response.ok) {
    alert(data.error || `Unable to void certificate ${testid}.`)
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
      <p>Certificate ${testid} was voided and retained in the audit history.</p>
    `
  }

  alert(`Certificate ${testid} was marked as entered in error.`)
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
  const isElectricRopeHoist = String(inspection.equiptypeid) === "105"
  return [
    ["WLL", inspection.wll ? `${inspection.wll} kg` : ""],
    ["Height of Lift", inspection.heightoflift ? `${inspection.heightoflift} mm` : ""],
    [isElectricRopeHoist ? "Number of Rope Falls" : "Number of Chain Falls", inspection.numberofchainfalls],
    ["OEM Top Hook Size", isElectricRopeHoist ? "" : (inspection.oemtophooksize ? `${inspection.oemtophooksize} mm` : "")],
    ["OEM Bottom Hook Size", inspection.oembottomhooksize ? `${inspection.oembottomhooksize} mm` : ""],
    [isElectricRopeHoist ? "Rope Size" : "Load Chain Diameter", inspection.loadchaindiameter ? `${inspection.loadchaindiameter} mm` : ""],
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

function getCertificateLayoutDensity(results = [], assetDetails = [], photos = []) {
  const contentWeight = results.length + Math.ceil(assetDetails.length / 2) + photos.length

  if (results.length <= 8 && contentWeight <= 14) return "spacious"
  if (results.length <= 16 && contentWeight <= 24) return "balanced"
  return "compact"
}

function allowsTwoPageCertificate(inspection = {}) {
  return inspection.inspectiontype !== "LOADTEST" &&
    String(inspection.equipgroupid || "") === "400"
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

function getCertificateRegulationNotes(inspection) {
  const notes = []
  const equiptypeid = String(inspection.equiptypeid || "")
  const equipgroupid = String(inspection.equipgroupid || "")

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

function formatDate(value) {
  if (!value) return "-"
  return String(value).split("T")[0]
}

function formatInspectionFrequency(value) {
  const normalized = String(value || "").toUpperCase()
  if (normalized === "ANNUAL") return "Annual"
  if (normalized === "FREQUENT") return "Frequent"
  return ""
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
  downloadSelectedBulkCertificatesPdf: window.downloadSelectedBulkCertificatesPdf,
  downloadAllBulkCertificatesPdf: window.downloadAllBulkCertificatesPdf,
  toggleBulkCertificateSelection: window.toggleBulkCertificateSelection,
  updateBulkCertificateButtons: window.updateBulkCertificateButtons
}


