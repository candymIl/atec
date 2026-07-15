import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'
import { escapeHtml } from '../utils/security.js'
import {
  assetSupportsCraneWizard,
  assetSupportsInspectionWizard,
  wizardActionLabel
} from '../inspectionWizard/wizardRegistry.js'

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

function getServerPaginationState(rows, pageInfo, pageKey, pageSizeKey, defaultPageSize = 25) {
  const pageSize = window[pageSizeKey] || defaultPageSize
  const totalRows = Number(pageInfo.total || 0)
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const currentPage = Math.min(window[pageKey] || 1, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = totalRows === 0 ? 0 : startIndex + rows.length

  window[pageKey] = currentPage
  window[pageSizeKey] = pageSize

  return {
    currentPage,
    endIndex,
    pageSize,
    rows,
    startIndex,
    totalPages,
    totalRows
  }
}

export function renderInspections(assets, pageInfo = {}) {
  const serverPaged = pageInfo.serverPaged === true
  const sortedAssets = serverPaged ? assets : sortTableRows(assets, 'inspectionAssets', {
    client_section_serial: asset => `${asset.clientname || ''}\u0000${asset.sectionname || ''}\u0000${asset.serialno || ''}`,
    assetid: asset => asset.assetid,
    assettagno: asset => asset.assettagno,
    serialno: asset => asset.serialno,
    clientname: asset => asset.clientname,
    sitename: asset => asset.sitename,
    sectionname: asset => asset.sectionname,
    description: asset => asset.description,
    equipmenttype: asset => asset.equipmenttype
  }, 'client_section_serial')
  const pagination = serverPaged
    ? getServerPaginationState(sortedAssets, pageInfo, "inspectionCurrentPage", "inspectionRowsPerPage")
    : getPaginationState(sortedAssets, "inspectionCurrentPage", "inspectionRowsPerPage")

  document.querySelector('#page').innerHTML = `
    <h1>Inspections/Load Tests</h1>

    <div class="filter-card">
      <label><strong><h2>Search Assets</h2></strong></label>

      <div class="form-row">
        <div class="form-group">
          <label>Search By</label>

          <select id="inspectionSearchType" onchange="filterInspectionAssets(true)">
            <option value="all">All Fields</option>
            <option value="assetid">Asset ID</option>
            <option value="assettagno">Asset Tag</option>
            <option value="serialno">Serial No</option>
            <option value="clientname">Client</option>
            <option value="sitename">Site</option>
            <option value="sectionname">Section</option>
            <option value="description">Description</option>
            <option value="equipmenttype">Equipment Type</option>
          </select>
        </div>

        <div class="form-group">
          <label>Search Text</label>

          <input
            id="inspectionAssetSearch"
            class="search-box"
            type="text"
            placeholder="Type search text..."
            onkeyup="filterInspectionAssets(true)"
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
          <button type="button" class="filter-key-btn" onclick="setInspectionFilterKey('${value}')">
            ${label}
          </button>
        `).join("")}
      </div>
    </div>

    ${renderPaginationControls({
      ...pagination,
      label: "assets",
      onPage: "goToInspectionPage",
      onPageSize: "setInspectionRowsPerPage"
    })}

    <table>
      <thead>
        <tr>
          <th>${sortHeader('Asset ID', 'inspectionAssets', 'assetid', 'showInspections')}</th>
          <th>${sortHeader('Asset Tag', 'inspectionAssets', 'assettagno', 'showInspections')}</th>
          <th>${sortHeader('Serial No', 'inspectionAssets', 'serialno', 'showInspections')}</th>
          <th>${sortHeader('Client', 'inspectionAssets', 'clientname', 'showInspections')}</th>
          <th>${sortHeader('Site', 'inspectionAssets', 'sitename', 'showInspections')}</th>
          <th>${sortHeader('Section', 'inspectionAssets', 'sectionname', 'showInspections')}</th>
          <th>${sortHeader('Description', 'inspectionAssets', 'description', 'showInspections')}</th>
          <th>${sortHeader('Equipment Type', 'inspectionAssets', 'equipmenttype', 'showInspections')}</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody id="inspectionAssetTableBody">
        ${pagination.rows.map(asset => {
          const assetId = escapeHtml(asset.assetid)
          const assetTag = escapeHtml(asset.assettagno || '')
          const serialNo = escapeHtml(asset.serialno || '')
          const client = escapeHtml(asset.clientname || '')
          const site = escapeHtml(asset.sitename || '')
          const section = escapeHtml(asset.sectionname || '')
          const description = escapeHtml(asset.description || '')
          const equipmentType = escapeHtml(asset.equipmenttype || '')

          return `
          <tr>
            <td>${assetId}</td>
            <td>${assetTag}</td>
            <td>${serialNo}</td>
            <td>${client}</td>
            <td>${site}</td>
            <td>${section}</td>
            <td>${description}</td>
            <td>${equipmentType}</td>
            <td>
  <div class="action-buttons">

    ${assetSupportsInspectionWizard(asset, window.atecCriteria || [], 'VISUAL') ? `
      <button class="load-test-btn" onclick="startInspection(${asset.assetid}, 'VISUAL', 'inspections', 'wizard')">
        ${wizardActionLabel(asset, window.atecCriteria || [], 'VISUAL')}
      </button>
    ` : `
      <button onclick="startInspection(${asset.assetid}, 'VISUAL', 'inspections')">
        Inspection
      </button>
    `}

        ${
          assetSupportsLoadTest(asset)
          ? `
            <button
              class="load-test-btn"
              onclick="startInspection(${asset.assetid}, 'LOADTEST', 'inspections', '${assetSupportsCraneWizard(asset) ? 'wizard' : 'auto'}')">
              ${wizardActionLabel(asset, window.atecCriteria || [], 'LOADTEST')}
            </button>
          `
          : ''
        }

      </div>
    </td>
          </tr>
        `}).join('')}
      </tbody>
    </table>

    <br>

    <div id="inspectionFormContainer"></div>
  `
}
