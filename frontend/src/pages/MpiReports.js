import { API_BASE } from '../api.js'
import { escapeHtml, safeAttr } from '../utils/security.js'

const PRE_USE_CHECKS = [
  ['YOKE_BODY', 'Yoke plastic casing / body', 'No cracks allowed.'],
  ['POWER_CABLE', 'Power cable', 'No loose strands or exposed wires allowed.'],
  ['PLUG', 'Plug', 'Not damaged, broken or improperly repaired.'],
  ['SWITCH', 'Switch', 'Releases correctly and dust cover is in place.'],
  ['LIFT_TEST', 'Lift test', '4.5 kg for AC or 18.1 kg for DC.'],
  ['POLE_ADJUSTMENT', 'Legs / poles', 'Easily adjustable.'],
  ['POLE_CONTACT', 'Legs / poles contact', 'Flat contact areas suitable for the lift test.']
]

const EQUIPMENT_TYPES = [
  'AC yoke',
  'Gauss meter',
  'Temperature gauge',
  'Light meter or radiometer',
  'Light source or UV-A lamp',
  'Lift weight',
  'Flux indicator strip'
]

const CONSUMABLE_TYPES = [
  ['CLEANER_REMOVER', 'Cleaner / remover'],
  ['MAGNETIC_INK', 'Magnetic ink'],
  ['WHITE_BACKGROUND', 'White background']
]

let pageContext = {}
let reports = []
let qualifications = []
let equipmentRegister = []
let ndtUsers = []
let activeRecord = null
let indicationRows = []

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Unable to complete the MPI request.')
  return data
}

function option(value, label, selectedValue) {
  return `<option value="${safeAttr(value)}" ${String(value) === String(selectedValue ?? '') ? 'selected' : ''}>${escapeHtml(label)}</option>`
}

function activeCustomers() {
  return (pageContext.customers || []).filter(row => !(row.archived === true || row.archived === 'true'))
}

function activeAssets() {
  return (pageContext.assets || []).filter(row => !(row.archived === true || row.archived === 'true'))
}

function reportHeader(record = {}) {
  return record.report || record
}

function formValue(record, key, fallback = '') {
  const header = reportHeader(record)
  return header?.[key] ?? fallback
}

function inputValue(value) {
  return safeAttr(value ?? '')
}

function dateOnlyValue(value) {
  const raw = String(value || '')
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10)
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function statusLabel(value) {
  return String(value || '-').replaceAll('_', ' ')
}

function canCreate() {
  return ['ADMIN', 'MANAGER', 'INSPECTOR'].includes(pageContext.currentUser?.role)
}

function canIssue() {
  return ['ADMIN', 'MANAGER'].includes(pageContext.currentUser?.role)
}

function canManageNdtMasterData() {
  return ['ADMIN', 'MANAGER'].includes(pageContext.currentUser?.role)
}

function qualificationOptions(selectedId, minimumLevel = 1, userId = null) {
  return qualifications
    .filter(row =>
      Number(row.qualification_level) >= minimumLevel &&
      (!userId || String(row.userid) === String(userId))
    )
    .map(row => option(
      row.qualificationid,
      `${row.full_name} — MT Level ${row.qualification_level} — ${row.certificate_number}`,
      selectedId
    ))
    .join('')
}

function performingUserOptions(selectedUserId) {
  const users = new Map()
  qualifications.forEach(row => {
    if (!users.has(String(row.userid))) users.set(String(row.userid), row)
  })
  if (pageContext.currentUser?.role === 'INSPECTOR') {
    const own = [...users.values()].filter(row => String(row.userid) === String(pageContext.currentUser.user_id))
    return own.map(row => option(row.userid, row.full_name, selectedUserId || pageContext.currentUser.user_id)).join('')
  }
  return [...users.values()].map(row => option(row.userid, row.full_name, selectedUserId)).join('')
}

function renderRegister() {
  const body = reports.length
    ? reports.map(row => `
      <tr>
        <td><button type="button" class="link-button" onclick="openMpiReport(${row.ndtreportid})">${escapeHtml(row.report_number)}</button></td>
        <td>${escapeHtml(row.report_revision ?? 0)}</td>
        <td>${escapeHtml(row.client_name_snapshot || '-')}</td>
        <td>${escapeHtml(row.item_description || '-')}</td>
        <td>${escapeHtml(row.serial_number || '-')}</td>
        <td>${escapeHtml(dateOnlyValue(row.test_date))}</td>
        <td>${escapeHtml(statusLabel(row.status))}</td>
        <td>${escapeHtml(statusLabel(row.primary_outcome))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="8">No MPI reports found.</td></tr>'

  document.querySelector('#mpiRegister').innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Report</th>
          <th>Rev</th>
          <th>Customer</th>
          <th>Item</th>
          <th>Serial / ID</th>
          <th>Test date</th>
          <th>Status</th>
          <th>Outcome</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `
}

function masterDataPanel() {
  if (!canManageNdtMasterData()) return ''
  return `
    <details class="filter-card">
      <summary><strong>MPI Qualifications and Test Equipment</strong></summary>
      <div class="mpi-master-grid">
        <fieldset class="mpi-section">
          <legend>Add MT qualification</legend>
          <div class="form-group">
            <label>User</label>
            <select id="mpiQualificationUser">
              <option value="">Select user</option>
              ${ndtUsers.map(row => option(row.user_id, row.full_name, '')).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Level</label><select id="mpiQualificationLevel">${option(1, 'Level 1', '')}${option(2, 'Level 2', '')}${option(3, 'Level 3', '')}</select></div>
            <div class="form-group"><label>Qualification scheme</label><input id="mpiQualificationScheme" placeholder="e.g. Written Practice / SNT-TC-1A"></div>
            <div class="form-group"><label>Certificate number</label><input id="mpiQualificationCertificate"></div>
            <div class="form-group"><label>Qualified on</label><input id="mpiQualifiedOn" type="date"></div>
            <div class="form-group"><label>Expires on</label><input id="mpiQualificationExpires" type="date"></div>
          </div>
          <button type="button" onclick="saveMpiQualification()">Add qualification</button>
        </fieldset>

        <fieldset class="mpi-section">
          <legend>Add test equipment</legend>
          <div class="form-row">
            <div class="form-group"><label>Equipment type</label><select id="mpiMasterEquipmentType">${EQUIPMENT_TYPES.map(value => option(value, value, '')).join('')}</select></div>
            <div class="form-group"><label>Manufacturer</label><input id="mpiMasterEquipmentManufacturer"></div>
            <div class="form-group"><label>Model</label><input id="mpiMasterEquipmentModel"></div>
            <div class="form-group"><label>Serial number</label><input id="mpiMasterEquipmentSerial"></div>
          </div>
          <button type="button" onclick="saveMpiEquipment()">Add equipment</button>
        </fieldset>

        <fieldset class="mpi-section">
          <legend>Add calibration / verification</legend>
          <div class="form-row">
            <div class="form-group">
              <label>Equipment</label>
              <select id="mpiCalibrationEquipment">
                <option value="">Select equipment</option>
                ${equipmentRegister.map(row => option(row.equipmentid, `${row.equipment_type} — ${row.serial_number}`, '')).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Type</label>
              <select id="mpiCalibrationType">${option('CALIBRATION', 'Calibration', '')}${option('VERIFICATION', 'Verification', '')}${option('INITIAL_VERIFICATION', 'Initial verification', '')}</select>
            </div>
            <div class="form-group"><label>Certificate number</label><input id="mpiCalibrationCertificate"></div>
            <div class="form-group"><label>Calibration date</label><input id="mpiCalibrationDate" type="date"></div>
            <div class="form-group"><label>Due date</label><input id="mpiCalibrationDue" type="date"></div>
            <div class="form-group"><label>Provider</label><input id="mpiCalibrationProvider"></div>
          </div>
          <button type="button" onclick="saveMpiCalibration()">Add calibration</button>
        </fieldset>
      </div>
    </details>
  `
}

function techniqueSection(record = {}) {
  const detail = record.mpi_detail || {}
  return `
    <fieldset class="mpi-section">
      <legend>3. MPI Technique</legend>
      <div class="form-row">
        <div class="form-group">
          <label>Current type</label>
          <select id="mpiCurrentType">${option('AC', 'AC', detail.current_type || 'AC')}${option('DC', 'DC', detail.current_type)}</select>
        </div>
        <div class="form-group">
          <label>Particle medium</label>
          <select id="mpiParticleMedium">
            ${option('WET_INK', 'Wet ink', detail.particle_medium || 'WET_INK')}
            ${option('DRY_POWDER', 'Dry powder', detail.particle_medium)}
          </select>
        </div>
        <div class="form-group">
          <label>Viewing method</label>
          <select id="mpiViewingMethod">
            ${option('VISIBLE_CONTRAST', 'Visible contrast', detail.viewing_method || 'VISIBLE_CONTRAST')}
            ${option('FLUORESCENT', 'Fluorescent', detail.viewing_method)}
          </select>
        </div>
        <div class="form-group">
          <label>Magnetising method</label>
          <input id="mpiMagnetisingMethod" value="CONTINUOUS" readonly>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Pre-cleaning method</label>
          <input id="mpiPrecleaning" value="${inputValue(detail.precleaning_method)}">
        </div>
        <div class="form-group">
          <label>White background</label>
          <select id="mpiWhiteBackground">
            ${option('AEROSOL', 'Sprayed from aerosol', detail.white_background_application)}
            ${option('BULK_PAINTED', 'Painted from bulk', detail.white_background_application)}
            ${option('NOT_USED', 'Not used', detail.white_background_application)}
            ${option('OTHER', 'Other', detail.white_background_application)}
          </select>
        </div>
        <div class="form-group">
          <label><input id="mpiPostCleaningRequired" type="checkbox" ${detail.post_cleaning_required ? 'checked' : ''}> Post-cleaning required</label>
          <input id="mpiPostCleaningMethod" placeholder="Method" value="${inputValue(detail.post_cleaning_method)}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Surface temperature °C</label><input id="mpiSurfaceTemperature" type="number" step="0.1" value="${inputValue(detail.surface_temperature_c)}"></div>
        <div class="form-group"><label>Visible light lux</label><input id="mpiVisibleLight" type="number" step="0.1" value="${inputValue(detail.visible_light_lux)}"></div>
        <div class="form-group"><label>UV-A µW/cm²</label><input id="mpiUva" type="number" step="0.1" value="${inputValue(detail.uva_intensity_uw_cm2)}"></div>
        <div class="form-group"><label>Demagnetisation gauss</label><input id="mpiDemag" type="number" step="0.001" value="${inputValue(detail.demagnetisation_gauss)}"></div>
        <div class="form-group">
          <label>Flux indicator</label>
          <select id="mpiFluxIndicator">
            ${option('A', 'Type A', detail.flux_indicator_type)}
            ${option('G', 'Type G', detail.flux_indicator_type)}
            ${option('NOT_APPLICABLE', 'Not applicable', detail.flux_indicator_type || 'NOT_APPLICABLE')}
          </select>
          <input id="mpiFluxResult" placeholder="Observed result" value="${inputValue(detail.flux_indicator_result)}">
        </div>
      </div>
    </fieldset>
  `
}

function equipmentRows(record = {}) {
  const saved = record.equipment || []
  return EQUIPMENT_TYPES.map((equipmentType, index) => {
    const row = saved.find(item => item.equipment_type === equipmentType) || {}
    const registerOptions = equipmentRegister
      .filter(item => item.equipment_type === equipmentType)
      .map(item => option(item.equipmentid, `${item.manufacturer || ''} ${item.serial_number}`, row.equipmentid))
      .join('')
    return `
      <tr class="mpi-equipment-row" data-equipment-type="${safeAttr(equipmentType)}">
        <td>${escapeHtml(equipmentType)}</td>
        <td>
          <select class="mpi-equipment-id" onchange="applyMpiEquipment(${index})">
            <option value="">Manual entry</option>${registerOptions}
          </select>
        </td>
        <td><input class="mpi-equipment-manufacturer" value="${inputValue(row.manufacturer_snapshot)}"></td>
        <td><input class="mpi-equipment-serial" value="${inputValue(row.serial_number_snapshot)}"></td>
        <td><input class="mpi-equipment-due" type="date" value="${inputValue(String(row.calibration_due_snapshot || '').slice(0, 10))}"></td>
        <td><input class="mpi-equipment-certificate" value="${inputValue(row.certificate_number_snapshot)}"></td>
        <td><input class="mpi-equipment-reading" value="${inputValue(row.verification_result)}"></td>
        <td><input class="mpi-equipment-compliant" type="checkbox" ${row.compliant_at_test ? 'checked' : ''}></td>
      </tr>
    `
  }).join('')
}

function consumableRows(record = {}) {
  const saved = record.consumables || []
  return CONSUMABLE_TYPES.map(([type, label]) => {
    const row = saved.find(item => item.consumable_type === type) || {}
    return `
      <tr class="mpi-consumable-row" data-consumable-type="${safeAttr(type)}">
        <td>${escapeHtml(label)}</td>
        <td><input class="mpi-consumable-manufacturer" value="${inputValue(row.manufacturer)}"></td>
        <td><input class="mpi-consumable-product" value="${inputValue(row.product_code)}"></td>
        <td><input class="mpi-consumable-batch" value="${inputValue(row.batch_number)}"></td>
        <td><input class="mpi-consumable-expiry" type="date" value="${inputValue(String(row.expires_on || '').slice(0, 10))}"></td>
        <td><input class="mpi-consumable-compliant" type="checkbox" ${row.compliant_at_test ? 'checked' : ''}></td>
      </tr>
    `
  }).join('')
}

function checkRows(record = {}) {
  const saved = record.checks || []
  return PRE_USE_CHECKS.map(([code, label, limit]) => {
    const row = saved.find(item => item.check_code === code) || {}
    return `
      <tr class="mpi-check-row" data-check-code="${safeAttr(code)}" data-label="${safeAttr(label)}" data-limit="${safeAttr(limit)}">
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(limit)}</td>
        <td>
          <select class="mpi-check-result">
            <option value="">Select</option>
            ${option('YES', 'Yes', row.result)}
            ${option('NO', 'No', row.result)}
            ${option('NOT_APPLICABLE', 'N/A', row.result)}
          </select>
        </td>
        <td><input class="mpi-check-note" value="${inputValue(row.result_note)}"></td>
      </tr>
    `
  }).join('')
}

function renderIndications() {
  const container = document.querySelector('#mpiIndicationRows')
  if (!container) return
  container.innerHTML = indicationRows.length
    ? indicationRows.map((row, index) => `
      <div class="filter-card mpi-indication-row" data-index="${index}">
        <div class="section-header">
          <h4>Indication ${index + 1}</h4>
          <button type="button" class="danger-btn" onclick="removeMpiIndication(${index})">Remove</button>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Examined area</label><input data-key="examined_area" value="${inputValue(row.examined_area)}"></div>
          <div class="form-group"><label>Datum description</label><input data-key="datum_description" value="${inputValue(row.datum_description)}"></div>
          <div class="form-group"><label>Distance from datum mm</label><input data-key="distance_from_datum_mm" type="number" step="0.001" value="${inputValue(row.distance_from_datum_mm)}"></div>
          <div class="form-group"><label>Distance from centreline mm</label><input data-key="distance_from_centreline_mm" type="number" step="0.001" value="${inputValue(row.distance_from_centreline_mm)}"></div>
          <div class="form-group"><label>Length mm</label><input data-key="length_mm" type="number" step="0.001" value="${inputValue(row.length_mm)}"></div>
          <div class="form-group"><label>Width mm</label><input data-key="width_mm" type="number" step="0.001" value="${inputValue(row.width_mm)}"></div>
          <div class="form-group">
            <label>Classification</label>
            <select data-key="confirmed_classification">
              ${option('LINEAR', 'Linear', row.confirmed_classification)}
              ${option('ROUNDED', 'Rounded', row.confirmed_classification)}
              ${option('GROUPED', 'Grouped', row.confirmed_classification)}
            </select>
          </div>
          <div class="form-group">
            <label>Relevance</label>
            <select data-key="relevance">${option('RELEVANT', 'Relevant', row.relevance)}${option('NON_RELEVANT', 'Non-relevant', row.relevance)}</select>
          </div>
          <div class="form-group">
            <label>Code disposition</label>
            <select data-key="code_disposition">
              ${option('ACCEPTABLE', 'Acceptable', row.code_disposition)}
              ${option('REJECTABLE', 'Rejectable', row.code_disposition)}
              ${option('UNDETERMINED', 'Undetermined', row.code_disposition)}
            </select>
          </div>
          <div class="form-group"><label>Diagram number</label><input data-key="diagram_number" type="number" min="1" value="${inputValue(row.diagram_number)}"></div>
          <div class="form-group"><label>Diagram X (0–1)</label><input data-key="diagram_x" type="number" min="0" max="1" step="0.001" value="${inputValue(row.diagram_x)}"></div>
          <div class="form-group"><label>Diagram Y (0–1)</label><input data-key="diagram_y" type="number" min="0" max="1" step="0.001" value="${inputValue(row.diagram_y)}"></div>
        </div>
        <label>Description</label>
        <textarea data-key="description">${escapeHtml(row.description || '')}</textarea>
      </div>
    `).join('')
    : '<p>No indications added. Select “No Relevant Indications” when applicable.</p>'
}

function collectIndications() {
  return Array.from(document.querySelectorAll('.mpi-indication-row')).map(row => {
    const result = {}
    row.querySelectorAll('[data-key]').forEach(input => { result[input.dataset.key] = input.value })
    return result
  })
}

function reportActions(record) {
  if (!record?.report) return ''
  const report = record.report
  const ownQualifications = qualifications.filter(row => String(row.userid) === String(pageContext.currentUser?.user_id))
  const ownLevel2 = ownQualifications.filter(row => Number(row.qualification_level) >= 2)
  const isPerformer = String(report.performing_user_id) === String(pageContext.currentUser?.user_id)
  const editable = ['DRAFT', 'READY_FOR_SIGNING', 'RETURNED_FOR_CORRECTION'].includes(report.status)

  return `
    <div class="form-actions mpi-report-actions">
      ${editable ? '<button type="button" onclick="saveMpiReport()">Save draft</button>' : ''}
      ${editable && isPerformer ? `
        <select id="mpiSigningQualification">
          <option value="">Select signing qualification</option>
          ${qualificationOptions('', 1, pageContext.currentUser?.user_id)}
        </select>
        <button type="button" class="load-test-btn" onclick="signMpiReport()">Technician sign</button>
      ` : ''}
      ${report.status === 'AWAITING_LEVEL_2' && ownLevel2.length ? `
        <select id="mpiCertifyingQualification">
          <option value="">Select Level 2 qualification</option>
          ${qualificationOptions('', 2, pageContext.currentUser?.user_id)}
        </select>
        <button type="button" class="load-test-btn" onclick="certifyMpiReport()">Level 2 certify</button>
        <button type="button" onclick="returnMpiReport()">Return for correction</button>
      ` : ''}
      ${report.status === 'CERTIFIED' && canIssue() ? '<button type="button" class="load-test-btn" onclick="issueMpiReport()">Issue reports</button>' : ''}
      ${report.status === 'ISSUED' && canIssue() ? '<button type="button" onclick="reviseMpiReport()">Create revised report</button>' : ''}
      ${report.status === 'ISSUED' ? '<button type="button" onclick="emailMpiCustomerReport()">Email customer report</button>' : ''}
      ${['CERTIFIED', 'ISSUED', 'SUPERSEDED'].includes(report.status) && pageContext.currentUser?.role !== 'CUSTOMER' ? `
        <button type="button" onclick="window.open('${API_BASE}/ndt/mpi/reports/${report.ndtreportid}/practical-exam.pdf','_blank')">Practical exam PDF</button>
      ` : ''}
      ${['CERTIFIED', 'ISSUED', 'SUPERSEDED'].includes(report.status) ? `
        <button type="button" onclick="window.open('${API_BASE}/ndt/mpi/reports/${report.ndtreportid}/customer-report.pdf','_blank')">Customer report PDF</button>
      ` : ''}
    </div>
  `
}

function deliveryHistory(record) {
  if (!record?.deliveries?.length) return ''
  return `
    <fieldset class="mpi-section">
      <legend>Delivery History</legend>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Recipient</th><th>Status</th><th>Subject</th><th>Error</th></tr></thead>
          <tbody>
            ${record.deliveries.map(row => `
              <tr>
                <td>${escapeHtml(String(row.sent_at || row.created_at || '').replace('T', ' ').slice(0, 19))}</td>
                <td>${escapeHtml(row.recipient_email || '')}</td>
                <td>${escapeHtml(row.delivery_status || '')}</td>
                <td>${escapeHtml(row.email_subject || '')}</td>
                <td>${escapeHtml(row.error_message || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </fieldset>
  `
}

function attachmentSection(record) {
  if (!record?.report?.ndtreportid) {
    return `
      <fieldset class="mpi-section">
        <legend>9. Photographs and Evidence</legend>
        <p>Save the draft before adding photographs or diagram evidence.</p>
      </fieldset>
    `
  }
  const editable = ['DRAFT', 'READY_FOR_SIGNING', 'RETURNED_FOR_CORRECTION'].includes(record.report.status)
  return `
    <fieldset class="mpi-section">
      <legend>9. Photographs and Evidence</legend>
      ${editable ? `
        <div class="form-row">
          <div class="form-group"><label>Images</label><input id="mpiEvidenceFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple></div>
          <div class="form-group">
            <label>Evidence type</label>
            <select id="mpiEvidenceType">
              ${option('COMPONENT_OVERVIEW', 'Component overview', '')}
              ${option('SURFACE_PREPARATION', 'Surface preparation', '')}
              ${option('INDICATION', 'Indication', '')}
              ${option('DIAGRAM', 'Diagram', '')}
              ${option('GENERAL', 'General', '')}
            </select>
          </div>
          <div class="form-group"><label>Caption</label><input id="mpiEvidenceCaption"></div>
          <button type="button" onclick="uploadMpiEvidence()">Upload evidence</button>
        </div>
      ` : ''}
      <div class="mpi-attachment-grid">
        ${(record.attachments || []).map(attachment => `
          <div class="filter-card">
            <img src="${API_BASE}${safeAttr(attachment.file_path)}" alt="${safeAttr(attachment.caption || attachment.attachment_type)}">
            <strong>${escapeHtml(statusLabel(attachment.attachment_type))}</strong>
            <span>${escapeHtml(attachment.caption || attachment.original_filename || '')}</span>
            ${editable ? `<button type="button" class="danger-btn" onclick="removeMpiEvidence(${attachment.attachmentid})">Remove</button>` : ''}
          </div>
        `).join('') || '<p>No evidence uploaded.</p>'}
      </div>
    </fieldset>
  `
}

function renderForm(record = null) {
  activeRecord = record
  const report = reportHeader(record || {})
  indicationRows = (record?.indications || []).map(row => ({ ...row }))
  const customerId = report.clientid || ''
  const subjectType = report.subject_type || 'EXTERNAL'
  const performingUserId = report.performing_user_id || pageContext.currentUser?.user_id
  const readOnly = record && !['DRAFT', 'READY_FOR_SIGNING', 'RETURNED_FOR_CORRECTION'].includes(report.status)

  document.querySelector('#mpiEditor').innerHTML = `
    <div class="section-header">
      <div>
        <h2>${report.report_number ? escapeHtml(report.report_number) : 'New MPI Practical Examination'}</h2>
        <p>${report.status ? `Status: <strong>${escapeHtml(statusLabel(report.status))}</strong>` : 'Draft report number will be allocated on first save.'}</p>
      </div>
      <button type="button" onclick="closeMpiEditor()">Close</button>
    </div>
    <div class="mpi-form ${readOnly ? 'mpi-form-readonly' : ''}">
      <fieldset class="mpi-section">
        <legend>1. Customer and Item</legend>
        <div class="form-row">
          <div class="form-group">
            <label>Customer</label>
            <select id="mpiClientId">
              <option value="">Select customer</option>
              ${activeCustomers().map(row => option(row.clientid, row.clientname, customerId)).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Subject type</label>
            <select id="mpiSubjectType" onchange="toggleMpiSubjectType()">
              ${option('EXTERNAL', 'External item', subjectType)}
              ${option('ASSET', 'ATEC asset', subjectType)}
            </select>
          </div>
          <div class="form-group" id="mpiAssetGroup">
            <label>ATEC asset</label>
            <select id="mpiAssetId">
              <option value="">Select asset</option>
              ${activeAssets().map(row => option(row.assetid, `${row.assettagno || row.assetid} — ${row.description || ''} — ${row.serialno || ''}`, report.assetid)).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Performing technician</label>
            <select id="mpiPerformingUserId">
              <option value="">Select qualified technician</option>
              ${performingUserOptions(performingUserId)}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Address / location</label><input id="mpiAddress" value="${inputValue(report.address_snapshot)}"></div>
          <div class="form-group"><label>Item description</label><input id="mpiItemDescription" value="${inputValue(report.item_description)}"></div>
          <div class="form-group"><label>Item size</label><input id="mpiItemSize" value="${inputValue(report.item_size)}"></div>
          <div class="form-group"><label>Serial / identification number</label><input id="mpiSerialNumber" value="${inputValue(report.serial_number)}"></div>
          <div class="form-group"><label>Material specification</label><input id="mpiMaterialSpecification" value="${inputValue(report.material_specification)}"></div>
          <div class="form-group"><label>Customer / job reference</label><input id="mpiCustomerReference" value="${inputValue(report.customer_reference)}"></div>
          <div class="form-group"><label>Drawing / weld reference</label><input id="mpiDrawingReference" value="${inputValue(report.drawing_weld_reference)}"></div>
        </div>
      </fieldset>

      <fieldset class="mpi-section">
        <legend>2. Examination Specification</legend>
        <div class="form-row">
          <div class="form-group"><label>Date of test</label><input id="mpiTestDate" type="date" value="${inputValue(dateOnlyValue(report.test_date || new Date()))}"></div>
          <div class="form-group"><label>Procedure used</label><input id="mpiProcedure" value="${inputValue(report.procedure_used)}"></div>
          <div class="form-group"><label>Acceptance standard</label><input id="mpiAcceptanceStandard" value="${inputValue(report.acceptance_standard)}"></div>
          <div class="form-group"><label>Area/s tested</label><input id="mpiAreaTested" value="${inputValue(report.area_tested)}"></div>
          <div class="form-group"><label>Surface condition</label><input id="mpiSurfaceCondition" value="${inputValue(report.surface_condition)}"></div>
        </div>
        <label>Examination scope</label>
        <textarea id="mpiExaminationScope">${escapeHtml(report.examination_scope || '')}</textarea>
      </fieldset>

      ${techniqueSection(record || {})}

      <fieldset class="mpi-section">
        <legend>4. Test Equipment and Calibration</legend>
        <div class="table-scroll">
          <table class="data-table mpi-entry-table">
            <thead><tr><th>Equipment</th><th>Register item</th><th>Manufacturer</th><th>Serial</th><th>Due</th><th>Certificate</th><th>Reading/result</th><th>OK</th></tr></thead>
            <tbody>${equipmentRows(record || {})}</tbody>
          </table>
        </div>
      </fieldset>

      <fieldset class="mpi-section">
        <legend>5. Consumables</legend>
        <div class="table-scroll">
          <table class="data-table mpi-entry-table">
            <thead><tr><th>Type</th><th>Manufacturer</th><th>Product</th><th>Batch</th><th>Expiry</th><th>OK</th></tr></thead>
            <tbody>${consumableRows(record || {})}</tbody>
          </table>
        </div>
      </fieldset>

      <fieldset class="mpi-section">
        <legend>6. Yoke Pre-use Checks</legend>
        <div class="table-scroll">
          <table class="data-table mpi-entry-table">
            <thead><tr><th>Check</th><th>Limit</th><th>Compliance</th><th>Remarks</th></tr></thead>
            <tbody>${checkRows(record || {})}</tbody>
          </table>
        </div>
      </fieldset>

      <fieldset class="mpi-section">
        <legend>7. Findings</legend>
        <div class="form-row">
          <div class="form-group">
            <label>Primary outcome</label>
            <select id="mpiPrimaryOutcome">
              <option value="">Select outcome</option>
              ${option('ACCEPTABLE', 'Acceptable', report.primary_outcome)}
              ${option('REJECTED', 'Rejected', report.primary_outcome)}
              ${option('INCONCLUSIVE', 'Inconclusive', report.primary_outcome)}
            </select>
          </div>
          <div class="form-group">
            <label>Indication summary</label>
            <select id="mpiIndicationSummary">
              <option value="">Select summary</option>
              ${option('NO_RELEVANT_INDICATIONS', 'No Relevant Indications', report.indication_summary)}
              ${option('RELEVANT_INDICATIONS_ACCEPTABLE', 'Relevant indications — acceptable', report.indication_summary)}
              ${option('RELEVANT_INDICATIONS_REJECTABLE', 'Relevant indications — rejectable', report.indication_summary)}
              ${option('EXAMINATION_LIMITED', 'Examination limited', report.indication_summary)}
            </select>
          </div>
          <button type="button" onclick="addMpiIndication()">Add indication</button>
        </div>
        <div id="mpiIndicationRows"></div>
      </fieldset>

      <fieldset class="mpi-section">
        <legend>8. Limitations and Notes</legend>
        <label>Limitations</label>
        <textarea id="mpiLimitations">${escapeHtml(report.limitations || '')}</textarea>
        <label>Technical notes</label>
        <textarea id="mpiNotes">${escapeHtml(report.notes || '')}</textarea>
      </fieldset>

      ${attachmentSection(record)}
      ${deliveryHistory(record)}

      ${record ? reportActions(record) : '<div class="form-actions"><button type="button" onclick="saveMpiReport()">Create draft</button></div>'}
    </div>
  `
  renderIndications()
  window.toggleMpiSubjectType()
  if (readOnly) document.querySelectorAll('#mpiEditor input, #mpiEditor select, #mpiEditor textarea').forEach(element => { element.disabled = true })
}

function collectEquipment() {
  return Array.from(document.querySelectorAll('.mpi-equipment-row'))
    .map(row => ({
      equipment_type: row.dataset.equipmentType,
      equipmentid: row.querySelector('.mpi-equipment-id').value || null,
      manufacturer_snapshot: row.querySelector('.mpi-equipment-manufacturer').value,
      serial_number_snapshot: row.querySelector('.mpi-equipment-serial').value,
      calibration_due_snapshot: row.querySelector('.mpi-equipment-due').value || null,
      certificate_number_snapshot: row.querySelector('.mpi-equipment-certificate').value,
      verification_result: row.querySelector('.mpi-equipment-reading').value,
      compliant_at_test: row.querySelector('.mpi-equipment-compliant').checked
    }))
    .filter(row => row.equipmentid || row.serial_number_snapshot || row.verification_result)
}

function collectConsumables() {
  return Array.from(document.querySelectorAll('.mpi-consumable-row'))
    .map(row => ({
      consumable_type: row.dataset.consumableType,
      manufacturer: row.querySelector('.mpi-consumable-manufacturer').value,
      product_code: row.querySelector('.mpi-consumable-product').value,
      batch_number: row.querySelector('.mpi-consumable-batch').value,
      expires_on: row.querySelector('.mpi-consumable-expiry').value || null,
      compliant_at_test: row.querySelector('.mpi-consumable-compliant').checked
    }))
    .filter(row => row.manufacturer || row.product_code || row.batch_number)
}

function collectChecks() {
  return Array.from(document.querySelectorAll('.mpi-check-row'))
    .map(row => ({
      check_code: row.dataset.checkCode,
      check_label_snapshot: row.dataset.label,
      limit_snapshot: row.dataset.limit,
      result: row.querySelector('.mpi-check-result').value,
      result_note: row.querySelector('.mpi-check-note').value
    }))
    .filter(row => row.result)
}

function formPayload() {
  return {
    subject_type: document.querySelector('#mpiSubjectType').value,
    clientid: document.querySelector('#mpiClientId').value || null,
    assetid: document.querySelector('#mpiAssetId').value || null,
    performing_user_id: document.querySelector('#mpiPerformingUserId').value || pageContext.currentUser?.user_id,
    address_snapshot: document.querySelector('#mpiAddress').value,
    item_description: document.querySelector('#mpiItemDescription').value,
    item_size: document.querySelector('#mpiItemSize').value,
    serial_number: document.querySelector('#mpiSerialNumber').value,
    material_specification: document.querySelector('#mpiMaterialSpecification').value,
    customer_reference: document.querySelector('#mpiCustomerReference').value,
    drawing_weld_reference: document.querySelector('#mpiDrawingReference').value,
    test_date: document.querySelector('#mpiTestDate').value,
    procedure_used: document.querySelector('#mpiProcedure').value,
    acceptance_standard: document.querySelector('#mpiAcceptanceStandard').value,
    area_tested: document.querySelector('#mpiAreaTested').value,
    surface_condition: document.querySelector('#mpiSurfaceCondition').value,
    examination_scope: document.querySelector('#mpiExaminationScope').value,
    primary_outcome: document.querySelector('#mpiPrimaryOutcome').value || null,
    indication_summary: document.querySelector('#mpiIndicationSummary').value || null,
    limitations: document.querySelector('#mpiLimitations').value,
    notes: document.querySelector('#mpiNotes').value,
    mpi_detail: {
      current_type: document.querySelector('#mpiCurrentType').value,
      particle_medium: document.querySelector('#mpiParticleMedium').value,
      viewing_method: document.querySelector('#mpiViewingMethod').value,
      magnetising_method: 'CONTINUOUS',
      precleaning_method: document.querySelector('#mpiPrecleaning').value,
      white_background_application: document.querySelector('#mpiWhiteBackground').value,
      post_cleaning_required: document.querySelector('#mpiPostCleaningRequired').checked,
      post_cleaning_method: document.querySelector('#mpiPostCleaningMethod').value,
      surface_temperature_c: document.querySelector('#mpiSurfaceTemperature').value || null,
      visible_light_lux: document.querySelector('#mpiVisibleLight').value || null,
      uva_intensity_uw_cm2: document.querySelector('#mpiUva').value || null,
      demagnetisation_gauss: document.querySelector('#mpiDemag').value || null,
      flux_indicator_type: document.querySelector('#mpiFluxIndicator').value,
      flux_indicator_result: document.querySelector('#mpiFluxResult').value
    },
    equipment: collectEquipment(),
    consumables: collectConsumables(),
    checks: collectChecks(),
    indications: collectIndications()
  }
}

async function refreshReports() {
  const search = document.querySelector('#mpiSearch')?.value || ''
  const status = document.querySelector('#mpiStatusFilter')?.value || ''
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (status) params.set('status', status)
  reports = await api(`/ndt/mpi/reports?${params.toString()}`)
  renderRegister()
}

export async function renderMpiReportsPage(context) {
  pageContext = context
  document.querySelector('#page').innerHTML = `
    <div class="section-header">
      <div>
        <h1>Magnetic Particle Inspection</h1>
        <p>FBC286 practical examinations and controlled customer outcome reports.</p>
      </div>
      ${canCreate() ? '<button type="button" class="load-test-btn" onclick="newMpiReport()">New MPI Examination</button>' : ''}
    </div>
    <div class="filter-card">
      <div class="form-row">
        <div class="form-group"><label>Search</label><input id="mpiSearch" placeholder="Report, customer, item or serial"></div>
        <div class="form-group">
          <label>Status</label>
          <select id="mpiStatusFilter">
            <option value="">All statuses</option>
            ${['DRAFT','AWAITING_LEVEL_2','RETURNED_FOR_CORRECTION','CERTIFIED','ISSUED','SUPERSEDED','VOID'].map(value => option(value, statusLabel(value), '')).join('')}
          </select>
        </div>
        <button type="button" onclick="searchMpiReports()">Search</button>
      </div>
    </div>
    <div id="mpiMasterData"></div>
    <div id="mpiRegister" class="table-scroll"><p>Loading MPI reports...</p></div>
    <div id="mpiEditor"></div>
  `

  const loads = [api('/ndt/mpi/reports')]
  if (pageContext.currentUser?.role !== 'CUSTOMER') {
    loads.push(api('/ndt/qualifications?active=true'), api('/ndt/equipment'))
  }
  if (canManageNdtMasterData()) loads.push(api('/ndt/users'))
  const results = await Promise.all(loads)
  reports = results[0]
  qualifications = results[1] || []
  equipmentRegister = results[2] || []
  ndtUsers = canManageNdtMasterData() ? results[3] || [] : []
  document.querySelector('#mpiMasterData').innerHTML = masterDataPanel()
  renderRegister()
}

window.searchMpiReports = refreshReports
window.newMpiReport = () => renderForm()
window.closeMpiEditor = () => { activeRecord = null; document.querySelector('#mpiEditor').innerHTML = '' }
window.openMpiReport = async id => {
  try {
    renderForm(await api(`/ndt/mpi/reports/${id}`))
    document.querySelector('#mpiEditor').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) {
    alert(error.message)
  }
}
window.toggleMpiSubjectType = () => {
  const isAsset = document.querySelector('#mpiSubjectType')?.value === 'ASSET'
  const group = document.querySelector('#mpiAssetGroup')
  if (group) group.hidden = !isAsset
}
window.applyMpiEquipment = index => {
  const row = document.querySelectorAll('.mpi-equipment-row')[index]
  const selected = equipmentRegister.find(item => String(item.equipmentid) === String(row?.querySelector('.mpi-equipment-id')?.value))
  if (!row || !selected) return
  row.querySelector('.mpi-equipment-manufacturer').value = selected.manufacturer || ''
  row.querySelector('.mpi-equipment-serial').value = selected.serial_number || ''
  row.querySelector('.mpi-equipment-due').value = String(selected.due_on || '').slice(0, 10)
  row.querySelector('.mpi-equipment-certificate').value = selected.certificate_number || ''
  row.querySelector('.mpi-equipment-compliant').checked =
    selected.status === 'ACTIVE' &&
    selected.calibration_result === 'PASS' &&
    (!selected.due_on || dateOnlyValue(selected.due_on) >= dateOnlyValue(new Date()))
}
window.addMpiIndication = () => {
  indicationRows = collectIndications()
  indicationRows.push({
    confirmed_classification: 'LINEAR',
    relevance: 'RELEVANT',
    code_disposition: 'UNDETERMINED'
  })
  renderIndications()
}
window.removeMpiIndication = index => {
  indicationRows = collectIndications()
  indicationRows.splice(index, 1)
  renderIndications()
}
window.saveMpiReport = async () => {
  try {
    const id = activeRecord?.report?.ndtreportid
    const saved = await api(id ? `/ndt/mpi/reports/${id}` : '/ndt/mpi/reports', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(formPayload())
    })
    activeRecord = saved
    renderForm(saved)
    await refreshReports()
    alert(`MPI draft ${saved.report.report_number} saved.`)
  } catch (error) {
    alert(error.message)
  }
}
window.signMpiReport = async () => {
  try {
    const qualificationid = document.querySelector('#mpiSigningQualification')?.value
    if (!qualificationid) return alert('Select the qualification used to sign this examination.')
    const saved = await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}/sign`, {
      method: 'POST',
      body: JSON.stringify({ qualificationid })
    })
    renderForm(saved)
    await refreshReports()
  } catch (error) {
    alert(error.message)
  }
}
window.certifyMpiReport = async () => {
  try {
    const qualificationid = document.querySelector('#mpiCertifyingQualification')?.value
    if (!qualificationid) return alert('Select the Level 2 qualification used for certification.')
    const saved = await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}/certify`, {
      method: 'POST',
      body: JSON.stringify({ qualificationid })
    })
    renderForm(saved)
    await refreshReports()
  } catch (error) {
    alert(error.message)
  }
}
window.returnMpiReport = async () => {
  const comments = prompt('Reason for returning this examination:')
  if (!comments) return
  try {
    const qualificationid = document.querySelector('#mpiCertifyingQualification')?.value
    const saved = await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}/return`, {
      method: 'POST',
      body: JSON.stringify({ qualificationid, comments })
    })
    renderForm(saved)
    await refreshReports()
  } catch (error) {
    alert(error.message)
  }
}
window.issueMpiReport = async () => {
  if (!confirm('Issue the practical-examination and customer outcome reports?')) return
  try {
    const saved = await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}/issue`, {
      method: 'POST',
      body: JSON.stringify({})
    })
    renderForm(saved)
    await refreshReports()
  } catch (error) {
    alert(error.message)
  }
}
window.reviseMpiReport = async () => {
  const revision_reason = prompt('Reason for creating a new report revision:')
  if (!revision_reason) return
  try {
    const revised = await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}/revise`, {
      method: 'POST',
      body: JSON.stringify({ revision_reason })
    })
    renderForm(revised)
    await refreshReports()
    alert(`Revision ${revised.report.report_revision} created as a draft.`)
  } catch (error) {
    alert(error.message)
  }
}
window.emailMpiCustomerReport = async () => {
  const defaultRecipient = pageContext.currentUser?.role === 'CUSTOMER'
    ? pageContext.currentUser?.email || ''
    : ''
  const to = prompt('Recipient email address:', defaultRecipient)
  if (!to) return
  try {
    await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}/email`, {
      method: 'POST',
      body: JSON.stringify({ to })
    })
    const saved = await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}`)
    renderForm(saved)
    alert('MPI customer report emailed successfully.')
  } catch (error) {
    alert(error.message)
  }
}
window.uploadMpiEvidence = async () => {
  const files = Array.from(document.querySelector('#mpiEvidenceFiles')?.files || [])
  if (!files.length) return alert('Select one or more evidence images.')
  const formData = new FormData()
  files.forEach(file => {
    formData.append('mpiPhotos', file)
    formData.append('photoTypes', document.querySelector('#mpiEvidenceType').value)
    formData.append('photoCaptions', document.querySelector('#mpiEvidenceCaption').value)
  })
  try {
    await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}/attachments`, {
      method: 'POST',
      body: formData
    })
    const saved = await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}`)
    renderForm(saved)
  } catch (error) {
    alert(error.message)
  }
}
window.removeMpiEvidence = async attachmentid => {
  if (!confirm('Remove this MPI evidence attachment?')) return
  try {
    await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}/attachments/${attachmentid}`, { method: 'DELETE' })
    const saved = await api(`/ndt/mpi/reports/${activeRecord.report.ndtreportid}`)
    renderForm(saved)
  } catch (error) {
    alert(error.message)
  }
}
window.saveMpiQualification = async () => {
  try {
    await api('/ndt/qualifications', {
      method: 'POST',
      body: JSON.stringify({
        userid: document.querySelector('#mpiQualificationUser').value,
        qualification_level: document.querySelector('#mpiQualificationLevel').value,
        qualification_scheme: document.querySelector('#mpiQualificationScheme').value,
        certificate_number: document.querySelector('#mpiQualificationCertificate').value,
        qualified_on: document.querySelector('#mpiQualifiedOn').value || null,
        expires_on: document.querySelector('#mpiQualificationExpires').value || null
      })
    })
    qualifications = await api('/ndt/qualifications?active=true')
    document.querySelector('#mpiMasterData').innerHTML = masterDataPanel()
    alert('MT qualification saved.')
  } catch (error) {
    alert(error.message)
  }
}
window.saveMpiEquipment = async () => {
  try {
    await api('/ndt/equipment', {
      method: 'POST',
      body: JSON.stringify({
        equipment_type: document.querySelector('#mpiMasterEquipmentType').value,
        manufacturer: document.querySelector('#mpiMasterEquipmentManufacturer').value,
        model: document.querySelector('#mpiMasterEquipmentModel').value,
        serial_number: document.querySelector('#mpiMasterEquipmentSerial').value
      })
    })
    equipmentRegister = await api('/ndt/equipment')
    document.querySelector('#mpiMasterData').innerHTML = masterDataPanel()
    alert('MPI test equipment added.')
  } catch (error) {
    alert(error.message)
  }
}
window.saveMpiCalibration = async () => {
  try {
    const equipmentid = document.querySelector('#mpiCalibrationEquipment').value
    if (!equipmentid) return alert('Select the equipment being calibrated or verified.')
    await api(`/ndt/equipment/${equipmentid}/calibrations`, {
      method: 'POST',
      body: JSON.stringify({
        calibration_type: document.querySelector('#mpiCalibrationType').value,
        certificate_number: document.querySelector('#mpiCalibrationCertificate').value,
        calibrated_on: document.querySelector('#mpiCalibrationDate').value,
        due_on: document.querySelector('#mpiCalibrationDue').value || null,
        provider: document.querySelector('#mpiCalibrationProvider').value
      })
    })
    equipmentRegister = await api('/ndt/equipment')
    document.querySelector('#mpiMasterData').innerHTML = masterDataPanel()
    alert('Calibration record added.')
  } catch (error) {
    alert(error.message)
  }
}
