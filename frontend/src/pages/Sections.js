export function renderSections(sections) {
  document.querySelector('#page').innerHTML = `
    <h2>Sections</h2>

    <div class="page-actions">
      <button onclick="showAddSectionForm()">
        Add Section
      </button>
    </div>

    <div class="filter-card">
      <p>
        Total Sections:
        <strong>${sections.length}</strong>
      </p>

      <label><strong><h2>Search Sections</h2></strong></label>

      <div class="form-row">
        <div class="form-group">
          <label>Search By</label>

          <select id="sectionSearchType" onchange="filterSections()">
            <option value="clientname">Customer</option>
            <option value="sitename">Site</option>
            <option value="responsiblename">Responsible Person</option>
            <option value="sectionname">Section</option>
          </select>
        </div>

        <div class="form-group">
          <label>Search Text</label>

          <input
            id="sectionSearch"
            class="search-box"
            type="text"
            placeholder="Type search text..."
            onkeyup="filterSections()"
          />
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Client</th>
          <th>Site</th>
          <th>Responsible Person</th>
          <th>Section Name</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody id="sectionTableBody">
        ${sections.map(section => `
          <tr>
            <td>${section.sectionid}</td>
            <td>${section.clientname || ''}</td>
            <td>${section.sitename || ''}</td>
            <td>${section.responsiblename || ''}</td>
            <td>${section.sectionname || ''}</td>
            <td>
              <button onclick="editSection(${section.sectionid})">
                Edit
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}