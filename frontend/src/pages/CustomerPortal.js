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

function complianceDocumentState(expiryDate) {
  if (!expiryDate) return { label: "Current", className: "current" }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(`${formatDate(expiryDate)}T00:00:00`)
  const days = Math.ceil((expiry - today) / 86400000)
  if (days < 0) return { label: "Expired", className: "expired" }
  if (days <= 60) return { label: `Expires in ${days} day${days === 1 ? "" : "s"}`, className: "expiring" }
  return { label: "Current", className: "current" }
}

function renderPortalComplianceDocuments(rows = []) {
  if (!rows.length) return `<p class="portal-section-note">No company compliance documents are currently published.</p>`
  return `<div class="portal-compliance-grid">${rows.map(row => {
    const state = complianceDocumentState(row.expiry_date)
    return `<article class="portal-compliance-document">
      <div><span class="compliance-status ${state.className}">${escapeHtml(state.label)}</span><h4>${escapeHtml(row.title)}</h4></div>
      <dl>
        <div><dt>Reference</dt><dd>${escapeHtml(row.reference_number || "-")}</dd></div>
        <div><dt>Issued by</dt><dd>${escapeHtml(row.issuing_authority || "-")}</dd></div>
        <div><dt>Valid until</dt><dd>${escapeHtml(row.expiry_date ? formatDate(row.expiry_date) : "No expiry")}</dd></div>
      </dl>
      <button type="button" onclick="downloadPortalComplianceDocument(this, ${row.compliancedocumentid})">Download PDF</button>
    </article>`
  }).join("")}</div>`
}

async function downloadPortalComplianceDocument(button, documentId) {
  const originalLabel = button.textContent
  button.disabled = true
  button.textContent = "Downloading..."
  try {
    const response = await fetch(`${API_BASE}/customer-portal/compliance-documents/${documentId}/download`)
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error || "Unable to download document")
    }
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement("a")
    link.href = url
    link.download = `company-compliance-document-${documentId}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    alert(error.message)
  } finally {
    button.disabled = false
    button.textContent = originalLabel
  }
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
              <button type="button" class="customer-asset-history-link" onclick="openCustomerAssetHistory('${escapeHtml(row.assetid)}')">
                Asset ${escapeHtml(row.assetid || "-")}
              </button>
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

function historyMetric(label, value, tone = "") {
  return `
    <div class="customer-history-metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? 0)}</strong>
    </div>
  `
}

function historyInspectionType(value) {
  return String(value || "").toUpperCase() === "LOADTEST" ? "Load Test" : "Visual Inspection"
}

function renderCustomerAssetHistory(history) {
  const asset = history.asset || {}
  const summary = history.summary || {}
  const events = history.events || []

  return `
    <div class="customer-history-heading">
      <div>
        <p class="customer-history-eyebrow">Asset History Review</p>
        <h2>Asset ${escapeHtml(asset.assetid || "-")}</h2>
        <p>${escapeHtml(asset.description || asset.equipmenttype || "Asset inspection history")}</p>
      </div>
      <div class="form-actions customer-history-actions">
        <a class="cert-action-link" href="${API_BASE}/customer-portal/assets/${encodeURIComponent(asset.assetid)}/history.pdf" download>
          Download History PDF
        </a>
        <button type="button" class="secondary-btn" onclick="closeCustomerAssetHistory()">Close</button>
      </div>
    </div>

    <div class="customer-history-asset-grid">
      <p><span>Serial Number</span><strong>${escapeHtml(asset.serialno || "-")}</strong></p>
      <p><span>Equipment Type</span><strong>${escapeHtml(asset.equipmenttype || "-")}</strong></p>
      <p><span>Site</span><strong>${escapeHtml(asset.sitename || "-")}</strong></p>
      <p><span>Section</span><strong>${escapeHtml(asset.sectionname || "-")}</strong></p>
      <p><span>Responsible Person</span><strong>${escapeHtml(asset.responsiblename || "-")}</strong></p>
      <p><span>History Period</span><strong>${escapeHtml(formatDate(summary.firstInspectionDate))} to ${escapeHtml(formatDate(summary.latestInspectionDate))}</strong></p>
    </div>

    <div class="customer-history-metrics">
      ${historyMetric("Total Inspections", summary.totalInspections)}
      ${historyMetric("Visual Inspections", summary.visualInspections)}
      ${historyMetric("Load Tests", summary.loadTests)}
      ${historyMetric("Not Safe Outcomes", summary.notSafeOutcomes, summary.notSafeOutcomes ? "danger" : "")}
      ${historyMetric("Resolved Failures", summary.resolvedFailures, summary.resolvedFailures ? "success" : "")}
      ${historyMetric("Unresolved Failures", summary.unresolvedFailures, summary.unresolvedFailures ? "danger" : "")}
    </div>

    <div class="customer-history-current-status">
      <div><span>Current Visual Status</span><strong class="${statusClass(summary.currentVisualStatus)}">${escapeHtml(summary.currentVisualStatus || "NO VISUAL")}</strong></div>
      <div><span>Current Load Test Status</span><strong class="${statusClass(summary.currentLoadStatus)}">${escapeHtml(summary.currentLoadStatus || "NO LOAD TEST")}</strong></div>
    </div>

    <section class="customer-history-timeline-section">
      <h3>Inspection Timeline</h3>
      <p>Newest event first. A failure is cleared only by a later safe inspection of the same type.</p>
      <div class="customer-history-timeline">
        ${events.map(event => `
          <article class="customer-history-event ${event.status === "NOT SAFE" ? "is-danger" : "is-safe"}">
            <div class="customer-history-event-marker" aria-hidden="true"></div>
            <div class="customer-history-event-card">
              <div class="customer-history-event-heading">
                <div>
                  <span>${escapeHtml(formatDate(event.testdate))}</span>
                  <h4>${escapeHtml(historyInspectionType(event.inspectiontype))}</h4>
                </div>
                <strong class="${statusClass(event.status)}">${escapeHtml(event.status || "-")}</strong>
              </div>
              <div class="customer-history-event-meta">
                <span>Certificate ${escapeHtml(event.testid || "-")}</span>
                <span>Inspector: ${escapeHtml(event.inspector || "-")}</span>
                ${event.job_number ? `<span>Job: ${escapeHtml(event.job_number)}</span>` : ""}
              </div>

              ${event.status === "NOT SAFE" ? `
                <div class="customer-history-failures">
                  <h5>Recorded failure reason${event.failures?.length === 1 ? "" : "s"}</h5>
                  ${(event.failures?.length ? event.failures : [{ criteria: "Failure reason", result: "Not Safe", remarks: "Reason not recorded" }]).map(failure => `
                    <div>
                      <strong>${escapeHtml(failure.criteria || "Inspection criterion")}: ${escapeHtml(failure.result || "Failed")}</strong>
                      <p>${escapeHtml(failure.remarks || "Reason not recorded")}</p>
                    </div>
                  `).join("")}
                </div>
              ` : ""}

              ${event.resolvedBy ? `
                <p class="customer-history-recovery is-resolved">
                  Returned to safe by ${escapeHtml(historyInspectionType(event.inspectiontype))} certificate ${escapeHtml(event.resolvedBy.testid)} on ${escapeHtml(formatDate(event.resolvedBy.testdate))}${event.resolvedBy.daysToSafe === null ? "" : ` after ${escapeHtml(event.resolvedBy.daysToSafe)} day(s)`}.
                </p>
              ` : event.unresolved ? `
                <p class="customer-history-recovery is-unresolved">Unresolved Not Safe Event - no later safe inspection of the same type is recorded.</p>
              ` : event.resolvesTestIds?.length ? `
                <p class="customer-history-recovery is-resolved">This inspection returned ${escapeHtml(event.resolvesTestIds.length)} earlier ${escapeHtml(historyInspectionType(event.inspectiontype))} failure(s) to safe.</p>
              ` : ""}

              <a class="customer-history-certificate-link" href="${API_BASE}/inspections/${encodeURIComponent(event.testid)}/certificate.pdf" download>
                Download Certificate
              </a>
            </div>
          </article>
        `).join("") || `<p class="customer-history-empty">No inspection or load-test history is available for this asset.</p>`}
      </div>
    </section>
  `
}

async function openCustomerAssetHistory(assetid) {
  if (!assetid) return
  closeCustomerAssetHistory()
  const modal = document.createElement("div")
  modal.id = "customerAssetHistoryModal"
  modal.className = "customer-history-modal"
  modal.innerHTML = `
    <div class="customer-history-backdrop" onclick="closeCustomerAssetHistory()"></div>
    <div class="customer-history-dialog" role="dialog" aria-modal="true" aria-label="Asset history review">
      <div class="customer-history-loading">Loading asset history...</div>
    </div>
  `
  document.body.appendChild(modal)
  document.body.classList.add("modal-open")

  try {
    const response = await fetch(`${API_BASE}/customer-portal/assets/${encodeURIComponent(assetid)}/history`)
    const history = await response.json()
    if (!response.ok) throw new Error(history.error || "Unable to load asset history.")
    modal.querySelector(".customer-history-dialog").innerHTML = renderCustomerAssetHistory(history)
  } catch (error) {
    modal.querySelector(".customer-history-dialog").innerHTML = `
      <div class="customer-history-error">
        <h2>Unable to load asset history</h2>
        <p>${escapeHtml(error.message)}</p>
        <button type="button" onclick="closeCustomerAssetHistory()">Close</button>
      </div>
    `
  }
}

function closeCustomerAssetHistory() {
  document.querySelector("#customerAssetHistoryModal")?.remove()
  document.body.classList.remove("modal-open")
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
    const [response, complianceResponse] = await Promise.all([
      fetch(`${API_BASE}/customer-portal/summary`),
      fetch(`${API_BASE}/customer-portal/compliance-documents`)
    ])
    const data = await response.json()
    const complianceDocuments = await complianceResponse.json()

    if (!response.ok || !complianceResponse.ok) {
      content.innerHTML = `<p class="login-error">${escapeHtml(data.error || complianceDocuments.error || "Could not load the customer portal.")}</p>`
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
        ${portalMetric("Current Not Safe Assets", assets.not_safe_assets, numberValue(assets.not_safe_assets) ? "danger" : "", "openPortalAssets('NOT SAFE')")}
        ${portalMetric("Visual Overdue", assets.visual_overdue_assets, numberValue(assets.visual_overdue_assets) ? "warning" : "", "openPortalAssets('VISUAL OVERDUE')")}
        ${portalMetric("Load Test Overdue", assets.loadtest_overdue_assets, numberValue(assets.loadtest_overdue_assets) ? "warning" : "", "openPortalAssets('LOAD TEST OVERDUE')")}
        ${portalMetric("Expiring Soon", certificates.expiring_soon_certificates, numberValue(certificates.expiring_soon_certificates) ? "warning" : "", "openPortalCertificates()")}
        ${portalMetric("Visit Outstanding", visits.outstanding_visit_assets, numberValue(visits.outstanding_visit_assets) ? "warning" : "", "document.querySelector('.customer-portal-panels')?.scrollIntoView({ behavior: 'smooth' })")}
      </div>

      <div class="customer-portal-panels">
        <section class="filter-card">
          <h3>Certificate Records (Inspection History)</h3>
          <p class="portal-section-note">Each inspection certificate is counted. One asset can have multiple certificate records.</p>
          <div class="portal-mini-grid">
            ${portalMetric("Safe Certificates", certificates.safe_certificates, "", "openPortalCertificates('SAFE')")}
            ${portalMetric("Not Safe Certificates", certificates.not_safe_certificates, numberValue(certificates.not_safe_certificates) ? "danger" : "", "openPortalCertificates('NOT SAFE')")}
            ${portalMetric("Expired Certificates", certificates.expired_certificates, numberValue(certificates.expired_certificates) ? "warning" : "", "openPortalCertificates()")}
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

      <section id="portalComplianceDocuments" class="filter-card portal-compliance-section">
        <div class="customer-portal-section-heading">
          <div><h3>Company Compliance Documents</h3><p class="portal-section-note">Current ATEC registrations, standing letters and management-system certificates.</p></div>
        </div>
        ${renderPortalComplianceDocuments(complianceDocuments)}
      </section>

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
window.downloadPortalComplianceDocument = downloadPortalComplianceDocument
window.openPortalAssets = openPortalAssets
window.openPortalCertificates = openPortalCertificates
window.openCustomerAssetHistory = openCustomerAssetHistory
window.closeCustomerAssetHistory = closeCustomerAssetHistory

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
