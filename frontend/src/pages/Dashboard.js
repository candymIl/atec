import { sortHeader, sortTableRows } from '../tableSort.js'

export function showDashboard(
    customers,
    assets,
    sites,
    equipmentTypes,
    stats
)

{

  // Calculate equipment totals
  const equipmentTotals = {}

  assets.forEach(asset => {
    const type = asset.equipmenttype || "Unknown"

    equipmentTotals[type] =
      (equipmentTotals[type] || 0) + 1
  })

  const topEquipment =
    Object.entries(equipmentTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

  const customerAssetRows = customers
    .map(customer => {
      const customerSites = sites.filter(site =>
        String(site.clientid) === String(customer.clientid)
      )

      const customerSiteIds = customerSites.map(site =>
        String(site.siteid)
      )

      const customerAssets = assets.filter(asset =>
        customerSiteIds.includes(String(asset.siteid))
      )

      return {
        clientname: customer.clientname || "",
        sites: customerSites.length,
        assets: customerAssets.length
      }
    })

  const sortedCustomerAssetRows = sortTableRows(customerAssetRows, 'dashboardCustomers', {
    clientname: row => row.clientname,
    sites: row => row.sites,
    assets: row => row.assets
  }, 'assets').slice(0, 10)

  const sortedTopEquipment = sortTableRows(topEquipment.map(item => ({
    equipmenttype: item[0],
    total: item[1]
  })), 'dashboardEquipment', {
    equipmenttype: row => row.equipmenttype,
    total: row => row.total
  }, 'total')

  document.querySelector('#page').innerHTML = `

    <h2>Dashboard</h2>

    <div class="filter-card">
  <h3>Quick Asset Search</h3>

  <div class="form-row">
    <input
      id="dashboardAssetSearch"
      class="search-box"
      type="text"
      placeholder="Scan QR / Asset ID / Tag No / Serial No..."
      onkeydown="handleDashboardSearchEnter(event)"
    >

    <button onclick="dashboardFindAsset()">
      Search
    </button>
  </div>

  <div id="dashboardAssetSearchResult"></div>
</div>

<div class="dashboard-cards">

  <div class="stat-card stat-blue">
    <div class="stat-icon">👥</div>
    <div>
      <h3>Customers</h3>
      <p>${stats.customers}</p>
    </div>
  </div>

  <div class="stat-card stat-blue">
    <div class="stat-icon">🏭</div>
    <div>
      <h3>Sites</h3>
      <p>${stats.sites}</p>
    </div>
  </div>

  <div class="stat-card stat-blue">
    <div class="stat-icon">📦</div>
    <div>
      <h3>Assets</h3>
      <p>${stats.assets}</p>
    </div>
  </div>

  <div class="stat-card stat-blue">
    <div class="stat-icon">🛠️</div>
    <div>
      <h3>Equipment Types</h3>
      <p>${stats.equipmenttypes}</p>
    </div>
  </div>

  <div class="stat-card stat-orange">
    <div class="stat-icon">👁️</div>
    <div>
      <h3>Visual Due</h3>
      <p>${stats.visualdue}</p>
    </div>
  </div>

  <div class="stat-card stat-orange">
    <div class="stat-icon">⚖️</div>
    <div>
      <h3>Load Tests Due</h3>
      <p>${stats.loadtestdue}</p>
    </div>
  </div>

  <div class="stat-card stat-green">
    <div class="stat-icon">📄</div>
    <div>
      <h3>Certificates</h3>
      <p>${stats.certificates}</p>
    </div>
  </div>

  <div class="stat-card stat-red">
    <div class="stat-icon">⚠️</div>
    <div>
      <h3>Overdue</h3>
      <p>${stats.overdue}</p>
    </div>
  </div>

</div>

<div class="dashboard-section dashboard-alerts">

  <div class="section-header">
    <h2>Operational Alerts</h2>
  </div>

  <div id="dashboardAlerts">
    Loading...
  </div>

</div>

<div class="dashboard-section full-width">

  <div class="section-header">
    <h2>Assets Requiring Attention</h2>
  </div>

  <table class="dashboard-table">

    <thead>
      <tr>
        <th>${sortHeader('Asset', 'dashboardAttention', 'assettagno', 'showDashboard')}</th>
        <th>${sortHeader('Customer', 'dashboardAttention', 'clientname', 'showDashboard')}</th>
        <th>${sortHeader('Site', 'dashboardAttention', 'sitename', 'showDashboard')}</th>
        <th>${sortHeader('Equipment', 'dashboardAttention', 'equipmenttype', 'showDashboard')}</th>
        <th>${sortHeader('Reason', 'dashboardAttention', 'reason', 'showDashboard')}</th>
        <th>${sortHeader('Days Overdue', 'dashboardAttention', 'daysoverdue', 'showDashboard')}</th>
        <th>Action</th>
      </tr>
    </thead>

    <tbody id="attentionTableBody">
      <tr>
        <td colspan="7">Loading...</td>
      </tr>
    </tbody>

  </table>

</div>

<div class="dashboard-section full-width">

  <div class="section-header">
    <h2>Failed Equipment</h2>
  </div>

  <table class="dashboard-table">

    <thead>
      <tr>
        <th>${sortHeader('Asset', 'dashboardFailed', 'assettagno', 'showDashboard')}</th>
        <th>${sortHeader('Customer', 'dashboardFailed', 'clientname', 'showDashboard')}</th>
        <th>${sortHeader('Site', 'dashboardFailed', 'sitename', 'showDashboard')}</th>
        <th>${sortHeader('Equipment', 'dashboardFailed', 'equipmenttype', 'showDashboard')}</th>
        <th>${sortHeader('Failed Date', 'dashboardFailed', 'testdate', 'showDashboard')}</th>
        <th>${sortHeader('Inspector', 'dashboardFailed', 'inspector', 'showDashboard')}</th>
        <th>Action</th>
      </tr>
    </thead>

    <tbody id="failedEquipmentTableBody">
      <tr>
        <td colspan="7">Loading...</td>
      </tr>
    </tbody>

  </table>

</div>

<div class="dashboard-section full-width">
  <div class="section-header">
    <h2>Upcoming Certificate Expiries</h2>
  </div>

  <table class="dashboard-table">
    <thead>
      <tr>
        <th>${sortHeader('Asset', 'dashboardExpiries', 'assettagno', 'showDashboard')}</th>
        <th>${sortHeader('Customer', 'dashboardExpiries', 'clientname', 'showDashboard')}</th>
        <th>${sortHeader('Site', 'dashboardExpiries', 'sitename', 'showDashboard')}</th>
        <th>${sortHeader('Equipment', 'dashboardExpiries', 'equipmenttype', 'showDashboard')}</th>
        <th>${sortHeader('Type', 'dashboardExpiries', 'inspectiontype', 'showDashboard')}</th>
        <th>${sortHeader('Expiry Date', 'dashboardExpiries', 'validdate', 'showDashboard')}</th>
        <th>${sortHeader('Days Left', 'dashboardExpiries', 'daysremaining', 'showDashboard')}</th>
        <th>Action</th>
      </tr>
    </thead>

    <tbody id="upcomingExpiriesTableBody">
      <tr>
        <td colspan="8">Loading...</td>
      </tr>
    </tbody>
  </table>
</div>

<hr>

<h2>Top Customers by Asset Count</h2>

<table>
  <thead>
    <tr>
      <th>${sortHeader('Client', 'dashboardCustomers', 'clientname', 'showDashboard')}</th>
      <th>${sortHeader('Sites', 'dashboardCustomers', 'sites', 'showDashboard')}</th>
      <th>${sortHeader('Assets', 'dashboardCustomers', 'assets', 'showDashboard')}</th>
    </tr>
  </thead>

<tbody>
  ${sortedCustomerAssetRows.map(row => `
      <tr>
        <td>${row.clientname}</td>
        <td>${row.sites}</td>
        <td>${row.assets}</td>
      </tr>
    `).join("")}
</tbody>

  </table>

    <br>

<div class="dashboard-row">

<div class="dashboard-panel">

    <h2>Equipment by Type</h2>

    <table>

        <thead>
            <tr>
                <th>${sortHeader('Equipment Type', 'dashboardEquipment', 'equipmenttype', 'showDashboard')}</th>
                <th>${sortHeader('Total', 'dashboardEquipment', 'total', 'showDashboard')}</th>
            </tr>
        </thead>

        <tbody>

            ${sortedTopEquipment.map(item => `
                <tr>
                    <td>${item.equipmenttype}</td>
                    <td><strong>${item.total}</strong></td>
                </tr>
            `).join('')}

        </tbody>

    </table>

</div>

    <div class="dashboard-panel">

        <h2>Quick Actions</h2>

        <div class="dashboard-buttons">

            <button onclick="showQuickInspection()">
                New Inspection
            </button>

            <button onclick="showInspections()">
                Load Test
            </button>

            <button onclick="showAssetSetup()">
                Assets
            </button>

            <button onclick="showCertificateSearch()">
                Certificates
            </button>

        </div>

    </div>
</div>

  
  `
}
