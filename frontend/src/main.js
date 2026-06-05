import './style.css'

async function loadData() {
  const customerResponse = await fetch('http://localhost:5000/customers')
  const customers = await customerResponse.json()

  const assetResponse = await fetch('http://localhost:5000/assets')
  const assets = await assetResponse.json()

  document.querySelector('#app').innerHTML = `
    <div class="app">

      <h1>ATEC Inspection Platform</h1>

      <h2>Dashboard</h2>

      <p>
        Customers: <strong>${customers.length}</strong>
      </p>

      <p>
        Assets: <strong>${assets.length}</strong>
      </p>

      <hr>

      <h2>Recent Customers</h2>

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Client Name</th>
          </tr>
        </thead>

        <tbody>
          ${customers.slice(0, 10).map(customer => `
            <tr>
              <td>${customer.clientid}</td>
              <td>${customer.clientname}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <br>

      <h2>Recent Assets</h2>

      <table>
        <thead>
          <tr>
            <th>Asset ID</th>
            <th>Serial Number</th>
            <th>Description</th>
            <th>Equipment Type</th>
          </tr>
        </thead>

        <tbody>
          ${assets.slice(0, 10).map(asset => `
            <tr>
              <td>${asset.assetid}</td>
              <td>${asset.serialno || ''}</td>
              <td>${asset.description || ''}</td>
              <td>${asset.equipmenttype || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

    </div>
  `
}

loadData()