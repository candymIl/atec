import { sortHeader, sortTableRows } from '../tableSort.js'
import { escapeHtml } from '../utils/security.js'

function assetSupportsLoadTest(asset) {
  if (['100', '400', '500'].includes(String(asset.equipgroupid || ''))) {
    return true
  }

  const criteria = window.atecCriteria || []

  return criteria.some(row =>
    String(row.equiptypeid) === String(asset.equiptypeid) &&
    String(row.inspectioncategory || row.inspection_category || '').toUpperCase() === 'LOADTEST' &&
    row.active !== false &&
    row.active !== 'false'
  )
}

export function renderAssetRow(asset) {
  const serialDisplay = asset.serialno || asset.hoistserialno || ''
  const canManageAssets = ['ADMIN', 'MANAGER', 'INSPECTOR'].includes(window.currentUser?.role)
  const assetid = escapeHtml(asset.assetid)
  const assetTag = escapeHtml(asset.assettagno || '')
  const serial = escapeHtml(serialDisplay)
  const hoistSerial = escapeHtml(asset.hoistserialno || '')
  const client = escapeHtml(asset.clientname || '')
  const site = escapeHtml(asset.sitename || '')
  const section = escapeHtml(asset.sectionname || '')
  const equipmentType = escapeHtml(asset.equipmenttype || '')
  const description = escapeHtml(asset.description || '')

  return `
    <tr>
      <td>${assetid}</td>
      <td>${assetTag}</td>
      <td>
        ${serial}
        ${asset.serialno && asset.hoistserialno && asset.serialno !== asset.hoistserialno ? `
          <br><small>Hoist: ${hoistSerial}</small>
        ` : ''}
      </td>
      <td>${client}</td>
      <td>${site}</td>
      <td>${section}</td>
      <td>${equipmentType}</td>
      <td>${description}</td>
      <td>
        <div class="action-buttons">
          ${canManageAssets ? `
            <button onclick="editAsset(${asset.assetid})">
              Edit
            </button>

            <button onclick="startInspection(${asset.assetid}, 'VISUAL', 'assets')">
              Inspect
            </button>

            ${assetSupportsLoadTest(asset) ? `
              <button
                class="load-test-btn"
                onclick="startInspection(${asset.assetid}, 'LOADTEST', 'assets')"
              >
                Load Test
              </button>
            ` : ''}
          ` : ''}

          <button class="history-btn" onclick="showAssetHistoryFromSetup(${asset.assetid})">
            History
          </button>

          <button class="qr-label-btn" onclick="openAssetQrLabel(${asset.assetid})">
            QR Label
          </button>

          ${canManageAssets ? `
            <button class="move-btn" onclick="showMoveAssetForm(${asset.assetid})">
              Move
            </button>

            <button onclick="archiveAsset(${asset.assetid})">
              Archive
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `
}

export function renderAssetSetup(assets, pageInfo = {}) {
  const serverPaged = pageInfo.serverPaged === true
  const sortedAssets = serverPaged ? assets : sortTableRows(assets, 'assets', {
    assetid: asset => asset.assetid,
    assettagno: asset => asset.assettagno,
    serialno: asset => asset.serialno || asset.hoistserialno,
    clientname: asset => asset.clientname,
    sitename: asset => asset.sitename,
    sectionname: asset => asset.sectionname,
    equipmenttype: asset => asset.equipmenttype,
    description: asset => asset.description,
    qrcode: asset => asset.qrcode
  }, 'assetid')
  const pageSize = window.assetRowsPerPage || 25
  const totalRows = serverPaged ? Number(pageInfo.total || 0) : sortedAssets.length
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const currentPage = Math.min(window.assetCurrentPage || 1, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const visibleAssets = serverPaged ? sortedAssets : sortedAssets.slice(startIndex, startIndex + pageSize)
  const endIndex = totalRows === 0 ? 0 : startIndex + visibleAssets.length
  const paginationBar = renderAssetPaginationBar(
    totalRows,
    startIndex,
    endIndex,
    currentPage,
    totalPages,
    pageSize,
    true
  )
  const bottomPaginationBar = renderAssetPaginationBar(
    totalRows,
    startIndex,
    endIndex,
    currentPage,
    totalPages,
    pageSize,
    false
  )

  document.querySelector('#page').innerHTML = `
    <h1>Asset Setup</h1>

    ${['ADMIN', 'MANAGER', 'INSPECTOR'].includes(window.currentUser?.role) ? `
      <div class="page-actions">
        <button onclick="showAddAssetForm()">
          Add Asset
        </button>
      </div>
    ` : ''}

    <div class="filter-card">
      <p>
        Total Assets:
        <strong>${totalRows}</strong>
      </p>

      <h2>Search Assets</h2>

      <div class="form-row">
        <div class="form-group">
          <label>Search By</label>

          <select id="assetSearchType" onchange="filterAssets(true)">
            <option value="all">All Fields</option>
            <option value="assetid">Asset ID</option>
            <option value="assettagno">Asset Tag</option>
            <option value="serialno">Serial No</option>
            <option value="hoistserialno">Hoist Serial No</option>
            <option value="clientname">Client</option>
            <option value="sitename">Site</option>
            <option value="sectionname">Section</option>
            <option value="equipmenttype">Equipment Type</option>
            <option value="description">Description</option>
            <option value="qrcode">QR Code</option>
          </select>
        </div>

        <div class="form-group">
          <label>Search Text</label>

          <input
            id="assetSearch"
            class="search-box"
            type="text"
            placeholder="Type search text..."
            onkeyup="filterAssets(true)"
          />
        </div>
      </div>

      <div class="filter-key-row">
        ${[
          ["all", "All"],
          ["assetid", "Asset ID"],
          ["assettagno", "Asset Tag"],
          ["serialno", "Serial No"],
          ["hoistserialno", "Hoist Serial No"],
          ["clientname", "Client"],
          ["sitename", "Site"],
          ["sectionname", "Section"],
          ["equipmenttype", "Equipment Type"],
          ["description", "Description"],
          ["qrcode", "QR Code"]
        ].map(([value, label]) => `
          <button type="button" class="filter-key-btn" onclick="setAssetFilterKey('${value}')">
            ${label}
          </button>
        `).join("")}
      </div>
    </div>

    ${paginationBar}

    <table>
      <thead>
        <tr>
          <th>${sortHeader('Asset ID', 'assets', 'assetid', 'showAssetSetup')}</th>
          <th>${sortHeader('Asset Tag', 'assets', 'assettagno', 'showAssetSetup')}</th>
          <th>${sortHeader('Serial No', 'assets', 'serialno', 'showAssetSetup')}</th>
          <th>${sortHeader('Client', 'assets', 'clientname', 'showAssetSetup')}</th>
          <th>${sortHeader('Site', 'assets', 'sitename', 'showAssetSetup')}</th>
          <th>${sortHeader('Section', 'assets', 'sectionname', 'showAssetSetup')}</th>
          <th>${sortHeader('Equipment Type', 'assets', 'equipmenttype', 'showAssetSetup')}</th>
          <th>${sortHeader('Description', 'assets', 'description', 'showAssetSetup')}</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody id="assetTableBody">
        ${visibleAssets.map(renderAssetRow).join('')}
      </tbody>
    </table>

    ${bottomPaginationBar}
  `
}

function renderAssetPaginationBar(totalRows, startIndex, endIndex, currentPage, totalPages, pageSize, showPageSize) {
  const pageButtons = renderAssetPageButtons(currentPage, totalPages)

  return `
    <div ${showPageSize ? 'id="assetPaginationControls"' : ''} class="report-pagination-bar asset-pagination-bar ${showPageSize ? '' : 'asset-pagination-bottom'}">
      ${showPageSize ? `
        <div class="report-page-size">
          <label for="assetRowsPerPage">Rows per page</label>
          <select id="assetRowsPerPage" onchange="setAssetRowsPerPage(this.value)">
            ${[25, 50, 100, 250].map(size => `
              <option value="${size}" ${size === pageSize ? "selected" : ""}>
                ${size}
              </option>
            `).join("")}
          </select>
        </div>
      ` : '<div></div>'}

      <div class="report-page-controls">
        <button type="button" onclick="changeAssetPage(-1)" ${currentPage <= 1 ? "disabled" : ""}>
          Previous
        </button>
        ${pageButtons}
        <button type="button" onclick="changeAssetPage(1)" ${currentPage >= totalPages ? "disabled" : ""}>
          Next
        </button>
        <span>Showing ${totalRows === 0 ? 0 : startIndex + 1} to ${endIndex} of ${totalRows} assets - Page ${currentPage} of ${totalPages}</span>
      </div>
    </div>
  `
}

function getAssetPageNumbers(currentPage, totalPages) {
  const pages = []

  if (totalPages <= 7) {
    for (let page = 1; page <= totalPages; page += 1) {
      pages.push(page)
    }

    return pages
  }

  pages.push(1)

  if (currentPage > 4) {
    pages.push("...")
  }

  const startPage = Math.max(2, currentPage - 1)
  const endPage = Math.min(totalPages - 1, currentPage + 1)

  for (let page = startPage; page <= endPage; page += 1) {
    pages.push(page)
  }

  if (currentPage < totalPages - 3) {
    pages.push("...")
  }

  pages.push(totalPages)

  return pages
}

function renderAssetPageButtons(currentPage, totalPages) {
  return getAssetPageNumbers(currentPage, totalPages).map(page => {
    if (page === "...") {
      return `<span class="pagination-ellipsis">...</span>`
    }

    return `
      <button
        type="button"
        class="pagination-page-btn ${page === currentPage ? "active" : ""}"
        onclick="goToAssetPage(${page})"
        ${page === currentPage ? "disabled" : ""}
      >
        ${page}
      </button>
    `
  }).join("")
}
