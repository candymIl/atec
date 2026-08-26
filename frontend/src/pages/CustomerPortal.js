import { API_BASE } from '../api.js'
import { escapeHtml } from '../utils/security.js'

let portalAssetPage = 1
let portalAssetPageSize = 25
let portalAssetSortBy = "asset"
let portalAssetSortDirection = "asc"

function numberValue(value) {
  return Number(value || 0)
}

function formatDate(value) {
  if (!value) return "-"
  return String(value).split("T")[0]
}

function statusClass(status) {
  return status === "SAFE" ? "status-safe" : status === "NOT SAFE" ? "status-unsafe" : ""
}

function portalMetric(label, value, tone = "", action = "") {
  const tag = action ? "button" : "div"
  const actionAttributes = action
    ? ` type="button" class="portal-metric portal-metric-action ${tone}" onclick="${action}"`
    : ` class="portal-metric ${tone}"`

  return `
    <${tag}${actionAttributes}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(numberValue(value))}</strong>
    </${tag}>
  `
}

function openPortalAssets(status = "") {
  const statusSelect = document.querySelector("#portalAssetStatus")
  if (statusSelect) statusSelect.value = status
  portalAssetPage = 1
  loadPortalAssets()
  document.querySelector("#portalAssetResults")?.closest("section")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  })
}

function openPortalCertificates(status = "") {
  window.showCertificateSearch()
  const statusSelect = document.querySelector("#certStatus")
  if (statusSelect && status) statusSelect.value = status
  window.searchCertificates?.()
}

function renderRecentCertificates(rows = []) {
  if (!rows.length) {
    return `<p>No certificates found yet.</p>`
  }

  return `
    <table class="portal-certificate-table">
      <thead>
        <tr>
          <th>Certificate</th>
          <th>Asset</th>
          <th>Site</th>
          <th>Type</th>
          <th>Date</th>
          <th>Valid Until</th>
          <th>Status</th>
          <th>PDF</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td>${escapeHtml(row.testid)}</td>
            <td>
              <strong>${escapeHtml(row.assettagno || row.assetid || "-")}</strong>
              <span>${escapeHtml(row.description || row.serialno || "")}</span>
            </td>
            <td>${escapeHtml(row.sitename || "-")}</td>
            <td>${escapeHtml(row.inspectiontype || "-")}</td>
            <td>${escapeHtml(formatDate(row.testdate))}</td>
            <td>${escapeHtml(formatDate(row.validdate))}</td>
            <td><strong class="${statusClass(row.status)}">${escapeHtml(row.status || "-")}</strong></td>
            <td>
              <button type="button" class="cert-action-link" onclick="customerPortalDownloadCertificate(this, '${escapeHtml(row.testid)}')">
                Download
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `
}

function assetStatusClass(status) {
  if (status === "OK") return "is-ok"
  if (status === "NOT SAFE") return "is-danger"
  if (String(status || "").includes("OVERDUE")) return "is-warning"
  if (String(status || "").startsWith("NO ")) return "is-muted"
  return ""
}

function certificateLink(testid, label = "PDF") {
  if (!testid) return "-"

  return `
    <button type="button" class="cert-action-link" onclick="customerPortalDownloadCertificate(this, '${escapeHtml(testid)}')">
      ${escapeHtml(label)}
    </button>
  `
}

function portalAssetSortHeader(label, key) {
  const isActive = portalAssetSortBy === key
  const directionClass = isActive ? portalAssetSortDirection : ""

  return `
    <span class="user-table-heading">
      <span>${escapeHtml(label)}</span>
      <button
        type="button"
        class="user-sort-btn ${isActive ? `active ${directionClass}` : ""}"
        onclick="sortPortalAssets('${key}')"
        aria-label="Sort ${escapeHtml(label)} ${isActive && portalAssetSortDirection === "asc" ? "descending" : "ascending"}"
        title="Sort ${escapeHtml(label)}"
      ></button>
    </span>
  `
}

async function downloadPortalCertificate(button, testid) {
  if (!testid || button?.disabled) return

  const originalLabel = button?.textContent || "Download"
  if (button) {
    button.disabled = true
    button.textContent = "Preparing..."
  }

  try {
    const response = await fetch(
      `${API_BASE}/inspections/${encodeURIComponent(testid)}/certificate.pdf?t=${Date.now()}`
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: "Unable to download certificate PDF."
      }))
      const reasons = Array.isArray(error.reasons) && error.reasons.length
        ? `\n\n${error.reasons.join("\n")}`
        : ""
      throw new Error(`${error.error || "Unable to download certificate PDF."}${reasons}`)
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `certificate-${testid}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    alert(`Certificate download failed: ${error.message}`)
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalLabel
    }
  }
}

function renderPortalAssetsTable(rows = []) {
  if (!rows.length) {
    return `<p>No assets match the selected filters.</p>`
  }

  return `
    <table class="portal-asset-table">
      <thead>
        <tr>
          <th>${portalAssetSortHeader("Asset", "asset")}</th>
          <th>${portalAssetSortHeader("Site", "site")}</th>
          <th>${portalAssetSortHeader("Section", "section")}</th>
          <th>${portalAssetSortHeader("Equipment", "equipment")}</th>
          <th>${portalAssetSortHeader("Last Visual", "last_visual")}</th>
          <th>${portalAssetSortHeader("Last Load Test", "last_load_test")}</th>
          <th>${portalAssetSortHeader("Status", "status")}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td>
              <strong>${escapeHtml(row.assettagno || row.assetid || "-")}</strong>
              <span>${escapeHtml(row.description || "")}</span>
              <span>${escapeHtml(row.serialno || "")}</span>
            </td>
            <td>${escapeHtml(row.sitename || "-")}</td>
            <td>${escapeHtml(row.sectionname || "-")}</td>
            <td>${escapeHtml(row.equipmenttype || "-")}</td>
            <td>
              <strong class="${statusClass(row.visual_status)}">${escapeHtml(row.visual_status || "-")}</strong>
              <span>${escapeHtml(formatDate(row.visual_testdate))} / valid ${escapeHtml(formatDate(row.visual_validdate))}</span>
              ${certificateLink(row.visual_testid)}
            </td>
            <td>
              <strong class="${statusClass(row.loadtest_status)}">${escapeHtml(row.loadtest_status || "-")}</strong>
              <span>${escapeHtml(formatDate(row.loadtest_testdate))} / valid ${escapeHtml(formatDate(row.loadtest_validdate))}</span>
              ${certificateLink(row.loadtest_testid)}
            </td>
            <td>
              <span class="report-status-pill ${assetStatusClass(row.asset_status)}">
                ${escapeHtml(row.asset_status || "-")}
              </span>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `
}

function assetQuery() {
  const params = new URLSearchParams()
  const search = document.querySelector("#portalAssetSearch")?.value || ""
  const status = document.querySelector("#portalAssetStatus")?.value || ""

  if (search) params.set("search", search)
  if (status) params.set("status", status)
  params.set("page", String(portalAssetPage))
  params.set("limit", String(portalAssetPageSize))
  params.set("sortBy", portalAssetSortBy)
  params.set("sortDirection", portalAssetSortDirection)

  return params.toString()
}

async function loadPortalAssets() {
  const panel = document.querySelector("#portalAssetResults")
  if (!panel) return

  panel.innerHTML = `<p>Loading assets...</p>`

  try {
    const response = await fetch(`${API_BASE}/customer-portal/assets?${assetQuery()}`)
    const payload = await response.json()

    if (!response.ok) {
      panel.innerHTML = `<p class="login-error">${escapeHtml(payload.error || "Could not load assets.")}</p>`
      return
    }

    const page = Number(payload.page || 1)
    const totalPages = Number(payload.totalPages || 1)
    panel.innerHTML = `
      <div class="portal-asset-summary">
        <span>${escapeHtml(payload.total || 0)} assets</span>
        <span>Page ${escapeHtml(page)} of ${escapeHtml(totalPages)}</span>
      </div>
      ${renderPortalAssetsTable(payload.rows || [])}
      <div class="form-actions portal-asset-pagination">
        <button type="button" ${page <= 1 ? "disabled" : ""} onclick="portalAssetPreviousPage()">Previous</button>
        <button type="button" ${page >= totalPages ? "disabled" : ""} onclick="portalAssetNextPage()">Next</button>
      </div>
    `
  } catch (err) {
    panel.innerHTML = `<p class="login-error">Could not connect to the asset list.</p>`
  }
}

export async function renderCustomerPortal(currentUser = null) {
  document.querySelector("#page").innerHTML = `
    <div class="customer-portal-page">
      <div class="customer-portal-hero">
        <div>
          <h1>Customer Portal</h1>
          <p>Certificates, asset status and reports for your ATEC account.</p>
        </div>
      </div>

      <div id="customerPortalContent" class="filter-card">
        <p>Loading portal...</p>
      </div>
    </div>
  `

  const content = document.querySelector("#customerPortalContent")

  try {
    const response = await fetch(`${API_BASE}/customer-portal/summary`)
    const data = await response.json()

    if (!response.ok) {
      content.innerHTML = `<p class="login-error">${escapeHtml(data.error || "Could not load the customer portal.")}</p>`
      return
    }

    const assets = data.assetSummary || {}
    const certificates = data.certificateSummary || {}
    const visits = data.visitSummary || {}
    const customer = data.customer || {}

    content.className = "customer-portal-content"
    content.innerHTML = `
      <div class="customer-portal-heading">
        <div>
          <h2>${escapeHtml(customer.clientname || currentUser?.full_name || "Customer")}</h2>
          <p>${escapeHtml(customer.clientaddr || "")}</p>
        </div>
        <div class="form-actions">
          <button type="button" onclick="showCertificateSearch()">Certificates</button>
          <button type="button" onclick="showCustomerDetailedReport({ autoLoad: true })">Detailed Report</button>
        </div>
      </div>

      <div class="portal-metric-grid">
        ${portalMetric("Active Assets", assets.active_assets, "", "openPortalAssets()")}
        ${portalMetric("Sites", assets.active_sites, "", "openPortalAssets()")}
        ${portalMetric("Certificates", certificates.total_certificates, "", "openPortalCertificates()")}
        ${portalMetric("Not Safe Assets", assets.not_safe_assets, numberValue(assets.not_safe_assets) ? "danger" : "", "openPortalAssets('NOT SAFE')")}
        ${portalMetric("Visual Overdue", assets.visual_overdue_assets, numberValue(assets.visual_overdue_assets) ? "warning" : "", "openPortalAssets('VISUAL OVERDUE')")}
        ${portalMetric("Load Test Overdue", assets.loadtest_overdue_assets, numberValue(assets.loadtest_overdue_assets) ? "warning" : "", "openPortalAssets('LOAD TEST OVERDUE')")}
        ${portalMetric("Expiring Soon", certificates.expiring_soon_certificates, numberValue(certificates.expiring_soon_certificates) ? "warning" : "", "openPortalCertificates()")}
        ${portalMetric("Visit Outstanding", visits.outstanding_visit_assets, numberValue(visits.outstanding_visit_assets) ? "warning" : "", "document.querySelector('.customer-portal-panels')?.scrollIntoView({ behavior: 'smooth' })")}
      </div>

      <div class="customer-portal-panels">
        <section class="filter-card">
          <h3>Certificate Status</h3>
          <div class="portal-mini-grid">
            ${portalMetric("Safe", certificates.safe_certificates, "", "openPortalCertificates('SAFE')")}
            ${portalMetric("Not Safe", certificates.not_safe_certificates, numberValue(certificates.not_safe_certificates) ? "danger" : "", "openPortalCertificates('NOT SAFE')")}
            ${portalMetric("Expired", certificates.expired_certificates, numberValue(certificates.expired_certificates) ? "warning" : "", "openPortalCertificates()")}
          </div>
        </section>

        <section class="filter-card">
          <h3>On-Site Visits</h3>
          <div class="portal-mini-grid">
            ${portalMetric("Active Visits", visits.active_visits, "", "showCustomerDetailedReport({ autoLoad: true })")}
            ${portalMetric("Outstanding Items", visits.outstanding_visit_assets, numberValue(visits.outstanding_visit_assets) ? "warning" : "", "showCustomerDetailedReport({ autoLoad: true })")}
            ${portalMetric("Completed 30 Days", visits.recently_completed_visits, "", "showCustomerDetailedReport({ autoLoad: true })")}
          </div>
        </section>
      </div>

      <section class="filter-card">
        <div class="customer-portal-section-heading">
          <h3>Recent Certificates</h3>
          <button type="button" onclick="showCertificateSearch()">Search All</button>
        </div>
        ${renderRecentCertificates(data.recentCertificates || [])}
      </section>

      <section class="filter-card">
        <div class="customer-portal-section-heading">
          <h3>Assets</h3>
          <button type="button" onclick="loadPortalAssets()">Refresh</button>
        </div>
        <div class="portal-asset-filters">
          <input id="portalAssetSearch" type="search" placeholder="Search tag, serial, description, site...">
          <select id="portalAssetStatus">
            <option value="">All statuses</option>
            <option value="OK">OK</option>
            <option value="NOT SAFE">Not safe</option>
            <option value="VISUAL OVERDUE">Visual overdue</option>
            <option value="LOAD TEST OVERDUE">Load test overdue</option>
            <option value="NO VISUAL">No visual</option>
            <option value="NO LOAD TEST">No load test</option>
          </select>
          <select id="portalAssetPageSize">
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
          </select>
          <button type="button" onclick="searchPortalAssets()">Search</button>
        </div>
        <div id="portalAssetResults">
          <p>Loading assets...</p>
        </div>
      </section>
    `

    bindPortalAssetControls()
    loadPortalAssets()
  } catch (err) {
    content.innerHTML = `<p class="login-error">Could not connect to the customer portal.</p>`
  }
}

function bindPortalAssetControls() {
  document.querySelector("#portalAssetSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      window.searchPortalAssets()
    }
  })

  document.querySelector("#portalAssetStatus")?.addEventListener("change", window.searchPortalAssets)
  document.querySelector("#portalAssetPageSize")?.addEventListener("change", event => {
    portalAssetPageSize = Number(event.target.value) || 25
    window.searchPortalAssets()
  })
}

window.loadPortalAssets = loadPortalAssets
window.customerPortalDownloadCertificate = downloadPortalCertificate
window.openPortalAssets = openPortalAssets
window.openPortalCertificates = openPortalCertificates

window.searchPortalAssets = function () {
  portalAssetPage = 1
  loadPortalAssets()
}

window.portalAssetPreviousPage = function () {
  portalAssetPage = Math.max(1, portalAssetPage - 1)
  loadPortalAssets()
}

window.portalAssetNextPage = function () {
  portalAssetPage += 1
  loadPortalAssets()
}

window.sortPortalAssets = function (key) {
  const validKeys = ["asset", "site", "section", "equipment", "last_visual", "last_load_test", "status"]
  if (!validKeys.includes(key)) return

  portalAssetSortDirection = portalAssetSortBy === key && portalAssetSortDirection === "asc" ? "desc" : "asc"
  portalAssetSortBy = key
  portalAssetPage = 1
  loadPortalAssets()
}
