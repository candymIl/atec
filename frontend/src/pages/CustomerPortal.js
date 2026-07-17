import { API_BASE } from '../api.js'
import { escapeHtml } from '../utils/security.js'

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

function portalMetric(label, value, tone = "") {
  return `
    <div class="portal-metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(numberValue(value))}</strong>
    </div>
  `
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
              <a class="cert-action-link" href="${API_BASE}/inspections/${encodeURIComponent(row.testid)}/certificate.pdf" download>
                Download
              </a>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `
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
        ${portalMetric("Active Assets", assets.active_assets)}
        ${portalMetric("Sites", assets.active_sites)}
        ${portalMetric("Certificates", certificates.total_certificates)}
        ${portalMetric("Not Safe Assets", assets.not_safe_assets, numberValue(assets.not_safe_assets) ? "danger" : "")}
        ${portalMetric("Visual Overdue", assets.visual_overdue_assets, numberValue(assets.visual_overdue_assets) ? "warning" : "")}
        ${portalMetric("Load Test Overdue", assets.loadtest_overdue_assets, numberValue(assets.loadtest_overdue_assets) ? "warning" : "")}
        ${portalMetric("Expiring Soon", certificates.expiring_soon_certificates, numberValue(certificates.expiring_soon_certificates) ? "warning" : "")}
        ${portalMetric("Visit Outstanding", visits.outstanding_visit_assets, numberValue(visits.outstanding_visit_assets) ? "warning" : "")}
      </div>

      <div class="customer-portal-panels">
        <section class="filter-card">
          <h3>Certificate Status</h3>
          <div class="portal-mini-grid">
            ${portalMetric("Safe", certificates.safe_certificates)}
            ${portalMetric("Not Safe", certificates.not_safe_certificates, numberValue(certificates.not_safe_certificates) ? "danger" : "")}
            ${portalMetric("Expired", certificates.expired_certificates, numberValue(certificates.expired_certificates) ? "warning" : "")}
          </div>
        </section>

        <section class="filter-card">
          <h3>On-Site Visits</h3>
          <div class="portal-mini-grid">
            ${portalMetric("Active Visits", visits.active_visits)}
            ${portalMetric("Outstanding Items", visits.outstanding_visit_assets, numberValue(visits.outstanding_visit_assets) ? "warning" : "")}
            ${portalMetric("Completed 30 Days", visits.recently_completed_visits)}
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
    `
  } catch (err) {
    content.innerHTML = `<p class="login-error">Could not connect to the customer portal.</p>`
  }
}
