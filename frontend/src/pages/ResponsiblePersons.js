import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'

export function renderResponsiblePersons(responsiblePersons) {
  const sortedPeople = sortTableRows(responsiblePersons, 'responsible', {
    personid: person => person.personid,
    clientname: person => person.clientname,
    name: person => person.name
  }, 'name')
  const pagination = getPaginationState(sortedPeople, "responsibleCurrentPage", "responsibleRowsPerPage")

  document.querySelector('#page').innerHTML = `
    <h2>Responsible Persons</h2>

    <button onclick="showAddResponsiblePersonForm()">
      Add Responsible Person
    </button>

    <br><br>

    <p>
      Total Responsible Persons:
      <strong>${responsiblePersons.length}</strong>
    </p>

    <label><strong>Search Responsible Persons</strong></label>
    <br>

    <input
      id="responsibleSearch"
      class="search-box"
      type="text"
      placeholder="Search Customer Name or Responsible Person..."
      onkeyup="filterResponsiblePersons(true)"
    />

    <br><br>

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
          <th>Actions</th>
        </tr>
      </thead>

      <tbody id="responsibleTableBody">
        ${pagination.rows.map(person => `
          <tr>
            <td>${person.personid}</td>
            <td>${person.clientname || ''}</td>
            <td>${person.name || ''}</td>
            <td>
              <button onclick="editResponsiblePerson(${person.personid})">
                Edit
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}
