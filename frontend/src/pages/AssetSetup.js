import { sortHeader, sortTableRows } from '../tableSort.js'

export function renderAssetSetup(assets) {
  const sortedAssets = sortTableRows(assets, 'assets', {
    assetid: asset => asset.assetid,
    assettagno: asset => asset.assettagno,
    serialno: asset => asset.serialno,
    clientname: asset => asset.clientname,
    sitename: asset => asset.sitename,
    sectionname: asset => asset.sectionname,
    equipmenttype: asset => asset.equipmenttype,
    description: asset => asset.description
  }, 'assetid')
  const pageSize = window.assetRowsPerPage || 25
  const totalPages = Math.max(1, Math.ceil(sortedAssets.length / pageSize))
  const currentPage = Math.min(window.assetCurrentPage || 1, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const visibleAssets = sortedAssets.slice(startIndex, startIndex + pageSize)
  const endIndex = sortedAssets.length === 0 ? 0 : startIndex + visibleAssets.length
  const pageButtons = renderAssetPageButtons(currentPage, totalPages)

  document.querySelector('#page').innerHTML = `
    <h1>Asset Setup</h1>

    <div class="page-actions">
      <button onclick="showAddAssetForm()">
        Add Asset
      </button>
    </div>

    <div class="filter-card">
      <p>
        Total Assets:
        <strong>${sortedAssets.length}</strong>
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
            <option value="clientname">Client</option>
            <option value="sitename">Site</option>
            <option value="sectionname">Section</option>
            <option value="equipmenttype">Equipment Type</option>
            <option value="description">Description</option>
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
          ["clientname", "Client"],
          ["sitename", "Site"],
          ["sectionname", "Section"],
          ["equipmenttype", "Equipment Type"],
          ["description", "Description"]
        ].map(([value, label]) => `
          <button type="button" class="filter-key-btn" onclick="setAssetFilterKey('${value}')">
            ${label}
          </button>
        `).join("")}
      </div>
    </div>

    <div id="assetPaginationControls" class="report-pagination-bar asset-pagination-bar">
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

      <div class="report-page-controls">
        <button type="button" onclick="changeAssetPage(-1)" ${currentPage <= 1 ? "disabled" : ""}>
          Previous
        </button>
        ${pageButtons}
        <button type="button" onclick="changeAssetPage(1)" ${currentPage >= totalPages ? "disabled" : ""}>
          Next
        </button>
        <span>Showing ${sortedAssets.length === 0 ? 0 : startIndex + 1} to ${endIndex} of ${sortedAssets.length} assets - Page ${currentPage} of ${totalPages}</span>
      </div>
    </div>

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
        ${visibleAssets.map(asset => `
          <tr>
            <td>${asset.assetid}</td>
            <td>${asset.assettagno || ''}</td>
            <td>${asset.serialno || ''}</td>
            <td>${asset.clientname || ''}</td>
            <td>${asset.sitename || ''}</td>
            <td>${asset.sectionname || ''}</td>
            <td>${asset.equipmenttype || ''}</td>
            <td>${asset.description || ''}</td>
            <td>
              <div class="action-buttons">
                <button onclick="editAsset(${asset.assetid})">
                  Edit
                </button>

                <button onclick="startInspection(${asset.assetid}, 'VISUAL', 'assets')">
                  Inspect
                </button>

                ${['100', '400', '500'].includes(String(asset.equipgroupid || '')) ? `
                  <button
                      class="load-test-btn"
                      onclick="startInspection(${asset.assetid}, 'LOADTEST', 'assets')"
                    >
                      Load Test
                    </button>                                 
                ` : ''}

                <button onclick="showAssetHistoryFromSetup(${asset.assetid})">
                  History
                </button>

                <button onclick="showMoveAssetForm(${asset.assetid})">
                  Move
                </button>

                <button onclick="archiveAsset(${asset.assetid})">
                  Archive
                </button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
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
