import { sortHeader, sortTableRows } from '../tableSort.js'

const API_BASE = 'http://localhost:5000'

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

function assetOptions(assets, selected = '') {
  return `
    <option value="">General / no asset</option>
    ${assets.map(asset => `
      <option value="${asset.assetid}" ${String(selected) === String(asset.assetid) ? 'selected' : ''}>
        ${asset.assetid} - ${asset.assettagno || asset.serialno || asset.description || 'Asset'}
      </option>
    `).join('')}
  `
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
    <h1>Risk Assessment / SHE</h1>
    <p>Create and track SHE risk assessments linked to assets where needed.</p>

    ${canWrite ? `<div class="filter-card">
      <h2>New Risk Assessment</h2>

      <div class="asset-form-grid">
        <div class="form-group">
          <label>Asset</label>
          <select id="riskAssetId">${assetOptions(assets)}</select>
        </div>

        <div class="form-group">
          <label>Assessment Date</label>
          <input id="riskAssessmentDate" type="date" value="${todayIso()}">
        </div>

        <div class="form-group">
          <label>Status</label>
          <select id="riskStatus">${statusOptions()}</select>
        </div>

        <div class="form-group asset-description">
          <label>Activity / Task</label>
          <input id="riskActivity" type="text">
        </div>

        <div class="form-group asset-description">
          <label>Hazard</label>
          <textarea id="riskHazard" rows="2"></textarea>
        </div>

        <div class="form-group asset-description">
          <label>Consequence</label>
          <textarea id="riskConsequence" rows="2"></textarea>
        </div>

        <div class="form-group">
          <label>Initial Severity</label>
          <select id="riskInitialSeverity">${riskOptions(3)}</select>
        </div>

        <div class="form-group">
          <label>Initial Likelihood</label>
          <select id="riskInitialLikelihood">${riskOptions(3)}</select>
        </div>

        <div class="form-group asset-description">
          <label>Controls</label>
          <textarea id="riskControls" rows="2"></textarea>
        </div>

        <div class="form-group">
          <label>Residual Severity</label>
          <select id="riskResidualSeverity">${riskOptions(2)}</select>
        </div>

        <div class="form-group">
          <label>Residual Likelihood</label>
          <select id="riskResidualLikelihood">${riskOptions(2)}</select>
        </div>

        <div class="form-group asset-description">
          <label>Action Required</label>
          <textarea id="riskActionRequired" rows="2"></textarea>
        </div>

        <div class="form-group">
          <label>Responsible Person</label>
          <input id="riskResponsiblePerson" type="text">
        </div>

        <div class="form-group">
          <label>Due Date</label>
          <input id="riskDueDate" type="date">
        </div>
      </div>

      <div class="form-actions">
        <button onclick="saveRiskAssessment()">Save Risk Assessment</button>
      </div>
    </div>` : ''}

    <div class="filter-card">
      <div class="form-row">
        <div class="form-group">
          <label>Search</label>
          <input id="riskSearch" type="text" placeholder="Asset, activity, hazard, status..." onkeyup="filterRiskAssessments()">
        </div>

        <div class="form-group">
          <label>Status</label>
          <select id="riskStatusFilter" onchange="filterRiskAssessments()">
            <option value="">All</option>
            ${statusOptions('')}
          </select>
        </div>
      </div>

      <div class="form-actions">
        <button type="button" onclick="downloadRiskAssessments('pdf')">
          Download PDF
        </button>
        <button type="button" onclick="downloadRiskAssessments('xlsx')">
          Export Excel
        </button>
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
          <th>${sortHeader('Initial Risk', 'riskAssessments', 'initial_rating', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Residual Risk', 'riskAssessments', 'residual_rating', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Status', 'riskAssessments', 'status', 'filterRiskAssessments')}</th>
          <th>${sortHeader('Due', 'riskAssessments', 'due_date', 'filterRiskAssessments')}</th>
          ${canWrite ? '<th>Action</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${sorted.length ? sorted.map(risk => `
          <tr>
            <td>${risk.riskid}</td>
            <td>${formatDate(risk.assessment_date)}</td>
            <td>
              <strong>${risk.assettagno || risk.assetid || '-'}</strong><br>
              <small>${risk.asset_description || risk.serialno || ''}</small>
            </td>
            <td>${risk.activity || ''}</td>
            <td>${risk.hazard || ''}</td>
            <td><span class="status-badge ${ratingClass(risk.initial_rating)}">${risk.initial_rating || '-'}</span></td>
            <td><span class="status-badge ${ratingClass(risk.residual_rating)}">${risk.residual_rating || '-'}</span></td>
            <td>${risk.status || ''}</td>
            <td>${formatDate(risk.due_date)}</td>
            ${canWrite ? `<td>
              <div class="action-buttons">
                <button onclick="editRiskAssessment(${risk.riskid})">Edit</button>
                <button onclick="archiveRiskAssessment(${risk.riskid})">Archive</button>
              </div>
            </td>` : ''}
          </tr>
        `).join('') : `
          <tr>
            <td colspan="${canWrite ? '10' : '9'}" class="empty-row">No risk assessments found</td>
          </tr>
        `}
      </tbody>
    </table>
  `
}
