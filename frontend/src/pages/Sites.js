import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'

export function renderSites(sites, siteArchiveMode = 'active') {
  const canArchiveSites = window.currentUser?.role === 'ADMIN'
  const visibleSites = sites.filter(site => {
    const isArchived = site.archived === true || site.archived === 'true'
    if (siteArchiveMode === 'active') return !isArchived
    if (siteArchiveMode === 'archived') return isArchived
    return true
  })

  const sortedSites = sortTableRows(visibleSites, 'sites', {
    siteid: site => site.siteid,
    clientname: site => site.clientname,
    sitename: site => site.sitename,
    archived: site => site.archived ? 'Archived' : 'Active'
  }, 'clientname')
  const pagination = getPaginationState(sortedSites, "siteCurrentPage", "siteRowsPerPage")

  document.querySelector('#page').innerHTML = `
    <h2>Sites</h2>

    <button onclick="showAddSiteForm()">
      Add Site
    </button>

    <br><br>

    <p>Total Sites: <strong>${visibleSites.length}</strong></p>

    <div class="filter-card">
      <label>Show Sites</label>
      <div class="radio-row">
        ${['active', 'archived', 'all'].map(mode => `
          <label>
            <input
              type="radio"
              name="siteArchiveFilter"
              value="${mode}"
              ${siteArchiveMode === mode ? 'checked' : ''}
              onchange="showSites('${mode}')"
            >
            ${mode[0].toUpperCase() + mode.slice(1)}
          </label>
        `).join('')}
      </div>
    </div>

    <label><strong>Search Sites</strong></label>
    <br>

    <input
      id="siteSearch"
      class="search-box"
      type="text"
      placeholder="Search Site ID, Client or Site Name..."
      onkeyup="filterSites(true)"
    />

    <br><br>

    ${renderPaginationControls({
      ...pagination,
      label: "sites",
      onPage: "goToSitePage",
      onPageSize: "setSiteRowsPerPage"
    })}

    <table>
    <thead>
      <tr>
        <th>${sortHeader('Site ID', 'sites', 'siteid', 'showSites')}</th>
        <th>${sortHeader('Client', 'sites', 'clientname', 'showSites')}</th>
        <th>${sortHeader('Site Name', 'sites', 'sitename', 'showSites')}</th>
        <th>${sortHeader('Status', 'sites', 'archived', 'showSites')}</th>
        <th>Actions</th>
      </tr>
    </thead>

      <tbody id="siteTableBody">
        ${pagination.rows.map(site => `
         <tr>
          <td>${site.siteid}</td>
          <td>${site.clientname || ''}</td>
          <td>${site.sitename || ''}</td>
          <td>${site.archived ? 'Archived' : 'Active'}</td>
          <td>
            <button onclick="editSite(${site.siteid})">
              Edit
            </button>
            ${canArchiveSites ? `
            ${
              site.archived
                ? `<button onclick="unarchiveSite(${site.siteid})">Restore</button>`
                : `<button onclick="archiveSite(${site.siteid})">Archive</button>`
            }
            ` : ''}
          </td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  `
}
