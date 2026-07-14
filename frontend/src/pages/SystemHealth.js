import { API_BASE } from '../api.js'
import { FRONTEND_BUILD_ID, FRONTEND_BUILD_TIMESTAMP } from '../buildInfo.js'
import { escapeHtml } from '../utils/security.js'

const refreshMs = 60000

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return 'Unknown'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.max(0, bytes)
  let index = 0

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }

  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatDuration(seconds) {
  const total = Number(seconds)
  if (!Number.isFinite(total)) return 'Unknown'

  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatDate(value) {
  if (!value || value === 'unavailable') return 'Unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString()
}

function statusClass(status = '') {
  const normalized = String(status).toLowerCase()
  if (/healthy|connected|current/.test(normalized)) return 'health-good'
  if (/critical|failed|offline|overdue|mismatch/.test(normalized)) return 'health-bad'
  return 'health-warning'
}

function badge(label, status) {
  return `<span class="health-badge ${statusClass(status)}">${escapeHtml(label || status || 'Unknown')}</span>`
}

function valueRow(label, value) {
  return `
    <div class="health-info-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? 'Unknown')}</strong>
    </div>
  `
}

function renderBackupFile(file) {
  if (!file) return valueRow('Latest file', 'No file found')

  return `
    ${valueRow('Latest file', file.filename)}
    ${valueRow('Modified', formatDate(file.modifiedAt))}
    ${valueRow('Size', formatBytes(file.sizeBytes))}
    ${file.ageHours === undefined ? '' : valueRow('Age', `${file.ageHours} hours`)}
  `
}

function renderSystemHealth(data) {
  const frontendBackendMatch =
    FRONTEND_BUILD_ID !== 'unavailable' &&
    data.deployment.backendBuildIdentifier !== 'unavailable' &&
    FRONTEND_BUILD_ID === data.deployment.backendBuildIdentifier
  const deploymentMatch = frontendBackendMatch ? 'Match' : 'Unverified'

  return `
    <div class="system-health-page">
      <div class="section-header system-health-header">
        <div>
          <h1>System Health</h1>
          <p>Last refreshed ${escapeHtml(formatDate(data.checkedAt))}</p>
        </div>
        <button type="button" onclick="refreshSystemHealth()">Refresh</button>
      </div>

      <div class="health-status-grid">
        <div class="health-status-card">
          <span>Backend</span>
          ${badge(data.overallStatus, data.overallStatus)}
        </div>
        <div class="health-status-card">
          <span>Database</span>
          ${badge(data.database.status, data.database.status)}
        </div>
        <div class="health-status-card">
          <span>Backup</span>
          ${badge(data.backup.status, data.backup.status)}
        </div>
        <div class="health-status-card">
          <span>Disk</span>
          ${badge(data.disk.status, data.disk.status)}
        </div>
        <div class="health-status-card">
          <span>Memory</span>
          ${badge(data.server.systemMemory.status, data.server.systemMemory.status)}
        </div>
        <div class="health-status-card">
          <span>Deployment</span>
          ${badge(data.deployment.status, data.deployment.status)}
        </div>
      </div>

      <div class="health-section-grid">
        <section class="dashboard-section">
          <div class="section-header"><h2>Deployment Information</h2></div>
          ${valueRow('Running commit', data.deployment.runningGitCommit)}
          ${valueRow('Latest local commit', data.deployment.latestLocalGitCommit)}
          ${valueRow('Git branch', data.deployment.gitBranch)}
          ${valueRow('Working tree', data.deployment.workingTreeClean === null ? 'Unverified' : data.deployment.workingTreeClean ? 'Clean' : 'Local changes present')}
          ${valueRow('Frontend build ID', FRONTEND_BUILD_ID)}
          ${valueRow('Frontend build timestamp', FRONTEND_BUILD_TIMESTAMP)}
          ${valueRow('Backend build ID', data.deployment.backendBuildIdentifier)}
          ${valueRow('Frontend/backend match', deploymentMatch)}
        </section>

        <section class="dashboard-section">
          <div class="section-header"><h2>Application</h2></div>
          ${valueRow('Application', data.application.name)}
          ${valueRow('Version', data.application.version)}
          ${valueRow('Environment', data.application.environment)}
          ${valueRow('Node.js', data.application.nodeVersion)}
          ${valueRow('Backend started', formatDate(data.application.backendStartTime))}
          ${valueRow('Backend uptime', formatDuration(data.application.backendUptimeSeconds))}
          ${valueRow('Build/deployment date', formatDate(data.application.buildOrDeploymentDate))}
        </section>

        <section class="dashboard-section">
          <div class="section-header"><h2>Database</h2></div>
          ${valueRow('Status', data.database.status)}
          ${valueRow('Database', data.database.databaseName)}
          ${valueRow('Schema', data.database.schemaName)}
          ${valueRow('Response time', data.database.responseTimeMs === null ? 'Unavailable' : `${data.database.responseTimeMs} ms`)}
          ${valueRow('Pool total', data.database.pool.total)}
          ${valueRow('Pool idle', data.database.pool.idle)}
          ${valueRow('Pool waiting', data.database.pool.waiting)}
          ${valueRow('PostgreSQL', data.database.postgresVersion)}
        </section>

        <section class="dashboard-section">
          <div class="section-header"><h2>Server Resources</h2></div>
          ${valueRow('Platform', data.server.platform)}
          ${valueRow('Hostname', data.server.hostname)}
          ${valueRow('Process ID', data.server.processId)}
          ${valueRow('Configured port', data.server.configuredPort)}
          ${valueRow('Process memory', formatBytes(data.server.processMemory.rss))}
          ${valueRow('System free memory', formatBytes(data.server.systemMemory.freeBytes))}
          ${valueRow('System memory used', `${data.server.systemMemory.usedPercent}%`)}
          ${valueRow('System uptime', formatDuration(data.server.systemUptimeSeconds))}
          ${valueRow('CPU load', data.server.cpuLoadAverage.map(value => Number(value).toFixed(2)).join(' / '))}
        </section>

        <section class="dashboard-section">
          <div class="section-header"><h2>Disk Usage</h2></div>
          ${valueRow('Status', data.disk.status)}
          ${valueRow('Filesystem', data.disk.checkedPathLabel)}
          ${valueRow('Used', formatBytes(data.disk.usedBytes))}
          ${valueRow('Available', formatBytes(data.disk.availableBytes))}
          ${valueRow('Used percent', data.disk.usedPercent === null ? 'Unknown' : `${data.disk.usedPercent}%`)}
          ${valueRow('Warning threshold', `${data.thresholds.diskWarningPercent}%`)}
          ${valueRow('Critical threshold', `${data.thresholds.diskCriticalPercent}%`)}
        </section>

        <section class="dashboard-section">
          <div class="section-header"><h2>Backup Status</h2></div>
          ${valueRow('Status', data.backup.status)}
          ${valueRow('Directory', data.backup.accessible ? 'Accessible' : 'Not accessible')}
          ${valueRow('Maximum expected age', `${data.thresholds.backupMaxAgeHours} hours`)}
          ${valueRow('Message', data.backup.message)}
          <h3>Database Backup</h3>
          ${renderBackupFile(data.backup.latestDatabaseBackup)}
          <h3>Uploads Backup</h3>
          ${renderBackupFile(data.backup.latestUploadsBackup)}
        </section>
      </div>
    </div>
  `
}

async function loadSystemHealth() {
  const page = document.querySelector('#page')
  page.innerHTML = `
    <h1>System Health</h1>
    <div class="filter-card">Loading system health...</div>
  `

  try {
    const response = await fetch(`${API_BASE}/admin/system-info`)
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      page.innerHTML = `
        <h1>System Health</h1>
        <div class="filter-card">
          ${escapeHtml(payload.error || 'Unable to load system health.')}
        </div>
      `
      return
    }

    page.innerHTML = renderSystemHealth(payload)
  } catch (err) {
    page.innerHTML = `
      <h1>System Health</h1>
      <div class="filter-card">Unable to reach the system health endpoint.</div>
    `
  }
}

export function renderSystemHealthPage() {
  if (window.systemHealthRefreshTimer) {
    clearInterval(window.systemHealthRefreshTimer)
  }

  loadSystemHealth()
  window.systemHealthRefreshTimer = setInterval(loadSystemHealth, refreshMs)
}

window.refreshSystemHealth = loadSystemHealth
