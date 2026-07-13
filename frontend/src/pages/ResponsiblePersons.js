import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'
import { escapeHtml } from '../utils/security.js'

export function renderResponsiblePersons(responsiblePersons, responsibleArchiveMode = 'active') {
  const canArchiveResponsiblePersons = window.currentUser?.role === 'ADMIN'
  const visiblePeople = responsiblePersons.filter(person => {
    const isArchived = person.archived === true || person.archived === 'true'
    if (responsibleArchiveMode === 'active') return !isArchived
    if (responsibleArchiveMode === 'archived') return isArchived
    return true
  })

  const sortedPeople = sortTableRows(visiblePeople, 'responsible', {
    personid: person => person.personid,
    clientname: person => person.clientname,
    name: person => person.name,
    archived: person => person.archived ? 'Archived' : 'Active'
  }, 'name')
  const pagination = getPaginationState(sortedPeople, "responsibleCurrentPage", "responsibleRowsPerPage")

  document.querySelector('#page').innerHTML = `
    <h2>Responsible Persons</h2>

    <div class="page-actions">
      <button onclick="showAddResponsiblePersonForm()">
        Add Responsible Person
      </button>
    </div>

    <div class="filter-card">
      <p>
        Total Responsible Persons:
        <strong>${visiblePeople.length}</strong>
      </p>

      <label>Show Responsible Persons</label>
      <div class="radio-row">
        ${['active', 'archived', 'all'].map(mode => `
          <label>
            <input
              type="radio"
              name="responsibleArchiveFilter"
              value="${mode}"
              ${responsibleArchiveMode === mode ? 'checked' : ''}
              onchange="showResponsiblePersons('${mode}')"
            >
            ${mode[0].toUpperCase() + mode.slice(1)}
          </label>
        `).join('')}
      </div>

      <label><strong>Search Responsible Persons</strong></label>

      <input
        id="responsibleSearch"
        class="search-box"
        type="text"
        placeholder="Search Customer Name or Responsible Person..."
        onkeyup="filterResponsiblePersons(true)"
      />
    </div>

    ${renderPaginationControls({
      ...pagination,
      label: "people",
      onPage: "goToResponsiblePage",
      onPageSize: "setResponsibleRowsPerPage"
    })}

    <table>
      <thead>
        <tr>
          <th>${sortHeader('Person ID', 'responsible', 'personid', 'showResponsiblePersons')}</th>
          <th>${sortHeader('Client', 'responsible', 'clientname', 'showResponsiblePersons')}</th>
          <th>${sortHeader('Name', 'responsible', 'name', 'showResponsiblePersons')}</th>
          <th>${sortHeader('Status', 'responsible', 'archived', 'showResponsiblePersons')}</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody id="responsibleTableBody">
        ${pagination.rows.map(person => `
          <tr>
            <td>${escapeHtml(person.personid)}</td>
            <td>${escapeHtml(person.clientname || '')}</td>
            <td>${escapeHtml(person.name || '')}</td>
            <td>${person.archived ? 'Archived' : 'Active'}</td>
            <td>
              <button onclick="editResponsiblePerson(${person.personid})">
                Edit
              </button>
              ${canArchiveResponsiblePersons ? `
              ${
                person.archived
                  ? `<button onclick="unarchiveResponsiblePerson(${person.personid})">Restore</button>`
                  : `<button onclick="archiveResponsiblePerson(${person.personid})">Archive</button>`
              }
              ` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}
