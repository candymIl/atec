export function renderCertificateSearch(customers = [], sites = [], sections = []) {
  document.querySelector('#page').innerHTML = `
    <h1>Certificates</h1>
    <p>Search, view and manage inspection and load test certificates.</p>

    <div class="filter-card">
      <h2>Search Certificates</h2>

      <div class="asset-form-grid">
        <div class="form-group">
          <label>Broad Search</label>
          <input
            id="certSearch"
            type="text"
            placeholder="Test ID, tag, serial, client, site, asset description..."
          >
        </div>

        <div class="form-group">
          <label>Inspection Type</label>
          <select id="certInspectionType">
            <option value="">All Types</option>
            <option value="VISUAL">Visual Inspection</option>
            <option value="LOADTEST">Load Test</option>
          </select>
        </div>

        <div class="form-group">
          <label>Status</label>
          <select id="certStatus">
            <option value="">All Statuses</option>
            <option value="SAFE">SAFE</option>
            <option value="NOT SAFE">NOT SAFE</option>
          </select>
        </div>

        <div class="form-group">
          <label>Client</label>
          <select id="certClient">
            <option value="">All Clients</option>
            ${customers.map(c => `
              <option value="${c.clientid}">${c.clientname}</option>
            `).join("")}
          </select>
        </div>

        <div class="form-group">
          <label>Site</label>
          <select id="certSite">
            <option value="">All Sites</option>
          </select>
        </div>

        <div class="form-group">
          <label>Section</label>
          <select id="certSection">
            <option value="">All Sections</option>
          </select>
        </div>

        <div class="form-group">
          <label>Date From</label>
          <input id="certDateFrom" type="date">
        </div>

        <div class="form-group">
          <label>Date To</label>
          <input id="certDateTo" type="date">
        </div>
      </div>

      <div class="form-actions">
        <button id="certSearchBtn">Search</button>
        <button id="certClearBtn">Clear Filters</button>
      </div>
    </div>

    <div class="certificate-dashboard-grid">
      <div class="filter-card">
        <h2>Search Results</h2>
        <div id="certificateResults">
          <p>Loading certificates...</p>
        </div>
      </div>

      <div>
        <div class="filter-card">
          <h2>Quick Stats</h2>
          <div id="certificateStats">
            <p>No search loaded yet.</p>
          </div>
        </div>

        <div class="filter-card" id="certificatePreviewPanel">
          <h2>Certificate Preview</h2>
          <p>Select Preview on a certificate to view quick details here.</p>
        </div>
      </div>
    </div>
  `

  window.certificateCustomers = customers
  window.certificateSites = sites
  window.certificateSections = sections

  document.querySelector('#certSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      window.searchCertificates()
    }
  })

  document.querySelector('#certClient').addEventListener('change', window.filterCertificateSites)
  document.querySelector('#certSite').addEventListener('change', window.filterCertificateSections)
  document.querySelector('#certSearchBtn').addEventListener('click', window.searchCertificates)
  document.querySelector('#certClearBtn').addEventListener('click', window.clearCertificateSearch)

  window.searchCertificates()
}

window.filterCertificateSites = function () {
  const clientid = document.querySelector('#certClient').value
  const siteSelect = document.querySelector('#certSite')
  const sectionSelect = document.querySelector('#certSection')

  sectionSelect.innerHTML = `<option value="">All Sections</option>`

  const filteredSites = clientid
    ? window.certificateSites.filter(site => String(site.clientid) === String(clientid))
    : window.certificateSites

  siteSelect.innerHTML = `
    <option value="">All Sites</option>
    ${filteredSites.map(site => `
      <option value="${site.siteid}">${site.sitename}</option>
    `).join("")}
  `
}

window.filterCertificateSections = function () {
  const siteid = document.querySelector('#certSite').value
  const sectionSelect = document.querySelector('#certSection')

  const filteredSections = siteid
    ? window.certificateSections.filter(section => String(section.siteid) === String(siteid))
    : window.certificateSections

  sectionSelect.innerHTML = `
    <option value="">All Sections</option>
    ${filteredSections.map(section => `
      <option value="${section.sectionid}">${section.sectionname}</option>
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

  window.searchCertificates()
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

  renderCertificateStats(certificates)
  renderCertificateResults(certificates)
}

function renderCertificateStats(certificates) {
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
}

function renderCertificateResults(certificates) {
  if (certificates.length === 0) {
    document.querySelector('#certificateResults').innerHTML = `<p>No certificates found.</p>`
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
          <tr data-testid="${cert.testid}">
            <td>${cert.testid}</td>
            <td>${cert.tagnumber || "-"}</td>
            <td>${cert.clientname || ""}</td>
            <td>${cert.sitename || ""}</td>
            <td>${cert.description || ""}</td>
            <td>${cert.serialno || ""}</td>
            <td>${cert.inspectiontype || ""}</td>
            <td>${formatDate(cert.testdate)}</td>
            <td>
              <strong class="${cert.status === "SAFE" ? "status-safe" : "status-unsafe"}">
                ${cert.status || ""}
              </strong>
            </td>
            <td>${cert.inspector || "-"}</td>
            <td>
              <button type="button" class="cert-preview-btn" data-testid="${cert.testid}">
                Preview
              </button>

              <button type="button" class="cert-view-btn" data-testid="${cert.testid}">
                View
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `

  bindCertificateResultEvents()
}

function bindCertificateResultEvents() {
  document.querySelectorAll('#certificateResults tbody tr').forEach(row => {
    row.addEventListener('click', () => {
      window.selectCertificateRow(row, row.dataset.testid)
    })
  })

  document.querySelectorAll('.cert-preview-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      window.previewCertificate(button.dataset.testid)
    })
  })

  document.querySelectorAll('.cert-view-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      window.openCertificateModal(button.dataset.testid)
    })
  })
}

window.selectCertificateRow = function (rowElement, testid) {
  document
    .querySelectorAll('#certificateResults tbody tr')
    .forEach(row => row.classList.remove('selected-certificate-row'))

  rowElement.classList.add('selected-certificate-row')

  window.previewCertificate(testid)
}

window.previewCertificate = async function (testid) {
  const response = await fetch(
    `http://localhost:5000/inspections/${testid}/certificate`
  )

  const data = await response.json()

  if (!response.ok) {
    alert("Error loading certificate preview: " + data.error)
    return
  }

  const inspection = data.inspection
  const results = data.results || []

  const failCount = results.filter(r => r.result === "FAIL").length
  const passCount = results.filter(r => r.result === "PASS").length

  const statusClass =
    inspection.status === "SAFE"
      ? "status-safe"
      : "status-unsafe"

  document.querySelector('#certificatePreviewPanel').innerHTML = `
    <h2>Certificate Preview</h2>

    <div class="certificate-preview-status ${statusClass}">
      ${inspection.status || "-"}
    </div>

    <div class="certificate-preview-row">
      <span>Certificate No</span>
      <strong>${inspection.testid}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Tag No</span>
      <strong>${inspection.tagnumber || "-"}</strong>
    </div>

    <hr>

    <div class="certificate-preview-row">
      <span>Client</span>
      <strong>${inspection.clientname || "-"}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Site</span>
      <strong>${inspection.sitename || "-"}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Section</span>
      <strong>${inspection.sectionname || "-"}</strong>
    </div>

    <hr>

    <p><strong>Asset</strong><br>${inspection.description || "-"}</p>
    <p><strong>Equipment Type</strong><br>${inspection.equipmenttype || "-"}</p>
    <p><strong>Serial No</strong><br>${inspection.serialno || "-"}</p>

    <hr>

    <div class="certificate-preview-row">
      <span>Type</span>
      <strong>${inspection.inspectiontype || "-"}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Date</span>
      <strong>${formatDate(inspection.testdate)}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Certificate Expiry Date</span>
      <strong>${formatDate(inspection.validdate)}</strong>
    </div>

    <div class="certificate-preview-row">
      <span>Inspector</span>
      <strong>${inspection.inspector || "-"}</strong>
    </div>

    <hr>

    <div class="certificate-preview-summary">
      <div>
        <span>Passed</span>
        <strong>${passCount}</strong>
      </div>

      <div>
        <span>Failed</span>
        <strong>${failCount}</strong>
      </div>
    </div>

    <div class="form-actions">
      <button type="button" id="previewOpenCertificateBtn">Open</button>
      <button type="button" id="previewPrintCertificateBtn">Print</button>
    </div>
  `

  document
    .querySelector('#previewOpenCertificateBtn')
    .addEventListener('click', () => window.openCertificateModal(inspection.testid))

  document
    .querySelector('#previewPrintCertificateBtn')
    .addEventListener('click', async () => {
      await window.openCertificateModal(inspection.testid)
      setTimeout(() => window.print(), 250)
    })
}

window.openCertificateModal = async function (testid) {
  const response = await fetch(
    `http://localhost:5000/inspections/${testid}/certificate`
  )

  const data = await response.json()

  if (!response.ok) {
    alert("Error loading certificate: " + data.error)
    return
  }

  const inspection = data.inspection
  const results = data.results || []

  const existingModal = document.querySelector("#certificateModal")
  if (existingModal) existingModal.remove()

  const modal = document.createElement("div")
  modal.id = "certificateModal"
  modal.className = "certificate-modal-overlay"

  modal.innerHTML = `
    <div class="certificate-modal certificate-original-layout">

      <div class="certificate-modal-header screen-only">
        <h2>Certificate ${inspection.testid}</h2>
        <div class="form-actions">
          <button type="button" id="certificatePrintBtn">Print</button>
          <button type="button" id="certificateCloseBtn">Close</button>
        </div>
      </div>

      <div class="certificate-modal-body" id="certificatePrintArea">

        <div class="fb-cert-page">

          <img src="/header.jpg" class="fb-cert-header" alt="FB Cranes Header">

          <div class="fb-cert-title">
            <h1>Certificate of Inspection</h1>
          </div>

          <div class="fb-cert-meta">
            <div>
              <strong>Certificate No:</strong>
              <span>${inspection.testid}</span>
            </div>

            <div>
              <strong>Tag Number:</strong>
              <span>${inspection.tagnumber || "-"}</span>
            </div>

            <div>
              <strong>Status:</strong>
              <span class="${inspection.status === "SAFE" ? "status-safe" : "status-unsafe"}">
                ${inspection.status || "-"}
              </span>
            </div>
          </div>

          <div class="fb-cert-section">
            <h3>Customer Details</h3>
            <div class="fb-cert-grid">
              <p><strong>Client:</strong> ${inspection.clientname || "-"}</p>
              <p><strong>Site:</strong> ${inspection.sitename || "-"}</p>
              <p><strong>Section:</strong> ${inspection.sectionname || "-"}</p>
            </div>
          </div>

          <div class="fb-cert-section">
            <h3>Asset Details</h3>
            <div class="fb-cert-grid">
              <p><strong>Asset ID:</strong> ${inspection.assetid || "-"}</p>
              <p><strong>Equipment Type:</strong> ${inspection.equipmenttype || "-"}</p>
              <p><strong>Description:</strong> ${inspection.description || "-"}</p>
              <p><strong>Serial No:</strong> ${inspection.serialno || "-"}</p>
              <p><strong>Manufacturer:</strong> ${inspection.manufacturer || "-"}</p>
            </div>
          </div>

          <div class="fb-cert-section">
            <h3>Inspection Details</h3>
            <div class="fb-cert-grid">
              <p><strong>Inspection Type:</strong> ${inspection.inspectiontype || "-"}</p>
              <p><strong>Inspection Date:</strong> ${formatDate(inspection.testdate)}</p>
              <p><strong>Certificate Expiry Date:</strong> ${formatDate(inspection.validdate)}</p>
              <p><strong>Inspector:</strong> ${inspection.inspector || "-"}</p>
            </div>
          </div>

          <div class="fb-cert-section">
            <h3>Inspection Photos</h3>
            <div class="fb-cert-photo-grid">
              ${inspection.photo1 ? `
                <div>
                  <img src="http://localhost:5000${inspection.photo1}">
                  <p>Photo 1</p>
                </div>
              ` : `
                <div class="fb-cert-no-photo">No Photo 1</div>
              `}

              ${inspection.photo2 ? `
                <div>
                  <img src="http://localhost:5000${inspection.photo2}">
                  <p>Photo 2</p>
                </div>
              ` : `
                <div class="fb-cert-no-photo">No Photo 2</div>
              `}
            </div>
          </div>

          <div class="fb-cert-section">
            <h3>Inspection Results</h3>

            <table class="fb-cert-results-table">
              <thead>
                <tr>
                  <th>Criteria</th>
                  <th>Asset Value</th>
                  <th>Measured Value</th>
                  <th>Result</th>
                  <th>Remarks</th>
                </tr>
              </thead>

              <tbody>
                ${results.map(row => `
                  <tr>
                    <td>${row.criterianame || ""}</td>
                    <td>${row.assetvalue || ""}</td>
                    <td>${row.measuredvalue || ""}</td>
                    <td>
                      <strong class="${
                        row.result === "PASS"
                          ? "status-safe"
                          : row.result === "FAIL"
                            ? "status-unsafe"
                            : ""
                      }">
                        ${row.result || ""}
                      </strong>
                    </td>
                    <td>${row.remarks || ""}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>

          <div class="fb-cert-signature-section">
            <div>
              <strong>Inspector Signature</strong>
              <div class="fb-cert-signature-line"></div>
            </div>

           <img src="/footer.jpg" class="fb-cert-footer" alt="FB Cranes Footer">

        </div>

      </div>
    </div>
  `

  document.body.appendChild(modal)

  document
    .querySelector('#certificateCloseBtn')
    .addEventListener('click', window.closeCertificateModal)

  document
    .querySelector('#certificatePrintBtn')
    .addEventListener('click', () => window.print())
}

window.closeCertificateModal = function () {
  const modal = document.querySelector("#certificateModal")
  if (modal) modal.remove()
}

function formatDate(value) {
  if (!value) return "-"
  return String(value).split("T")[0]
}
