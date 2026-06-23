import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'

export function renderSections(sections, sectionArchiveMode = 'active') {
  const visibleSections = sections.filter(section => {
    const isArchived = section.archived === true || section.archived === 'true'
    if (sectionArchiveMode === 'active') return !isArchived
    if (sectionArchiveMode === 'archived') return isArchived
    return true
  })

  const sortedSections = sortTableRows(visibleSections, 'sections', {
    sectionid: section => section.sectionid,
    clientname: section => section.clientname,
    sitename: section => section.sitename,
    responsiblename: section => section.responsiblename,
    sectionname: section => section.sectionname,
    archived: section => section.archived ? 'Archived' : 'Active'
  }, 'sectionname')
  const pagination = getPaginationState(sortedSections, "sectionCurrentPage", "sectionRowsPerPage")

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
        <strong>${visibleSections.length}</strong>
      </p>

      <label>Show Sections</label>
      <div class="radio-row">
        ${['active', 'archived', 'all'].map(mode => `
          <label>
            <input
              type="radio"
              name="sectionArchiveFilter"
              value="${mode}"
              ${sectionArchiveMode === mode ? 'checked' : ''}
              onchange="showSections('${mode}')"
            >
            ${mode[0].toUpperCase() + mode.slice(1)}
          </label>
        `).join('')}
      </div>

      <label><strong><h2>Search Sections</h2></strong></label>

      <div class="form-row">
        <div class="form-group">
          <label>Search By</label>

          <select id="sectionSearchType" onchange="filterSections(true)">
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
            onkeyup="filterSections(true)"
          />
        </div>
      </div>
    </div>

    ${renderPaginationControls({
      ...pagination,
      label: "sections",
      onPage: "goToSectionPage",
      onPageSize: "setSectionRowsPerPage"
    })}

    <table>
      <thead>
        <tr>
          <th>${sortHeader('ID', 'sections', 'sectionid', 'showSections')}</th>
          <th>${sortHeader('Client', 'sections', 'clientname', 'showSections')}</th>
          <th>${sortHeader('Site', 'sections', 'sitename', 'showSections')}</th>
          <th>${sortHeader('Responsible Person', 'sections', 'responsiblename', 'showSections')}</th>
          <th>${sortHeader('Section Name', 'sections', 'sectionname', 'showSections')}</th>
          <th>${sortHeader('Status', 'sections', 'archived', 'showSections')}</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody id="sectionTableBody">
        ${pagination.rows.map(section => `
          <tr>
            <td>${section.sectionid}</td>
            <td>${section.clientname || ''}</td>
            <td>${section.sitename || ''}</td>
            <td>${section.responsiblename || ''}</td>
            <td>${section.sectionname || ''}</td>
            <td>${section.archived ? 'Archived' : 'Active'}</td>
            <td>
              <button onclick="editSection(${section.sectionid})">
                Edit
              </button>
              ${
                section.archived
                  ? `<button onclick="unarchiveSection(${section.sectionid})">Restore</button>`
                  : `<button onclick="archiveSection(${section.sectionid})">Archive</button>`
              }
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}
