import './style.css'
import { showDashboard as renderDashboard } from './pages/Dashboard'
import { renderCustomerSetup } from './pages/CustomerSetup.js'
import { renderSites } from './pages/Sites.js'
import { renderResponsiblePersons } from './pages/ResponsiblePersons.js'
import { renderSections } from './pages/Sections.js'
import { renderAssetSetup } from './pages/AssetSetup.js'
import { renderInspections } from './pages/Inspections.js'
import { renderEquipmentTypeCriteria } from './pages/EquipmentTypeCriteria.js'
import { renderQuickInspection } from './pages/QuickInspection.js'
import { renderCertificateSearch } from './pages/Certificates.js'
import { renderCustomerDetailedReport } from './pages/CustomerDetailedReport.js'


async function loadData() {
  const customerResponse = await fetch('http://localhost:5000/customers')
  let customers = await customerResponse.json()

  const assetResponse = await fetch('http://localhost:5000/assets')
  const assets = await assetResponse.json()
  
  const siteResponse = await fetch('http://localhost:5000/sites')
  const sites = await siteResponse.json()

  const responsibleResponse = await fetch('http://localhost:5000/responsible-persons')
  const responsiblePersons = await responsibleResponse.json()

  const sectionResponse = await fetch('http://localhost:5000/sections')
  const sections = await sectionResponse.json()

  const equipmentTypeResponse = await fetch('http://localhost:5000/equipment-types')
  const equipmentTypes = await equipmentTypeResponse.json()
  const dashboardResponse = await fetch("http://localhost:5000/dashboard/stats")
  const dashboardStats = await dashboardResponse.json()

  const criteriaResponse = await fetch('http://localhost:5000/equipment-type-criteria')
  const criteria = await criteriaResponse.json()

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

    <button onclick="showDashboard()">
      Dashboard
    </button>

    <button onclick="showCustomerSetup()">
      Customer Setup
    </button>

    <button onclick="showSites()">
      Sites
    </button>
    
    <button onclick="showResponsiblePersons()">
    Responsible Persons
    </button>

    <button onclick="showSections()">
      Sections
    </button>

    <button onclick="showAssetSetup()">
      Assets
    </button>

    <button onclick="showInspections()">
      Inspection/Testing
    </button>

    <button onclick="showQuickInspection()">
      Quick Inspection/Testing
    </button>

    <button onclick="showCertificateSearch()">
      Certificates
    </button>

    <button onclick="showCustomerDetailedReport()">
      Reports
    </button>

    <button onclick="showEquipmentTypeCriteria()">
      Equipment Type Criteria
    </button>

  </div>

  <div class="content">
    <div id="page"></div>
  </div>

</div>

</div>

  `
window.showDashboard = function () {

  localStorage.setItem("currentPage", "dashboard")

  renderDashboard(
    customers,
    assets,
    sites,
    equipmentTypes,
    dashboardStats
  )

  loadDashboardAlerts()
  loadDashboardAttention()
  loadDashboardFailedEquipment()
  loadDashboardUpcomingExpiries()
}

let customerArchiveMode = localStorage.getItem("customerArchiveMode") || "active"

window.showCustomerSetup = function (mode = customerArchiveMode) {

  customerArchiveMode = mode

  localStorage.setItem("currentPage", "customers")
  localStorage.setItem("customerArchiveMode", mode)

  renderCustomerSetup(customers, customerArchiveMode)

}

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

  if (!response.ok) {
    alert("Error saving client: " + newClient.error)
    return
  }

  alert("Client saved: " + newClient.clientname)

  loadData()
}

window.editClient = function (clientid) {

  const customer = customers.find(
    c => String(c.clientid) === String(clientid)
  )

  if (!customer) {
    alert("Client not found")
    return
  }

  document.querySelector('#page').innerHTML = `

    <h2>Edit Client</h2>

    <label>Client Name</label>
    <input
      id="editClientName"
      type="text"
      value="${customer.clientname || ''}"
    >

    <label>Address</label>
    <input
      id="editClientAddress"
      type="text"
      value="${customer.clientaddr || ''}"
    >

    <button onclick="saveClientChanges(${customer.clientid})">
      Save Changes
    </button>

    <button onclick="showCustomerSetup()">
      Cancel
    </button>

  `
}

window.saveClientChanges = async function (clientid) {

  const clientname =
    document.querySelector('#editClientName').value

  const clientaddr =
    document.querySelector('#editClientAddress').value

  const response = await fetch(
    `http://localhost:5000/customers/${clientid}`,
    {
      method: "PUT",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        clientname,
        clientaddr
      })
    }
  )

  const updatedClient = await response.json()

  if (!response.ok) {
    alert("Error updating client: " + updatedClient.error)
    return
  }

  alert("Client updated")

  await loadData()

  showCustomerSetup()

}

window.filterCustomers = function () {
  const search = document
    .querySelector("#customerSearch")
    .value
    .toLowerCase()

  const filtered = customers.filter(customer => {
    const isArchived =
      customer.archived === true || customer.archived === "true"

    const matchesArchiveMode =
      customerArchiveMode === "all" ||
      (customerArchiveMode === "active" && !isArchived) ||
      (customerArchiveMode === "archived" && isArchived)

    const matchesSearch =
      String(customer.clientid || "").includes(search) ||
      (customer.clientname || "").toLowerCase().includes(search) ||
      (customer.clientaddr || "").toLowerCase().includes(search)

    return matchesArchiveMode && matchesSearch
  })

  const tableBody = document.querySelector("#customerTableBody")

  tableBody.innerHTML = filtered.map(customer => {
    const isArchived =
      customer.archived === true || customer.archived === "true"

    return `
      <tr>
        <td>${customer.clientid}</td>
        <td>${customer.clientname || ""}</td>
        <td>${customer.clientaddr || ""}</td>
        <td>${isArchived ? "Archived" : "Active"}</td>
        <td>
          <button onclick="editClient(${customer.clientid})">Edit</button>

          ${
            isArchived
              ? `<button onclick="unarchiveClient(${customer.clientid})">Restore</button>`
              : `<button onclick="archiveClient(${customer.clientid})">Archive</button>`
          }
        </td>
      </tr>
    `
  }).join("")
}

window.archiveClient = async function (clientid) {

  if (!confirm("Archive this client and all linked data?"))
    return

  await fetch(
    `http://localhost:5000/customers/${clientid}/archive`,
    {
      method: "PUT"
    }
  )

  await loadData()

  showCustomerSetup()

}

window.unarchiveClient = async function (clientid) {

  await fetch(
    `http://localhost:5000/customers/${clientid}/unarchive`,
    {
      method: "PUT"
    }
  )

  await loadData()

  showCustomerSetup()

}

window.showResponsiblePersons = function () {
  localStorage.setItem("currentPage", "responsible")
  renderResponsiblePersons(responsiblePersons)
}

window.showAddResponsiblePersonForm = function () {

  const sortedCustomers = [...customers].sort((a, b) =>
    (a.clientname || '').localeCompare(b.clientname || '')
  )

  document.querySelector('#page').innerHTML = `
    <h2>Add Responsible Person</h2>

    <label>Client</label>
    <select id="responsibleClient">
      <option value="">Select Client</option>

      ${sortedCustomers.map(client => `
        <option value="${client.clientid}">
          ${client.clientname}
        </option>
      `).join('')}
    </select>

    <label>Responsible Person Name</label>
    <input id="responsibleName" type="text">

    <button onclick="saveResponsiblePerson()">
      Save
    </button>

    <button onclick="showResponsiblePersons()">
      Cancel
    </button>
  `
}

window.saveResponsiblePerson = async function () {

  const clientid =
    document.querySelector('#responsibleClient').value

  const name =
    document.querySelector('#responsibleName').value

  if (!clientid || !name) {
    alert("Please complete all fields")
    return
  }

  const response = await fetch(
    "http://localhost:5000/responsible-persons",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        clientid,
        name
      })
    }
  )

  const result = await response.json()

  if (!response.ok) {
    alert(result.error)
    return
  }

  alert("Responsible Person Saved")

  await loadData()

  showResponsiblePersons()
}

window.editResponsiblePerson = function (personid) {

  const person = responsiblePersons.find(
    p => String(p.personid) === String(personid)
  )

  if (!person) {
    alert("Person not found")
    return
  }

  document.querySelector('#page').innerHTML = `
    <h2>Edit Responsible Person</h2>

    <label>Name</label>
    <input
      id="editResponsibleName"
      type="text"
      value="${person.name || ''}"
    >

    <button onclick="saveResponsiblePersonChanges(${person.personid})">
      Save Changes
    </button>

    <button onclick="showResponsiblePersons()">
      Cancel
    </button>
  `
}

window.saveResponsiblePersonChanges = async function (personid) {

  const person = responsiblePersons.find(
    p => String(p.personid) === String(personid)
  )

  const name =
    document.querySelector('#editResponsibleName').value

  const response = await fetch(
    `http://localhost:5000/responsible-persons/${personid}`,
    {
      method: "PUT",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        clientid: person.clientid,
        name
      })
    }
  )

  const result = await response.json()

  if (!response.ok) {
    alert(result.error)
    return
  }

  alert("Responsible Person Updated")

  await loadData()

  showResponsiblePersons()
}

window.filterResponsiblePersons = function () {

  const search = document
    .querySelector('#responsibleSearch')
    .value
    .toLowerCase()
    .trim()

  const filtered = responsiblePersons.filter(person =>
    String(person.personid || '').includes(search) ||
    (person.clientname || '').toLowerCase().includes(search) ||
    (person.name || '').toLowerCase().includes(search)
  )

  document.querySelector('#responsibleTableBody').innerHTML =
    filtered.map(person => `
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
    `).join('')
}

window.showSections = function () {
  localStorage.setItem("currentPage", "sections")
  renderSections(sections)
}

window.showAddSectionForm = function () {
  const sortedCustomers = [...customers].sort((a, b) =>
    (a.clientname || "").localeCompare(b.clientname || "")
  )

  document.querySelector("#page").innerHTML = `
    <h2>Add Section</h2>

    <div class="form-row">

      <div class="form-group">
        <label>Client</label>
        <select id="sectionClient" onchange="filterSectionDropdowns()">
          <option value="">Select Client</option>
          ${sortedCustomers.map(client => `
            <option value="${client.clientid}">
              ${client.clientname}
            </option>
          `).join("")}
        </select>
      </div>

      <div class="form-group">
        <label>Site</label>
        <select id="sectionSite">
          <option value="">Select Client First</option>
        </select>
      </div>

      <div class="form-group">
        <label>Responsible Person</label>
        <select id="sectionResponsible">
          <option value="">Select Client First</option>
        </select>
      </div>

      <div class="form-group">
        <label>Section Name</label>
        <input id="sectionName" type="text" placeholder="Enter section name">
      </div>

    </div>

    <button onclick="saveSectionFromForm()">Save Section</button>
    <button onclick="showSections()">Cancel</button>
  `
}

window.filterSectionDropdowns = function () {
  const clientid = document.querySelector('#sectionClient').value

  const siteSelect = document.querySelector('#sectionSite')
  const responsibleSelect = document.querySelector('#sectionResponsible')

  if (!clientid) {
    siteSelect.innerHTML = `<option value="">Select Client First</option>`
    responsibleSelect.innerHTML = `<option value="">Select Client First</option>`
    return
  }

  const filteredSites = sites
    .filter(site => String(site.clientid) === String(clientid))
    .sort((a, b) => (a.sitename || '').localeCompare(b.sitename || ''))

  const filteredResponsiblePersons = responsiblePersons
    .filter(person => String(person.clientid) === String(clientid))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  siteSelect.innerHTML = `
    <option value="">Select Site</option>
    ${filteredSites.map(site => `
      <option value="${site.siteid}">
        ${site.sitename}
      </option>
    `).join('')}
  `

  responsibleSelect.innerHTML = `
    <option value="">Select Responsible Person</option>
    ${filteredResponsiblePersons.map(person => `
      <option value="${person.personid}">
        ${person.name}
      </option>
    `).join('')}
  `
}

window.filterSections = function () {
  const searchType = document.querySelector("#sectionSearchType").value

  const search = document
    .querySelector("#sectionSearch")
    .value
    .toLowerCase()
    .trim()

  const filtered = sections.filter(section => {
    const fieldValue = String(section[searchType] || "")
      .toLowerCase()

    return fieldValue.includes(search)
  })

  document.querySelector("#sectionTableBody").innerHTML =
    filtered.map(section => `
      <tr>
        <td>${section.sectionid}</td>
        <td>${section.clientname || ""}</td>
        <td>${section.sitename || ""}</td>
        <td>${section.responsiblename || ""}</td>
        <td>${section.sectionname || ""}</td>
        <td>
          <button onclick="editSection(${section.sectionid})">
            Edit
          </button>
        </td>
      </tr>
    `).join("")
}

window.editSection = function (sectionid) {
  const section = sections.find(
    s => String(s.sectionid) === String(sectionid)
  )

  if (!section) {
    alert("Section not found")
    return
  }

  const filteredResponsiblePersons = responsiblePersons
    .filter(person => String(person.clientid) === String(section.clientid))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  document.querySelector('#page').innerHTML = `
    <h2>Edit Section</h2>

    <label>Client</label>
    <input type="text" value="${section.clientname || ''}" disabled>

    <label>Site</label>
    <input type="text" value="${section.sitename || ''}" disabled>

    <label>Responsible Person</label>
    <select id="editSectionResponsible">
      ${filteredResponsiblePersons.map(person => `
        <option
          value="${person.personid}"
          ${String(person.personid) === String(section.responsibleid) ? 'selected' : ''}
        >
          ${person.name}
        </option>
      `).join('')}
    </select>

    <label>Section Name</label>
    <input
      id="editSectionName"
      type="text"
      value="${section.sectionname || ''}"
    >

    <button onclick="saveSectionChanges(${section.sectionid})">
      Save Changes
    </button>

    <button onclick="showSections()">
      Cancel
    </button>
  `
}

window.saveSectionChanges = async function (sectionid) {
  const responsibleid =
    document.querySelector('#editSectionResponsible').value

  const sectionname =
    document.querySelector('#editSectionName').value

  if (!responsibleid || !sectionname) {
    alert("Please complete all fields")
    return
  }

  const response = await fetch(
    `http://localhost:5000/sections/${sectionid}`,
    {
      method: "PUT",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        responsibleid,
        sectionname
      })
    }
  )

  const updatedSection = await response.json()

  if (!response.ok) {
    alert("Error updating section: " + updatedSection.error)
    return
  }

  alert("Section updated")

  await loadData()

  showSections()
}

window.saveSectionFromForm = async function () {
  const clientid = document.querySelector('#sectionClient').value
  const siteid = document.querySelector('#sectionSite').value
  const responsibleid = document.querySelector('#sectionResponsible').value
  const sectionname = document.querySelector('#sectionName').value

  if (!clientid || !siteid || !responsibleid || !sectionname) {
    alert("Please complete all fields")
    return
  }

  const response = await fetch("http://localhost:5000/sections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientid,
      siteid,
      responsibleid,
      sectionname,
    }),
  })

  const newSection = await response.json()

  if (!response.ok) {
    alert("Error saving section: " + newSection.error)
    return
  }

  alert("Section saved: " + newSection.sectionname)

  await loadData()
  showSections()
}

window.showSites = function () {

  localStorage.setItem("currentPage", "sites")

  renderSites(sites)

}

window.filterSites = function () {
  const search = document
    .querySelector('#siteSearch')
    .value
    .toLowerCase()
    .trim()

  const filtered = sites.filter(site =>
    String(site.siteid || '').includes(search) ||
    (site.clientname || '').toLowerCase().includes(search) ||
    (site.sitename || '').toLowerCase().includes(search)
  )

  document.querySelector('#siteTableBody').innerHTML =
    filtered.map(site => `
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
    `).join('')
}

window.editSite = function (siteid) {
  const site = sites.find(
    s => String(s.siteid) === String(siteid)
  )

  if (!site) {
    alert("Site not found")
    return
  }

  document.querySelector('#page').innerHTML = `
    <h2>Edit Site</h2>

    <label>Client</label>
    <input
      type="text"
      value="${site.clientname || ''}"
      disabled
    >

    <label>Site Name</label>
    <input
      id="editSiteName"
      type="text"
      value="${site.sitename || ''}"
    >

    <button onclick="saveSiteChanges(${site.siteid})">
      Save Changes
    </button>

    <button onclick="showSites()">
      Cancel
    </button>
  `
}

window.saveSiteChanges = async function (siteid) {
  const sitename =
    document.querySelector('#editSiteName').value

  if (!sitename) {
    alert("Please enter a site name")
    return
  }

  const response = await fetch(
    `http://localhost:5000/sites/${siteid}`,
    {
      method: "PUT",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        sitename
      })
    }
  )

  const updatedSite = await response.json()

  if (!response.ok) {
    alert("Error updating site: " + updatedSite.error)
    return
  }

  alert("Site updated")

  await loadData()

  showSites()
}

window.showAddSiteForm = function () {
  const sortedCustomers = [...customers].sort((a, b) =>
    (a.clientname || '').localeCompare(b.clientname || '')
  )

  document.querySelector('#page').innerHTML = `
    <h2>Add Site</h2>

    <label>Client</label>
    <select id="siteClient">
      <option value="">Select Client</option>
      ${sortedCustomers.map(client => `
        <option value="${client.clientid}">
          ${client.clientname}
        </option>
      `).join('')}
    </select>

    <label>Site Name</label>
    <input id="siteName" type="text" placeholder="Enter site name">

    <button onclick="saveSiteFromForm()">
      Save Site
    </button>

    <button onclick="showSites()">
      Cancel
    </button>
  `
}

window.saveSiteFromForm = async function () {
  const clientid = document.querySelector('#siteClient').value
  const sitename = document.querySelector('#siteName').value

  if (!clientid || !sitename) {
    alert("Please complete all fields")
    return
  }

  const response = await fetch("http://localhost:5000/sites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientid,
      sitename,
    }),
  })

  const newSite = await response.json()

  if (!response.ok) {
    alert("Error saving site: " + newSite.error)
    return
  }

  alert("Site saved: " + newSite.sitename)

  await loadData()
  showSites()
}

window.showAssetSetup = function () {

  localStorage.setItem("currentPage", "assets")

  renderAssetSetup(assets)

}

window.showAddAssetForm = function () {
  const sortedCustomers = [...customers].sort((a, b) =>
    (a.clientname || '').localeCompare(b.clientname || '')
  )

  const sortedEquipmentTypes = [...equipmentTypes].sort((a, b) =>
    (a.description || '').localeCompare(b.description || '')
  )

  document.querySelector('#page').innerHTML = `
    <h2>Add Asset</h2>

    <div class="filter-card">

     <div class="asset-form-grid">

  <div class="form-group">
    <label>Client</label>
    <select id="assetClient" onchange="filterAssetDropdowns()">
      <option value="">Select Client</option>
      ${sortedCustomers.map(client => `
        <option value="${client.clientid}">
          ${client.clientname}
        </option>
      `).join('')}
    </select>
  </div>

  <div class="form-group">
    <label>Site</label>
    <select id="assetSite" onchange="filterAssetSections()">
      <option value="">Select Client First</option>
    </select>
  </div>

  <div class="form-group">
    <label>Section</label>
    <select id="assetSection" onchange="autoFillResponsibleFromSection()">
      <option value="">Select Site First</option>
    </select>
  </div>

  <div class="form-group">
    <label>Responsible Person</label>
    <input id="assetResponsibleName" type="text" placeholder="Auto-filled from Section" disabled>
    <input id="assetResponsible" type="hidden">
  </div>

  <div class="form-group">
    <label>Equipment Type</label>
    <select id="assetEquipType" onchange="handleAssetEquipmentTypeChange()">
      <option value="">Select Equipment Type</option>
      ${sortedEquipmentTypes.map(type => `
        <option value="${type.equiptypeid}">
          ${type.description}
        </option>
      `).join('')}
    </select>
  </div>

  <div id="dynamicAssetFields" class="dynamic-asset-fields"></div>

    <div class="form-group">
    <label>Serial No</label>
    <input id="assetSerialNo" type="text">
  </div>

  <div class="form-group">
    <label>Asset Tag Number</label>
    <input id="assetTagNo" type="text">
  </div>

  <div class="form-group">
    <label>Manufacturer</label>
    <input id="assetManufacturer" type="text">
  </div>

  <div class="form-group asset-description">
    <label>Description</label>
    <textarea id="assetDescription" rows="4" placeholder="Enter full asset description..."></textarea>
  </div>

  <div class="form-group" id="manufactureDateRow" style="display:none;">
    <label>Manufacture Date</label>
    <input id="assetManufactDate" type="date">
  </div>

  <div class="asset-photo-row">
    <div class="form-group">
      <label>Asset Photo 1</label>
      <input id="newAssetPhoto1" type="file" accept="image/*">
    </div>

    <div class="form-group">
      <label>Asset Photo 2</label>
      <input id="newAssetPhoto2" type="file" accept="image/*">
    </div>
  </div>

  <div class="form-actions">
    <button onclick="saveAssetFromForm()">Save Asset</button>
    <button onclick="showAssetSetup()">Cancel</button>
  </div>

</div>

  `
}

window.toggleManufactureDate = function () {
  const equiptypeid =
    document.querySelector('#assetEquipType').value

  const selectedType = equipmentTypes.find(
    type => String(type.equiptypeid) === String(equiptypeid)
  )

  const manufactureDateRow =
    document.querySelector('#manufactureDateRow')

  const manufactureDateInput =
    document.querySelector('#assetManufactDate')

  if (selectedType && String(selectedType.equipgroupid) === "400") {
    manufactureDateRow.style.display = "flex"
  } else {
    manufactureDateRow.style.display = "none"
    manufactureDateInput.value = ""
  }
}

window.handleAssetEquipmentTypeChange = function () {
  toggleManufactureDate()
  loadDynamicAssetFields()
}

window.loadDynamicAssetFields = function () {
  const equiptypeid = document.querySelector('#assetEquipType').value
  const container = document.querySelector('#dynamicAssetFields')

  container.innerHTML = ''

  const selectedType = equipmentTypes.find(
    type => String(type.equiptypeid) === String(equiptypeid)
  )

  if (!selectedType) return

  const groupid = String(selectedType.equipgroupid)

  let html = ''

  if (groupid === '100') {
    html = `
      <div class="form-group"><label>WLL(kg)</label><input id="assetWLL" type="number"></div>
      <div class="form-group"><label>Height of Lift(mm)</label><input id="assetHeightOfLift" type="number"></div>
      <div class="form-group"><label>Number of Chain Falls</label><input id="assetNumberOfChainFalls" type="number"></div>
      <div class="form-group"><label>OEM Top Hook Size(mm)</label><input id="assetOEMTopHookSize" type="number"></div>
      <div class="form-group"><label>OEM Bottom Hook Size(mm)</label><input id="assetOEMBottomHookSize" type="number"></div>
      <div class="form-group"><label>Load Chain Diameter(mm)</label><input id="assetLoadChainDiameter" type="number"></div>
    `
  }

  if (groupid === '200') {
    html = `
      <div class="form-group"><label>WLL(kg)</label><input id="assetWLL" type="number"></div>
      <div class="form-group"><label>Effective Length(mm)</label><input id="assetEffectiveLength" type="number"></div>
    `
  }

  if (groupid === '300' || groupid === '600') {
    html = `
      <div class="form-group"><label>WLL(kg)</label><input id="assetWLL" type="number"></div>
    `
  }

  if (groupid === '400') {
    html = `
      <div class="form-group"><label>WLL(kg)</label><input id="assetWLL" type="number"></div>
      <div class="form-group"><label>Span(mm)</label><input id="assetSpan" type="number"></div>
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="assetPermissibleDeflection" type="number"></div>
      <div class="form-group"><label>Hook Size(mm)</label><input id="assetHookSize" type="number"></div>
      <div class="form-group"><label>Height of Lift(mm)</label><input id="assetHeightOfLift" type="number"></div>
      <div class="form-group"><label>Steel Wire Rope(mm)</label><input id="assetSteelWireRopeMM" type="number"></div>
    `
  }

  if (groupid === '500') {
    html = `
      <div class="form-group"><label>WLL(kg)</label><input id="assetWLL" type="number"></div>
      <div class="form-group"><label>Span(mm)</label><input id="assetSpan" type="number"></div>
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="assetPermissibleDeflection" type="number"></div>
      <div class="form-group"><label>Hook Size(mm)</label><input id="assetHookSize" type="number"></div>
      <div class="form-group"><label>Hoist Description</label><input id="assetHoistDescription" type="text"></div>
      <div class="form-group"><label>Hoist Serial No</label><input id="assetHoistSerialNo" type="text"></div>
    `
  }

  container.innerHTML = html
}

window.filterAssetDropdowns = function () {
  const clientid = document.querySelector('#assetClient').value
  const siteSelect = document.querySelector('#assetSite')

  document.querySelector('#assetSection').innerHTML =
    `<option value="">Select Site First</option>`

  document.querySelector('#assetResponsibleName').value = ''
  document.querySelector('#assetResponsible').value = ''

  if (!clientid) {
    siteSelect.innerHTML = `<option value="">Select Client First</option>`
    return
  }

  const filteredSites = sites
    .filter(site => String(site.clientid) === String(clientid))
    .sort((a, b) =>
      (a.sitename || '').localeCompare(b.sitename || '')
    )

  siteSelect.innerHTML = `
    <option value="">Select Site</option>

    ${filteredSites.map(site => `
      <option value="${site.siteid}">
        ${site.sitename}
      </option>
    `).join('')}
  `
}

window.filterAssetSections = function () {
  const siteid =
    document.querySelector('#assetSite').value

  const sectionSelect =
    document.querySelector('#assetSection')

  document.querySelector('#assetResponsibleName').value = ''
  document.querySelector('#assetResponsible').value = ''

  if (!siteid) {
    sectionSelect.innerHTML =
      `<option value="">Select Site First</option>`
    return
  }

  const filteredSections = sections
    .filter(section =>
      String(section.siteid) === String(siteid)
    )
    .sort((a, b) =>
      (a.sectionname || '').localeCompare(b.sectionname || '')
    )

  sectionSelect.innerHTML = `
    <option value="">Select Section</option>

    ${filteredSections.map(section => `
      <option value="${section.sectionid}">
        ${section.sectionname}
      </option>
    `).join('')}
  `
}

window.autoFillResponsibleFromSection = function () {
  const sectionid =
    document.querySelector('#assetSection').value

  const responsibleNameInput =
    document.querySelector('#assetResponsibleName')

  const responsibleIdInput =
    document.querySelector('#assetResponsible')

  responsibleNameInput.value = ''
  responsibleIdInput.value = ''

  if (!sectionid) return

  const section = sections.find(
    s => String(s.sectionid) === String(sectionid)
  )

  if (!section) return

  responsibleNameInput.value =
    section.responsiblename || ''

  responsibleIdInput.value =
    section.responsibleid || ''
}

window.saveAssetFromForm = async function () {
  const clientid = document.querySelector('#assetClient').value
  const siteid = document.querySelector('#assetSite').value
  const sectionid = document.querySelector('#assetSection').value
  const responsibleid = document.querySelector('#assetResponsible').value
  const equiptypeid = document.querySelector('#assetEquipType').value
  const assettagno = document.querySelector('#assetTagNo')?.value || ""
  const serialno = document.querySelector('#assetSerialNo').value
  const manufacturer = document.querySelector('#assetManufacturer').value
  const description = document.querySelector('#assetDescription').value
  const manufactdate = document.querySelector('#assetManufactDate')?.value || ""
  
  if (!clientid || !siteid || !sectionid || !responsibleid || !equiptypeid || !description) {
    alert("Please complete Client, Site, Section, Responsible Person, Equipment Type, and Description")
    return
  }

  const response = await fetch("http://localhost:5000/assets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
  clientid,
  siteid,
  sectionid,
  responsibleid,
  equiptypeid,
  assettagno,
  serialno,
  manufacturer,
  description,
  manufactdate,

  wll: document.querySelector('#assetWLL')?.value || null,
  heightoflift: document.querySelector('#assetHeightOfLift')?.value || null,
  numberofchainfalls: document.querySelector('#assetNumberOfChainFalls')?.value || null,
  oemtophooksize: document.querySelector('#assetOEMTopHookSize')?.value || null,
  oembottomhooksize: document.querySelector('#assetOEMBottomHookSize')?.value || null,
  loadchaindiameter: document.querySelector('#assetLoadChainDiameter')?.value || null,
  effectivelength: document.querySelector('#assetEffectiveLength')?.value || null,
  span: document.querySelector('#assetSpan')?.value || null,
  permissibledeflection: document.querySelector('#assetPermissibleDeflection')?.value || null,
  hooksize: document.querySelector('#assetHookSize')?.value || null,
  steelwireropemm: document.querySelector('#assetSteelWireRopeMM')?.value || null,
  hoistdescription: document.querySelector('#assetHoistDescription')?.value || null,
  hoistserialno: document.querySelector('#assetHoistSerialNo')?.value || null
}),
  })

  const newAsset = await response.json()

  if (!response.ok) {
    alert("Error saving asset: " + newAsset.error)
    return
  }

  const photo1 = document.querySelector('#newAssetPhoto1')?.files[0]
  const photo2 = document.querySelector('#newAssetPhoto2')?.files[0]

  if (photo1 || photo2) {
    const formData = new FormData()

    if (photo1) {
      formData.append("photo1", photo1)
    }

    if (photo2) {
      formData.append("photo2", photo2)
    }

    const photoResponse = await fetch(
      `http://localhost:5000/assets/${newAsset.assetid}/photos`,
      {
        method: "POST",
        body: formData,
      }
    )

    const photoResult = await photoResponse.json()

    if (!photoResponse.ok) {
      alert("Asset saved, but photo upload failed: " + photoResult.error)
      await loadData()
      showAssetSetup()
      return
    }
  }

  alert("Asset saved successfully")

  await loadData()
  showAssetSetup()
}

window.filterAssets = function () {
  const searchType =
    document.querySelector('#assetSearchType').value

  const search =
    document.querySelector('#assetSearch').value
      .toLowerCase()
      .trim()

  const filtered = assets.filter(asset => {
    const fieldValue = String(asset[searchType] || '')
      .toLowerCase()

    return fieldValue.includes(search)
  })

  const tableBody = document.querySelector('#assetTableBody')

  tableBody.innerHTML = filtered.slice(0, 100).map(asset => `
    <tr>
      <td>${asset.assetid}</td>
      <td>${asset.serialno || ''}</td>
      <td>${asset.clientname || ''}</td>
      <td>${asset.sitename || ''}</td>
      <td>${asset.sectionname || ''}</td>
      <td>${asset.equipmenttype || ''}</td>
      <td>${asset.description || ''}</td>
      <td>
          <div class="action-buttons">

            <button
              onclick="startInspection(${asset.assetid}, 'VISUAL', 'inspections')"
            >
              Inspection
            </button>

            ${
              ['100','400','500'].includes(String(asset.equipgroupid))
              ? `
                <button
                  class="load-test-btn"
                  onclick="startInspection(${asset.assetid}, 'LOADTEST', 'inspections')"
                >
                  Load Test
                </button>
              `
              : ''
            }

            <button
              onclick="showAssetHistoryFromSetup(${asset.assetid})"
            >
              History
            </button>

          </div>
        </td>
    </tr>
  `).join('')
}

window.editAsset = function (assetid) {
  const asset = assets.find(a => String(a.assetid) === String(assetid))

  if (!asset) {
    alert("Asset not found")
    return
  }

  const selectedType = equipmentTypes.find(
    type => String(type.equiptypeid) === String(asset.equiptypeid)
  )

  const groupid = String(selectedType?.equipgroupid || '')

  let dynamicEditFields = ''

  if (groupid === '100') {
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${asset.wll || ''}"></div>
      <div class="form-group"><label>Height of Lift(mm)</label><input id="editAssetHeightOfLift" type="number" value="${asset.heightoflift || ''}"></div>
      <div class="form-group"><label>Number of Chain Falls</label><input id="editAssetNumberOfChainFalls" type="number" value="${asset.numberofchainfalls || ''}"></div>
      <div class="form-group"><label>OEM Top Hook Size(mm)</label><input id="editAssetOEMTopHookSize" type="number" value="${asset.oemtophooksize || ''}"></div>
      <div class="form-group"><label>OEM Bottom Hook Size(mm)</label><input id="editAssetOEMBottomHookSize" type="number" value="${asset.oembottomhooksize || ''}"></div>
      <div class="form-group"><label>Load Chain Diameter(mm)</label><input id="editAssetLoadChainDiameter" type="number" value="${asset.loadchaindiameter || ''}"></div>
    `
  }

  if (groupid === '200') {
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${asset.wll || ''}"></div>
      <div class="form-group"><label>Effective Length(mm)</label><input id="editAssetEffectiveLength" type="number" value="${asset.effectivelength || ''}"></div>
    `
  }

  if (groupid === '300' || groupid === '600') {
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${asset.wll || ''}"></div>
    `
  }

  if (groupid === '400') {
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${asset.wll || ''}"></div>
      <div class="form-group"><label>Span(mm)</label><input id="editAssetSpan" type="number" value="${asset.span || ''}"></div>
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="editAssetPermissibleDeflection" type="number" value="${asset.permissibledeflection || ''}"></div>
      <div class="form-group"><label>Hook Size(mm)</label><input id="editAssetHookSize" type="number" value="${asset.hooksize || ''}"></div>
      <div class="form-group"><label>Height of Lift(mm)</label><input id="editAssetHeightOfLift" type="number" value="${asset.heightoflift || ''}"></div>
      <div class="form-group"><label>Steel Wire Rope(mm)</label><input id="editAssetSteelWireRopeMM" type="number" value="${asset.steelwireropemm || ''}"></div>
    `
  }

  if (groupid === '500') {
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${asset.wll || ''}"></div>
      <div class="form-group"><label>Span(mm)</label><input id="editAssetSpan" type="number" value="${asset.span || ''}"></div>
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="editAssetPermissibleDeflection" type="number" value="${asset.permissibledeflection || ''}"></div>
      <div class="form-group"><label>Hook Size(mm)</label><input id="editAssetHookSize" type="number" value="${asset.hooksize || ''}"></div>
      <div class="form-group"><label>Hoist Description</label><input id="editAssetHoistDescription" type="text" value="${asset.hoistdescription || ''}"></div>
      <div class="form-group"><label>Hoist Serial No</label><input id="editAssetHoistSerialNo" type="text" value="${asset.hoistserialno || ''}"></div>
    `
  }

  document.querySelector('#page').innerHTML = `
    <h2>Edit Asset ${asset.assetid}</h2>

    <div class="filter-card">
      <div class="asset-form-grid">

        <div class="form-group">
          <label>Serial No</label>
          <input id="editAssetSerialNo" type="text" value="${asset.serialno || ''}">
        </div>

        <div class="form-group">
          <label>Asset Tag Number</label>
          <input id="editAssetTagNo" type="text" value="${asset.assettagno || ''}">
        </div>

        <div class="form-group">
          <label>Manufacturer</label>
          <input id="editAssetManufacturer" type="text" value="${asset.manufacturer || ''}">
        </div>

        ${dynamicEditFields}

        <div class="form-group asset-description">
          <label>Description</label>
          <textarea id="editAssetDescription" rows="4">${asset.description || ''}</textarea>
        </div>

        <div class="asset-photo-row">
          <div class="form-group">
            <label>Replace Photo 1</label>
            <input id="assetPhoto1" type="file" accept="image/*">
          </div>

          <div class="form-group">
            <label>Replace Photo 2</label>
            <input id="assetPhoto2" type="file" accept="image/*">
          </div>
        </div>

        <div class="form-actions">
          <button onclick="saveAssetChanges(${asset.assetid})">
            Save Changes
          </button>

          <button onclick="uploadAssetPhotos(${asset.assetid})">
            Upload Photos
          </button>

          <button onclick="showAssetSetup()">
            Cancel
          </button>
        </div>

      </div>
    </div>

    <div class="photo-preview-grid">
      ${asset.media1 ? `
        <div class="photo-card">
          <h3>Photo 1</h3>
          <img src="http://localhost:5000${asset.media1}">
        </div>
      ` : ''}

      ${asset.media2 ? `
        <div class="photo-card">
          <h3>Photo 2</h3>
          <img src="http://localhost:5000${asset.media2}">
        </div>
      ` : ''}
    </div>
  `
}

window.saveAssetChanges = async function (assetid) {
  const serialno = document.querySelector('#editAssetSerialNo').value
  const assettagno = document.querySelector('#editAssetTagNo')?.value || ""
  const manufacturer = document.querySelector('#editAssetManufacturer').value
  const description = document.querySelector('#editAssetDescription').value

  const response = await fetch(`http://localhost:5000/assets/${assetid}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      serialno,
      assettagno,
      manufacturer,
      description,

      wll: document.querySelector('#editAssetWLL')?.value || null,
      heightoflift: document.querySelector('#editAssetHeightOfLift')?.value || null,
      numberofchainfalls: document.querySelector('#editAssetNumberOfChainFalls')?.value || null,
      oemtophooksize: document.querySelector('#editAssetOEMTopHookSize')?.value || null,
      oembottomhooksize: document.querySelector('#editAssetOEMBottomHookSize')?.value || null,
      loadchaindiameter: document.querySelector('#editAssetLoadChainDiameter')?.value || null,
      effectivelength: document.querySelector('#editAssetEffectiveLength')?.value || null,
      span: document.querySelector('#editAssetSpan')?.value || null,
      permissibledeflection: document.querySelector('#editAssetPermissibleDeflection')?.value || null,
      hooksize: document.querySelector('#editAssetHookSize')?.value || null,
      steelwireropemm: document.querySelector('#editAssetSteelWireRopeMM')?.value || null,
      hoistdescription: document.querySelector('#editAssetHoistDescription')?.value || null,
      hoistserialno: document.querySelector('#editAssetHoistSerialNo')?.value || null
    }),
  })

  const updatedAsset = await response.json()

  if (!response.ok) {
    alert("Error updating asset: " + updatedAsset.error)
    return
  }

  alert("Asset updated: " + updatedAsset.assetid)

  await loadData()
  showAssetSetup()
}

window.archiveAsset = async function (assetid) {
  const confirmArchive = confirm(
    "Archive asset " + assetid + "? It will be hidden but its inspection history will remain."
  )

  if (!confirmArchive) return

  const response = await fetch(`http://localhost:5000/assets/${assetid}/archive`, {
    method: "PUT",
  })

  const archivedAsset = await response.json()

  if (!response.ok) {
    alert("Error archiving asset: " + archivedAsset.error)
    return
  }

  alert("Asset archived: " + archivedAsset.assetid)

  await loadData()
  showAssetSetup()
}

window.unarchiveAsset = async function (assetid) {
  const confirmRestore = confirm(
    "Restore asset " + assetid + "?"
  );

  if (!confirmRestore) return;

  const response = await fetch(`http://localhost:5000/assets/${assetid}/unarchive`, {
    method: "PUT",
  });

  const restoredAsset = await response.json();

  if (!response.ok) {
    alert("Error restoring asset: " + restoredAsset.error);
    return;
  }

  alert("Asset restored: " + restoredAsset.assetid);

  await loadData();
  showAssetSetup();
};

window.uploadAssetPhotos = async function (assetid) {
  const photo1 = document.querySelector('#assetPhoto1').files[0]
  const photo2 = document.querySelector('#assetPhoto2').files[0]

  if (!photo1 && !photo2) {
    alert("Please choose at least one photo")
    return
  }

  const formData = new FormData()

  if (photo1) {
    formData.append("photo1", photo1)
  }

  if (photo2) {
    formData.append("photo2", photo2)
  }

  const response = await fetch(`http://localhost:5000/assets/${assetid}/photos`, {
    method: "POST",
    body: formData,
  })

  const updatedAsset = await response.json()

  if (!response.ok) {
    alert("Error uploading photos: " + updatedAsset.error)
    return
  }

  alert("Photos uploaded for asset " + updatedAsset.assetid)

  await loadData()
  editAsset(assetid)
}

window.showEquipmentTypeCriteria = function () {

  localStorage.setItem("currentPage", "criteria")

  window.criteriaEquipmentFilter =
    window.criteriaEquipmentFilter || ""

  renderEquipmentTypeCriteria(
    equipmentTypes,
    criteria
  )

}

window.filterEquipmentCriteria = function () {
  window.criteriaEquipmentFilter =
    document.querySelector('#criteriaEquipmentFilter')?.value || ""

  showEquipmentTypeCriteria()
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function renderCriteriaPopup(row = {}) {
  const sortedEquipmentTypes = [...equipmentTypes].sort((a, b) =>
    (a.description || '').localeCompare(b.description || '')
  )

  const selectedEquipmentType =
    row.equiptypeid ||
    window.criteriaEquipmentFilter ||
    sortedEquipmentTypes[0]?.equiptypeid ||
    ""

  const selectedCategory =
    row.inspectioncategory || "VISUAL"

  const selectedFieldType =
    row.fieldtype || "PASSFAIL"

  document.querySelector('#criteriaPopup')?.remove()

  document.body.insertAdjacentHTML('beforeend', `
    <div
      id="criteriaPopup"
      class="criteria-modal-overlay"
      onclick="closeCriteriaPopupOnBackdrop(event)"
    >
      <div class="criteria-modal" role="dialog" aria-modal="true" aria-labelledby="criteriaPopupTitle">
        <div class="criteria-modal-header">
          <h2 id="criteriaPopupTitle">
            ${row.criteriaid ? "Edit Criteria" : "Add Criteria"}
          </h2>

          <button type="button" onclick="cancelCriteriaEdit()">
            Close
          </button>
        </div>

        <div class="criteria-modal-body">
          <input id="editingCriteriaId" type="hidden" value="${row.criteriaid || ""}">

          <div class="form-row">
            <div class="form-group">
              <label>Equipment Type</label>
              <select id="criteriaEquipType">
                ${sortedEquipmentTypes.map(type => `
                  <option
                    value="${type.equiptypeid}"
                    ${String(type.equiptypeid) === String(selectedEquipmentType) ? "selected" : ""}
                  >
                    ${type.description}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Inspection Category</label>
              <select id="criteriaCategory">
                <option value="VISUAL" ${selectedCategory === "VISUAL" ? "selected" : ""}>
                  Visual Inspection
                </option>
                <option value="LOADTEST" ${selectedCategory === "LOADTEST" ? "selected" : ""}>
                  Load Test
                </option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group form-group-wide">
              <label>Criteria Name</label>
              <input id="criteriaName" type="text" value="${escapeAttribute(row.criterianame)}">
            </div>

            <div class="form-group">
              <label>Field Type</label>
              <select id="criteriaFieldType">
                <option value="PASSFAIL" ${selectedFieldType === "PASSFAIL" ? "selected" : ""}>Pass / Fail / N/A</option>
                <option value="TEXT" ${selectedFieldType === "TEXT" ? "selected" : ""}>Text Input</option>
                <option value="NUMBER" ${selectedFieldType === "NUMBER" ? "selected" : ""}>Number Input</option>
                <option value="DATE" ${selectedFieldType === "DATE" ? "selected" : ""}>Date Input</option>
                <option value="LOAD" ${selectedFieldType === "LOAD" ? "selected" : ""}>Load Value</option>
                <option value="MEASUREMENT" ${selectedFieldType === "MEASUREMENT" ? "selected" : ""}>Measurement</option>
              </select>
            </div>
          </div>
        </div>

        <div class="criteria-modal-footer">
          <button type="button" onclick="cancelCriteriaEdit()">
            Cancel
          </button>

          <button type="button" onclick="saveCriteria()">
            Save Criteria
          </button>
        </div>
      </div>
    </div>
  `)

  document.querySelector('#criteriaName')?.focus()
}

window.openCriteriaPopup = function () {
  renderCriteriaPopup()
}

window.closeCriteriaPopupOnBackdrop = function (event) {
  if (event.target.id === "criteriaPopup") {
    cancelCriteriaEdit()
  }
}

window.saveCriteria = async function () {
  const criteriaid =
    document.querySelector('#editingCriteriaId')?.value || ""

  const equiptypeid =
    document.querySelector('#criteriaEquipType').value

  const inspectioncategory =
    document.querySelector('#criteriaCategory').value

  const criterianame =
    document.querySelector('#criteriaName').value

  if (!criterianame) {
    alert("Please enter a criteria name")
    return
  }

  const payload = {
    equiptypeid,
    criterianame,
    fieldtype: document.querySelector('#criteriaFieldType').value,
    required: true,
    sortorder: 1,
    inspectioncategory
  }

  const response = await fetch(
    criteriaid
      ? `http://localhost:5000/equipment-type-criteria/${criteriaid}`
      : "http://localhost:5000/equipment-type-criteria",
    {
      method: criteriaid ? "PUT" : "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(payload)
    }
  )

  const newCriteria = await response.json()

  if (!response.ok) {
    alert("Error saving criteria: " + newCriteria.error)
    return
  }

  alert(criteriaid ? "Criteria updated" : "Criteria saved")

  await loadData()

  cancelCriteriaEdit()

  showEquipmentTypeCriteria()
}

window.editCriteria = function (criteriaid) {
  const row = criteria.find(
    item => String(item.criteriaid) === String(criteriaid)
  )

  if (!row) {
    alert("Criteria not found")
    return
  }

  renderCriteriaPopup(row)
}

window.cancelCriteriaEdit = function () {
  document.querySelector('#criteriaPopup')?.remove()
}

window.deleteCriteria = async function (criteriaid) {
  const row = criteria.find(
    item => String(item.criteriaid) === String(criteriaid)
  )

  if (!row) {
    alert("Criteria not found")
    return
  }

  if (!confirm(`Delete this criteria?\n\n${row.criterianame}\n\nThis removes it from future inspection/load test forms.`)) {
    return
  }

  const response = await fetch(
    `http://localhost:5000/equipment-type-criteria/${criteriaid}`,
    {
      method: "DELETE"
    }
  )

  const result = await response.json()

  if (!response.ok) {
    alert("Error deleting criteria: " + result.error)
    return
  }

  alert("Criteria deleted")

  await loadData()

  showEquipmentTypeCriteria()
}

window.showInspections = function () {

  localStorage.setItem("currentPage", "inspections")

  renderInspections(assets)

}

window.showCertificateSearch = function () {
  localStorage.setItem("currentPage", "certificates")

  renderCertificateSearch(
    customers,
    sites,
    sections
  )
}

window.showCustomerDetailedReport = function () {
  localStorage.setItem("currentPage", "customer-report")

  renderCustomerDetailedReport(customers)
}

window.handleCertificateEnter = function (event) {
  if (event.key === "Enter") {
    searchCertificates()
  }
}

window.filterCertificateSites = function () {
  const clientid = document.querySelector('#certClient').value
  const siteSelect = document.querySelector('#certSite')
  const sectionSelect = document.querySelector('#certSection')

  sectionSelect.innerHTML = `<option value="">All Sections</option>`

  const filteredSites = clientid
    ? sites.filter(site => String(site.clientid) === String(clientid))
    : sites

  siteSelect.innerHTML = `
    <option value="">All Sites</option>
    ${filteredSites.map(site => `
      <option value="${site.siteid}">
        ${site.sitename}
      </option>
    `).join("")}
  `
}

window.filterCertificateSections = function () {
  const siteid = document.querySelector('#certSite').value
  const sectionSelect = document.querySelector('#certSection')

  const filteredSections = siteid
    ? sections.filter(section => String(section.siteid) === String(siteid))
    : sections

  sectionSelect.innerHTML = `
    <option value="">All Sections</option>
    ${filteredSections.map(section => `
      <option value="${section.sectionid}">
        ${section.sectionname}
      </option>
    `).join("")}
  `
}

window.clearCertificateSearch = function () {
  document.querySelector('#certSearch').value = ""
  document.querySelector('#certInspectionType').value = ""
  document.querySelector('#certStatus').value = ""
  document.querySelector('#certClient').value = ""
  document.querySelector('#certSite').innerHTML = `<option value="">All Sites</option>`
  document.querySelector('#certSection').innerHTML = `<option value="">All Sections</option>`
  document.querySelector('#certDateFrom').value = ""
  document.querySelector('#certDateTo').value = ""

  searchCertificates()
}

window.searchCertificates = async function () {
  const params = new URLSearchParams()

  params.append("search", document.querySelector('#certSearch')?.value || "")
  params.append("inspectiontype", document.querySelector('#certInspectionType')?.value || "")
  params.append("status", document.querySelector('#certStatus')?.value || "")
  params.append("clientid", document.querySelector('#certClient')?.value || "")
  params.append("siteid", document.querySelector('#certSite')?.value || "")
  params.append("sectionid", document.querySelector('#certSection')?.value || "")
  params.append("datefrom", document.querySelector('#certDateFrom')?.value || "")
  params.append("dateto", document.querySelector('#certDateTo')?.value || "")

  const response = await fetch(
    `http://localhost:5000/certificates/search?${params.toString()}`
  )

  const certificates = await response.json()

  if (!response.ok) {
    alert("Error searching certificates: " + certificates.error)
    return
  }

  const safeCount = certificates.filter(c => c.status === "SAFE").length
  const notSafeCount = certificates.filter(c => c.status === "NOT SAFE").length
  const loadTestCount = certificates.filter(c => c.inspectiontype === "LOADTEST").length
  const visualCount = certificates.filter(c => c.inspectiontype === "VISUAL").length

  document.querySelector('#certificateStats').innerHTML = `
    <p><strong>Total:</strong> ${certificates.length}</p>
    <p><strong>Safe:</strong> ${safeCount}</p>
    <p><strong>Not Safe:</strong> ${notSafeCount}</p>
    <p><strong>Visual:</strong> ${visualCount}</p>
    <p><strong>Load Tests:</strong> ${loadTestCount}</p>
  `

  if (certificates.length === 0) {
    document.querySelector('#certificateResults').innerHTML = `
      <p>No certificates found.</p>
    `
    return
  }

  document.querySelector('#certificateResults').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Test ID</th>
          <th>Tag No</th>
          <th>Client</th>
          <th>Site</th>
          <th>Asset</th>
          <th>Serial No</th>
          <th>Type</th>
          <th>Date</th>
          <th>Status</th>
          <th>Inspector</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        ${certificates.map(cert => `
          <tr>
            <td>${cert.testid}</td>
            <td>${cert.tagnumber || "-"}</td>
            <td>${cert.clientname || ""}</td>
            <td>${cert.sitename || ""}</td>
            <td>${cert.description || ""}</td>
            <td>${cert.serialno || ""}</td>
            <td>${cert.inspectiontype || ""}</td>
            <td>${cert.testdate ? cert.testdate.split("T")[0] : ""}</td>
            <td>
              <strong class="${
                cert.status === "SAFE"
                  ? "status-safe"
                  : "status-unsafe"
              }">
                ${cert.status || ""}
              </strong>
            </td>
            <td>${cert.inspector || "-"}</td>
            <td>
              <button onclick="previewCertificate(${cert.testid})">Preview</button>
              <button onclick="openCertificateModal(${cert.testid})">View</button>
              <a
                class="cert-action-link"
                href="http://localhost:5000/inspections/${cert.testid}/certificate.pdf"
                download="certificate-${cert.testid}.pdf"
              >
                Download PDF
              </a>
              <button onclick="mailCertificate(${cert.testid})">Mail</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `
}

window.openCertificateFromSearch = function () {
  const testid = document.querySelector('#certificateSearch').value.trim()

  if (!testid) {
    alert("Enter a certificate number")
    return
  }

  openCertificateModal(testid)
}

window.showQuickInspection = function () {
  localStorage.setItem("currentPage", "quick-inspection")
  renderQuickInspection()
}

window.handleQuickInspectionEnter = function (event) {
  if (event.key === "Enter") {
    quickFindAsset()
  }
}

window.quickFindAsset = function () {
  const search = document
    .querySelector('#quickAssetSearch')
    .value
    .toLowerCase()
    .trim()

  const resultBox =
    document.querySelector('#quickInspectionResult')

  if (!search) {
    resultBox.innerHTML = `
      <p>Please scan or enter an asset number.</p>
    `
    return
  }

  const matchedAssets = assets.filter(asset =>
    String(asset.assetid || '').toLowerCase().includes(search) ||
    (asset.assettagno || '').toLowerCase().includes(search) ||
    (asset.serialno || '').toLowerCase().includes(search) ||
    (asset.qrcode || '').toLowerCase().includes(search)
  )

  if (matchedAssets.length === 0) {
    resultBox.innerHTML = `
      <div class="filter-card">
        <h3>No Asset Found</h3>
        <p>No asset matched: <strong>${search}</strong></p>
      </div>
    `
    return
  }

  if (matchedAssets.length > 1) {
    resultBox.innerHTML = `
      <div class="filter-card">
        <h3>Multiple Assets Found</h3>
        <p>Please select the correct asset.</p>

        <table>
          <thead>
            <tr>
              <th>Asset ID</th>
              <th>Asset Tag</th>
              <th>Serial No</th>
              <th>Description</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            ${matchedAssets.map(asset => `
              <tr>
                <td>${asset.assetid}</td>
                <td>${asset.assettagno || ''}</td>
                <td>${asset.serialno || ''}</td>
                <td>${asset.description || ''}</td>
                <td>
                  <button onclick="quickOpenAsset(${asset.assetid})">
                    Select
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    return
  }

  quickOpenAsset(matchedAssets[0].assetid)
}

window.quickOpenAsset = async function (assetid) {
  const resultBox =
    document.querySelector('#quickInspectionResult') ||
    document.querySelector('#dashboardAssetSearchResult')

  if (!resultBox) {
    alert("No asset result panel found")
    return
  }

  const returnPage =
    resultBox.id === "dashboardAssetSearchResult" ? "quick" : "quick"

  const response = await fetch(
    `http://localhost:5000/assets/${assetid}/quick-details`
  )

  const asset = await response.json()

  if (!response.ok) {
    alert("Asset details not found: " + asset.error)
    return
  }

  resultBox.innerHTML = `
    <div class="filter-card">
      <h3>Asset Found</h3>

      <div class="quick-asset-grid">

        <div>
          <p><strong>Asset ID:</strong> ${asset.assetid}</p>
          <p><strong>Asset Tag:</strong> ${asset.assettagno || ''}</p>
          <p><strong>Serial No:</strong> ${asset.serialno || ''}</p>
          <p><strong>Description:</strong> ${asset.description || ''}</p>
          <p><strong>Equipment Type:</strong> ${asset.equipmenttype || ''}</p>
          <p><strong>Client:</strong> ${asset.clientname || ''}</p>
          <p><strong>Site:</strong> ${asset.sitename || ''}</p>
          <p><strong>Section:</strong> ${asset.sectionname || ''}</p>
        </div>

        <div>
          <h4>Inspection History</h4>

          <p>
            <strong>Last Visual:</strong>
      ${asset.lastvisualdate ? asset.lastvisualdate.split('T')[0] : 'No record'}
            -
            ${asset.lastvisualstatus || ''}
          </p>

          <p>
            <strong>Last Load Test:</strong>
    ${asset.lastloadtestdate ? asset.lastloadtestdate.split('T')[0] : 'No record'}          
            -
            ${asset.lastloadteststatus || ''}
          </p>
        </div>

      </div>

      <div class="quick-photo-grid">
        ${asset.media1 ? `
          <div class="quick-photo-card">
            <h4>Photo 1</h4>
            <img src="http://localhost:5000${asset.media1}">
          </div>
        ` : ''}

        ${asset.media2 ? `
          <div class="quick-photo-card">
            <h4>Photo 2</h4>
            <img src="http://localhost:5000${asset.media2}">
          </div>
        ` : ''}
      </div>

      <div class="form-actions">
<button onclick="startInspection(${asset.assetid}, 'VISUAL', '${returnPage}')">Visual Inspection
        </button>

<button class="load-test-btn" onclick="startInspection(${asset.assetid}, 'LOADTEST', '${returnPage}')">Load Test
        </button>

      </div>
    </div>
  `
}

window.startQuickInspection = function (assetid, inspectiontype) {
  startInspection(assetid, inspectiontype, "quick")
}

window.filterInspectionAssets = function () {
  const search = document
    .querySelector('#inspectionAssetSearch')
    .value
    .toLowerCase()

  const filtered = assets.filter(asset =>
    String(asset.assetid || '').includes(search) ||
    (asset.assettagno || '').toLowerCase().includes(search) ||
    (asset.serialno || '').toLowerCase().includes(search) ||
    (asset.description || '').toLowerCase().includes(search)
  )

  const tableBody = document.querySelector('#inspectionAssetTableBody')

  tableBody.innerHTML = filtered.slice(0, 100).map(asset => `
    <tr>
      <td>${asset.assetid}</td>
      <td>${asset.assettagno || ''}</td>
      <td>${asset.serialno || ''}</td>
      <td>${asset.description || ''}</td>
      <td>${asset.equipmenttype || ''}</td>
      <td>
        <div class="action-buttons">

          <button onclick="startInspection(${asset.assetid}, 'VISUAL', 'inspections')">
            New Inspection
          </button>

          ${
            ['100','400','500'].includes(String(asset.equipgroupid))
            ? `
              <button
                class="load-test-btn"
                onclick="startInspection(${asset.assetid}, 'LOADTEST', 'inspections')"
              >
                Load Test
              </button>
            `
            : ''
          }

        </div>
      </td>
    </tr>
  `).join('')
}

const criteriaAssetMap = {
  "Top Hook Dimensions": "oemtophooksize",
  "Bottom Hook Dimensions": "oembottomhooksize",
  "Load Chain Diameter": "loadchaindiameter",
  "Hook Size mm": "hooksize",
  "Hoist Serial Number": "hoistserialno",
  "WLL Main Hoist - Load Mass kg": "wll",
  "SWL of Beam - Length Span mm": "span",
  "Permissible Deflection mm": "permissibledeflection",
  "Steel Wire Rope mm": "steelwireropemm"
}

const loadTestAssetOnlyCriteria = new Set([
  "WLL Main Hoist - Deflection mm",
  "WLL Main Hoist - Length Span/Jib mm",
  "WLL Auxiliary Hoist - Deflection mm",
  "WLL Auxiliary Hoist - Length Span/Jib mm"
])

function isLoadMassCriteria(criteriaName) {
  return [
    "WLL Main Hoist - Load Mass kg",
    "WLL Auxiliary Hoist - Load Mass kg"
  ].includes(criteriaName)
}

function isTextCriteria(row) {
  const name = (row.criterianame || "").toLowerCase()

  return (
    row.fieldtype === "TEXT" ||
    name.includes("defects and recommendations")
  )
}

function isSafeForServiceCriteria(row) {
  return (row.criterianame || "").toLowerCase() === "safe for service"
}

function getInspectionCriteriaRows(allCriteria, inspectiontype) {
  return allCriteria
    .filter(row =>
      inspectiontype !== "LOADTEST" ||
      !loadTestAssetOnlyCriteria.has(row.criterianame)
    )
    .sort((a, b) => {
      if (isSafeForServiceCriteria(a)) return 1
      if (isSafeForServiceCriteria(b)) return -1
      return 0
    })
}

function getMeasurementLabels(criteriaName) {
  const name = (criteriaName || "").toLowerCase()

  if (name.includes("diameter")) {
    return {
      assetLabel: "Standard Diameter (mm)",
      measuredLabel: "Measured Diameter (mm)"
    }
  }

   if (name.includes("dimension") || name.includes("hook")) {
    return {
      assetLabel: "Standard Dimension",
      measuredLabel: "Measured Dimension"
    }
  }

  if (name.includes("length") || name.includes("span")) {
    return {
      assetLabel: "Standard Length (mm)",
      measuredLabel: "Measured Length (mm)"
    }
  }

  if (name.includes("deflection")) {
    return {
      assetLabel: "Permissible Deflection (mm)",
      measuredLabel: "Measured Deflection (mm)"
    }
  }

  if (name.includes("rope")) {
    return {
      assetLabel: "Standard Rope Diameter (mm)",
      measuredLabel: "Measured Rope Diameter (mm)"
    }
  }

  if (name.includes("wll") || name.includes("load mass")) {
    return {
      assetLabel: "Rated Load (kg)",
      measuredLabel: "Test Load / Measured Load (kg)"
    }
  }

  return {
    assetLabel: "Standard Value",
    measuredLabel: "Measured Value"
  }
}

window.toggleFailRemark = function (criteriaid) {
  const result = document.querySelector(`#result-${criteriaid}`)?.value
  const remarksBox = document.querySelector(`#fail-remarks-${criteriaid}`)

  if (!remarksBox) return

  remarksBox.style.display = result === "FAIL" ? "block" : "none"
}

window.startInspection = async function (assetid, inspectiontype = "VISUAL", returnPage = "quick") {
  const asset = assets.find(
    a => String(a.assetid) === String(assetid)
  )
  const quickDetailsResponse = await fetch(
  `http://localhost:5000/assets/${assetid}/quick-details`
)
const today = new Date()
const validDate = new Date(today)

if (inspectiontype === "LOADTEST") {
  validDate.setFullYear(validDate.getFullYear() + 1)
} else {
  validDate.setMonth(validDate.getMonth() + 3)
}

const defaultValidDate = validDate.toISOString().split("T")[0]

const quickDetails = await quickDetailsResponse.json()

  if (!asset) {
    alert("Asset not found")
    return
  }

  window.scrollTo(0, 0)

const assetCriteria = getInspectionCriteriaRows(criteria.filter(
  c =>
    String(c.equiptypeid) === String(asset.equiptypeid) &&
    String(c.inspectioncategory) === String(inspectiontype)
), inspectiontype)

  document.querySelector('#page').innerHTML = `
    <h2>${inspectiontype} - Asset ${asset.assetid}</h2>

    <div class="filter-card">
      <div class="inspection-asset-summary">
        <div class="inspection-asset-title">
          <strong>${asset.description || ''}</strong>
          <span>Asset ${asset.assetid}</span>
        </div>

        <div class="inspection-asset-details">
          <div><span>Serial No</span><strong>${asset.serialno || '-'}</strong></div>
          <div><span>Equipment Type</span><strong>${asset.equipmenttype || '-'}</strong></div>
          <div><span>WLL</span><strong>${asset.wll || '-'} kg</strong></div>
          <div><span>Span/Jib</span><strong>${asset.span || '-'} mm</strong></div>
          <div><span>Permissible Deflection</span><strong>${asset.permissibledeflection || '-'} mm</strong></div>
        </div>

        <div class="inspection-asset-actions">
          <button onclick="passAllCriteria(${asset.assetid}, '${inspectiontype}', '${returnPage}')">
            Pass All & Save
          </button>

          <button onclick="${returnPage === 'quick' ? 'showQuickInspection()' : 'showInspections()'}">
            Cancel
          </button>
        </div>
      </div>
    </div>

    <div class="quick-photo-grid">

  ${asset.media1 ? `
    <div class="quick-photo-card">
      <img src="http://localhost:5000${asset.media1}">
    </div>
  ` : ''}

  ${asset.media2 ? `
    <div class="quick-photo-card">
      <img src="http://localhost:5000${asset.media2}">
    </div>
  ` : ''}

</div>

<div class="filter-card">

  <h3>Inspection Photos</h3>

  <input
    id="inspectionPhoto1"
    type="file"
    accept="image/*"
  >

  <input
    id="inspectionPhoto2"
    type="file"
    accept="image/*"
  >

  <label><b>
    <input type="checkbox"
      id="updateAssetPhotos">
    Update Asset Master Photos
  </b></label>

</div>

<div class="inspection-tag-card">

  <div class="inspection-tag-title">
    INSPECTION DETAILS
  </div>

  <div class="form-row">

    <div class="form-group">
      <label>Inspection Tag No</label>
      <input
        id="inspectionTagNo"
        class="inspection-tag-input"
        type="text"
        placeholder="ENTER TAG NUMBER"
      >
    </div>

    <div class="form-group">
      <label>Certificate Expiry Date</label>
      <input
        id="inspectionValidDate"
        type="date"
        value="${defaultValidDate}"
      >
    </div>

  </div>

</div>
      <div class="inspection-history-card">

        <div class="inspection-history-title">
          LAST INSPECTION
        </div>

        <div class="inspection-history-grid">

          <div>
            <strong>Date:</strong><br>
            ${quickDetails.lastinspectiondate || 'Never Inspected'}
          </div>

          <div>
            <strong>Tag Number:</strong><br>
            ${quickDetails.lastinspectiontag || '-'}
          </div>

          <div>
            <strong>Type:</strong><br>
            ${quickDetails.lastinspectiontype || '-'}
          </div>

          <div>
            <strong>Status:</strong><br>
           <span class="${
              quickDetails.lastinspectionstatus === 'SAFE'
                ? 'status-safe'
                : 'status-unsafe'
            }">
              ${quickDetails.lastinspectionstatus || '-'}
            </span>
          </div>

          <div>
            <strong>Inspector:</strong><br>
            ${quickDetails.lastinspector || '-'}
          </div>

        </div>

      </div>

<div class="inspection-list">
<div class="inspection-list">

    <div class="inspection-section-title">
        Measurements
    </div>

    <div class="inspection-header measurements ${inspectiontype === "LOADTEST" ? "loadtest-measurements" : ""}">

        <div>Criteria</div>
        <div>Standard Dimension</div>
        <div>Measured Dimension</div>
        ${inspectiontype === "LOADTEST" ? "<div>Comments / Remarks</div>" : ""}

    </div>

    

  ${assetCriteria.filter(row => row.fieldtype === "NUMBER").map(row => {
    const assetField = criteriaAssetMap[row.criterianame]
    const assetValue = assetField ? (asset[assetField] || '') : ''
    const labels = getMeasurementLabels(row.criterianame)

    return `
      <div class="inspection-row compact-row ${inspectiontype === "LOADTEST" ? "loadtest-measurement-row" : ""}">

        <div class="inspection-criteria">
          ${row.criterianame}
        </div>

<div class="comparison-grid">

    <input
        type="text"
        value="${assetValue}"
        readonly
        class="readonly-value"
    >

    <input
        id="measured-${row.criteriaid}"
        type="text"
        value="${assetValue}"
    >

</div>
        ${inspectiontype === "LOADTEST" && isLoadMassCriteria(row.criterianame) ? `
          <div class="inspection-remarks">
            <input
              id="remarks-${row.criteriaid}"
              type="text"
              placeholder="Comments / Remarks"
            >
          </div>
        ` : inspectiontype === "LOADTEST" ? `<div></div>` : ""}
      </div>
    `
  }).join('')}

<div class="inspection-section-title">
    Visual Inspection
</div>

<div class="inspection-header visual">

    <div>Criteria</div>
    <div>Result</div>
    <div>Reason for FAIL (required)</div>

</div>

  ${assetCriteria.filter(row => row.fieldtype !== "NUMBER").map(row => isTextCriteria(row) ? `
    <div class="inspection-row compact-row">

      <div class="inspection-criteria">
        ${row.criterianame}
      </div>

      <div class="inspection-result inspection-text-result">
        <textarea
          id="remarks-${row.criteriaid}"
          rows="3"
          placeholder="${row.criterianame}"
        ></textarea>
      </div>

    </div>
  ` : `
    <div class="inspection-row compact-row">

      <div class="inspection-criteria">
        ${row.criterianame}
      </div>

      <div class="inspection-result">
        <select
          id="result-${row.criteriaid}"
          onchange="toggleFailRemark(${row.criteriaid})"
        >
          <option value="PASS">PASS</option>
          <option value="FAIL">FAIL</option>
          <option value="N/A">N/A</option>
        </select>
      </div>

      <div
        class="inspection-remarks"
        id="fail-remarks-${row.criteriaid}"
        style="display:none;"
      >
        <input
          id="remarks-${row.criteriaid}"
          type="text"
          placeholder="Reason for FAIL"
        >
      </div>

    </div>
  `).join('')}

</div>

    <div class="filter-card">
      <button type="button" onclick="window.saveInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}')">
        Save ${inspectiontype}
      </button>

      <button onclick="${returnPage === 'quick' ? 'showQuickInspection()' : 'showInspections()'}">
        Cancel
      </button>
    </div>

        <div class="filter-card">

        <button onclick="showInspectionHistory(${asset.assetid})">
          Show Inspection History
        </button>

        <div id="inspectionHistoryPanel"></div>

      </div>

  `
}

window.showInspectionHistory = async function (assetid) {
  const response = await fetch(
    `http://localhost:5000/assets/${assetid}/inspection-history`
  )

  const history = await response.json()

  if (!response.ok) {
    alert("Error loading inspection history: " + history.error)
    return
  }

  const rows = history.map(row => `
    <tr>
      <td>${row.testdate || ''}</td>
      <td>${row.inspectiontype || ''}</td>
      <td><strong>${row.tagnumber || '-'}</strong></td>
      <td>${row.status || ''}</td>
      <td>${row.inspector || '-'}</td>
      <td>
          <button onclick="openCertificateModal(${row.testid})">
            View Certificate
          </button>
      </td>
    </tr>
  `).join('')

  document.querySelector('#inspectionHistoryPanel').innerHTML = `
    <h3>Inspection History</h3>

    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Tag No</th>
          <th>Status</th>
          <th>Inspector</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `
          <tr>
            <td colspan="5">No inspection history found</td>
          </tr>
        `}
      </tbody>
    </table>
  `
}

window.showAssetHistoryFromSetup = async function (assetid) {
  const response = await fetch(
    `http://localhost:5000/assets/${assetid}/inspection-history`
  )

  const history = await response.json()

  if (!response.ok) {
    alert("Error loading inspection history: " + history.error)
    return
  }

  document.querySelector('#page').innerHTML = `
    <h2>Inspection History - Asset ${assetid}</h2>

    <div class="filter-card">
      <button onclick="showAssetSetup()">Back to Asset Setup</button>
    </div>

    <div class="filter-card">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Tag No</th>
            <th>Status</th>
            <th>Inspector</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${history.length ? history.map(row => `
            <tr>
              <td>${row.testdate || ''}</td>
              <td>${row.inspectiontype || ''}</td>
              <td><strong>${row.tagnumber || '-'}</strong></td>
              <td>${row.status || ''}</td>
              <td>${row.inspector || '-'}</td>
              <td>
              <button onclick="openCertificateModal(${row.testid})">
                View Certificate
              </button>
              </td>
            </tr>
          `).join('') : `
            <tr>
              <td colspan="6">No inspection history found</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `
}

window.passAllCriteria = function (assetid, inspectiontype, returnPage = "quick") {
  const confirmPassAll = confirm(
    "Are you sure you want to mark all visual criteria as PASS and save this inspection?"
  )

  if (!confirmPassAll) return

  document
    .querySelectorAll('select[id^="result-"]')
    .forEach(select => {
      select.value = "PASS"
    })

  document
    .querySelectorAll('input[id^="measured-"]')
    .forEach(input => {
      if (!input.value) {
        input.value = input.defaultValue || ""
      }
    })

  saveInspection(assetid, inspectiontype, returnPage)
}

window.handleDashboardSearchEnter = function (event) {
  if (event.key === "Enter") {
    dashboardFindAsset()
  }
}

window.dashboardFindAsset = function () {
  const search = document
    .querySelector("#dashboardAssetSearch")
    .value
    .toLowerCase()
    .trim()

  const resultBox = document.querySelector("#dashboardAssetSearchResult")

  if (!search) {
    resultBox.innerHTML = `<p>Please enter an asset number, tag, serial number or QR code.</p>`
    return
  }

  const matchedAssets = assets.filter(asset =>
    String(asset.assetid || "").toLowerCase().includes(search) ||
    String(asset.assettagno || "").toLowerCase().includes(search) ||
    String(asset.serialno || "").toLowerCase().includes(search) ||
    String(asset.qrcode || "").toLowerCase().includes(search) ||
    String(asset.description || "").toLowerCase().includes(search)
  )

  if (matchedAssets.length === 0) {
    resultBox.innerHTML = `
      <p>No asset found for <strong>${search}</strong>.</p>
    `
    return
  }

  resultBox.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Asset ID</th>
          <th>Tag No</th>
          <th>Serial No</th>
          <th>Description</th>
          <th>Equipment Type</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        ${matchedAssets.slice(0, 10).map(asset => `
          <tr>
            <td>${asset.assetid}</td>
            <td>${asset.assettagno || "-"}</td>
            <td>${asset.serialno || "-"}</td>
            <td>${asset.description || ""}</td>
            <td>${asset.equipmenttype || ""}</td>
            <td>
              <button onclick="startInspection(${asset.assetid}, 'VISUAL', 'quick')">
                Inspect
              </button>

              ${
                ["100", "400", "500"].includes(String(asset.equipgroupid))
                  ? `<button class="load-test-btn" onclick="startInspection(${asset.assetid}, 'LOADTEST', 'quick')">Load Test</button>`
                  : ""
              }
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `
}

async function loadDashboardAlerts() {
  try {
    const response = await fetch(
      "http://localhost:5000/dashboard/alerts"
    )

    const data = await response.json()

    const alertBox = document.querySelector("#dashboardAlerts")

    if (!alertBox) return

    let html = ""

    if (Number(data.overdue) > 0) {
      html += `
        <div class="alert-card danger">
          🔴 ${data.overdue} Assets Overdue
        </div>
      `
    }

    if (Number(data.expiring) > 0) {
      html += `
        <div class="alert-card warning">
          🟠 ${data.expiring} Certificates Expiring Within 30 Days
        </div>
      `
    }

    if (Number(data.failed) > 0) {
      html += `
        <div class="alert-card danger">
          🔴 ${data.failed} Failed Assets
        </div>
      `
    }

    if (html === "") {
      html = `
        <div class="alert-card success">
          ✓ No operational alerts
        </div>
      `
    }

    alertBox.innerHTML = html

  } catch (err) {
    console.error("Failed to load dashboard alerts:", err)
  }
}

async function loadDashboardAttention() {
  try {
    const response = await fetch("http://localhost:5000/dashboard/attention");
    const data = await response.json();

    const tbody = document.getElementById("attentionTableBody");

    if (!data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-row">No assets require attention</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.map(item => `
      <tr>
        <td>
          <strong>${item.assettagno || "No Tag"}</strong><br>
          <small>${item.serialno || ""}</small>
        </td>
        <td>${item.clientname || ""}</td>
        <td>${item.sitename || ""}</td>
        <td>${item.equipmenttype || ""}</td>
        <td><span class="status-badge warning">${item.reason}</span></td>
        <td>${item.daysoverdue ?? "-"}</td>
        <td>
          <button class="small-btn" onclick="quickOpenAsset(${item.assetid})">
            Open
          </button>
        </td>
      </tr>
    `).join("");

  } catch (err) {
    console.error("Failed to load dashboard attention:", err);
  }
}

async function loadDashboardFailedEquipment() {
  try {
    const response = await fetch(
      "http://localhost:5000/dashboard/failed-equipment"
    )

    const data = await response.json()

    const tbody = document.querySelector("#failedEquipmentTableBody")

    if (!tbody) return

    if (!data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-row">
            No failed equipment found
          </td>
        </tr>
      `
      return
    }

    tbody.innerHTML = data.map(item => `
      <tr>
        <td>
          <strong>${item.assettagno || "No Tag"}</strong><br>
          <small>Asset ID: ${item.assetid}</small><br>
          <small>Serial: ${item.serialno || "-"}</small>
        </td>
        <td>${item.clientname || ""}</td>
        <td>${item.sitename || ""}</td>
        <td>${item.equipmenttype || ""}</td>
        <td>${item.testdate ? item.testdate.split("T")[0] : ""}</td>
        <td>${item.inspector || "-"}</td>
        <td>
          <button
            class="small-btn"
            onclick="openCertificateModal(${item.testid})"
          >
            View
          </button>
        </td>
      </tr>
    `).join("")

  } catch (err) {
    console.error("Failed to load failed equipment:", err)
  }
}

async function loadDashboardUpcomingExpiries() {
  try {
    const response = await fetch(
      "http://localhost:5000/dashboard/upcoming-expiries"
    )

    const data = await response.json()

    const tbody = document.querySelector("#upcomingExpiriesTableBody")

    if (!tbody) return

    if (!data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-row">
            No upcoming certificate expiries
          </td>
        </tr>
      `
      return
    }

    tbody.innerHTML = data.map(item => `
      <tr>
        <td>
          <strong>${item.assettagno || "No Tag"}</strong><br>
          <small>Asset ID: ${item.assetid}</small><br>
          <small>Serial: ${item.serialno || "-"}</small>
        </td>
        <td>${item.clientname || ""}</td>
        <td>${item.sitename || ""}</td>
        <td>${item.equipmenttype || ""}</td>
        <td>${item.inspectiontype || ""}</td>
        <td>${item.validdate ? item.validdate.split("T")[0] : ""}</td>
        <td><strong>${item.daysremaining}</strong></td>
        <td>
          <button
            class="small-btn"
            onclick="openCertificateModal(${item.testid})"
          >
            View
          </button>
        </td>
      </tr>
    `).join("")

  } catch (err) {
    console.error("Failed to load upcoming expiries:", err)
  }
}


window.saveInspection = async function(assetid, inspectiontype = "VISUAL", returnPage = "quick") {
  const tagnumber =
    document.querySelector('#inspectionTagNo')?.value.trim() || ""

  const asset = assets.find(
    a => String(a.assetid) === String(assetid)
  )

  if (!asset) {
    alert("Asset not found")
    return
  }

  const assetCriteria = getInspectionCriteriaRows(criteria.filter(
    c =>
      String(c.equiptypeid) === String(asset.equiptypeid) &&
      String(c.inspectioncategory) === String(inspectiontype)
  ), inspectiontype)

  let results = []
  let overallStatus = "SAFE"

  for (const row of assetCriteria) {

    const resultInput =
      document.querySelector(`#result-${row.criteriaid}`)

    const measuredInput =
      document.querySelector(`#measured-${row.criteriaid}`)

    let result =
      resultInput ? resultInput.value : "RECORDED"

      const remarks =
        inspectiontype === "LOADTEST"
          ? document.querySelector(`#remarks-${row.criteriaid}`)?.value || ""
          : result === "FAIL"
            ? document.querySelector(`#remarks-${row.criteriaid}`)?.value || ""
            : ""

    if (
      row.criterianame === "Safe For Service" &&
      result !== "PASS"
    ) {
      overallStatus = "NOT SAFE"
    }

    const assetField =
      criteriaAssetMap[row.criterianame]

    const assetValue =
      assetField ? asset[assetField] : null

    const measuredValue =
      measuredInput ? measuredInput.value : null

    results.push({
      criteriaid: row.criteriaid,
      criterianame: row.criterianame,
      assetvalue: assetValue,
      measuredvalue: measuredValue,
      result: result,
      remarks: remarks
    })
  }

  const formData = new FormData()

  formData.append("assetid", assetid)
  formData.append("testdate", new Date().toISOString().split("T")[0])
  formData.append(
    "validdate",
    document.querySelector("#inspectionValidDate")?.value || ""
  )
  formData.append("comments", "")
  formData.append("status", overallStatus)
  formData.append("inspectiontype", inspectiontype)
  formData.append("tagnumber", tagnumber)
  formData.append("results", JSON.stringify(results))
  formData.append(
    "updateassetphotos",
    document.querySelector("#updateAssetPhotos")?.checked || false
  )

  const photo1 = document.querySelector("#inspectionPhoto1")?.files[0]
  const photo2 = document.querySelector("#inspectionPhoto2")?.files[0]

  if (photo1) formData.append("photo1", photo1)
  if (photo2) formData.append("photo2", photo2)

  let response
  let savedInspection

  try {
    response = await fetch(
      "http://localhost:5000/inspections",
      {
        method: "POST",
        body: formData
      }
    )

    savedInspection = await response.json()
  } catch (err) {
    alert("Error saving inspection: " + err.message)
    return
  }

  if (!response.ok) {
    alert("Error saving inspection: " + savedInspection.error)
    return
  }

  alert("Inspection saved. Status: " + overallStatus)

  await loadData()

  if (returnPage === "quick") {
    showQuickInspection()
  }
  else if (returnPage === "assets") {
    showAssetSetup()
  }
  else {
    showInspections()
  }
}



const currentPage =
  localStorage.getItem("currentPage") || "dashboard"

switch (currentPage) {

  case "dashboard":
    showDashboard()
    break

  case "customers":
    showCustomerSetup()
    break

  case "sites":
    showSites()
    break

  case "responsible":
    showResponsiblePersons()
    break

  case "sections":
    showSections()
    break

  case "assets":
    showAssetSetup()
    break

  case "inspections":
    showInspections()
    break

  case "quick-inspection":
    showQuickInspection()
    break

  case "criteria":
    showEquipmentTypeCriteria()
    break

  case "certificates":
    showCertificateSearch()
    break

  case "customer-report":
    showCustomerDetailedReport()
    break

  default:
    showDashboard()
    break
}

}

loadData()
