import { getTableSortState, sortHeader } from '../tableSort.js'
import { API_BASE } from '../api.js'
import { escapeHtml, safeAttr } from '../utils/security.js'

let currentReport = null
let currentReportPage = 1
let currentReportPageSize = 25
let reportSites = []
let reportSections = []
let reportResponsiblePersons = []

export function renderCustomerDetailedReport(customers = [], equipmentTypes = [], sites = [], sections = [], responsiblePersons = [], options = {}) {
  const isActive = item => item.archived !== true && item.archived !== 'true'
  customers = customers.filter(isActive)
  sites = sites.filter(isActive)
  sections = sections.filter(isActive)
  responsiblePersons = responsiblePersons.filter(isActive)
  reportSites = sites
  reportSections = sections
  reportResponsiblePersons = responsiblePersons
  const sortedCustomers = [...customers].sort((a, b) =>
    (a.clientname || "").localeCompare(b.clientname || "")
  )

  const sortedSites = [...sites].sort((a, b) =>
    (a.sitename || "").localeCompare(b.sitename || "")
  )

  const sortedSections = [...sections].sort((a, b) =>
    (a.sectionname || "").localeCompare(b.sectionname || "")
  )

  const seenResponsiblePersonIds = new Set()
  const sortedResponsiblePersons = [...responsiblePersons].filter(person => {
    const key = String(person.personid)
    if (seenResponsiblePersonIds.has(key)) return false
    seenResponsiblePersonIds.add(key)
    return true
  }).sort((a, b) =>
    (a.name || "").localeCompare(b.name || "")
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
                <option value="${safeAttr(customer.clientid)}">
                  ${escapeHtml(customer.clientname || `Customer ${customer.clientid}`)}
                </option>
              `).join("")}
            </select>
          </div>

        <div class="report-filter-control">
          <label for="customerReportSite">Site</label>
          <select id="customerReportSite">
            <option value="">All Sites</option>
            ${sortedSites.map(site => `
              <option value="${safeAttr(site.siteid)}">
                ${escapeHtml(site.sitename || `Site ${site.siteid}`)}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="report-filter-control">
          <label for="customerReportSection">Section</label>
          <select id="customerReportSection">
            <option value="">All Sections</option>
            ${sortedSections.map(section => `
              <option value="${safeAttr(section.sectionid)}">
                ${escapeHtml(section.sectionname || `Section ${section.sectionid}`)}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="report-filter-control">
          <label for="customerReportResponsible">Responsible Person</label>
          <select id="customerReportResponsible">
            <option value="">All Responsible Persons</option>
            ${sortedResponsiblePersons.map(person => `
              <option value="${safeAttr(person.personid)}">
                ${escapeHtml(person.name || `Person ${person.personid}`)}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="report-filter-control">
          <label for="customerReportEquipment">Equipment Type</label>
          <select id="customerReportEquipment">
            <option value="">All Equipment Types</option>
            ${sortedEquipmentTypes.map(type => `
              <option value="${safeAttr(type.equiptypeid)}">
                ${escapeHtml(type.description || `Equipment ${type.equiptypeid}`)}
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
              href="${API_BASE}/reports/customer-detailed.pdf"
              download
            >
              Download PDF
            </a>

            <a
              id="customerReportExcelLink"
              class="cert-action-link"
              href="${API_BASE}/reports/customer-detailed.xlsx"
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

  bindCustomerReportEvents()

  if (options?.clientid) {
    const customerSelect = document.querySelector("#customerReportClient")
    if (customerSelect) {
      customerSelect.value = String(options.clientid)
    }
  }

  refreshCustomerReportHierarchy()
  applyCustomerReportOptions(options)

  updateCustomerReportLinks()

  if (options?.autoLoad) {
    loadCustomerDetailedReport()
  }
}

function bindCustomerReportEvents() {
  document.querySelector("#customerReportClient")?.addEventListener("change", () => {
    refreshCustomerReportHierarchy({ resetSite: true, resetSection: true, resetResponsible: true })
    customerReportFilterChanged()
  })

  document.querySelector("#customerReportSite")?.addEventListener("change", () => {
    refreshCustomerReportHierarchy({ resetSection: true, resetResponsible: true })
    customerReportFilterChanged()
  })

  document.querySelector("#customerReportSection")?.addEventListener("change", () => {
    refreshCustomerReportHierarchy({ resetResponsible: true })
    customerReportFilterChanged()
  })

  document
    .querySelectorAll("#customerReportResponsible, #customerReportEquipment, #customerReportDateFrom, #customerReportDateTo")
    .forEach(input => {
      input.addEventListener("change", customerReportFilterChanged)
    })

  document
    .querySelector("#customerReportPreviewBtn")
    ?.addEventListener("click", () => {
      currentReportPage = 1
      loadCustomerDetailedReport()
    })
}

function applyCustomerReportOptions(options = {}) {
  const siteSelect = document.querySelector("#customerReportSite")
  if (options.siteid && siteSelect) {
    siteSelect.value = String(options.siteid)
    refreshCustomerReportHierarchy()
  }

  const sectionSelect = document.querySelector("#customerReportSection")
  if (options.sectionid && sectionSelect) {
    sectionSelect.value = String(options.sectionid)
    refreshCustomerReportHierarchy()
  }

  const optionValues = {
    customerReportResponsible: options.responsibleid,
    customerReportEquipment: options.equiptypeid,
    customerReportDateFrom: options.datefrom,
    customerReportDateTo: options.dateto
  }

  Object.entries(optionValues).forEach(([id, value]) => {
    if (value === undefined || value === null || value === "") return
    const input = document.querySelector(`#${id}`)
    if (input) input.value = String(value)
  })
}

function customerReportFilterChanged() {
  currentReportPage = 1
  updateCustomerReportLinks()
}

function refreshCustomerReportHierarchy(options = {}) {
  const customerSelect = document.querySelector("#customerReportClient")
  const siteSelect = document.querySelector("#customerReportSite")
  const sectionSelect = document.querySelector("#customerReportSection")
  const responsibleSelect = document.querySelector("#customerReportResponsible")
  if (!customerSelect || !siteSelect || !sectionSelect || !responsibleSelect) return

  const clientid = customerSelect.value
  const previousSite = options.resetSite ? "" : siteSelect.value
  const filteredSites = clientid
    ? reportSites.filter(site => String(site.clientid) === String(clientid))
    : reportSites

  siteSelect.innerHTML = reportFilterOptions(filteredSites, "siteid", "sitename", "All Sites")
  if (filteredSites.some(site => String(site.siteid) === String(previousSite))) {
    siteSelect.value = previousSite
  }

  const siteid = siteSelect.value
  const previousSection = options.resetSection ? "" : sectionSelect.value
  const filteredSections = reportSections.filter(section => {
    if (siteid) return String(section.siteid) === String(siteid)
    if (clientid) return String(section.clientid) === String(clientid)
    return true
  })

  sectionSelect.innerHTML = reportFilterOptions(filteredSections, "sectionid", "sectionname", "All Sections")
  if (filteredSections.some(section => String(section.sectionid) === String(previousSection))) {
    sectionSelect.value = previousSection
  }

  const sectionid = sectionSelect.value
  const allowedResponsibleIds = new Set(
    filteredSections
      .filter(section => !sectionid || String(section.sectionid) === String(sectionid))
      .map(section => String(section.responsibleid || ""))
      .filter(Boolean)
  )
  const previousResponsible = options.resetResponsible ? "" : responsibleSelect.value
  const filteredResponsible = reportResponsiblePersons.filter(person => {
    if (clientid && String(person.clientid) !== String(clientid)) return false
    if ((siteid || sectionid) && !allowedResponsibleIds.has(String(person.personid))) return false
    return true
  })

  responsibleSelect.innerHTML = reportFilterOptions(filteredResponsible, "personid", "name", "All Responsible Persons")
  if (filteredResponsible.some(person => String(person.personid) === String(previousResponsible))) {
    responsibleSelect.value = previousResponsible
  }
}

function reportFilterOptions(rows, valueKey, labelKey, allLabel) {
  const sortedRows = [...rows].sort((a, b) =>
    String(a[labelKey] || "").localeCompare(String(b[labelKey] || ""))
  )

  return `
    <option value="">${allLabel}</option>
    ${sortedRows.map(row => `
      <option value="${safeAttr(row[valueKey])}">${escapeHtml(row[labelKey] || "")}</option>
    `).join("")}
  `
}

function updateCustomerReportLinks() {
  const query = getCustomerReportQuery()

  const pdfLink = document.querySelector("#customerReportPdfLink")
  const excelLink = document.querySelector("#customerReportExcelLink")

  if (pdfLink) {
    pdfLink.href = `${API_BASE}/reports/customer-detailed.pdf${query}`
  }

  if (excelLink) {
    excelLink.href = `${API_BASE}/reports/customer-detailed.xlsx${query}`
  }
}

async function loadCustomerDetailedReport() {
  updateCustomerReportLinks()

  const query = getCustomerReportQuery({ includePagination: true })
  const preview = document.querySelector("#customerReportPreview")

  preview.className = "report-preview-empty"
  preview.innerHTML = `<div class="report-preview-empty">Loading report...</div>`

  const response = await fetch(`${API_BASE}/reports/customer-detailed${query}`)
  const report = await response.json()

  if (!response.ok) {
    preview.innerHTML = `
      <div class="report-preview-empty">
        Error loading report: ${escapeHtml(report.error || "Unknown error")}
      </div>
    `
    return
  }

  currentReport = null
  preview.className = "report-preview-loaded"
  currentReport = report
  renderCustomerReportPage()
}

window.updateCustomerReportLinks = updateCustomerReportLinks
window.loadCustomerDetailedReport = loadCustomerDetailedReport

function getCustomerReportQuery(options = {}) {
  const params = new URLSearchParams()
  const clientid = document.querySelector("#customerReportClient")?.value || ""
  const siteid = document.querySelector("#customerReportSite")?.value || ""
  const sectionid = document.querySelector("#customerReportSection")?.value || ""
  const responsibleid = document.querySelector("#customerReportResponsible")?.value || ""
  const equiptypeid = document.querySelector("#customerReportEquipment")?.value || ""
  const datefrom = document.querySelector("#customerReportDateFrom")?.value || ""
  const dateto = document.querySelector("#customerReportDateTo")?.value || ""

  if (clientid) params.append("clientid", clientid)
  if (siteid) params.append("siteid", siteid)
  if (sectionid) params.append("sectionid", sectionid)
  if (responsibleid) params.append("responsibleid", responsibleid)
  if (equiptypeid) params.append("equiptypeid", equiptypeid)
  if (datefrom) params.append("datefrom", datefrom)
  if (dateto) params.append("dateto", dateto)

  if (options.includePagination) {
    const sort = getTableSortState('customerReport', 'latestinspectiondate', 'desc')
    params.append("page", String(currentReportPage || 1))
    params.append("limit", String(currentReportPageSize || 25))
    params.append("sortKey", sort.key || "latestinspectiondate")
    params.append("sortDir", sort.direction || "desc")
  }

  const query = params.toString()
  return query ? `?${query}` : ""
}

function renderCustomerReportPreview(report) {
  const title =
    report.customers.length === 1
      ? escapeHtml(report.customers[0].clientname)
      : "All Customers"

  const pageSize = getReportPageSize()
  const pagination = report.pagination || {
    page: currentReportPage,
    limit: pageSize,
    total: report.assets.length,
    totalPages: Math.max(1, Math.ceil(report.assets.length / pageSize))
  }
  const totalPages = Math.max(1, Number(pagination.totalPages || 1))
  const currentPage = Math.min(Number(pagination.page || currentReportPage || 1), totalPages)
  const totalRows = Number(pagination.total || report.assets.length)
  const startIndex = (currentPage - 1) * Number(pagination.limit || pageSize)
  const rows = report.assets || []
  const endIndex = totalRows === 0 ? 0 : startIndex + rows.length

  return `
    <div class="report-summary-card">
      <div class="report-summary-heading">
        <div>
          <h2>${title}</h2>
          <p>Generated ${formatReportDate(report.generatedAt)}</p>
        </div>

        <div class="report-count-note">
          ${totalRows} assets in report
        </div>
      </div>

      <div class="report-summary-grid">
        ${summaryTile("Customers", report.summary.customers)}
        ${summaryTile("Assets", report.summary.assets)}
        ${summaryTile("Active Assets", report.summary.activeAssets)}
        ${summaryTile("OK", report.summary.safeAssets)}
        ${summaryTile("Not Safe", report.summary.notSafeAssets)}
        ${summaryTile("Incomplete", report.summary.incompleteInspectionAssets)}
        ${summaryTile("Missing Metadata", report.summary.missingCertificateMetadataAssets)}
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
          <p>Showing ${totalRows === 0 ? 0 : startIndex + 1} to ${endIndex} of ${totalRows} assets. Use PDF or Excel for the full detailed report.</p>
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
          ${renderCustomerReportPageButtons(currentPage, totalPages)}
          <button id="reportNextPageBtn" type="button" ${currentPage >= totalPages ? "disabled" : ""}>
            Next
          </button>
          <span>Page ${currentPage} of ${totalPages}</span>
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
              <th>${sortHeader('Customer', 'customerReport', 'clientname', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Asset ID', 'customerReport', 'assetid', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Asset Tag', 'customerReport', 'assettagno', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Serial No', 'customerReport', 'serialno', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Site', 'customerReport', 'sitename', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Section', 'customerReport', 'sectionname', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Responsible Person', 'customerReport', 'responsiblename', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Equipment Type', 'customerReport', 'equipmenttype', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Description', 'customerReport', 'description', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Latest Inspection', 'customerReport', 'latestinspectiondate', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Last Visual', 'customerReport', 'visualtestdate', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Visual Status', 'customerReport', 'visualstatus', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Last Load', 'customerReport', 'loadtestdate', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Load Status', 'customerReport', 'loadstatus', 'rerenderCustomerReport')}</th>
              <th>${sortHeader('Report Status', 'customerReport', 'reportstatus', 'rerenderCustomerReport')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${escapeHtml(row.clientname || "-")}</td>
                <td>${escapeHtml(row.assetid || "-")}</td>
                <td>${escapeHtml(row.assettagno || "-")}</td>
                <td>${escapeHtml(row.serialno || "-")}</td>
                <td>${escapeHtml(row.sitename || "-")}</td>
                <td>${escapeHtml(row.sectionname || "-")}</td>
                <td>${escapeHtml(row.responsiblename || "-")}</td>
                <td>${escapeHtml(row.equipmenttype || "-")}</td>
                <td>${escapeHtml(row.description || "-")}</td>
                <td>${formatReportDate(row.latestinspectiondate)}</td>
                <td>${formatReportDate(row.visualtestdate)}</td>
                <td class="${statusClass(row.visualstatus)}">${escapeHtml(row.visualstatus || "-")}</td>
                <td>${formatReportDate(row.loadtestdate)}</td>
                <td class="${statusClass(row.loadstatus)}">${escapeHtml(row.loadstatus || "-")}</td>
                <td>
                  <span class="report-status-pill ${reportStatusClass(row.reportstatus)}">
                    ${escapeHtml(row.reportstatus || "-")}
                  </span>
                </td>
              </tr>
            `).join("") || `
              <tr>
                <td colspan="15">No assets found for this report.</td>
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
      loadCustomerDetailedReport()
    })

  document
    .querySelector("#reportPrevPageBtn")
    ?.addEventListener("click", () => {
      currentReportPage = Math.max(1, currentReportPage - 1)
      loadCustomerDetailedReport()
    })

  document
    .querySelector("#reportNextPageBtn")
    ?.addEventListener("click", () => {
      const totalPages = currentReport?.pagination?.totalPages || 1

      currentReportPage = Math.min(totalPages, currentReportPage + 1)
      loadCustomerDetailedReport()
    })
}

function getCustomerReportPageNumbers(currentPage, totalPages) {
  const pages = []

  if (totalPages <= 10) {
    for (let page = 1; page <= totalPages; page += 1) pages.push(page)
    return pages
  }

  const visibleWindow = 9
  const halfWindow = Math.floor(visibleWindow / 2)
  let startPage = Math.max(1, currentPage - halfWindow)
  let endPage = Math.min(totalPages, startPage + visibleWindow - 1)

  if (endPage - startPage + 1 < visibleWindow) {
    startPage = Math.max(1, endPage - visibleWindow + 1)
  }

  if (startPage > 1) {
    pages.push(1)
    if (startPage > 2) pages.push("...")
  }

  for (let page = startPage; page <= endPage; page += 1) pages.push(page)

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) pages.push("...")
    pages.push(totalPages)
  }

  return pages
}

function renderCustomerReportPageButtons(currentPage, totalPages) {
  return getCustomerReportPageNumbers(currentPage, totalPages).map(page => {
    if (page === "...") return `<span class="pagination-ellipsis">...</span>`

    return `
      <button
        type="button"
        class="pagination-page-btn ${page === currentPage ? "active" : ""}"
        onclick="goToCustomerReportPage(${page})"
        ${page === currentPage ? "disabled" : ""}
      >
        ${page}
      </button>
    `
  }).join("")
}

window.goToCustomerReportPage = function (page) {
  currentReportPage = Math.max(1, Number(page) || 1)
  loadCustomerDetailedReport()
}

window.rerenderCustomerReport = function () {
  currentReportPage = 1
  loadCustomerDetailedReport()
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


