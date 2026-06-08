import './style.css'

async function loadData() {
  const customerResponse = await fetch('http://localhost:5000/customers')
  const customers = await customerResponse.json()

  const assetResponse = await fetch('http://localhost:5000/assets')
  const assets = await assetResponse.json()
  
  const siteResponse = await fetch('http://localhost:5000/sites')
  const sites = await siteResponse.json()

  const responsibleResponse = await fetch('http://localhost:5000/responsible-persons')
  const responsiblePersons = await responsibleResponse.json()

         document.querySelector('#app').innerHTML = `
    <div class="app">

     <div class="layout">

  <div class="sidebar">

                <div class="logo-container">
            <img src="/logo.png" alt="ATEC Logo" class="logo">
          </div>

          <div class="system-title">
            Inspection Platform
          </div>

    <button onclick="showDashboard()">Dashboard</button>

    <button onclick="showCustomerSetup()">
      Customer Setup
    </button>

    <button onclick="showSites()">
      Sites
    </button>

    <button onclick="showResponsiblePersons()">
    Responsible Persons
    </button>

    <button>
      Sections
    </button>

    <button>
      Asset Setup
    </button>

    <button>
      Inspections
    </button>

    <button>
      Certificates
    </button>

  </div>

  <div class="content">
    <div id="page"></div>
  </div>

</div>

</div>

  `

  window.showDashboard = function () {
    document.querySelector('#page').innerHTML = `
      <h2>Dashboard</h2>

     <div class="dashboard-cards">

  <div class="stat-card">
    <h3>Customers</h3>
    <p>${customers.length}</p>
  </div>

  <div class="stat-card">
    <h3>Assets</h3>
    <p>${assets.length}</p>
  </div>

  <div class="stat-card">
    <h3>Sites</h3>
    <p>${sites.length}</p>
  </div>

</div>

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
    `
  }

  window.showCustomerSetup = function () {
            window.addClient = async function () {
              const clientName = prompt("Enter Client Name")

              if (!clientName) return

              const clientAddress = prompt("Enter Client Address")

              const response = await fetch("http://localhost:5000/customers", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  clientname: clientName,
                  clientaddr: clientAddress,
                }),
              })

              const newClient = await response.json()

              alert("Client saved: " + newClient.clientname)

              loadData()
            }
    document.querySelector('#page').innerHTML = `
      <h2>Customer Setup</h2>
          <button onclick="addClient()">
          Add Client
          </button>
          <br><br>

      <p>This page will manage:</p>

      <ul>
        <li>Clients</li>
        <li>Sites</li>
        <li>Responsible Persons</li>
        <li>Sections</li>
      </ul>

      <h3>Clients</h3>
              <button onclick="showCustomerSetup()">
                Refresh
              </button>
                  <p>
                   Total Clients: <strong>${customers.length}</strong>
                 </p>
      <table>
        <thead>
          <tr>
            <th>Client ID</th>
            <th>Client Name</th>
            <th>Address</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${customers.map(customer => `
            <tr>
              <td>${customer.clientid}</td>
              <td>${customer.clientname || ''}</td>
              <td>${customer.clientaddr || ''}</td>
              <td>
                  <button onclick="editClient(${customer.clientid})">
                    Edit
                  </button>
                </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }
      window.editClient = function(clientid) {
      alert("Edit Client " + clientid)
  }
          window.addSite = async function () {

        const clientid = prompt(
          "Enter Client ID"
        )

        if (!clientid) return

        const sitename = prompt(
          "Enter Site Name"
        )

        if (!sitename) return

        const response = await fetch(
          "http://localhost:5000/sites",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              clientid,
              sitename,
            }),
          }
        )

        const newSite =
          await response.json()

        alert(
          "Site saved: " +
          newSite.sitename
        )

        loadData()
      }

      window.showResponsiblePersons = function () {
  document.querySelector('#page').innerHTML = `
    <h2>Responsible Persons</h2>

    <p>Total Responsible Persons: <strong>${responsiblePersons.length}</strong></p>

    <table>
      <thead>
        <tr>
          <th>Person ID</th>
          <th>Client</th>
          <th>Name</th>
        </tr>
      </thead>

      <tbody>
        ${responsiblePersons.map(person => `
          <tr>
            <td>${person.personid}</td>
            <td>${person.clientname || ''}</td>
            <td>${person.name || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}


  window.showSites = function () {
  document.querySelector('#page').innerHTML = `
   <h2>Sites</h2>

      <button onclick="addSite()">
        Add Site
      </button>

      <br><br>

      <p>Total Sites: <strong>${sites.length}</strong></p>

    <table>
      <thead>
        <tr>
          <th>Site ID</th>
          <th>Client</th>
          <th>Site Name</th>
        </tr>
      </thead>

      <tbody>
        ${sites.map(site => `
          <tr>
            <td>${site.siteid}</td>
            <td>${site.clientname || ''}</td>
            <td>${site.sitename || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

  showDashboard()
}

loadData()