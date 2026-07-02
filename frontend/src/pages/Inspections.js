import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'

export function renderInspections(assets) {
  const sortedAssets = sortTableRows(assets, 'inspectionAssets', {
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
  const pagination = getPaginationState(sortedAssets, "inspectionCurrentPage", "inspectionRowsPerPage")

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
        ${pagination.rows.map(asset => `
          <tr>
            <td>${asset.assetid}</td>
            <td>${asset.assettagno || ''}</td>
            <td>${asset.serialno || ''}</td>
            <td>${asset.clientname || ''}</td>
            <td>${asset.sitename || ''}</td>
            <td>${asset.sectionname || ''}</td>
            <td>${asset.description || ''}</td>
            <td>${asset.equipmenttype || ''}</td>
            <td>
  <div class="action-buttons">

    <button
          onclick="startInspection(${asset.assetid}, 'VISUAL', 'inspections')">
          Inspection
        </button>

        ${
          ['100','400','500'].includes(String(asset.equipgroupid))
          ? `
            <button
              class="load-test-btn"
              onclick="startInspection(${asset.assetid}, 'LOADTEST', 'inspections')">
              Load Test
            </button>
          `
          : ''
        }

      </div>
    </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <br>

    <div id="inspectionFormContainer"></div>
  `
}
