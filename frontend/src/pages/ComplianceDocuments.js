import { API_BASE } from "../api.js"
import { escapeHtml, safeAttr } from "../utils/security.js"

const TYPE_LABELS = {
  TAX_CLEARANCE: "Tax Clearance Certificate",
  LETTER_OF_GOOD_STANDING: "Letter of Good Standing / Workman's Compensation",
  LME: "LME Certificate",
  ISO_14001: "ISO 14001 Certificate",
  ISO_9001: "ISO 9001 Certificate",
  ISO_45001: "ISO 45001 Certificate",
  OTHER: "Other Compliance Document"
}

function dateLabel(value) {
  if (!value) return "No expiry"
  return String(value).slice(0, 10)
}

function expiryState(value, status) {
  if (status === "ARCHIVED") return { label: "Archived", className: "archived" }
  if (status === "DRAFT") return { label: "Draft", className: "draft" }
  if (!value) return { label: "Current", className: "current" }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  const days = Math.ceil((expiry - today) / 86400000)
  if (days < 0) return { label: "Expired", className: "expired" }
  if (days <= 60) return { label: `Expires in ${days} day${days === 1 ? "" : "s"}`, className: "expiring" }
  return { label: "Current", className: "current" }
}

function renderRows(documents) {
  if (!documents.length) {
    return `<tr><td colspan="8"><div class="compliance-empty"><strong>No compliance documents uploaded yet.</strong><span>Use the form above to publish the first document.</span></div></td></tr>`
  }
  return documents.map(document => {
    const expiry = expiryState(document.expiry_date, document.status)
    const audience = document.audience_all
      ? "All customers"
      : (document.customers || []).map(customer => customer.clientname).join(", ") || "No customers"
    return `<tr>
      <td data-label="Document"><strong>${escapeHtml(document.title)}</strong><small>${escapeHtml(TYPE_LABELS[document.document_type] || document.document_type)}</small></td>
      <td data-label="Reference">${escapeHtml(document.reference_number || "-")}</td>
      <td data-label="Issuer">${escapeHtml(document.issuing_authority || "-")}</td>
      <td data-label="Valid Until">${escapeHtml(dateLabel(document.expiry_date))}</td>
      <td data-label="Customer Access"><span class="compliance-audience">${escapeHtml(audience)}</span></td>
      <td data-label="Status"><span class="compliance-status ${expiry.className}">${escapeHtml(expiry.label)}</span></td>
      <td data-label="Uploaded"><span>${escapeHtml(String(document.created_at || "").slice(0, 10))}</span><small>${escapeHtml(document.uploaded_by_name || "-")}</small></td>
      <td data-label="Actions" class="compliance-actions">
        <button type="button" onclick="downloadComplianceDocument(${document.compliancedocumentid})">Download</button>
        ${document.status === "DRAFT" ? `<button type="button" class="load-test-btn" onclick="setComplianceDocumentStatus(${document.compliancedocumentid}, 'PUBLISHED')">Publish</button>` : ""}
        ${document.status !== "ARCHIVED" ? `<button type="button" class="secondary-button" onclick="setComplianceDocumentStatus(${document.compliancedocumentid}, 'ARCHIVED')">Archive</button>` : ""}
      </td>
    </tr>`
  }).join("")
}

export async function renderComplianceDocuments() {
  const page = document.querySelector("#page")
  page.innerHTML = `<h1>Compliance Documents</h1><div class="filter-card"><p>Loading company compliance documents...</p></div>`

  try {
    const [documentsResponse, customersResponse] = await Promise.all([
      fetch(`${API_BASE}/compliance-documents`),
      fetch(`${API_BASE}/compliance-documents/customers`)
    ])
    const documents = await documentsResponse.json()
    const customers = await customersResponse.json()
    if (!documentsResponse.ok || !customersResponse.ok) {
      throw new Error(documents.error || customers.error || "Unable to load compliance documents")
    }

    page.innerHTML = `
      <div class="page-heading"><div><h1>Compliance Documents</h1><p>Upload once, control customer access, and keep current company certificates available in the portal.</p></div></div>
      <section class="filter-card compliance-upload-card">
        <div class="section-heading"><div><h2>Upload Document</h2><p>PDF only. Publish immediately or save as a draft for review.</p></div></div>
        <div class="compliance-form-grid">
          <label>Document Type<select id="complianceType">${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select></label>
          <label class="compliance-wide">Display Name<input id="complianceTitle" type="text" placeholder="Name customers will see"></label>
          <label>Reference Number<input id="complianceReference" type="text"></label>
          <label>Issuing Authority<input id="complianceIssuer" type="text"></label>
          <label>Issue Date<input id="complianceIssueDate" type="date"></label>
          <label>Expiry Date<input id="complianceExpiryDate" type="date"></label>
          <label>Publish Status<select id="complianceStatus"><option value="PUBLISHED">Publish now</option><option value="DRAFT">Save as draft</option></select></label>
          <label class="compliance-wide">PDF Document<input id="complianceFile" type="file" accept="application/pdf,.pdf"></label>
        </div>
        <fieldset class="compliance-audience-picker">
          <legend>Customer Access</legend>
          <label class="compliance-radio"><input id="complianceAudienceAll" type="radio" name="complianceAudience" value="all" checked onchange="toggleComplianceCustomers()"> All customers</label>
          <label class="compliance-radio"><input type="radio" name="complianceAudience" value="selected" onchange="toggleComplianceCustomers()"> Selected customers only</label>
          <div id="complianceCustomerPicker" class="compliance-customer-picker" hidden>
            ${customers.map(customer => `<label><input type="checkbox" value="${safeAttr(customer.clientid)}"> ${escapeHtml(customer.clientname)}</label>`).join("")}
          </div>
        </fieldset>
        <div class="form-actions"><button id="complianceUploadButton" type="button" onclick="uploadComplianceDocument()">Upload Document</button></div>
      </section>
      <section class="filter-card compliance-library-card">
        <div class="section-heading"><div><h2>Document Library</h2><p>${documents.length} document${documents.length === 1 ? "" : "s"}, including drafts and archived versions.</p></div></div>
        <div class="table-scroll"><table class="mobile-card-table compliance-table"><thead><tr><th>Document</th><th>Reference</th><th>Issuer</th><th>Valid Until</th><th>Customer Access</th><th>Status</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>${renderRows(documents)}</tbody></table></div>
      </section>`
  } catch (error) {
    page.innerHTML = `<h1>Compliance Documents</h1><div class="filter-card"><p class="login-error">${escapeHtml(error.message)}</p></div>`
  }
}

export function toggleComplianceCustomers() {
  const selectedOnly = document.querySelector('input[name="complianceAudience"]:checked')?.value === "selected"
  const picker = document.querySelector("#complianceCustomerPicker")
  if (picker) picker.hidden = !selectedOnly
}

export async function uploadComplianceDocument() {
  const button = document.querySelector("#complianceUploadButton")
  const file = document.querySelector("#complianceFile")?.files?.[0]
  const title = document.querySelector("#complianceTitle")?.value.trim()
  const audienceAll = document.querySelector('input[name="complianceAudience"]:checked')?.value !== "selected"
  const customerIds = [...document.querySelectorAll("#complianceCustomerPicker input:checked")].map(input => Number(input.value))
  if (!title || !file) return alert("Enter a display name and select the PDF document")
  if (!audienceAll && !customerIds.length) return alert("Select at least one customer")

  const form = new FormData()
  form.append("complianceDocument", file)
  form.append("document_type", document.querySelector("#complianceType").value)
  form.append("title", title)
  form.append("reference_number", document.querySelector("#complianceReference").value)
  form.append("issuing_authority", document.querySelector("#complianceIssuer").value)
  form.append("issue_date", document.querySelector("#complianceIssueDate").value)
  form.append("expiry_date", document.querySelector("#complianceExpiryDate").value)
  form.append("status", document.querySelector("#complianceStatus").value)
  form.append("audience_all", String(audienceAll))
  form.append("customer_ids", JSON.stringify(customerIds))

  button.disabled = true
  button.textContent = "Uploading..."
  try {
    const response = await fetch(`${API_BASE}/compliance-documents`, { method: "POST", body: form })
    const result = await response.json()
    if (!response.ok) return alert(result.error || "Unable to upload document")
    alert("Compliance document uploaded successfully")
    await renderComplianceDocuments()
  } finally {
    button.disabled = false
    button.textContent = "Upload Document"
  }
}

export async function setComplianceDocumentStatus(documentId, status) {
  const action = status === "ARCHIVED" ? "archive" : "publish"
  if (!confirm(`${action[0].toUpperCase()}${action.slice(1)} this compliance document?`)) return
  const response = await fetch(`${API_BASE}/compliance-documents/${documentId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  })
  const result = await response.json()
  if (!response.ok) return alert(result.error || `Unable to ${action} document`)
  await renderComplianceDocuments()
}

export function downloadComplianceDocument(documentId) {
  window.open(`${API_BASE}/compliance-documents/${documentId}/download`, "_blank", "noopener")
}
