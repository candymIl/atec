import { sortHeader } from '../tableSort.js'

export function showDashboard(
    customers,
    assets,
    sites,
    equipmentTypes,
    stats
)

{
  document.querySelector('#page').innerHTML = `

    <h2>Dashboard</h2>

    <div class="filter-card dashboard-quick-search">
      <div class="section-header">
        <h3>Quick Asset Search</h3>
      </div>

      <div class="dashboard-search-row">
        <input
          id="dashboardAssetSearch"
          class="search-box"
          type="text"
          placeholder="Scan QR / Asset ID / Tag No / Serial No..."
          onkeydown="handleDashboardSearchEnter(event)"
        >

        <button onclick="dashboardFindAsset()">Search</button>
        <button type="button" class="secondary-btn" onclick="startDashboardCameraScan()">Scan QR / Barcode</button>
        <button type="button" class="secondary-btn" onclick="startDashboardNfcScan()">Scan NFC Tag</button>
      </div>

      <p id="dashboardNfcStatus" class="nfc-writing-note" hidden></p>

      <div id="dashboardCameraScanner" class="quick-camera-scanner dashboard-camera-scanner" hidden>
        <video id="dashboardCameraVideo" playsinline></video>
        <p id="dashboardScanStatus">Scanning... point the camera at the QR label or barcode.</p>
        <button type="button" class="secondary-btn" onclick="stopDashboardCameraScan()">Stop Scanning</button>
      </div>

      <div id="dashboardAssetSearchResult" class="dashboard-search-result"></div>
    </div>

    <div class="dashboard-cards">

      <div class="stat-card stat-blue">
        <div class="stat-icon">CU</div>
        <div>
          <h3>Customers</h3>
          <p>${stats.customers || 0}</p>
        </div>
      </div>

      <div class="stat-card stat-blue">
        <div class="stat-icon">SI</div>
        <div>
          <h3>Sites</h3>
          <p>${stats.sites || 0}</p>
        </div>
      </div>

      <div class="stat-card stat-blue">
        <div class="stat-icon">AS</div>
        <div>
          <h3>Assets</h3>
          <p>${stats.assets || 0}</p>
        </div>
      </div>

      <div class="stat-card stat-blue">
        <div class="stat-icon">ET</div>
        <div>
          <h3>Equipment Types</h3>
          <p>${stats.equipmenttypes || 0}</p>
        </div>
      </div>

      <div class="stat-card stat-orange">
        <div class="stat-icon">VI</div>
        <div>
          <h3>Visual Due</h3>
          <p>${stats.visualdue || 0}</p>
        </div>
      </div>

      <div class="stat-card stat-orange">
        <div class="stat-icon">LT</div>
        <div>
          <h3>Load Tests Due</h3>
          <p>${stats.loadtestdue || 0}</p>
        </div>
      </div>

      <div class="stat-card stat-green">
        <div class="stat-icon">CE</div>
        <div>
          <h3>Valid Certificates</h3>
          <p>${stats.certificates || 0}</p>
        </div>
      </div>

      <button type="button" class="stat-card stat-red stat-card-action" onclick="showDashboardReviewQueue('incomplete-inspections')">
        <div class="stat-icon">IC</div>
        <div>
          <h3>Incomplete Inspections</h3>
          <p>${stats.incompleteinspections || 0}</p>
        </div>
      </button>

      <button type="button" class="stat-card stat-red stat-card-action" onclick="showDashboardReviewQueue('certificate-metadata')">
        <div class="stat-icon">CM</div>
        <div>
          <h3>Certificate Metadata</h3>
          <p>${stats.certificateintegrityalerts || 0}</p>
        </div>
      </button>

      <button type="button" class="stat-card stat-orange stat-card-action" onclick="showDashboardReviewQueue('missing-section')">
        <div class="stat-icon">SC</div>
        <div>
          <h3>Assets Missing Section</h3>
          <p>${stats.assetsmissingsection || 0}</p>
        </div>
      </button>

      <button type="button" class="stat-card stat-orange stat-card-action" onclick="showDashboardReviewQueue('types-without-criteria')">
        <div class="stat-icon">CR</div>
        <div>
          <h3>Types Without Criteria</h3>
          <p>${stats.equipmenttypeswithoutcriteria || 0}</p>
        </div>
      </button>

      <button type="button" class="stat-card stat-red stat-card-action" onclick="showDashboardReviewQueue('overdue')">
        <div class="stat-icon">OD</div>
        <div>
          <h3>Overdue</h3>
          <p>${stats.overdue || 0}</p>
        </div>
      </button>

    </div>

    <div class="dashboard-section dashboard-review-queue" id="dashboardReviewQueue" hidden>
      <div class="section-header">
        <h2 id="dashboardReviewQueueTitle">Review Queue</h2>
        <div class="dashboard-review-actions">
          <button type="button" class="secondary-btn" onclick="exportDashboardReviewQueue()">Export CSV</button>
          <button type="button" class="secondary-btn" onclick="closeDashboardReviewQueue()">Close</button>
        </div>
      </div>

      <div id="dashboardReviewQueueBody">Select a dashboard card to review the items.</div>
    </div>

    <div class="dashboard-section dashboard-alerts">
      <div class="section-header">
        <h2>Operational Alerts</h2>
      </div>

      <div id="dashboardAlerts">Loading...</div>
    </div>

    <div class="dashboard-section dashboard-notification-centre">
      <div class="section-header">
        <h2>Notification Centre</h2>
        <div class="dashboard-notification-toolbar">
          <button type="button" class="secondary-btn" onclick="runDashboardNotificationScheduler()">Run Scheduled Check</button>
          <button type="button" class="secondary-btn" onclick="exportDashboardNotifications()">Export CSV</button>
        </div>
      </div>

      <div id="dashboardNotificationScheduler" class="notification-scheduler-status">Loading scheduler status...</div>
      <div id="dashboardNotificationCentre">Loading...</div>
      <div id="dashboardNotificationHistory" class="dashboard-notification-history">Loading notification history...</div>
    </div>

    <div class="dashboard-two-column">
      <div class="dashboard-section">
        <div class="section-header">
          <h2>Failed Equipment</h2>
        </div>

        <table class="dashboard-table">
          <thead>
            <tr>
              <th>${sortHeader('Customer', 'dashboardFailed', 'clientname', 'showDashboard')}</th>
              <th>${sortHeader('Failed Assets', 'dashboardFailed', 'failed_assets', 'showDashboard')}</th>
              <th>${sortHeader('Latest Failed Date', 'dashboardFailed', 'latest_failed_date', 'showDashboard')}</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody id="failedEquipmentTableBody">
            <tr>
              <td colspan="4">Loading...</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="dashboard-section">
        <div class="section-header">
          <h2>Upcoming Certificate Expiries</h2>
        </div>

        <table class="dashboard-table">
          <thead>
            <tr>
              <th>${sortHeader('Customer', 'dashboardExpiries', 'clientname', 'showDashboard')}</th>
              <th>${sortHeader('Upcoming Assets', 'dashboardExpiries', 'upcoming_assets', 'showDashboard')}</th>
              <th>${sortHeader('Next Expiry Date', 'dashboardExpiries', 'next_expiry_date', 'showDashboard')}</th>
              <th>${sortHeader('Days Left', 'dashboardExpiries', 'days_remaining', 'showDashboard')}</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody id="upcomingExpiriesTableBody">
            <tr>
              <td colspan="5">Loading...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="dashboard-two-column dashboard-top-row">
      <div class="dashboard-section">
        <div class="section-header">
          <h2>Top Customers by Asset Count</h2>
        </div>

        <table class="dashboard-table">
          <thead>
            <tr>
              <th>${sortHeader('Client', 'dashboardCustomers', 'clientname', 'showDashboard')}</th>
              <th>${sortHeader('Sites', 'dashboardCustomers', 'sites', 'showDashboard')}</th>
              <th>${sortHeader('Assets', 'dashboardCustomers', 'assets', 'showDashboard')}</th>
            </tr>
          </thead>

          <tbody id="dashboardTopCustomersBody">
            <tr>
              <td colspan="3">Loading...</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="dashboard-section">
        <div class="section-header">
          <h2>Equipment by Type</h2>
        </div>

        <table class="dashboard-table">
          <thead>
            <tr>
              <th>${sortHeader('Equipment Type', 'dashboardEquipment', 'equipmenttype', 'showDashboard')}</th>
              <th>${sortHeader('Total', 'dashboardEquipment', 'total', 'showDashboard')}</th>
            </tr>
          </thead>

          <tbody id="dashboardEquipmentTypeBody">
            <tr>
              <td colspan="2">Loading...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="dashboard-section dashboard-actions">
      <div class="section-header">
        <h2>Quick Actions</h2>
      </div>

      <div class="dashboard-buttons">
        <button onclick="showQuickInspection()">New Inspection</button>
        <button onclick="showQuickInspection()">Load Test</button>
        <button onclick="showAssetSetup()">Assets</button>
        <button onclick="showCertificateSearch()">Certificates</button>
      </div>
    </div>
  `
}
