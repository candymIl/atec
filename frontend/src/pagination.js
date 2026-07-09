export function getPaginationState(rows, pageKey, pageSizeKey, defaultPageSize = 25) {
  const pageSize = window[pageSizeKey] || defaultPageSize
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(window[pageKey] || 1, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const visibleRows = rows.slice(startIndex, startIndex + pageSize)
  const endIndex = rows.length === 0 ? 0 : startIndex + visibleRows.length

  window[pageKey] = currentPage
  window[pageSizeKey] = pageSize

  return {
    currentPage,
    endIndex,
    pageSize,
    rows: visibleRows,
    startIndex,
    totalPages,
    totalRows: rows.length
  }
}

export function renderPaginationControls({
  currentPage,
  endIndex,
  label,
  onPage,
  onPageSize,
  pageSize,
  startIndex,
  totalPages,
  totalRows
}) {
  return `
    <div class="report-pagination-bar">
      <div class="report-page-size">
        <label>Rows per page</label>
        <select onchange="${onPageSize}(this.value)">
          ${[25, 50, 100, 250].map(size => `
            <option value="${size}" ${size === pageSize ? "selected" : ""}>
              ${size}
            </option>
          `).join("")}
        </select>
      </div>

      <div class="report-page-controls">
        <button type="button" onclick="${onPage}(${currentPage - 1})" ${currentPage <= 1 ? "disabled" : ""}>
          Previous
        </button>
        ${renderPageButtons(currentPage, totalPages, onPage)}
        <button type="button" onclick="${onPage}(${currentPage + 1})" ${currentPage >= totalPages ? "disabled" : ""}>
          Next
        </button>
        <span>Showing ${totalRows === 0 ? 0 : startIndex + 1} to ${endIndex} of ${totalRows} ${label} - Page ${currentPage} of ${totalPages}</span>
      </div>
    </div>
  `
}

function getPageNumbers(currentPage, totalPages) {
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

function renderPageButtons(currentPage, totalPages, onPage) {
  return getPageNumbers(currentPage, totalPages).map(page => {
    if (page === "...") return `<span class="pagination-ellipsis">...</span>`

    return `
      <button
        type="button"
        class="pagination-page-btn ${page === currentPage ? "active" : ""}"
        onclick="${onPage}(${page})"
        ${page === currentPage ? "disabled" : ""}
      >
        ${page}
      </button>
    `
  }).join("")
}
