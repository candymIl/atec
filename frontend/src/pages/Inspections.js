import { getPaginationState, renderPaginationControls } from '../pagination.js'

export function renderInspections(assets) {
  const sortedAssets = [...assets].reverse()
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
          <th>Asset ID</th>
          <th>Asset Tag</th>
          <th>Serial No</th>
          <th>Client</th>
          <th>Site</th>
          <th>Section</th>
          <th>Description</th>
          <th>Equipment Type</th>
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
