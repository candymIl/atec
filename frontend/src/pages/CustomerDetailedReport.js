export function renderCustomerDetailedReport(customers = []) {
  const sortedCustomers = [...customers].sort((a, b) =>
    (a.clientname || "").localeCompare(b.clientname || "")
  )

  document.querySelector("#page").innerHTML = `
    <div class="report-page">
      <div class="report-hero">
        <div>
          <h1>Customer Detailed Report</h1>
          <p>Review customer assets, latest inspection status and due items in one place.</p>
        </div>
      </div>

      <div class="report-toolbar">
        <div class="report-filter-control">
          <label for="customerReportClient">Customer</label>
          <select id="customerReportClient" onchange="updateCustomerReportLinks()">
              <option value="">All Customers</option>
              ${sortedCustomers.map(customer => `
                <option value="${customer.clientid}">
                  ${customer.clientname || `Customer ${customer.clientid}`}
                </option>
              `).join("")}
            </select>
          </div>

        <div class="report-toolbar-actions">
            <button type="button" onclick="loadCustomerDetailedReport()">
              Preview Report
            </button>

            <a
              id="customerReportPdfLink"
              class="cert-action-link"
              href="http://localhost:5000/reports/customer-detailed.pdf"
              download
            >
              Download PDF
            </a>

            <a
              id="customerReportExcelLink"
              class="cert-action-link"
              href="http://localhost:5000/reports/customer-detailed.xlsx"
              download
            >
              Export Excel
            </a>
          </div>
        </div>

      <div id="customerReportPreview" class="report-preview-empty">
        <h2>No report preview yet</h2>
        <p>Select a customer or leave it on All Customers, then preview the report.</p>
      </div>
    </div>
  `

  updateCustomerReportLinks()
}

window.updateCustomerReportLinks = function () {
  const clientid = document.querySelector("#customerReportClient")?.value || ""
  const query = clientid ? `?clientid=${encodeURIComponent(clientid)}` : ""

  const pdfLink = document.querySelector("#customerReportPdfLink")
  const excelLink = document.querySelector("#customerReportExcelLink")

  if (pdfLink) {
    pdfLink.href = `http://localhost:5000/reports/customer-detailed.pdf${query}`
  }

  if (excelLink) {
    excelLink.href = `http://localhost:5000/reports/customer-detailed.xlsx${query}`
  }
}

window.loadCustomerDetailedReport = async function () {
  updateCustomerReportLinks()

  const clientid = document.querySelector("#customerReportClient")?.value || ""
  const query = clientid ? `?clientid=${encodeURIComponent(clientid)}` : ""
  const preview = document.querySelector("#customerReportPreview")

  preview.innerHTML = `<div class="report-preview-empty">Loading report...</div>`

  const response = await fetch(`http://localhost:5000/reports/customer-detailed${query}`)
  const report = await response.json()

  if (!response.ok) {
    preview.innerHTML = `
      <div class="report-preview-empty">
        Error loading report: ${report.error || "Unknown error"}
      </div>
    `
    return
  }

  preview.innerHTML = renderCustomerReportPreview(report)
}

function renderCustomerReportPreview(report) {
  const title =
    report.customers.length === 1
      ? report.customers[0].clientname
      : "All Customers"

  const rows = report.assets.slice(0, 80)

  return `
    <div class="report-summary-card">
      <div class="report-summary-heading">
        <div>
          <h2>${title}</h2>
          <p>Generated ${formatReportDate(report.generatedAt)}</p>
        </div>

        <div class="report-count-note">
          ${report.assets.length} assets in report
        </div>
      </div>

      <div class="report-summary-grid">
        ${summaryTile("Customers", report.summary.customers)}
        ${summaryTile("Assets", report.summary.assets)}
        ${summaryTile("Active Assets", report.summary.activeAssets)}
        ${summaryTile("OK", report.summary.safeAssets)}
        ${summaryTile("Not Safe", report.summary.notSafeAssets)}
        ${summaryTile("Visual Overdue", report.summary.visualOverdueAssets)}
        ${summaryTile("Load Overdue", report.summary.loadOverdueAssets)}
        ${summaryTile("No Visual", report.summary.noVisualAssets)}
        ${summaryTile("No Load Test", report.summary.noLoadAssets)}
      </div>
    </div>

    <div class="report-detail-card">
      <div class="report-detail-heading">
        <div>
          <h2>Asset Detail Preview</h2>
          <p>Showing ${rows.length} of ${report.assets.length} assets. Use PDF or Excel for the full detailed report.</p>
        </div>
      </div>

      <div class="report-table-wrap">
        <table class="report-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Asset ID</th>
              <th>Asset Tag</th>
              <th>Serial No</th>
              <th>Site</th>
              <th>Section</th>
              <th>Equipment Type</th>
              <th>Description</th>
              <th>Last Visual</th>
              <th>Visual Status</th>
              <th>Last Load</th>
              <th>Load Status</th>
              <th>Report Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${row.clientname || "-"}</td>
                <td>${row.assetid || "-"}</td>
                <td>${row.assettagno || "-"}</td>
                <td>${row.serialno || "-"}</td>
                <td>${row.sitename || "-"}</td>
                <td>${row.sectionname || "-"}</td>
                <td>${row.equipmenttype || "-"}</td>
                <td>${row.description || "-"}</td>
                <td>${formatReportDate(row.visualtestdate)}</td>
                <td class="${statusClass(row.visualstatus)}">${row.visualstatus || "-"}</td>
                <td>${formatReportDate(row.loadtestdate)}</td>
                <td class="${statusClass(row.loadstatus)}">${row.loadstatus || "-"}</td>
                <td>
                  <span class="report-status-pill ${reportStatusClass(row.reportstatus)}">
                    ${row.reportstatus || "-"}
                  </span>
                </td>
              </tr>
            `).join("") || `
              <tr>
                <td colspan="13">No assets found for this report.</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function summaryTile(label, value) {
  return `
    <div class="report-summary-tile">
      <span>${label}</span>
      <strong>${value ?? 0}</strong>
    </div>
  `
}

function statusClass(status) {
  if (status === "SAFE" || status === "OK") return "status-safe"
  if (status === "NOT SAFE") return "status-unsafe"
  return ""
}

function reportStatusClass(status) {
  if (status === "OK") return "is-ok"
  if (status === "NOT SAFE") return "is-danger"
  if ((status || "").includes("OVERDUE")) return "is-warning"
  if ((status || "").includes("NO ")) return "is-muted"
  return ""
}

function formatReportDate(value) {
  if (!value) return "-"
  return String(value).split("T")[0]
}
