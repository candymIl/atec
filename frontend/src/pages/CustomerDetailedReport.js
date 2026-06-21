let currentReport = null
let currentReportPage = 1
let currentReportPageSize = 25

export function renderCustomerDetailedReport(customers = [], equipmentTypes = []) {
  const sortedCustomers = [...customers].sort((a, b) =>
    (a.clientname || "").localeCompare(b.clientname || "")
  )

  const sortedEquipmentTypes = [...equipmentTypes].sort((a, b) =>
    (a.description || "").localeCompare(b.description || "")
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
          <select id="customerReportClient">
              <option value="">All Customers</option>
              ${sortedCustomers.map(customer => `
                <option value="${customer.clientid}">
                  ${customer.clientname || `Customer ${customer.clientid}`}
                </option>
              `).join("")}
            </select>
          </div>

        <div class="report-filter-control">
          <label for="customerReportEquipment">Equipment Type</label>
          <select id="customerReportEquipment">
            <option value="">All Equipment Types</option>
            ${sortedEquipmentTypes.map(type => `
              <option value="${type.equiptypeid}">
                ${type.description || `Equipment ${type.equiptypeid}`}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="report-filter-control">
          <label for="customerReportDateFrom">Inspection Date From</label>
          <input id="customerReportDateFrom" type="date">
        </div>

        <div class="report-filter-control">
          <label for="customerReportDateTo">Inspection Date To</label>
          <input id="customerReportDateTo" type="date">
        </div>

        <div class="report-toolbar-actions">
            <button id="customerReportPreviewBtn" type="button">
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
  bindCustomerReportEvents()
}

function bindCustomerReportEvents() {
  document
    .querySelectorAll("#customerReportClient, #customerReportEquipment, #customerReportDateFrom, #customerReportDateTo")
    .forEach(input => {
      input.addEventListener("change", updateCustomerReportLinks)
    })

  document
    .querySelector("#customerReportPreviewBtn")
    ?.addEventListener("click", loadCustomerDetailedReport)
}

function updateCustomerReportLinks() {
  const query = getCustomerReportQuery()

  const pdfLink = document.querySelector("#customerReportPdfLink")
  const excelLink = document.querySelector("#customerReportExcelLink")

  if (pdfLink) {
    pdfLink.href = `http://localhost:5000/reports/customer-detailed.pdf${query}`
  }

  if (excelLink) {
    excelLink.href = `http://localhost:5000/reports/customer-detailed.xlsx${query}`
  }
}

async function loadCustomerDetailedReport() {
  updateCustomerReportLinks()

  const query = getCustomerReportQuery()
  const preview = document.querySelector("#customerReportPreview")

  preview.className = "report-preview-empty"
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

  currentReport = null
  currentReportPage = 1
  currentReportPageSize = 25
  preview.className = "report-preview-loaded"
  currentReport = report
  renderCustomerReportPage()
}

window.updateCustomerReportLinks = updateCustomerReportLinks
window.loadCustomerDetailedReport = loadCustomerDetailedReport

function getCustomerReportQuery() {
  const params = new URLSearchParams()
  const clientid = document.querySelector("#customerReportClient")?.value || ""
  const equiptypeid = document.querySelector("#customerReportEquipment")?.value || ""
  const datefrom = document.querySelector("#customerReportDateFrom")?.value || ""
  const dateto = document.querySelector("#customerReportDateTo")?.value || ""

  if (clientid) params.append("clientid", clientid)
  if (equiptypeid) params.append("equiptypeid", equiptypeid)
  if (datefrom) params.append("datefrom", datefrom)
  if (dateto) params.append("dateto", dateto)

  const query = params.toString()
  return query ? `?${query}` : ""
}

function renderCustomerReportPreview(report) {
  const title =
    report.customers.length === 1
      ? report.customers[0].clientname
      : "All Customers"

  const pageSize = getReportPageSize()
  const totalPages = Math.max(1, Math.ceil(report.assets.length / pageSize))
  const currentPage = Math.min(currentReportPage, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const rows = report.assets.slice(startIndex, startIndex + pageSize)
  const endIndex = report.assets.length === 0
    ? 0
    : startIndex + rows.length

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
          <p>Showing ${report.assets.length === 0 ? 0 : startIndex + 1} to ${endIndex} of ${report.assets.length} assets. Use PDF or Excel for the full detailed report.</p>
        </div>
      </div>

      <div class="report-pagination-bar">
        <div class="report-page-size">
          <label for="reportRowsPerPage">Rows per page</label>
          <select id="reportRowsPerPage">
            ${[25, 50, 100, 250].map(size => `
              <option value="${size}" ${size === pageSize ? "selected" : ""}>
                ${size}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="report-page-controls">
          <button id="reportPrevPageBtn" type="button" ${currentPage <= 1 ? "disabled" : ""}>
            Previous
          </button>
          <span>Page ${currentPage} of ${totalPages}</span>
          <button id="reportNextPageBtn" type="button" ${currentPage >= totalPages ? "disabled" : ""}>
            Next
          </button>
        </div>
      </div>

      <div class="report-scroll-control">
        <span>Left</span>
        <input id="reportTableSlider" type="range" min="0" max="0" value="0" step="1">
        <span>Right</span>
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
              <th>Latest Inspection</th>
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
                <td>${formatReportDate(row.latestinspectiondate)}</td>
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
                <td colspan="14">No assets found for this report.</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function renderCustomerReportPage() {
  const preview = document.querySelector("#customerReportPreview")

  if (!preview || !currentReport) return

  preview.innerHTML = renderCustomerReportPreview(currentReport)
  bindReportPagination()
  bindReportSlider()
}

function bindReportPagination() {
  document
    .querySelector("#reportRowsPerPage")
    ?.addEventListener("change", event => {
      currentReportPageSize = Number(event.target.value) || 25
      currentReportPage = 1
      renderCustomerReportPage()
    })

  document
    .querySelector("#reportPrevPageBtn")
    ?.addEventListener("click", () => {
      currentReportPage = Math.max(1, currentReportPage - 1)
      renderCustomerReportPage()
    })

  document
    .querySelector("#reportNextPageBtn")
    ?.addEventListener("click", () => {
      const totalPages = currentReport
        ? Math.max(1, Math.ceil(currentReport.assets.length / getReportPageSize()))
        : 1

      currentReportPage = Math.min(totalPages, currentReportPage + 1)
      renderCustomerReportPage()
    })
}

function getReportPageSize() {
  return currentReportPageSize || 25
}

function bindReportSlider() {
  const slider = document.querySelector("#reportTableSlider")
  const tableWrap = document.querySelector(".report-table-wrap")

  if (!slider || !tableWrap) return

  const updateSliderRange = () => {
    const maxScroll = Math.max(0, tableWrap.scrollWidth - tableWrap.clientWidth)

    slider.max = String(maxScroll)
    slider.value = String(Math.min(tableWrap.scrollLeft, maxScroll))
    slider.disabled = maxScroll === 0
  }

  updateSliderRange()

  slider.addEventListener("input", () => {
    tableWrap.scrollLeft = Number(slider.value)
  })

  tableWrap.addEventListener("scroll", () => {
    slider.value = String(tableWrap.scrollLeft)
  })

  window.addEventListener("resize", updateSliderRange, { once: true })
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
