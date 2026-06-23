import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'

export function renderEquipmentTypeCriteria(equipmentTypes, criteria) {
  const sortedEquipmentTypes = [...equipmentTypes].sort((a, b) =>
    (a.description || '').localeCompare(b.description || '')
  )

  const selectedFilter =
    window.criteriaEquipmentFilter || ""

  const visibleCriteria = selectedFilter
    ? criteria.filter(row => String(row.equiptypeid) === String(selectedFilter))
    : criteria
  const sortedCriteria = sortTableRows(visibleCriteria, 'criteria', {
    equipmenttype: row => row.equipmenttype,
    inspectioncategory: row => row.inspectioncategory,
    inspection_category: row => row.inspection_category,
    severity: row => row.severity,
    criterianame: row => row.criterianame,
    resulttype: row => row.resulttype,
    active: row => row.active ? 'Active' : 'Inactive'
  }, 'equipmenttype')
  const pagination = getPaginationState(sortedCriteria, "criteriaCurrentPage", "criteriaRowsPerPage")

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

        <div class="form-group criteria-action-group">
          <button type="button" onclick="openCriteriaPopup()">
            Add Criteria
          </button>
        </div>
      </div>
    </div>

    ${renderPaginationControls({
      ...pagination,
      label: "criteria",
      onPage: "goToCriteriaPage",
      onPageSize: "setCriteriaRowsPerPage"
    })}

    <table>
      <thead>
        <tr>
          <th>${sortHeader('Equipment Type', 'criteria', 'equipmenttype', 'showEquipmentTypeCriteria')}</th>
          <th>${sortHeader('Type', 'criteria', 'inspectioncategory', 'showEquipmentTypeCriteria')}</th>
          <th>${sortHeader('Category', 'criteria', 'inspection_category', 'showEquipmentTypeCriteria')}</th>
          <th>${sortHeader('Severity', 'criteria', 'severity', 'showEquipmentTypeCriteria')}</th>
          <th>${sortHeader('Criteria', 'criteria', 'criterianame', 'showEquipmentTypeCriteria')}</th>
          <th>${sortHeader('Result Type', 'criteria', 'resulttype', 'showEquipmentTypeCriteria')}</th>
          <th>${sortHeader('Status', 'criteria', 'active', 'showEquipmentTypeCriteria')}</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody>
        ${pagination.rows.map(row => `
          <tr>
            <td>${row.equipmenttype || ''}</td>
            <td>${row.inspectioncategory || ''}</td>
            <td>${formatCriteriaLabel(row.inspection_category)}</td>
            <td>${formatCriteriaLabel(row.severity)}</td>
            <td>${row.criteriadescription || row.criterianame || ''}</td>
            <td>${formatCriteriaLabel(row.resulttype || row.fieldtype)}</td>
            <td>${row.active === false ? 'Inactive' : 'Active'}</td>
            <td class="criteria-row-actions">
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
            <td colspan="8">No criteria found for the selected equipment type.</td>
          </tr>
        `}
      </tbody>
    </table>
  `
}

function formatCriteriaLabel(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, letter => letter.toUpperCase())
}
