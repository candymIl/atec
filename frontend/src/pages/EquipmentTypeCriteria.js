export function renderEquipmentTypeCriteria(equipmentTypes, criteria) {
  const sortedEquipmentTypes = [...equipmentTypes].sort((a, b) =>
    (a.description || '').localeCompare(b.description || '')
  )

  const selectedFilter =
    window.criteriaEquipmentFilter || ""

  const visibleCriteria = selectedFilter
    ? criteria.filter(row => String(row.equiptypeid) === String(selectedFilter))
    : criteria

  document.querySelector('#page').innerHTML = `
    <h1>Equipment Type Criteria Setup</h1>

    <div class="filter-card">
      <div class="form-row">
        <div class="form-group">
          <label>Show Criteria For</label>
          <select id="criteriaEquipmentFilter" onchange="filterEquipmentCriteria()">
            <option value="">All Equipment Types</option>
            ${sortedEquipmentTypes.map(type => `
              <option
                value="${type.equiptypeid}"
                ${String(type.equiptypeid) === String(selectedFilter) ? "selected" : ""}
              >
                ${type.description}
              </option>
            `).join('')}
          </select>
        </div>
      </div>
    </div>

    <div class="form-row">

  <input id="editingCriteriaId" type="hidden">

  <div class="form-group">

    <label>Equipment Type</label>

    <select id="criteriaEquipType">
      ${sortedEquipmentTypes.map(type => `
        <option value="${type.equiptypeid}">
          ${type.description}
        </option>
      `).join('')}
    </select>

  </div>

  <div class="form-group">

    <label>Inspection Category</label>

    <select id="criteriaCategory">
      <option value="VISUAL">
        Visual Inspection
      </option>

      <option value="LOADTEST">
        Load Test
      </option>

    </select>

  </div>

  <div class="form-group">

        <label>Criteria Name</label>

        <input
          id="criteriaName"
          type="text"
        >

      </div>

      <div class="form-group">
      <label>Field Type</label>

      <select id="criteriaFieldType">
        <option value="PASSFAIL">Pass / Fail / N/A</option>
        <option value="TEXT">Text Input</option>
        <option value="NUMBER">Number Input</option>
        <option value="DATE">Date Input</option>
        <option value="LOAD">Load Value</option>
        <option value="MEASUREMENT">Measurement</option>
      </select>
      </div>

  <div class="form-group">

    <button onclick="saveCriteria()">
      Save Criteria
    </button>

    <button type="button" onclick="cancelCriteriaEdit()">
      Cancel Edit
    </button>

  </div>

</div>

    <br><br>

    <table>
      <thead>
        <tr>
          <th>Equipment Type</th>
          <th>Category</th>
          <th>Criteria</th>
          <th>Field Type</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody>
        ${visibleCriteria.map(row => `
          <tr>
            <td>${row.equipmenttype || ''}</td>
            <td>${row.inspectioncategory || ''}</td>
            <td>${row.criterianame || ''}</td>
            <td>${row.fieldtype || ''}</td>
            <td>
              <button type="button" onclick="editCriteria(${row.criteriaid})">
                Edit
              </button>
              <button type="button" onclick="deleteCriteria(${row.criteriaid})">
                Delete
              </button>
            </td>
          </tr>
        `).join('') || `
          <tr>
            <td colspan="5">No criteria found for the selected equipment type.</td>
          </tr>
        `}
      </tbody>
    </table>
  `
}
