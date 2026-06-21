export function renderEquipmentTypeCriteria(equipmentTypes, criteria) {
  const sortedEquipmentTypes = [...equipmentTypes].sort((a, b) =>
    (a.description || '').localeCompare(b.description || '')
  )

  document.querySelector('#page').innerHTML = `
    <h1>Equipment Type Criteria Setup</h1>

    <div class="form-row">

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

  </div>

</div>

    <br><br>

    <table>
      <thead>
        <tr>
          <th>Equipment Type</th>
          <th>Category</th>
          <th>Criteria</th>
        </tr>
      </thead>

      <tbody>
        ${criteria.map(row => `
          <tr>
            <td>${row.equipmenttype || ''}</td>
            <td>${row.inspectioncategory || ''}</td>
            <td>${row.criterianame || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}