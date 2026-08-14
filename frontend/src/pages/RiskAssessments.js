import { sortHeader, sortTableRows } from '../tableSort.js'
import { API_BASE } from '../api.js'
import { escapeHtml, safeAttr } from '../utils/security.js'

function todayIso() {
  return new Date().toISOString().split('T')[0]
}

function riskOptions(selected = '') {
  return [1, 2, 3, 4, 5].map(value => `
    <option value="${value}" ${String(selected) === String(value) ? 'selected' : ''}>
      ${value}
    </option>
  `).join('')
}

function statusOptions(selected = 'OPEN') {
  return ['OPEN', 'IN_PROGRESS', 'CLOSED'].map(status => `
    <option value="${status}" ${status === selected ? 'selected' : ''}>
      ${status.replaceAll('_', ' ')}
    </option>
  `).join('')
}

const hazardCategories = [
  'Machine Mobile',
  'Electrical',
  'Object / Pressure',
  'Machine Fixed',
  'Thermal Stress',
  'Slip / Trip / Strain',
  'Chemical',
  'Noise'
]

const stopQuestions = [
  ['routine_task', 'Is this a routine task, done daily or weekly?'],
  ['team_fit', 'Is the team physically and mentally fit to safely execute the task?'],
  ['authorized', 'Does the team have the necessary authorization, area access or permit to do the task?'],
  ['tools_ppe_safe', 'Are all tools, equipment and PPE correctly selected, inspected and safe for use?'],
  ['energy_locked_out', 'Have all energy sources been de-energized and locked out where required?'],
  ['team_competent', 'Are all team members trained, competent and properly appointed for their roles?'],
  ['task_planned', 'Was the task carefully planned to avoid improvisation or unsafe last-minute solutions?'],
  ['stop_if_risk_changes', 'Are all team members aware they must stop, regroup, replan and escalate if risk increases?'],
  ['standard_understood', 'Is there a standard for this task, and does the team understand it?']
]

const reviewQuestions = [
  ['task_completed_safely', 'Has the task been completed safely?'],
  ['team_accounted_for', 'Are all team members accounted for, safe and healthy?'],
  ['near_misses', 'Were near misses or incidents experienced during the task?'],
  ['ppe_worn', 'Did you wear the required PPE?'],
  ['housekeeping_done', 'Was good housekeeping practiced at the work site?'],
  ['reported_complete', 'Have you reported task completion to the appointed person?'],
  ['went_to_plan', 'Did the task go according to plan?'],
  ['extra_information', 'Would you like to communicate any additional information about the task?']
]

function assetOptions(assets, selected = '') {
  return `
    <option value="">General / no asset</option>
    ${assets.map(asset => `
      <option value="${safeAttr(asset.assetid)}" ${String(selected) === String(asset.assetid) ? 'selected' : ''}>
        ${escapeHtml(asset.assetid)} - ${escapeHtml(asset.assettagno || asset.serialno || asset.description || 'Asset')}
      </option>
    `).join('')}
  `
}

function yesNoOptions(selected = '') {
  return `
    <option value="">Select</option>
    <option value="YES" ${selected === 'YES' ? 'selected' : ''}>YES</option>
    <option value="NO" ${selected === 'NO' ? 'selected' : ''}>NO</option>
    <option value="N/A" ${selected === 'N/A' ? 'selected' : ''}>N/A</option>
  `
}

function renderQuestionRows(questions, className) {
  return questions.map(([key, label]) => `
    <div class="slamm-question-row">
      <span>${label}</span>
      <select class="${className}" data-key="${key}">
        ${yesNoOptions('')}
      </select>
    </div>
  `).join('')
}

function renderTeamRows() {
  return Array.from({ length: 6 }, (_, index) => `
    <div class="slamm-team-row" data-index="${index}">
      <span>${index + 1}</span>
      <input class="slamm-team-name" type="text" placeholder="Name">
      <input class="slamm-team-surname" type="text" placeholder="Surname">
      <input class="slamm-team-signature" type="text" placeholder="Signature / initials">
    </div>
  `).join('')
}

function formatDate(value) {
  return value ? String(value).split('T')[0] : '-'
}

function ratingClass(value) {
  const rating = Number(value || 0)

  if (rating >= 15) return 'danger'
  if (rating >= 8) return 'warning'
  return 'success'
}

export async function renderRiskAssessments(assets = [], canWrite = true) {
  const page = document.querySelector('#page')
  page.innerHTML = `
    <h1>SLAMM</h1>
    <p>SLAMM - Stop, Look, Assess, Manage and Monitor before and after the task.</p>

    ${canWrite ? `<div class="filter-card">
      <h2>New SLAMM</h2>
      <input type="hidden" id="riskId" value="">

      <div class="risk-form-grid risk-form-grid--top">
        <div class="form-group">
          <label>Asset</label>
          <select id="riskAssetId">${assetOptions(assets)}</select>
        </div>

        <div class="form-group">
          <label>Assessment Date</label>
          <input id="riskAssessmentDate" type="date" value="${todayIso()}">
        </div>

        <div class="form-group">
          <label>Assessment Time</label>
          <input id="riskAssessmentTime" type="time">
        </div>

        <div class="form-group">
          <label>Status</label>
          <select id="riskStatus">${statusOptions()}</select>
        </div>

        <div class="form-group risk-span-2">
          <label>Task Description</label>
          <input id="riskActivity" type="text">
        </div>

        <div class="form-group">
          <label>Responsible Person</label>
          <input id="riskResponsiblePerson" type="text">
        </div>
      </div>

      <div class="slamm-section">
        <h3>STOP and LOOK - Hazard Types</h3>
        <div class="slamm-check-grid">
          ${hazardCategories.map(category => `
            <label class="slamm-check">
              <input type="checkbox" class="risk-hazard-category" value="${category}">
              <span>${category}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="slamm-section">
        <h3>STOP Questions</h3>
        <p>If any answer is NO, stop and apply the required controls or escalate before continuing.</p>
        <div class="slamm-question-grid">
          ${renderQuestionRows(stopQuestions, 'slamm-stop-question')}
        </div>
      </div>

      <div class="risk-assessment-flow">
        <div class="form-group risk-full">
          <label>LOOK / ASSESS - Hazards and Risks</label>
          <textarea id="riskHazard" rows="2"></textarea>
        </div>

        <div class="form-group risk-full">
          <label>Consequence</label>
          <textarea id="riskConsequence" rows="2"></textarea>
        </div>

        <div class="risk-score-grid">
          <div class="form-group">
            <label>Initial Severity</label>
            <select id="riskInitialSeverity">${riskOptions(3)}</select>
          </div>

          <div class="form-group">
            <label>Initial Likelihood</label>
            <select id="riskInitialLikelihood">${riskOptions(3)}</select>
          </div>

          <div class="form-group">
            <label>Residual Severity</label>
            <select id="riskResidualSeverity">${riskOptions(2)}</select>
          </div>

          <div class="form-group">
            <label>Residual Likelihood</label>
            <select id="riskResidualLikelihood">${riskOptions(2)}</select>
          </div>
        </div>

        <div class="form-group risk-full">
          <label>Controls to Manage the Hazards and Risks</label>
          <textarea id="riskControls" rows="2"></textarea>
        </div>

        <div class="form-group risk-full">
          <label>MANAGE - Actions Required</label>
          <textarea id="riskActionRequired" rows="2"></textarea>
        </div>

        <div class="form-group risk-full">
          <label>Manage Plan</label>
          <textarea id="riskManagePlan" rows="2"></textarea>
        </div>

        <div class="form-group risk-full">
          <label>MONITOR - New Hazards / Changes During Task</label>
          <textarea id="riskMonitorNotes" rows="2"></textarea>
        </div>

        <div class="risk-due-row">
          <div class="form-group risk-due-field">
            <label>Due Date</label>
            <input id="riskDueDate" type="date">
          </div>
        </div>
      </div>

      <div class="slamm-section">
        <h3>After Task Review</h3>
        <div class="slamm-question-grid">
          ${renderQuestionRows(reviewQuestions, 'slamm-review-question')}
        </div>
        <div class="form-group">
          <label>Additional Comments / Recommendations</label>
          <textarea id="riskAdditionalNotes" rows="3"></textarea>
        </div>
      </div>

      <div class="slamm-section">
        <h3>Team Members Involved in the Risk Assessment / SHE Process</h3>
        <div class="slamm-team-grid">
          ${renderTeamRows()}
        </div>
      </div>

      <div class="asset-form-grid">
        <div class="form-group">
          <label>After Task Sign-off by Responsible Person</label>
          <input id="riskResponsibleSignoffName" type="text" placeholder="Name and surname">
        </div>

        <div class="form-group">
          <label>After Task Sign-off by Supervisor</label>
          <input id="riskSupervisorSignoffName" type="text" placeholder="Name and surname">
        </div>
      </div>

      <div class="form-actions">
        <button onclick="saveRiskAssessment()">Save Risk Assessment</button>
        <button type="button" class="secondary-button" onclick="showRiskAssessments()">Clear Form</button>
      </div>
    </div>` : '<div class="filter-card"><p>You have view-only access. Open Reporting to view and print saved SLAMMs.</p></div>'}
  `
}

export async function renderRiskAssessmentReports() {
  const page = document.querySelector('#page')
  page.innerHTML = `
    <h1>SLAMM Reporting</h1>
    <p>Search, review, print or download SLAMM risk assessments.</p>
    <div class="filter-card risk-report-controls">
      <div class="form-row">
        <div class="form-group"><label>Search</label><input id="riskSearch" type="text" placeholder="Asset, activity, hazard, status..." onkeyup="filterRiskAssessments()"></div>
        <div class="form-group"><label>Status</label><select id="riskStatusFilter" onchange="filterRiskAssessments()"><option value="">All</option>${statusOptions('')}</select></div>
      </div>
      <div class="form-actions">
        <button type="button" onclick="printRiskAssessments()">Print Report</button>
        <button type="button" onclick="downloadRiskAssessments('pdf')">Download PDF</button>
        <button type="button" onclick="downloadRiskAssessments('xlsx')">Export Excel</button>
      </div>
    </div>
    <div id="riskAssessmentTable"></div>
  `
  await window.loadRiskAssessments()
}

export function renderRiskAssessmentTable(risks = [], canWrite = true) {
  const table = document.querySelector('#riskAssessmentTable')
  const search = document.querySelector('#riskSearch')?.value.toLowerCase().trim() || ''
  const status = document.querySelector('#riskStatusFilter')?.value || ''
  const filtered = risks.filter(risk => {
    const matchesStatus = !status || risk.status === status
    const haystack = [
      risk.riskid,
      risk.assettagno,
      risk.serialno,
      risk.asset_description,
      risk.clientname,
      risk.sitename,
      risk.activity,
      risk.hazard,
      risk.hazard_categories,
      risk.status
    ].join(' ').toLowerCase()

    return matchesStatus && haystack.includes(search)
  })
  const sorted = sortTableRows(filtered, 'riskAssessments', {
    riskid: risk => risk.riskid,
    assessment_date: risk => risk.assessment_date,
    assettagno: risk => risk.assettagno,
    activity: risk => risk.activity,
    initial_rating: risk => risk.initial_rating,
    residual_rating: risk => risk.residual_rating,
    responsible_person: risk => risk.responsible_person,
    status: risk => risk.status,
    due_date: risk => risk.due_date
  }, 'assessment_date')

  table.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>${sortHeader('ID', 'riskAssessments', 'riskid', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Date', 'riskAssessments', 'assessment_date', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Asset', 'riskAssessments', 'assettagno', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Activity', 'riskAssessments', 'activity', 'filterRiskAssessments')}</th>
          <th>Hazard</th>
          <th>Hazard Types</th>
          <th>${sortHeader('Initial Risk', 'riskAssessments', 'initial_rating', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Residual Risk', 'riskAssessments', 'residual_rating', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Responsible', 'riskAssessments', 'responsible_person', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Status', 'riskAssessments', 'status', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Due', 'riskAssessments', 'due_date', 'filterRiskAssessments')}</th>
          <th>Report</th>
          ${canWrite ? '<th>Action</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${sorted.length ? sorted.map(risk => `
          <tr>
            <td>${escapeHtml(risk.riskid)}</td>
            <td>${formatDate(risk.assessment_date)}</td>
            <td>
              <strong>${escapeHtml(risk.assettagno || risk.assetid || '-')}</strong><br>
              <small>${escapeHtml(risk.asset_description || risk.serialno || '')}</small>
            </td>
            <td>${escapeHtml(risk.activity || '')}</td>
            <td>${escapeHtml(risk.hazard || '')}</td>
            <td>${escapeHtml(Array.isArray(risk.hazard_categories) ? risk.hazard_categories.join(', ') : '')}</td>
            <td><span class="status-badge ${ratingClass(risk.initial_rating)}">${escapeHtml(risk.initial_rating || '-')}</span></td>
            <td><span class="status-badge ${ratingClass(risk.residual_rating)}">${escapeHtml(risk.residual_rating || '-')}</span></td>
            <td>${escapeHtml(risk.responsible_person || '')}</td>
            <td>${escapeHtml(risk.status || '')}</td>
            <td>${formatDate(risk.due_date)}</td>
            <td><div class="action-buttons">
              <button onclick="downloadRiskAssessmentPdf(${risk.riskid})">PDF</button>
              <button class="secondary-button" onclick="printRiskAssessment(${risk.riskid})">Print</button>
            </div></td>
            ${canWrite ? `<td>
              <div class="action-buttons">
                <button onclick="editRiskAssessment(${risk.riskid})">Edit</button>
                <button onclick="archiveRiskAssessment(${risk.riskid})">Archive</button>
              </div>
            </td>` : ''}
          </tr>
        `).join('') : `
          <tr>
            <td colspan="${canWrite ? '13' : '12'}" class="empty-row">No risk assessments found</td>
          </tr>
        `}
      </tbody>
    </table>
  `
}


