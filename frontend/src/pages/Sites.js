export function renderSites(sites) {
  document.querySelector('#page').innerHTML = `
    <h2>Sites</h2>

    <button onclick="showAddSiteForm()">
      Add Site
    </button>

    <br><br>

    <p>Total Sites: <strong>${sites.length}</strong></p>

    <label><strong>Search Sites</strong></label>
    <br>

    <input
      id="siteSearch"
      class="search-box"
      type="text"
      placeholder="Search Site ID, Client or Site Name..."
      onkeyup="filterSites()"
    />

    <br><br>

    <table>
    <thead>
      <tr>
        <th>Site ID</th>
        <th>Client</th>
        <th>Site Name</th>
        <th>Actions</th>
      </tr>
    </thead>

      <tbody id="siteTableBody">
        ${sites.map(site => `
         <tr>
          <td>${site.siteid}</td>
          <td>${site.clientname || ''}</td>
          <td>${site.sitename || ''}</td>
          <td>
            <button onclick="editSite(${site.siteid})">
              Edit
            </button>
          </td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  `
}