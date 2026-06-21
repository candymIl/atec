export function renderAssetSetup(assets) {
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
        <strong>${assets.length}</strong>
      </p>

      <h2>Search Assets</h2>

      <div class="form-row">
        <div class="form-group">
          <label>Search By</label>

          <select id="assetSearchType" onchange="filterAssets()">
            <option value="assetid">Asset ID</option>
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
            onkeyup="filterAssets()"
          />
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Asset ID</th>
          <th>Serial No</th>
          <th>Client</th>
          <th>Site</th>
          <th>Section</th>
          <th>Equipment Type</th>
          <th>Description</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody id="assetTableBody">
        ${assets.slice(0, 100).map(asset => `
          <tr>
            <td>${asset.assetid}</td>
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