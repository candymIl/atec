import './style.css'
import { showDashboard as renderDashboard } from './pages/Dashboard'
import { renderCustomerSetup } from './pages/CustomerSetup.js'
import { renderSites } from './pages/Sites.js'
import { renderResponsiblePersons } from './pages/ResponsiblePersons.js'
import { renderSections } from './pages/Sections.js'
import { renderAssetSetup, renderAssetRow, updateAssetSetupResults } from './pages/AssetSetup.js'
import { renderInspections } from './pages/Inspections.js'
import { renderEquipmentTypeCriteria } from './pages/EquipmentTypeCriteria.js'
import { renderQuickInspection } from './pages/QuickInspection.js'
import { renderCertificateSearch } from './pages/Certificates.js'
import { renderCustomerDetailedReport } from './pages/CustomerDetailedReport.js'
import { renderRiskAssessments, renderRiskAssessmentTable } from './pages/RiskAssessments.js'
import { renderSystemHealthPage } from './pages/SystemHealth.js'
import { getPaginationState, renderPaginationControls } from './pagination.js'
import { getTableSortState, sortTableRows } from './tableSort.js'
import { API_BASE, assetUrl, uploadUrl } from './api.js'
import { escapeHtml, safeAttr } from './utils/security.js'

if (window.location.pathname.toLowerCase().startsWith('/atec/atec')) {
  window.history.replaceState({}, '', '/atec/')
}

const originalFetch = window.fetch.bind(window)

window.fetch = function (input, options = {}) {
  const url = typeof input === 'string' ? input : input?.url || ''
  const isApiRequest = url.startsWith(API_BASE)

  return originalFetch(input, {
    ...options,
    credentials: isApiRequest ? 'include' : options.credentials
  })
}

async function readApiResponse(response) {
  const text = await response.text()

  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch (err) {
    return {
      error: response.ok
        ? 'The server returned an unexpected response'
        : 'The server returned an unexpected error. Please try again.'
    }
  }
}

let currentUser = null
let customers = []
let assets = []
let sites = []
let responsiblePersons = []
let sections = []
let equipmentTypes = []
let dashboardStats = {}
let criteria = []
let assetSearchTimer = null

const pageAccess = {
  dashboard: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER'],
  customers: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  sites: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  responsible: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  sections: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  assets: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER'],
  inspections: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  'quick-inspection': ['ADMIN', 'MANAGER', 'INSPECTOR'],
  certificates: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER', 'CUSTOMER'],
  'customer-report': ['ADMIN', 'MANAGER', 'VIEWER', 'CUSTOMER'],
  she: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER'],
  criteria: ['ADMIN'],
  users: ['ADMIN'],
  'system-health': ['ADMIN'],
  profile: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER', 'CUSTOMER']
}

function hasAccess(pageKey) {
  return currentUser?.role === 'ADMIN' || (pageAccess[pageKey] || []).includes(currentUser?.role)
}

function showAccessDenied() {
  document.querySelector('#page').innerHTML = `
    <div class="filter-card">
      <h2>Access denied</h2>
      <p>You do not have permission to view this page.</p>
    </div>
  `
}

function ensurePageAccess(pageKey) {
  if (hasAccess(pageKey)) return true

  showAccessDenied()
  return false
}

function menuButton(pageKey, label, action) {
  return hasAccess(pageKey)
    ? `<button onclick="closeMobileMenu(); ${action}">${label}</button>`
    : ''
}

function canManageAssetRecords() {
  return ['ADMIN', 'MANAGER', 'INSPECTOR'].includes(currentUser?.role)
}

function canArchiveOrMoveAssetRecords() {
  return currentUser?.role === 'ADMIN'
}

function canArchiveSetupRecords() {
  return currentUser?.role === 'ADMIN'
}

function canPerformInspections() {
  return ['ADMIN', 'MANAGER', 'INSPECTOR'].includes(currentUser?.role)
}

function renderLogin(message = '') {
  document.querySelector('#app').innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <img src="${assetUrl('logo.jpg')}" alt="ATEC Logo" class="login-logo">
        <h1>ATEC Login</h1>
        ${message ? `<p class="login-error">${message}</p>` : ''}
        <label>Username or Email</label>
        <input id="loginUsername" type="text" autocomplete="username">
        <label>Password</label>
        <input id="loginPassword" type="password" autocomplete="current-password">
        <button onclick="loginUser()">Login</button>
      </div>
    </div>
  `
}

window.loginUser = async function () {
  const username = document.querySelector('#loginUsername')?.value || ''
  const password = document.querySelector('#loginPassword')?.value || ''

  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })

  const result = await response.json()

  if (!response.ok) {
    renderLogin(result.error || 'Login failed')
    return
  }

  currentUser = result.user
  window.currentUser = currentUser
  localStorage.setItem('currentPage', currentUser.role === 'CUSTOMER' ? 'certificates' : 'dashboard')
  await loadData()
}

window.logoutUser = async function () {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST' })
  currentUser = null
  window.currentUser = null
  localStorage.removeItem('currentPage')
  renderLogin()
}

const userManagementSortColumns = {
  username: user => user.username,
  email: user => user.email,
  full_name: user => user.full_name,
  role: user => user.role,
  lmi_number: user => user.lmi_number,
  clientid: user => getUserCustomerName(user.clientid),
  siteid: user => getUserSiteName(user.siteid),
  sectionid: user => getUserSectionName(user.sectionid),
  is_active: user => user.is_active ? 1 : 0,
  signature_image: user => user.signature_image ? 1 : 0
}

function getUserManagementLookups() {
  return window.userManagementLookups || {
    customers: [],
    sites: [],
    sections: []
  }
}

function getUserCustomerName(clientid) {
  const customer = getUserManagementLookups().customers
    .find(item => String(item.clientid) === String(clientid || ""))

  return customer?.clientname || ""
}

function getUserSiteName(siteid) {
  const site = getUserManagementLookups().sites
    .find(item => String(item.siteid) === String(siteid || ""))

  return site?.sitename || ""
}

function getUserSectionName(sectionid) {
  const section = getUserManagementLookups().sections
    .find(item => String(item.sectionid) === String(sectionid || ""))

  return section?.sectionname || ""
}

function renderUserLookupOptions(items, idKey, nameKey, selectedId, emptyLabel) {
  return `
    <option value="">${escapeHtml(emptyLabel)}</option>
    ${items.map(item => `
      <option value="${safeAttr(item[idKey])}" ${String(item[idKey]) === String(selectedId || "") ? "selected" : ""}>
        ${escapeHtml(item[nameKey] || `${emptyLabel} ${item[idKey]}`)}
      </option>
    `).join("")}
  `
}

function getUserManagementSort() {
  window.userManagementSort = window.userManagementSort || {
    key: 'username',
    direction: 'asc'
  }

  return window.userManagementSort
}

function sortUserManagementRows(users) {
  const sort = getUserManagementSort()
  const getValue = userManagementSortColumns[sort.key] || userManagementSortColumns.username
  const direction = sort.direction === 'desc' ? -1 : 1

  return [...users].sort((left, right) => {
    const leftValue = getValue(left)
    const rightValue = getValue(right)
    const leftNumber = Number(leftValue)
    const rightNumber = Number(rightValue)

    if (leftValue !== '' && rightValue !== '' && !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
      return (leftNumber - rightNumber) * direction
    }

    return String(leftValue || '').localeCompare(String(rightValue || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    }) * direction
  })
}

function userSortHeader(label, key) {
  const sort = getUserManagementSort()
  const isActive = sort.key === key
  const directionClass = isActive ? sort.direction : ''

  return `
    <span class="user-table-heading">
      <span>${label}</span>
      <button
        type="button"
        class="user-sort-btn ${isActive ? `active ${directionClass}` : ''}"
        onclick="sortUserManagement('${key}')"
        aria-label="Sort ${label}"
        title="Sort ${label}"
      ></button>
    </span>
  `
}

window.sortUserManagement = function (key) {
  const sort = getUserManagementSort()

  window.userManagementSort = {
    key,
    direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc'
  }

  showUserManagement()
}

window.showUserManagement = async function () {
  if (!ensurePageAccess('users')) return

  localStorage.setItem('currentPage', 'users')

  const [
    response,
    userCustomers,
    userSites,
    userSections
  ] = await Promise.all([
    fetch(`${API_BASE}/users`),
    fetchJsonOrDefault(`${API_BASE}/customers`, []),
    fetchJsonOrDefault(`${API_BASE}/sites`, []),
    fetchJsonOrDefault(`${API_BASE}/sections`, [])
  ])
  const users = await response.json()

  if (!response.ok) {
    alert(users.error || 'Unable to load users')
    return
  }

  window.userManagementLookups = {
    customers: userCustomers,
    sites: userSites,
    sections: userSections
  }

  const sortedUsers = sortUserManagementRows(users)

  document.querySelector('#page').innerHTML = `
    <div class="user-management-page">
    <h1>User Management</h1>

    <div class="filter-card user-create-card">
      <h2>Create User</h2>
      <div class="asset-form-grid">
        <div class="form-group">
          <label>Username</label>
          <input id="newUserUsername" type="text">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input id="newUserEmail" type="email">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input id="newUserPassword" type="password">
        </div>
        <div class="form-group">
          <label>Full Name</label>
          <input id="newUserFullName" type="text">
        </div>
        <div class="form-group">
          <label>Role</label>
          <select id="newUserRole">
            <option value="ADMIN">ADMIN</option>
            <option value="MANAGER">MANAGER</option>
            <option value="INSPECTOR">INSPECTOR</option>
            <option value="VIEWER">VIEWER</option>
            <option value="CUSTOMER">CUSTOMER</option>
          </select>
        </div>
        <div class="form-group">
          <label>LMI Number</label>
          <input id="newUserLmi" type="text">
        </div>
        <div class="form-group">
          <label>Customer Name</label>
          <select id="newUserClientId">
            ${renderUserLookupOptions(userCustomers, "clientid", "clientname", "", "No customer selected")}
          </select>
        </div>
        <div class="form-group">
          <label>Site Name</label>
          <select id="newUserSiteId">
            ${renderUserLookupOptions(userSites, "siteid", "sitename", "", "No site selected")}
          </select>
        </div>
        <div class="form-group">
          <label>Section Name</label>
          <select id="newUserSectionId">
            ${renderUserLookupOptions(userSections, "sectionid", "sectionname", "", "No section selected")}
          </select>
        </div>
      </div>
      <button onclick="createUser()">Create User</button>
    </div>

    <div class="filter-card user-signature-card">
      <h2>My Signature</h2>
      <p>Upload your own inspector signature. It will be used on new inspections saved under your login.</p>
      <input id="mySignatureUpload" type="file" accept="image/*">
      <button onclick="uploadMySignature()">Upload Signature</button>
    </div>

    <div class="user-management-table-wrap">
    <table class="user-management-table">
      <thead>
        <tr>
          <th>${userSortHeader('User', 'username')}</th>
          <th>${userSortHeader('Email', 'email')}</th>
          <th>${userSortHeader('Full Name', 'full_name')}</th>
          <th>${userSortHeader('Role', 'role')}</th>
          <th>${userSortHeader('LMI Number', 'lmi_number')}</th>
          <th>${userSortHeader('Customer Name', 'clientid')}</th>
          <th>${userSortHeader('Site Name', 'siteid')}</th>
          <th>${userSortHeader('Section Name', 'sectionid')}</th>
          <th>${userSortHeader('Active', 'is_active')}</th>
          <th>${userSortHeader('Signature', 'signature_image')}</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${sortedUsers.map(user => `
          <tr class="${user.is_active ? '' : 'inactive-user-row'}">
            <td class="user-name-cell">${escapeHtml(user.username)}</td>
            <td><input id="user-email-${safeAttr(user.user_id)}" value="${safeAttr(user.email || '')}"></td>
            <td><input id="user-name-${safeAttr(user.user_id)}" value="${safeAttr(user.full_name || '')}"></td>
            <td>
              <select id="user-role-${user.user_id}">
                ${['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER', 'CUSTOMER'].map(role => `
                  <option value="${role}" ${role === user.role ? 'selected' : ''}>${role}</option>
                `).join('')}
              </select>
            </td>
            <td><input id="user-lmi-${safeAttr(user.user_id)}" value="${safeAttr(user.lmi_number || '')}"></td>
            <td>
              <select id="user-client-${user.user_id}">
                ${renderUserLookupOptions(userCustomers, "clientid", "clientname", user.clientid, "No customer selected")}
              </select>
            </td>
            <td>
              <select id="user-site-${user.user_id}">
                ${renderUserLookupOptions(userSites, "siteid", "sitename", user.siteid, "No site selected")}
              </select>
            </td>
            <td>
              <select id="user-section-${user.user_id}">
                ${renderUserLookupOptions(userSections, "sectionid", "sectionname", user.sectionid, "No section selected")}
              </select>
            </td>
            <td class="user-active-cell">
              <input class="user-status-check" id="user-active-${user.user_id}" type="checkbox" ${user.is_active ? 'checked' : ''}>
            </td>
            <td>
              <div class="user-signature-cell">
                <span class="${user.signature_image ? 'signature-status saved' : 'signature-status'}">${user.signature_image ? 'Saved' : '-'}</span>
                <input id="user-signature-${user.user_id}" type="file" accept="image/*">
                <button type="button" class="secondary-small-btn" onclick="uploadUserSignature(${user.user_id})">Upload</button>
              </div>
            </td>
            <td class="user-row-actions">
              <button onclick="saveUser(${user.user_id})">Save</button>
              <button class="secondary-small-btn" onclick="resetUserPassword(${user.user_id})">Reset Password</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
    </div>
  `
}

window.createUser = async function () {
  const response = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: document.querySelector('#newUserUsername').value,
      email: document.querySelector('#newUserEmail').value,
      password: document.querySelector('#newUserPassword').value,
      full_name: document.querySelector('#newUserFullName').value,
      role: document.querySelector('#newUserRole').value,
      lmi_number: document.querySelector('#newUserLmi').value,
      clientid: document.querySelector('#newUserClientId').value,
      siteid: document.querySelector('#newUserSiteId').value,
      sectionid: document.querySelector('#newUserSectionId').value
    })
  })

  const result = await response.json()

  if (!response.ok) {
    alert(result.error || 'Unable to create user')
    return
  }

  alert('User created successfully')
  showUserManagement()
}

window.saveUser = async function (userId) {
  if (!userId || userId === 'null') {
    alert('This user record is missing an account ID. The list will refresh now.')
    showUserManagement()
    return
  }

  const response = await fetch(`${API_BASE}/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: document.querySelector(`#user-email-${userId}`).value,
      full_name: document.querySelector(`#user-name-${userId}`).value,
      role: document.querySelector(`#user-role-${userId}`).value,
      lmi_number: document.querySelector(`#user-lmi-${userId}`).value,
      clientid: document.querySelector(`#user-client-${userId}`).value,
      siteid: document.querySelector(`#user-site-${userId}`).value,
      sectionid: document.querySelector(`#user-section-${userId}`).value,
      is_active: document.querySelector(`#user-active-${userId}`).checked
    })
  })

  const result = await response.json()

  if (!response.ok) {
    alert(result.error || 'Unable to save user')
    return
  }

  alert('User saved successfully')
  showUserManagement()
}

window.uploadUserSignature = async function (userId) {
  if (!userId || userId === 'null') {
    alert('This user record is missing an account ID. The list will refresh now.')
    showUserManagement()
    return
  }

  const file = document.querySelector(`#user-signature-${userId}`)?.files[0]
  if (!file) {
    alert('Choose a signature image for this user')
    return
  }

  const formData = new FormData()
  formData.append('signature', file)

  const response = await fetch(`${API_BASE}/users/${userId}/signature`, {
    method: 'POST',
    body: formData
  })

  const result = await readApiResponse(response)

  if (!response.ok) {
    alert(result.error || 'Unable to upload signature')
    return
  }

  alert('Signature saved successfully')
  showUserManagement()
}

window.resetUserPassword = async function (userId) {
  if (!userId || userId === 'null') {
    alert('This user record is missing an account ID. The list will refresh now.')
    showUserManagement()
    return
  }

  const password = prompt('Enter the new password for this user. It must be at least 8 characters.')

  if (password === null) return

  if (password.length < 8) {
    alert('Password must be at least 8 characters')
    return
  }

  const confirmPassword = prompt('Confirm the new password')

  if (confirmPassword === null) return

  if (password !== confirmPassword) {
    alert('Passwords do not match')
    return
  }

  const response = await fetch(`${API_BASE}/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })

  const result = await readApiResponse(response)

  if (!response.ok) {
    alert(result.error || 'Unable to reset password')
    return
  }

  alert('Password reset successfully')
}

window.deleteUser = async function (userId) {
  if (!confirm('Delete this user? This will deactivate the login and keep old records safe.')) return

  const response = await fetch(`${API_BASE}/users/${userId}`, {
    method: 'DELETE'
  })

  const result = await response.json()

  if (!response.ok) {
    alert(result.error || 'Unable to delete user')
    return
  }

  showUserManagement()
}

window.uploadMySignature = async function () {
  const file = document.querySelector('#mySignatureUpload')?.files[0]
  if (!file) {
    alert('Choose a signature image')
    return
  }

  const formData = new FormData()
  formData.append('signature', file)

  const response = await fetch(`${API_BASE}/users/me/signature`, {
    method: 'POST',
    body: formData
  })

  const result = await response.json()

  if (!response.ok) {
    alert(result.error || 'Unable to upload signature')
    return
  }

  currentUser = result.user
  window.currentUser = currentUser
  alert('Signature saved successfully')
  if (hasAccess('users') && localStorage.getItem('currentPage') === 'users') {
    showUserManagement()
  } else {
    showMyProfile()
  }
}

window.showMyProfile = async function () {
  if (!ensurePageAccess('profile')) return

  localStorage.setItem('currentPage', 'profile')

  const response = await fetch(`${API_BASE}/users/me`)
  const result = await readApiResponse(response)

  if (!response.ok) {
    alert(result.error || 'Unable to load your profile')
    return
  }

  currentUser = result.user
  window.currentUser = currentUser

  document.querySelector('#page').innerHTML = `
    <h1>My Profile</h1>
    <div class="filter-card my-profile-card">
      <h2>Profile Details</h2>
      <div class="asset-form-grid">
        <div class="form-group">
          <label>Username</label>
          <input value="${safeAttr(currentUser.username || '')}" disabled>
        </div>
        <div class="form-group">
          <label>Role</label>
          <input value="${safeAttr(currentUser.role || '')}" disabled>
        </div>
        <div class="form-group">
          <label>Full Name</label>
          <input id="myProfileFullName" type="text" value="${safeAttr(currentUser.full_name || '')}">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input id="myProfileEmail" type="email" value="${safeAttr(currentUser.email || '')}">
        </div>
        <div class="form-group">
          <label>LMI Number</label>
          <input id="myProfileLmi" type="text" value="${safeAttr(currentUser.lmi_number || '')}">
        </div>
      </div>
      <button onclick="saveMyProfile()">Save Profile</button>
    </div>

    <div class="filter-card user-signature-card">
      <h2>My Signature</h2>
      <p>Your signature will be used on new inspection and load test certificates saved under your login.</p>
      <div class="profile-signature-status">
        Current signature: <strong>${currentUser.signature_image ? 'Saved' : 'Not uploaded yet'}</strong>
      </div>
      <input id="mySignatureUpload" type="file" accept="image/*">
      <button onclick="uploadMySignature()">Upload Signature</button>
    </div>
  `
}

window.saveMyProfile = async function () {
  const response = await fetch(`${API_BASE}/users/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: document.querySelector('#myProfileFullName')?.value || '',
      email: document.querySelector('#myProfileEmail')?.value || '',
      lmi_number: document.querySelector('#myProfileLmi')?.value || ''
    })
  })

  const result = await readApiResponse(response)

  if (!response.ok) {
    alert(result.error || 'Unable to save your profile')
    return
  }

  currentUser = result.user
  window.currentUser = currentUser
  alert('Profile saved successfully')
  showMyProfile()
}

async function fetchJsonOrDefault(url, fallback) {
  const response = await fetch(url)

  if (!response.ok) {
    if ([401, 403].includes(response.status)) return fallback
    const errorBody = await response.json().catch(() => ({}))
    throw new Error(errorBody.error || `Unable to load ${url}`)
  }

  return response.json()
}

async function fetchJsonBestEffort(url, fallback) {
  try {
    return await fetchJsonOrDefault(url, fallback)
  } catch (err) {
    console.error(`Unable to load optional data from ${url}:`, err)
    return fallback
  }
}

async function getAssetForAction(assetid) {
  const cachedAsset = assets.find(
    asset => String(asset.assetid) === String(assetid)
  )

  if (cachedAsset) return cachedAsset

  const response = await fetch(`${API_BASE}/assets/${assetid}`)
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || "Asset not found")
  }

  return result
}

function renderStartupError(message) {
  document.querySelector('#app').innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <img src="${assetUrl('logo.jpg')}" alt="ATEC Logo" class="login-logo">
        <h1>ATEC needs a database update</h1>
        <p>${message}</p>
        <p>
          Please run:
          <strong>database/2026-06-23-equipment-400-photos-and-critical-rule.sql</strong>
        </p>
        <button type="button" onclick="location.reload()">Reload</button>
      </div>
    </div>
  `
}

async function loadData() {
  let sessionResponse

  try {
    sessionResponse = await fetch(`${API_BASE}/auth/me`)
  } catch (err) {
    renderLogin('Cannot connect to the ATEC backend. Please check that the backend is running.')
    return
  }

  if (!sessionResponse.ok) {
    renderLogin()
    return
  }

  const session = await sessionResponse.json()
  currentUser = session.user
  window.currentUser = currentUser

  assets = []

  try {
    const [
      customersData,
      sitesData,
      responsiblePersonsData,
      sectionsData,
      equipmentTypesData,
      dashboardStatsData,
      criteriaData
    ] = await Promise.all([
      fetchJsonOrDefault(`${API_BASE}/customers`, []),
      fetchJsonOrDefault(`${API_BASE}/sites`, []),
      fetchJsonOrDefault(`${API_BASE}/responsible-persons`, []),
      fetchJsonOrDefault(`${API_BASE}/sections`, []),
      fetchJsonOrDefault(`${API_BASE}/equipment-types`, []),
      fetchJsonBestEffort(`${API_BASE}/dashboard/stats`, {}),
      fetchJsonOrDefault(`${API_BASE}/equipment-type-criteria`, [])
    ])

    customers = customersData
    sites = sitesData
    responsiblePersons = responsiblePersonsData
    sections = sectionsData
    equipmentTypes = equipmentTypesData
    dashboardStats = dashboardStatsData
    criteria = criteriaData
    window.atecCriteria = criteria
  } catch (err) {
    renderStartupError(err.message || "The database update has not been completed.")
    return
  }

         document.querySelector('#app').innerHTML = `
    <div class="app">

     <div class="layout">

  <div class="sidebar">

          <div class="logo-container">
            <img src="${assetUrl('logo.jpg')}" alt="ATEC Logo" class="logo">
          </div>

          <div class="system-title">
            Inspection Platform
          </div>

    <div class="user-panel">
      <strong>${escapeHtml(currentUser.full_name)}</strong>
      <span>${escapeHtml(currentUser.role)}${currentUser.lmi_number ? ` | LMI ${escapeHtml(currentUser.lmi_number)}` : ''}</span>
    </div>

    <button class="mobile-menu-toggle" onclick="toggleMobileMenu()" aria-expanded="false">
      Menu
    </button>

    <div class="mobile-menu-actions">
    ${menuButton('dashboard', 'Dashboard', 'showDashboard()')}
    ${menuButton('customers', 'Customer Setup', 'showCustomerSetup()')}
    ${menuButton('sites', 'Sites', 'showSites()')}
    ${menuButton('responsible', 'Responsible Persons', 'showResponsiblePersons()')}
    ${menuButton('sections', 'Sections', 'showSections()')}
    ${menuButton('assets', 'Assets', 'showAssetSetup()')}
    ${menuButton('inspections', 'Inspection/Testing', 'showInspections()')}
    ${menuButton('quick-inspection', 'Quick Inspection/Testing', 'showQuickInspection()')}
    ${menuButton('certificates', 'Certificates', 'showCertificateSearch()')}
    ${menuButton('customer-report', 'Reports', 'showCustomerDetailedReport()')}
    ${menuButton('she', 'Risk Assessment / SHE', 'showRiskAssessments()')}
    ${menuButton('criteria', 'Equipment Type Criteria', 'showEquipmentTypeCriteria()')}
    ${menuButton('users', 'User Management', 'showUserManagement()')}
    ${menuButton('system-health', 'System Health', 'showSystemHealth()')}
    ${menuButton('profile', 'My Profile', 'showMyProfile()')}

    <button onclick="logoutUser()">Logout</button>
    </div>

  </div>

  <div class="content">
    <div id="page"></div>
  </div>

</div>

</div>

  `

window.toggleMobileMenu = function () {
  const sidebar = document.querySelector('.sidebar')
  const toggle = document.querySelector('.mobile-menu-toggle')
  const isOpen = sidebar?.classList.toggle('mobile-menu-open')
  toggle?.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
}

window.closeMobileMenu = function () {
  const sidebar = document.querySelector('.sidebar')
  const toggle = document.querySelector('.mobile-menu-toggle')
  sidebar?.classList.remove('mobile-menu-open')
  toggle?.setAttribute('aria-expanded', 'false')
}

window.showDashboard = function () {
  if (!ensurePageAccess('dashboard')) return

  localStorage.setItem("currentPage", "dashboard")

  renderDashboard(
    customers,
    assets,
    sites,
    equipmentTypes,
    dashboardStats
  )

  loadDashboardSummary()
}

let customerArchiveMode = localStorage.getItem("customerArchiveMode") || "active"

window.showCustomerSetup = function (mode = customerArchiveMode) {
  if (!ensurePageAccess('customers')) return

  customerArchiveMode = mode

  localStorage.setItem("currentPage", "customers")
  localStorage.setItem("customerArchiveMode", mode)

  renderCustomerSetup(customers, customerArchiveMode)

}

window.addClient = async function () {
  const clientName = prompt("Enter Client Name")

  if (!clientName) return

  const clientAddress = prompt("Enter Client Address")

  const response = await fetch(`${API_BASE}/customers`, {
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
      value="${safeAttr(customer.clientname || '')}"
    >

    <label>Address</label>
    <input
      id="editClientAddress"
      type="text"
      value="${safeAttr(customer.clientaddr || '')}"
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
    `${API_BASE}/customers/${clientid}`,
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

window.filterCustomers = function (resetPage = false) {
  if (resetPage) window.customerCurrentPage = 1

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

  const pagination = getPaginationState(filtered, "customerCurrentPage", "customerRowsPerPage")
  const paginationBar = document.querySelector(".report-pagination-bar")
  if (paginationBar) {
    paginationBar.outerHTML = renderPaginationControls({
      ...pagination,
      label: "customers",
      onPage: "goToCustomerPage",
      onPageSize: "setCustomerRowsPerPage"
    })
  }

  const tableBody = document.querySelector("#customerTableBody")

  tableBody.innerHTML = pagination.rows.map(customer => {
    const isArchived =
      customer.archived === true || customer.archived === "true"

    return `
      <tr>
        <td>${escapeHtml(customer.clientid)}</td>
        <td>${escapeHtml(customer.clientname || "")}</td>
        <td>${escapeHtml(customer.clientaddr || "")}</td>
        <td>${isArchived ? "Archived" : "Active"}</td>
        <td>
          <button onclick="editClient(${customer.clientid})">Edit</button>

          ${canArchiveSetupRecords() ? `
          ${
            isArchived
              ? `<button onclick="unarchiveClient(${customer.clientid})">Restore</button>`
              : `<button onclick="archiveClient(${customer.clientid})">Archive</button>`
          }
          ` : ''}
        </td>
      </tr>
    `
  }).join("")
}

window.setCustomerRowsPerPage = function (value) {
  window.customerRowsPerPage = Number(value) || 25
  window.customerCurrentPage = 1
  filterCustomers()
}

window.goToCustomerPage = function (page) {
  window.customerCurrentPage = Math.max(1, Number(page) || 1)
  filterCustomers()
}

window.archiveClient = async function (clientid) {
  if (!canArchiveSetupRecords()) {
    alert("You do not have permission to archive customers.")
    return
  }

  if (!confirm("Archive this client and all linked data?"))
    return

  await fetch(
    `${API_BASE}/customers/${clientid}/archive`,
    {
      method: "PUT"
    }
  )

  await loadData()

  showCustomerSetup()

}

window.unarchiveClient = async function (clientid) {
  if (!canArchiveSetupRecords()) {
    alert("You do not have permission to restore customers.")
    return
  }

  await fetch(
    `${API_BASE}/customers/${clientid}/unarchive`,
    {
      method: "PUT"
    }
  )

  await loadData()

  showCustomerSetup()

}

let responsibleArchiveMode = localStorage.getItem("responsibleArchiveMode") || "active"

window.showResponsiblePersons = function (mode = responsibleArchiveMode) {
  if (!ensurePageAccess('responsible')) return

  responsibleArchiveMode = mode
  localStorage.setItem("currentPage", "responsible")
  localStorage.setItem("responsibleArchiveMode", mode)
  renderResponsiblePersons(responsiblePersons, responsibleArchiveMode)
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
        <option value="${safeAttr(client.clientid)}">
          ${escapeHtml(client.clientname)}
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
    `${API_BASE}/responsible-persons`,
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
      value="${safeAttr(person.name || '')}"
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
    `${API_BASE}/responsible-persons/${personid}`,
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

window.filterResponsiblePersons = function (resetPage = false) {
  if (resetPage) window.responsibleCurrentPage = 1

  const search = document
    .querySelector('#responsibleSearch')
    .value
    .toLowerCase()
    .trim()

  const filtered = responsiblePersons.filter(person => {
    const isArchived = person.archived === true || person.archived === "true"
    if (responsibleArchiveMode === "active" && isArchived) return false
    if (responsibleArchiveMode === "archived" && !isArchived) return false

    return (
      String(person.personid || '').includes(search) ||
      (person.clientname || '').toLowerCase().includes(search) ||
      (person.name || '').toLowerCase().includes(search)
    )
  })

  const pagination = getPaginationState(filtered, "responsibleCurrentPage", "responsibleRowsPerPage")
  const paginationBar = document.querySelector(".report-pagination-bar")
  if (paginationBar) {
    paginationBar.outerHTML = renderPaginationControls({
      ...pagination,
      label: "people",
      onPage: "goToResponsiblePage",
      onPageSize: "setResponsibleRowsPerPage"
    })
  }

  document.querySelector('#responsibleTableBody').innerHTML =
    pagination.rows.map(person => `
      <tr>
        <td>${escapeHtml(person.personid)}</td>
        <td>${escapeHtml(person.clientname || '')}</td>
        <td>${escapeHtml(person.name || '')}</td>
        <td>${person.archived ? 'Archived' : 'Active'}</td>
        <td>
          <button onclick="editResponsiblePerson(${person.personid})">
            Edit
          </button>
          ${canArchiveSetupRecords() ? `
          ${
            person.archived
              ? `<button onclick="unarchiveResponsiblePerson(${person.personid})">Restore</button>`
              : `<button onclick="archiveResponsiblePerson(${person.personid})">Archive</button>`
          }
          ` : ''}
        </td>
      </tr>
    `).join('')
}

window.archiveResponsiblePerson = async function (personid) {
  if (!canArchiveSetupRecords()) {
    alert("You do not have permission to archive responsible persons.")
    return
  }

  if (!confirm("Archive this responsible person? Active sections and assets must be moved first.")) return

  const response = await fetch(
    `${API_BASE}/responsible-persons/${personid}/archive`,
    {
      method: "PUT"
    }
  )

  const result = await readApiResponse(response)

  if (!response.ok) {
    alert(result.error || "Unable to archive responsible person.")
    return
  }

  alert("Responsible person archived")

  await loadData()
  showResponsiblePersons()
}

window.unarchiveResponsiblePerson = async function (personid) {
  if (!canArchiveSetupRecords()) {
    alert("You do not have permission to restore responsible persons.")
    return
  }

  const response = await fetch(
    `${API_BASE}/responsible-persons/${personid}/unarchive`,
    {
      method: "PUT"
    }
  )

  const result = await readApiResponse(response)

  if (!response.ok) {
    alert(result.error || "Unable to restore responsible person.")
    return
  }

  alert("Responsible person restored")

  await loadData()
  showResponsiblePersons()
}

window.setResponsibleRowsPerPage = function (value) {
  window.responsibleRowsPerPage = Number(value) || 25
  window.responsibleCurrentPage = 1
  filterResponsiblePersons()
}

window.goToResponsiblePage = function (page) {
  window.responsibleCurrentPage = Math.max(1, Number(page) || 1)
  filterResponsiblePersons()
}

let sectionArchiveMode = localStorage.getItem("sectionArchiveMode") || "active"

window.showSections = function (mode = sectionArchiveMode) {
  if (!ensurePageAccess('sections')) return

  sectionArchiveMode = mode
  localStorage.setItem("currentPage", "sections")
  localStorage.setItem("sectionArchiveMode", mode)
  renderSections(sections, sectionArchiveMode)
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
            <option value="${safeAttr(client.clientid)}">
              ${escapeHtml(client.clientname)}
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
    .filter(site =>
      String(site.clientid) === String(clientid) &&
      !(site.archived === true || site.archived === "true")
    )
    .sort((a, b) => (a.sitename || '').localeCompare(b.sitename || ''))

  const filteredResponsiblePersons = responsiblePersons
    .filter(person =>
      String(person.clientid) === String(clientid) &&
      !(person.archived === true || person.archived === "true")
    )
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  siteSelect.innerHTML = `
    <option value="">Select Site</option>
    ${filteredSites.map(site => `
      <option value="${safeAttr(site.siteid)}">
        ${escapeHtml(site.sitename)}
      </option>
    `).join('')}
  `

  responsibleSelect.innerHTML = `
    <option value="">Select Responsible Person</option>
    ${filteredResponsiblePersons.map(person => `
      <option value="${safeAttr(person.personid)}">
        ${escapeHtml(person.name)}
      </option>
    `).join('')}
  `
}

window.filterSections = function (resetPage = false) {
  if (resetPage) window.sectionCurrentPage = 1

  const searchType = document.querySelector("#sectionSearchType").value

  const search = document
    .querySelector("#sectionSearch")
    .value
    .toLowerCase()
    .trim()

  const filtered = sections.filter(section => {
    const isArchived = section.archived === true || section.archived === "true"
    if (sectionArchiveMode === "active" && isArchived) return false
    if (sectionArchiveMode === "archived" && !isArchived) return false

    const fieldValue = String(section[searchType] || "")
      .toLowerCase()

    return fieldValue.includes(search)
  })

  const sortedSections = sortTableRows(filtered, 'sections', {
    client_section: section => `${section.clientname || ''}\u0000${section.sectionname || ''}`,
    sectionid: section => section.sectionid,
    clientname: section => section.clientname,
    sitename: section => section.sitename,
    responsiblename: section => section.responsiblename,
    sectionname: section => section.sectionname,
    archived: section => section.archived ? 'Archived' : 'Active'
  }, 'client_section')

  const pagination = getPaginationState(sortedSections, "sectionCurrentPage", "sectionRowsPerPage")
  const paginationBar = document.querySelector(".report-pagination-bar")
  if (paginationBar) {
    paginationBar.outerHTML = renderPaginationControls({
      ...pagination,
      label: "sections",
      onPage: "goToSectionPage",
      onPageSize: "setSectionRowsPerPage"
    })
  }

  document.querySelector("#sectionTableBody").innerHTML =
    pagination.rows.map(section => `
      <tr>
        <td>${escapeHtml(section.sectionid)}</td>
        <td>${escapeHtml(section.clientname || "")}</td>
        <td>${escapeHtml(section.sitename || "")}</td>
        <td>${escapeHtml(section.responsiblename || "")}</td>
        <td>${escapeHtml(section.sectionname || "")}</td>
        <td>${section.archived ? "Archived" : "Active"}</td>
        <td>
          <button onclick="editSection(${section.sectionid})">
            Edit
          </button>
          ${canArchiveSetupRecords() ? `
          ${
            section.archived
              ? `<button onclick="unarchiveSection(${section.sectionid})">Restore</button>`
              : `<button onclick="archiveSection(${section.sectionid})">Archive</button>`
          }
          ` : ''}
        </td>
      </tr>
    `).join("")
}

window.setSectionRowsPerPage = function (value) {
  window.sectionRowsPerPage = Number(value) || 25
  window.sectionCurrentPage = 1
  filterSections()
}

window.goToSectionPage = function (page) {
  window.sectionCurrentPage = Math.max(1, Number(page) || 1)
  filterSections()
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
    .filter(person =>
      String(person.clientid) === String(section.clientid) &&
      (
        !(person.archived === true || person.archived === "true") ||
        String(person.personid) === String(section.responsibleid)
      )
    )
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  document.querySelector('#page').innerHTML = `
    <h2>Edit Section</h2>

    <label>Client</label>
    <input type="text" value="${safeAttr(section.clientname || '')}" disabled>

    <label>Site</label>
    <input type="text" value="${safeAttr(section.sitename || '')}" disabled>

    <label>Responsible Person</label>
    <select id="editSectionResponsible">
      ${filteredResponsiblePersons.map(person => `
        <option
          value="${safeAttr(person.personid)}"
          ${String(person.personid) === String(section.responsibleid) ? 'selected' : ''}
        >
          ${escapeHtml(person.name)}
        </option>
      `).join('')}
    </select>

    <label>Section Name</label>
    <input
      id="editSectionName"
      type="text"
      value="${safeAttr(section.sectionname || '')}"
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
    `${API_BASE}/sections/${sectionid}`,
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

  const response = await fetch(`${API_BASE}/sections`, {
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

window.archiveSection = async function (sectionid) {
  if (!canArchiveSetupRecords()) {
    alert("You do not have permission to archive sections.")
    return
  }

  if (!confirm("Archive this section? Active assets must be moved or archived first.")) return

  const response = await fetch(`${API_BASE}/sections/${sectionid}/archive`, {
    method: "PUT"
  })
  const result = await response.json()

  if (!response.ok) {
    alert(result.error || "Unable to archive section")
    return
  }

  alert("Section archived")
  await loadData()
  showSections()
}

window.unarchiveSection = async function (sectionid) {
  if (!canArchiveSetupRecords()) {
    alert("You do not have permission to restore sections.")
    return
  }

  const response = await fetch(`${API_BASE}/sections/${sectionid}/unarchive`, {
    method: "PUT"
  })
  const result = await response.json()

  if (!response.ok) {
    alert(result.error || "Unable to restore section")
    return
  }

  alert("Section restored")
  await loadData()
  showSections()
}

let siteArchiveMode = localStorage.getItem("siteArchiveMode") || "active"

window.showSites = function (mode = siteArchiveMode) {
  if (!ensurePageAccess('sites')) return

  siteArchiveMode = mode
  localStorage.setItem("currentPage", "sites")
  localStorage.setItem("siteArchiveMode", mode)
  renderSites(sites, siteArchiveMode)

}

window.filterSites = function (resetPage = false) {
  if (resetPage) window.siteCurrentPage = 1

  const search = document
    .querySelector('#siteSearch')
    .value
    .toLowerCase()
    .trim()

  const filtered = sites.filter(site => {
    const isArchived = site.archived === true || site.archived === "true"
    const archiveMatch =
      siteArchiveMode === "all" ||
      (siteArchiveMode === "active" && !isArchived) ||
      (siteArchiveMode === "archived" && isArchived)
    const searchMatch =
      String(site.siteid || '').includes(search) ||
      (site.clientname || '').toLowerCase().includes(search) ||
      (site.sitename || '').toLowerCase().includes(search)

    return archiveMatch && searchMatch
  })

  const pagination = getPaginationState(filtered, "siteCurrentPage", "siteRowsPerPage")
  const paginationBar = document.querySelector(".report-pagination-bar")
  if (paginationBar) {
    paginationBar.outerHTML = renderPaginationControls({
      ...pagination,
      label: "sites",
      onPage: "goToSitePage",
      onPageSize: "setSiteRowsPerPage"
    })
  }

  document.querySelector('#siteTableBody').innerHTML =
    pagination.rows.map(site => `
      <tr>
        <td>${escapeHtml(site.siteid)}</td>
        <td>${escapeHtml(site.clientname || '')}</td>
        <td>${escapeHtml(site.sitename || '')}</td>
        <td>${site.archived ? "Archived" : "Active"}</td>
        <td>
          <button onclick="editSite(${site.siteid})">
            Edit
          </button>
          ${canArchiveSetupRecords() ? `
          ${
            site.archived
              ? `<button onclick="unarchiveSite(${site.siteid})">Restore</button>`
              : `<button onclick="archiveSite(${site.siteid})">Archive</button>`
          }
          ` : ''}
        </td>
      </tr>
    `).join('')
}

window.setSiteRowsPerPage = function (value) {
  window.siteRowsPerPage = Number(value) || 25
  window.siteCurrentPage = 1
  filterSites()
}

window.goToSitePage = function (page) {
  window.siteCurrentPage = Math.max(1, Number(page) || 1)
  filterSites()
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
      value="${safeAttr(site.clientname || '')}"
      disabled
    >

    <label>Site Name</label>
    <input
      id="editSiteName"
      type="text"
      value="${safeAttr(site.sitename || '')}"
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
    `${API_BASE}/sites/${siteid}`,
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

window.archiveSite = async function (siteid) {
  if (!canArchiveSetupRecords()) {
    alert("You do not have permission to archive sites.")
    return
  }

  if (!confirm("Archive this site? Active assets must be moved or archived first.")) return

  const response = await fetch(`${API_BASE}/sites/${siteid}/archive`, {
    method: "PUT"
  })
  const result = await response.json()

  if (!response.ok) {
    alert(result.error || "Unable to archive site")
    return
  }

  alert("Site archived")
  await loadData()
  showSites()
}

window.unarchiveSite = async function (siteid) {
  if (!canArchiveSetupRecords()) {
    alert("You do not have permission to restore sites.")
    return
  }

  const response = await fetch(`${API_BASE}/sites/${siteid}/unarchive`, {
    method: "PUT"
  })
  const result = await response.json()

  if (!response.ok) {
    alert(result.error || "Unable to restore site")
    return
  }

  alert("Site restored")
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
        <option value="${safeAttr(client.clientid)}">
          ${escapeHtml(client.clientname)}
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

  const response = await fetch(`${API_BASE}/sites`, {
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

window.showAssetSetup = async function () {
  if (!ensurePageAccess('assets')) return

  localStorage.setItem("currentPage", "assets")
  const state = window.assetListState || {}
  window.assetCurrentPage = state.currentPage || window.assetCurrentPage || 1
  window.assetRowsPerPage = state.rowsPerPage || window.assetRowsPerPage || 25

  await loadAssetSetupPage()
}

window.showRiskAssessments = async function () {
  if (!ensurePageAccess('she')) return

  localStorage.setItem("currentPage", "she")
  window.canWriteRiskAssessments = ['ADMIN', 'MANAGER', 'INSPECTOR'].includes(currentUser?.role)
  await renderRiskAssessments(assets, window.canWriteRiskAssessments)
}

window.loadRiskAssessments = async function () {
  const response = await fetch(`${API_BASE}/she/risk-assessments`)
  const data = await response.json()

  if (!response.ok) {
    alert(data.error || "Unable to load risk assessments")
    return
  }

  window.riskAssessments = data
  renderRiskAssessmentTable(window.riskAssessments, window.canWriteRiskAssessments)
}

window.filterRiskAssessments = function () {
  renderRiskAssessmentTable(window.riskAssessments || [], window.canWriteRiskAssessments)
}

window.downloadRiskAssessments = async function (format = "pdf") {
  const params = new URLSearchParams()
  const search = document.querySelector("#riskSearch")?.value || ""
  const status = document.querySelector("#riskStatusFilter")?.value || ""

  if (search) params.append("search", search)
  if (status) params.append("status", status)

  const extension = format === "xlsx" ? "xlsx" : "pdf"
  const response = await fetch(`${API_BASE}/she/risk-assessments.${extension}?${params.toString()}`)

  if (!response.ok) {
    const data = await readApiResponse(response)
    alert(data.error || "Unable to download risk assessment register")
    return
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = `ATEC-SHE-Risk-Register.${extension}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function collectCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector))
    .filter(input => input.checked)
    .map(input => input.value)
}

function setCheckedValues(selector, values = []) {
  const selected = Array.isArray(values) ? values : []
  document.querySelectorAll(selector).forEach(input => {
    input.checked = selected.includes(input.value)
  })
}

function collectKeyedSelectValues(selector) {
  return Array.from(document.querySelectorAll(selector)).reduce((answers, select) => {
    answers[select.dataset.key] = select.value || ''
    return answers
  }, {})
}

function setKeyedSelectValues(selector, values = {}) {
  document.querySelectorAll(selector).forEach(select => {
    select.value = values?.[select.dataset.key] || ''
  })
}

function collectSlammTeamMembers() {
  return Array.from(document.querySelectorAll('.slamm-team-row')).map(row => ({
    name: row.querySelector('.slamm-team-name')?.value?.trim() || '',
    surname: row.querySelector('.slamm-team-surname')?.value?.trim() || '',
    signature: row.querySelector('.slamm-team-signature')?.value?.trim() || ''
  })).filter(member => member.name || member.surname || member.signature)
}

function setSlammTeamMembers(members = []) {
  const rows = Array.from(document.querySelectorAll('.slamm-team-row'))

  rows.forEach((row, index) => {
    const member = Array.isArray(members) ? members[index] || {} : {}
    row.querySelector('.slamm-team-name').value = member.name || ''
    row.querySelector('.slamm-team-surname').value = member.surname || ''
    row.querySelector('.slamm-team-signature').value = member.signature || ''
  })
}

window.saveRiskAssessment = async function () {
  const riskid = document.querySelector('#riskId')?.value || ''
  const payload = {
    assetid: document.querySelector('#riskAssetId')?.value || null,
    assessment_date: document.querySelector('#riskAssessmentDate')?.value,
    assessment_time: document.querySelector('#riskAssessmentTime')?.value || null,
    activity: document.querySelector('#riskActivity')?.value,
    hazard: document.querySelector('#riskHazard')?.value,
    hazard_categories: collectCheckedValues('.risk-hazard-category'),
    stop_questions: collectKeyedSelectValues('.slamm-stop-question'),
    consequence: document.querySelector('#riskConsequence')?.value,
    initial_severity: document.querySelector('#riskInitialSeverity')?.value,
    initial_likelihood: document.querySelector('#riskInitialLikelihood')?.value,
    controls: document.querySelector('#riskControls')?.value,
    residual_severity: document.querySelector('#riskResidualSeverity')?.value,
    residual_likelihood: document.querySelector('#riskResidualLikelihood')?.value,
    action_required: document.querySelector('#riskActionRequired')?.value,
    manage_plan: document.querySelector('#riskManagePlan')?.value,
    monitor_notes: document.querySelector('#riskMonitorNotes')?.value,
    review_questions: collectKeyedSelectValues('.slamm-review-question'),
    additional_notes: document.querySelector('#riskAdditionalNotes')?.value,
    team_members: collectSlammTeamMembers(),
    responsible_signoff_name: document.querySelector('#riskResponsibleSignoffName')?.value,
    supervisor_signoff_name: document.querySelector('#riskSupervisorSignoffName')?.value,
    responsible_person: document.querySelector('#riskResponsiblePerson')?.value,
    due_date: document.querySelector('#riskDueDate')?.value || null,
    status: document.querySelector('#riskStatus')?.value || 'OPEN'
  }

  if (!payload.activity || !payload.hazard) {
    alert("Activity and hazard are required")
    return
  }

  const response = await fetch(
    riskid ? `${API_BASE}/she/risk-assessments/${riskid}` : `${API_BASE}/she/risk-assessments`,
    {
      method: riskid ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  )
  const data = await response.json()

  if (!response.ok) {
    alert(data.error || "Unable to save risk assessment")
    return
  }

  alert("Risk assessment saved successfully")
  await showRiskAssessments()
}

window.editRiskAssessment = function (riskid) {
  const risk = (window.riskAssessments || []).find(item => String(item.riskid) === String(riskid))

  if (!risk) return

  if (!document.querySelector('#riskId')) {
    const hidden = document.createElement('input')
    hidden.type = 'hidden'
    hidden.id = 'riskId'
    document.querySelector('.filter-card').appendChild(hidden)
  }

  document.querySelector('#riskId').value = risk.riskid
  document.querySelector('#riskAssetId').value = risk.assetid || ''
  document.querySelector('#riskAssessmentDate').value = risk.assessment_date ? risk.assessment_date.split('T')[0] : ''
  document.querySelector('#riskAssessmentTime').value = risk.assessment_time ? String(risk.assessment_time).slice(0, 5) : ''
  document.querySelector('#riskStatus').value = risk.status || 'OPEN'
  document.querySelector('#riskActivity').value = risk.activity || ''
  document.querySelector('#riskHazard').value = risk.hazard || ''
  setCheckedValues('.risk-hazard-category', risk.hazard_categories || [])
  setKeyedSelectValues('.slamm-stop-question', risk.stop_questions || {})
  document.querySelector('#riskConsequence').value = risk.consequence || ''
  document.querySelector('#riskInitialSeverity').value = risk.initial_severity || 3
  document.querySelector('#riskInitialLikelihood').value = risk.initial_likelihood || 3
  document.querySelector('#riskControls').value = risk.controls || ''
  document.querySelector('#riskResidualSeverity').value = risk.residual_severity || 2
  document.querySelector('#riskResidualLikelihood').value = risk.residual_likelihood || 2
  document.querySelector('#riskActionRequired').value = risk.action_required || ''
  document.querySelector('#riskManagePlan').value = risk.manage_plan || ''
  document.querySelector('#riskMonitorNotes').value = risk.monitor_notes || ''
  setKeyedSelectValues('.slamm-review-question', risk.review_questions || {})
  document.querySelector('#riskAdditionalNotes').value = risk.additional_notes || ''
  setSlammTeamMembers(risk.team_members || [])
  document.querySelector('#riskResponsibleSignoffName').value = risk.responsible_signoff_name || ''
  document.querySelector('#riskSupervisorSignoffName').value = risk.supervisor_signoff_name || ''
  document.querySelector('#riskResponsiblePerson').value = risk.responsible_person || ''
  document.querySelector('#riskDueDate').value = risk.due_date ? risk.due_date.split('T')[0] : ''
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

window.archiveRiskAssessment = async function (riskid) {
  if (!confirm("Archive this risk assessment?")) return

  const response = await fetch(`${API_BASE}/she/risk-assessments/${riskid}/archive`, {
    method: "PUT"
  })
  const data = await response.json()

  if (!response.ok) {
    alert(data.error || "Unable to archive risk assessment")
    return
  }

  await window.loadRiskAssessments()
}

window.openAssetQrLabel = function (assetid) {
  window.open(`${API_BASE}/assets/${assetid}/qr-label.pdf`, "_blank")
}

window.showAddAssetForm = function () {
  if (!canManageAssetRecords()) {
    showAccessDenied()
    return
  }

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
        <option value="${safeAttr(client.clientid)}">
          ${escapeHtml(client.clientname)}
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
        <option value="${safeAttr(type.equiptypeid)}">
          ${escapeHtml(type.description)}
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
    <label>Asset Tag Number <span class="optional-label">(Optional)</span></label>
    <input id="assetTagNo" type="text" placeholder="Customer tag / plant number if available">
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
      <div class="form-group"><label>Main Hoist WLL(kg)</label><input id="assetWLL" type="number"></div>
      <div class="form-group"><label>Auxiliary Hoist WLL(kg)</label><input id="assetAuxHoistWLL" type="number"></div>
      <div class="form-group"><label>Span(mm)</label><input id="assetSpan" type="number"></div>
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="assetPermissibleDeflection" type="number"></div>
      <div class="form-group"><label>Main Hoist Description</label><input id="assetHoistDescription" type="text"></div>
      <div class="form-group"><label>Main Hoist Serial No</label><input id="assetHoistSerialNo" type="text"></div>
      <div class="form-group"><label>Auxiliary Hoist Description</label><input id="assetAuxHoistDescription" type="text"></div>
      <div class="form-group"><label>Auxiliary Hoist Serial No</label><input id="assetAuxHoistSerialNo" type="text"></div>
      <div class="form-group"><label>Main Hoist Hook Size(mm)</label><input id="assetHookSize" type="number"></div>
      <div class="form-group"><label>Auxiliary Hoist Hook Size(mm)</label><input id="assetAuxHoistHookSize" type="number"></div>
      <div class="form-group"><label>Height of Lift(mm)</label><input id="assetHeightOfLift" type="number"></div>
      <div class="form-group"><label>Main Hoist Steel Wire Rope(mm)</label><input id="assetSteelWireRopeMM" type="number"></div>
      <div class="form-group"><label>Auxiliary Hoist Steel Wire Rope(mm)</label><input id="assetAuxHoistRopeMM" type="number"></div>
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
    .filter(site =>
      String(site.clientid) === String(clientid) &&
      !(site.archived === true || site.archived === "true")
    )
    .sort((a, b) =>
      (a.sitename || '').localeCompare(b.sitename || '')
    )

  siteSelect.innerHTML = `
    <option value="">Select Site</option>

    ${filteredSites.map(site => `
      <option value="${safeAttr(site.siteid)}">
        ${escapeHtml(site.sitename)}
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
      String(section.siteid) === String(siteid) &&
      !(section.archived === true || section.archived === "true")
    )
    .sort((a, b) =>
      (a.sectionname || '').localeCompare(b.sectionname || '')
    )

  sectionSelect.innerHTML = `
    <option value="">Select Section</option>

    ${filteredSections.map(section => `
      <option value="${safeAttr(section.sectionid)}">
        ${escapeHtml(section.sectionname)}
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

const ASSET_PHOTO_MAX_BYTES = 15 * 1024 * 1024
const ASSET_PHOTO_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

function validateAssetPhotoFiles(files) {
  for (const file of files.filter(Boolean)) {
    if (!ASSET_PHOTO_ALLOWED_TYPES.has(file.type)) {
      alert("Asset photos must be JPG, PNG or WebP images.")
      return false
    }

    if (file.size > ASSET_PHOTO_MAX_BYTES) {
      alert("Asset photos must be 15 MB or smaller.")
      return false
    }
  }

  return true
}

window.saveAssetFromForm = async function () {
  if (!canManageAssetRecords()) {
    alert("You do not have permission to add assets.")
    return
  }

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

  const photo1 = document.querySelector('#newAssetPhoto1')?.files[0]
  const photo2 = document.querySelector('#newAssetPhoto2')?.files[0]

  if (!validateAssetPhotoFiles([photo1, photo2])) {
    return
  }

  const response = await fetch(`${API_BASE}/assets`, {
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
  hoistserialno: document.querySelector('#assetHoistSerialNo')?.value || null,
  auxhoistdescription: document.querySelector('#assetAuxHoistDescription')?.value || null,
  auxhoistserialno: document.querySelector('#assetAuxHoistSerialNo')?.value || null,
  auxhoistwll: document.querySelector('#assetAuxHoistWLL')?.value || null,
  auxhoisthooksize: document.querySelector('#assetAuxHoistHookSize')?.value || null,
  auxhoistropemm: document.querySelector('#assetAuxHoistRopeMM')?.value || null
}),
  })

  const newAsset = await response.json()

  if (!response.ok) {
    alert("Error saving asset: " + newAsset.error)
    return
  }

  if (photo1 || photo2) {
    const formData = new FormData()

    if (photo1) {
      formData.append("photo1", photo1)
    }

    if (photo2) {
      formData.append("photo2", photo2)
    }

    const photoResponse = await fetch(
      `${API_BASE}/assets/${newAsset.assetid}/photos`,
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

async function loadAssetSetupPage() {
  rememberAssetListState()

  const state = window.assetListState || {}
  const sort = getTableSortState('assets', 'assetid', 'desc')
  const params = new URLSearchParams({
    page: String(window.assetCurrentPage || state.currentPage || 1),
    limit: String(window.assetRowsPerPage || state.rowsPerPage || 25),
    searchBy: state.searchType || "all",
    search: state.search || "",
    sortKey: sort.key || "assetid",
    sortDir: sort.direction || "desc",
    archiveMode: state.archiveMode || "active"
  })

  const data = await fetchJsonOrDefault(`${API_BASE}/assets?${params.toString()}`, {
    rows: [],
    total: 0,
    page: 1,
    limit: Number(window.assetRowsPerPage || 25)
  })

  assets = data.rows || []
  window.assetCurrentPage = Number(data.page || window.assetCurrentPage || 1)
  window.assetRowsPerPage = Number(data.limit || window.assetRowsPerPage || 25)

  const pageInfo = {
    serverPaged: true,
    total: data.total || 0,
    page: window.assetCurrentPage,
    limit: window.assetRowsPerPage
  }

  if (document.querySelector('#assetTableBody')) {
    updateAssetSetupResults(assets, pageInfo)
  } else {
    renderAssetSetup(assets, pageInfo)
  }

  restoreAssetListState()
}

window.filterAssets = async function (resetPage = false) {
  if (resetPage) {
    window.assetCurrentPage = 1
  }

  await loadAssetSetupPage()
}

window.filterAssetsDebounced = function (resetPage = false) {
  rememberAssetListState()

  if (assetSearchTimer) {
    clearTimeout(assetSearchTimer)
  }

  assetSearchTimer = setTimeout(() => {
    filterAssets(resetPage)
  }, 350)
}

function rememberAssetListState() {
  const searchTypeInput = document.querySelector('#assetSearchType')
  const searchInput = document.querySelector('#assetSearch')
  const rowsInput = document.querySelector('#assetRowsPerPage')

  window.assetListState = {
    searchType: searchTypeInput ? searchTypeInput.value : window.assetListState?.searchType || "all",
    search: searchInput ? searchInput.value : window.assetListState?.search || "",
    currentPage: window.assetCurrentPage || window.assetListState?.currentPage || 1,
    rowsPerPage: Number(rowsInput?.value || window.assetRowsPerPage || window.assetListState?.rowsPerPage || 25)
  }
}

function restoreAssetListState() {
  const state = window.assetListState || {}
  const searchTypeInput = document.querySelector('#assetSearchType')
  const searchInput = document.querySelector('#assetSearch')
  const rowsInput = document.querySelector('#assetRowsPerPage')

  window.assetRowsPerPage = Number(state.rowsPerPage || window.assetRowsPerPage || 25)
  window.assetCurrentPage = Number(state.currentPage || window.assetCurrentPage || 1)

  if (searchTypeInput) searchTypeInput.value = state.searchType || "all"
  if (searchInput) searchInput.value = state.search || ""
  if (rowsInput) rowsInput.value = String(window.assetRowsPerPage)
}

function renderAssetPaginationControls(totalRows, startIndex, endIndex, currentPage, totalPages, pageSize) {
  const paginations = document.querySelectorAll('#assetPaginationControls, .asset-pagination-bottom')
  if (!paginations.length) return

  const pageButtons = renderAssetPageButtons(currentPage, totalPages)
  const controlsHtml = `
    <div class="report-page-controls">
      <button type="button" onclick="changeAssetPage(-1)" ${currentPage <= 1 ? "disabled" : ""}>
        Previous
      </button>
      ${pageButtons}
      <button type="button" onclick="changeAssetPage(1)" ${currentPage >= totalPages ? "disabled" : ""}>
        Next
      </button>
      <span>Showing ${totalRows === 0 ? 0 : startIndex + 1} to ${endIndex} of ${totalRows} assets - Page ${currentPage} of ${totalPages}</span>
    </div>
  `

  paginations.forEach(pagination => {
    if (pagination.id === "assetPaginationControls") {
      pagination.innerHTML = `
        <div class="report-page-size">
          <label for="assetRowsPerPage">Rows per page</label>
          <select id="assetRowsPerPage" onchange="setAssetRowsPerPage(this.value)">
            ${[25, 50, 100, 250].map(size => `
              <option value="${size}" ${size === pageSize ? "selected" : ""}>
                ${size}
              </option>
            `).join("")}
          </select>
        </div>

        ${controlsHtml}
      `
      return
    }

    pagination.innerHTML = `<div></div>${controlsHtml}`
  })
}

function getAssetPageNumbers(currentPage, totalPages) {
  const pages = []

  if (totalPages <= 10) {
    for (let page = 1; page <= totalPages; page += 1) {
      pages.push(page)
    }

    return pages
  }

  const visibleWindow = 9
  const halfWindow = Math.floor(visibleWindow / 2)
  let startPage = Math.max(1, currentPage - halfWindow)
  let endPage = Math.min(totalPages, startPage + visibleWindow - 1)

  if (endPage - startPage + 1 < visibleWindow) {
    startPage = Math.max(1, endPage - visibleWindow + 1)
  }

  if (startPage > 1) {
    pages.push(1)
    if (startPage > 2) {
      pages.push("...")
    }
  }

  for (let page = startPage; page <= endPage; page += 1) {
    pages.push(page)
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      pages.push("...")
    }
    pages.push(totalPages)
  }

  return pages
}

function renderAssetPageButtons(currentPage, totalPages) {
  return getAssetPageNumbers(currentPage, totalPages).map(page => {
    if (page === "...") {
      return `<span class="pagination-ellipsis">...</span>`
    }

    return `
      <button
        type="button"
        class="pagination-page-btn ${page === currentPage ? "active" : ""}"
        onclick="goToAssetPage(${page})"
        ${page === currentPage ? "disabled" : ""}
      >
        ${page}
      </button>
    `
  }).join("")
}

window.setAssetRowsPerPage = function (value) {
  window.assetRowsPerPage = Number(value) || 25
  window.assetCurrentPage = 1
  filterAssets()
}

window.changeAssetPage = function (direction) {
  window.assetCurrentPage = Math.max(1, (window.assetCurrentPage || 1) + direction)
  filterAssets()
}

window.goToAssetPage = function (page) {
  window.assetCurrentPage = Math.max(1, Number(page) || 1)
  filterAssets()
}

window.setAssetFilterKey = function (key) {
  const searchType = document.querySelector('#assetSearchType')
  if (!searchType) return

  searchType.value = key
  window.assetCurrentPage = 1
  filterAssets()
}

window.showMoveAssetForm = async function (assetid) {
  if (!canArchiveOrMoveAssetRecords()) {
    showAccessDenied()
    return
  }

  rememberAssetListState()

  let asset

  try {
    asset = await getAssetForAction(assetid)
  } catch (err) {
    alert(err.message || "Asset not found")
    return
  }

  const activeSites = sites
    .filter(site =>
      String(site.clientid) === String(asset.clientid) &&
      !(site.archived === true || site.archived === "true")
    )
    .sort((a, b) => (a.sitename || "").localeCompare(b.sitename || ""))

  document.querySelector("#page").innerHTML = `
    <h2>Move Asset ${escapeHtml(asset.assetid)}</h2>

    <div class="filter-card">
      <div class="asset-form-grid">
        <div class="form-group">
          <label>Customer</label>
          <input type="text" value="${safeAttr(asset.clientname || "")}" disabled>
        </div>

        <div class="form-group">
          <label>Current Site</label>
          <input type="text" value="${safeAttr(asset.sitename || "-")}" disabled>
        </div>

        <div class="form-group">
          <label>Current Section</label>
          <input type="text" value="${safeAttr(asset.sectionname || "-")}" disabled>
        </div>

        <div class="form-group">
          <label>New Site</label>
          <select id="moveAssetSite" onchange="filterMoveAssetSections()">
            <option value="">Select Site</option>
            ${activeSites.map(site => `
              <option value="${safeAttr(site.siteid)}" ${String(site.siteid) === String(asset.siteid) ? "selected" : ""}>
                ${escapeHtml(site.sitename)}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="form-group">
          <label>New Section</label>
          <select id="moveAssetSection">
            <option value="">Select Site First</option>
          </select>
        </div>
      </div>

      <div class="form-actions">
        <button onclick="saveAssetMove(${asset.assetid})">Move Asset</button>
        <button onclick="showAssetSetup()">Cancel</button>
      </div>
    </div>
  `

  filterMoveAssetSections(asset.sectionid)
}

window.filterMoveAssetSections = function (selectedSectionId = "") {
  const siteid = document.querySelector("#moveAssetSite")?.value || ""
  const sectionSelect = document.querySelector("#moveAssetSection")

  if (!sectionSelect) return

  if (!siteid) {
    sectionSelect.innerHTML = `<option value="">Select Site First</option>`
    return
  }

  const filteredSections = sections
    .filter(section =>
      String(section.siteid) === String(siteid) &&
      !(section.archived === true || section.archived === "true")
    )
    .sort((a, b) => (a.sectionname || "").localeCompare(b.sectionname || ""))

  sectionSelect.innerHTML = `
    <option value="">Select Section</option>
    ${filteredSections.map(section => `
      <option value="${safeAttr(section.sectionid)}" ${String(section.sectionid) === String(selectedSectionId) ? "selected" : ""}>
        ${escapeHtml(section.sectionname)}
      </option>
    `).join("")}
  `
}

window.saveAssetMove = async function (assetid) {
  if (!canArchiveOrMoveAssetRecords()) {
    alert("You do not have permission to move assets.")
    return
  }

  const siteid = document.querySelector("#moveAssetSite")?.value || ""
  const sectionid = document.querySelector("#moveAssetSection")?.value || ""

  if (!siteid || !sectionid) {
    alert("Please select the new site and section")
    return
  }

  const response = await fetch(`${API_BASE}/assets/${assetid}/move`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ siteid, sectionid })
  })

  const result = await response.json()

  if (!response.ok) {
    alert(result.error || "Unable to move asset")
    return
  }

  alert("Asset moved successfully")
  await loadData()
  showAssetSetup()
}

function buildEditAssetDynamicFields(groupid, values = {}) {
  let dynamicEditFields = ''

  if (groupid === '100') {
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${safeAttr(values.wll || '')}"></div>
      <div class="form-group"><label>Height of Lift(mm)</label><input id="editAssetHeightOfLift" type="number" value="${safeAttr(values.heightoflift || '')}"></div>
      <div class="form-group"><label>Number of Chain Falls</label><input id="editAssetNumberOfChainFalls" type="number" value="${safeAttr(values.numberofchainfalls || '')}"></div>
      <div class="form-group"><label>OEM Top Hook Size(mm)</label><input id="editAssetOEMTopHookSize" type="number" value="${safeAttr(values.oemtophooksize || '')}"></div>
      <div class="form-group"><label>OEM Bottom Hook Size(mm)</label><input id="editAssetOEMBottomHookSize" type="number" value="${safeAttr(values.oembottomhooksize || '')}"></div>
      <div class="form-group"><label>Load Chain Diameter(mm)</label><input id="editAssetLoadChainDiameter" type="number" value="${safeAttr(values.loadchaindiameter || '')}"></div>
    `
  }

  if (groupid === '200') {
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${safeAttr(values.wll || '')}"></div>
      <div class="form-group"><label>Effective Length(mm)</label><input id="editAssetEffectiveLength" type="number" value="${safeAttr(values.effectivelength || '')}"></div>
    `
  }

  if (groupid === '300' || groupid === '600') {
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${safeAttr(values.wll || '')}"></div>
    `
  }

  if (groupid === '400') {
    dynamicEditFields = `
      <div class="form-group"><label>Main Hoist WLL(kg)</label><input id="editAssetWLL" type="number" value="${safeAttr(values.wll || '')}"></div>
      <div class="form-group"><label>Auxiliary Hoist WLL(kg)</label><input id="editAssetAuxHoistWLL" type="number" value="${safeAttr(values.auxhoistwll || '')}"></div>
      <div class="form-group"><label>Span(mm)</label><input id="editAssetSpan" type="number" value="${safeAttr(values.span || '')}"></div>
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="editAssetPermissibleDeflection" type="number" value="${safeAttr(values.permissibledeflection || '')}"></div>
      <div class="form-group"><label>Main Hoist Description</label><input id="editAssetHoistDescription" type="text" value="${safeAttr(values.hoistdescription || '')}"></div>
      <div class="form-group"><label>Main Hoist Serial No</label><input id="editAssetHoistSerialNo" type="text" value="${safeAttr(values.hoistserialno || '')}"></div>
      <div class="form-group"><label>Auxiliary Hoist Description</label><input id="editAssetAuxHoistDescription" type="text" value="${safeAttr(values.auxhoistdescription || '')}"></div>
      <div class="form-group"><label>Auxiliary Hoist Serial No</label><input id="editAssetAuxHoistSerialNo" type="text" value="${safeAttr(values.auxhoistserialno || '')}"></div>
      <div class="form-group"><label>Main Hoist Hook Size(mm)</label><input id="editAssetHookSize" type="number" value="${safeAttr(values.hooksize || '')}"></div>
      <div class="form-group"><label>Auxiliary Hoist Hook Size(mm)</label><input id="editAssetAuxHoistHookSize" type="number" value="${safeAttr(values.auxhoisthooksize || '')}"></div>
      <div class="form-group"><label>Height of Lift(mm)</label><input id="editAssetHeightOfLift" type="number" value="${safeAttr(values.heightoflift || '')}"></div>
      <div class="form-group"><label>Main Hoist Steel Wire Rope(mm)</label><input id="editAssetSteelWireRopeMM" type="number" value="${safeAttr(values.steelwireropemm || '')}"></div>
      <div class="form-group"><label>Auxiliary Hoist Steel Wire Rope(mm)</label><input id="editAssetAuxHoistRopeMM" type="number" value="${safeAttr(values.auxhoistropemm || '')}"></div>
    `
  }

  if (groupid === '500') {
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${safeAttr(values.wll || '')}"></div>
      <div class="form-group"><label>Span(mm)</label><input id="editAssetSpan" type="number" value="${safeAttr(values.span || '')}"></div>
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="editAssetPermissibleDeflection" type="number" value="${safeAttr(values.permissibledeflection || '')}"></div>
      <div class="form-group"><label>Hook Size(mm)</label><input id="editAssetHookSize" type="number" value="${safeAttr(values.hooksize || '')}"></div>
      <div class="form-group"><label>Hoist Description</label><input id="editAssetHoistDescription" type="text" value="${safeAttr(values.hoistdescription || '')}"></div>
      <div class="form-group"><label>Hoist Serial No</label><input id="editAssetHoistSerialNo" type="text" value="${safeAttr(values.hoistserialno || '')}"></div>
    `
  }

  return dynamicEditFields
}

function collectCurrentEditAssetValues(fallback = {}) {
  const fieldValue = (selector, key) => document.querySelector(selector)?.value ?? fallback[key] ?? ''
  const dateValue = (selector, key) => {
    const value = document.querySelector(selector)?.value ?? fallback[key] ?? ''
    return String(value || '').slice(0, 10)
  }

  return {
    manufactdate: dateValue('#editAssetManufactDate', 'manufactdate'),
    wll: fieldValue('#editAssetWLL', 'wll'),
    heightoflift: fieldValue('#editAssetHeightOfLift', 'heightoflift'),
    numberofchainfalls: fieldValue('#editAssetNumberOfChainFalls', 'numberofchainfalls'),
    oemtophooksize: fieldValue('#editAssetOEMTopHookSize', 'oemtophooksize'),
    oembottomhooksize: fieldValue('#editAssetOEMBottomHookSize', 'oembottomhooksize'),
    loadchaindiameter: fieldValue('#editAssetLoadChainDiameter', 'loadchaindiameter'),
    effectivelength: fieldValue('#editAssetEffectiveLength', 'effectivelength'),
    span: fieldValue('#editAssetSpan', 'span'),
    permissibledeflection: fieldValue('#editAssetPermissibleDeflection', 'permissibledeflection'),
    hooksize: fieldValue('#editAssetHookSize', 'hooksize'),
    steelwireropemm: fieldValue('#editAssetSteelWireRopeMM', 'steelwireropemm'),
    hoistdescription: fieldValue('#editAssetHoistDescription', 'hoistdescription'),
    hoistserialno: fieldValue('#editAssetHoistSerialNo', 'hoistserialno'),
    auxhoistdescription: fieldValue('#editAssetAuxHoistDescription', 'auxhoistdescription'),
    auxhoistserialno: fieldValue('#editAssetAuxHoistSerialNo', 'auxhoistserialno'),
    auxhoistwll: fieldValue('#editAssetAuxHoistWLL', 'auxhoistwll'),
    auxhoisthooksize: fieldValue('#editAssetAuxHoistHookSize', 'auxhoisthooksize'),
    auxhoistropemm: fieldValue('#editAssetAuxHoistRopeMM', 'auxhoistropemm')
  }
}

window.refreshEditAssetDynamicFields = function () {
  const equiptypeid = document.querySelector('#editAssetEquipType')?.value
  const selectedType = equipmentTypes.find(
    type => String(type.equiptypeid) === String(equiptypeid)
  )
  const groupid = String(selectedType?.equipgroupid || '')
  const container = document.querySelector('#editDynamicAssetFields')
  const manufactureDateRow = document.querySelector('#editManufactureDateRow')
  const manufactureDateInput = document.querySelector('#editAssetManufactDate')

  if (!container) return

  container.innerHTML = buildEditAssetDynamicFields(groupid, collectCurrentEditAssetValues())

  if (manufactureDateRow) {
    manufactureDateRow.style.display = groupid === '400' ? 'flex' : 'none'
  }

  if (manufactureDateInput && groupid !== '400') {
    manufactureDateInput.value = ''
  }
}

window.editAsset = async function (assetid) {
  if (!canManageAssetRecords()) {
    showAccessDenied()
    return
  }

  rememberAssetListState()

  let asset

  try {
    asset = await getAssetForAction(assetid)
  } catch (err) {
    alert(err.message || "Asset not found")
    return
  }

  const selectedType = equipmentTypes.find(
    type => String(type.equiptypeid) === String(asset.equiptypeid)
  )

  const groupid = String(selectedType?.equipgroupid || '')
  const dynamicEditFields = buildEditAssetDynamicFields(groupid, asset)
  const showManufactureDate = groupid === '400'
  const equipmentTypeOptions = [...equipmentTypes]
    .sort((a, b) => (a.description || '').localeCompare(b.description || ''))
    .map(type => `
      <option value="${safeAttr(type.equiptypeid)}" ${String(type.equiptypeid) === String(asset.equiptypeid) ? 'selected' : ''}>
        ${escapeHtml(type.description)}
      </option>
    `).join('')

  document.querySelector('#page').innerHTML = `
    <h2>Edit Asset ${escapeHtml(asset.assetid)}</h2>

    <div class="filter-card">
      <div class="asset-form-grid">

        <div class="form-group">
          <label>Equipment Type</label>
          <select id="editAssetEquipType" onchange="refreshEditAssetDynamicFields()">
            <option value="">Select Equipment Type</option>
            ${equipmentTypeOptions}
          </select>
        </div>

        <div class="form-group">
          <label>Serial No</label>
          <input id="editAssetSerialNo" type="text" value="${safeAttr(asset.serialno || '')}">
        </div>

        <div class="form-group">
          <label>Asset Tag Number <span class="optional-label">(Optional)</span></label>
          <input id="editAssetTagNo" type="text" value="${safeAttr(asset.assettagno || '')}" placeholder="Customer tag / plant number if available">
        </div>

        <div class="form-group">
          <label>Manufacturer</label>
          <input id="editAssetManufacturer" type="text" value="${safeAttr(asset.manufacturer || '')}">
        </div>

        <div class="form-group" id="editManufactureDateRow" style="${showManufactureDate ? '' : 'display:none;'}">
          <label>Manufacture Date</label>
          <input id="editAssetManufactDate" type="date" value="${safeAttr(String(asset.manufactdate || '').slice(0, 10))}">
        </div>

        <div id="editDynamicAssetFields" class="dynamic-asset-fields">
          ${dynamicEditFields}
        </div>

        <div class="form-group asset-description">
          <label>Description</label>
          <textarea id="editAssetDescription" rows="4">${escapeHtml(asset.description || '')}</textarea>
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

          ${canArchiveOrMoveAssetRecords() ? `
            <button class="danger-btn" onclick="archiveAsset(${asset.assetid})">
              Archive
            </button>
          ` : ''}
        </div>

      </div>
    </div>

    <div class="photo-preview-grid">
      ${asset.media1 ? `
        <div class="photo-card">
          <h3>Photo 1</h3>
          <img src="${safeAttr(uploadUrl(asset.media1))}">
          ${canArchiveOrMoveAssetRecords() ? `
            <button
              type="button"
              class="danger-btn photo-delete-btn"
              onclick="deleteAssetPhoto(${asset.assetid}, 1)"
            >
              Delete Photo 1
            </button>
          ` : ''}
        </div>
      ` : ''}

      ${asset.media2 ? `
        <div class="photo-card">
          <h3>Photo 2</h3>
          <img src="${safeAttr(uploadUrl(asset.media2))}">
          ${canArchiveOrMoveAssetRecords() ? `
            <button
              type="button"
              class="danger-btn photo-delete-btn"
              onclick="deleteAssetPhoto(${asset.assetid}, 2)"
            >
              Delete Photo 2
            </button>
          ` : ''}
        </div>
      ` : ''}
    </div>
  `
}

window.saveAssetChanges = async function (assetid) {
  if (!canManageAssetRecords()) {
    alert("You do not have permission to edit assets.")
    return
  }

  const equiptypeid = document.querySelector('#editAssetEquipType')?.value || null
  const serialno = document.querySelector('#editAssetSerialNo').value
  const assettagno = document.querySelector('#editAssetTagNo')?.value || ""
  const manufacturer = document.querySelector('#editAssetManufacturer').value
  const manufactdate = document.querySelector('#editAssetManufactDate')?.value || ""
  const description = document.querySelector('#editAssetDescription').value

  const response = await fetch(`${API_BASE}/assets/${assetid}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      equiptypeid,
      serialno,
      assettagno,
      manufacturer,
      manufactdate,
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
      hoistserialno: document.querySelector('#editAssetHoistSerialNo')?.value || null,
      auxhoistdescription: document.querySelector('#editAssetAuxHoistDescription')?.value || null,
      auxhoistserialno: document.querySelector('#editAssetAuxHoistSerialNo')?.value || null,
      auxhoistwll: document.querySelector('#editAssetAuxHoistWLL')?.value || null,
      auxhoisthooksize: document.querySelector('#editAssetAuxHoistHookSize')?.value || null,
      auxhoistropemm: document.querySelector('#editAssetAuxHoistRopeMM')?.value || null
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
  if (!canArchiveOrMoveAssetRecords()) {
    alert("You do not have permission to archive assets.")
    return
  }

  const confirmArchive = confirm(
    "Archive asset " + assetid + "? It will be hidden but its inspection history will remain."
  )

  if (!confirmArchive) return

  const response = await fetch(`${API_BASE}/assets/${assetid}/archive`, {
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
  if (!canArchiveOrMoveAssetRecords()) {
    alert("You do not have permission to restore assets.")
    return
  }

  const confirmRestore = confirm(
    "Restore asset " + assetid + "?"
  );

  if (!confirmRestore) return;

  const response = await fetch(`${API_BASE}/assets/${assetid}/unarchive`, {
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
  if (!canManageAssetRecords()) {
    alert("You do not have permission to update asset photos.")
    return
  }

  const photo1 = document.querySelector('#assetPhoto1').files[0]
  const photo2 = document.querySelector('#assetPhoto2').files[0]

  if (!photo1 && !photo2) {
    alert("Please choose at least one photo")
    return
  }

  if (!validateAssetPhotoFiles([photo1, photo2])) {
    return
  }

  const formData = new FormData()

  if (photo1) {
    formData.append("photo1", photo1)
  }

  if (photo2) {
    formData.append("photo2", photo2)
  }

  const response = await fetch(`${API_BASE}/assets/${assetid}/photos`, {
    method: "POST",
    body: formData,
  })

  const updatedAsset = await readApiResponse(response)

  if (!response.ok) {
    alert("Error uploading photos: " + updatedAsset.error)
    return
  }

  alert("Photos uploaded for asset " + updatedAsset.assetid)

  await loadData()
  editAsset(assetid)
}

window.deleteAssetPhoto = async function (assetid, slot) {
  if (!canArchiveOrMoveAssetRecords()) {
    alert("You do not have permission to delete asset photos.")
    return
  }

  const confirmed = confirm(`Delete asset photo ${slot}?`)

  if (!confirmed) return

  const response = await fetch(`${API_BASE}/assets/${assetid}/photos/${slot}`, {
    method: "DELETE"
  })

  const updatedAsset = await readApiResponse(response)

  if (!response.ok) {
    alert("Error deleting photo: " + updatedAsset.error)
    return
  }

  alert(`Asset photo ${slot} deleted successfully`)

  await loadData()
  editAsset(assetid)
}

window.showEquipmentTypeCriteria = function () {
  if (!ensurePageAccess('criteria')) return

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
  window.criteriaCurrentPage = 1

  showEquipmentTypeCriteria()
}

window.setCriteriaRowsPerPage = function (value) {
  window.criteriaRowsPerPage = Number(value) || 25
  window.criteriaCurrentPage = 1
  showEquipmentTypeCriteria()
}

window.goToCriteriaPage = function (page) {
  window.criteriaCurrentPage = Math.max(1, Number(page) || 1)
  showEquipmentTypeCriteria()
}

function escapeAttribute(value) {
  return safeAttr(value)
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
    row.fieldtype || "PASS_FAIL"

  const selectedResultType =
    row.resulttype || (selectedFieldType === "NUMBER" ? "MEASURED" : "PASS_FAIL")

  const selectedInspectionGroup =
    row.inspection_category || "PERIODIC_THOROUGH_INSPECTION"

  const selectedSeverity =
    row.severity || "MINOR"

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
          <input id="editingCriteriaId" type="hidden" value="${safeAttr(row.criteriaid || "")}">

          <div class="form-row">
            <div class="form-group">
              <label>Equipment Type</label>
              <select id="criteriaEquipType">
                ${sortedEquipmentTypes.map(type => `
                  <option
                    value="${safeAttr(type.equiptypeid)}"
                    ${String(type.equiptypeid) === String(selectedEquipmentType) ? "selected" : ""}
                  >
                    ${escapeHtml(type.description)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Inspection Type</label>
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
              <input id="criteriaName" type="text" value="${escapeAttribute(row.criteriadescription || row.criterianame)}">
            </div>

            <div class="form-group">
              <label>Field Type</label>
              <select id="criteriaFieldType">
                <option value="PASS_FAIL" ${selectedFieldType === "PASS_FAIL" || selectedFieldType === "PASSFAIL" ? "selected" : ""}>Pass / Fail / N/A</option>
                <option value="TEXT" ${selectedFieldType === "TEXT" ? "selected" : ""}>Text Input</option>
                <option value="NUMBER" ${selectedFieldType === "NUMBER" ? "selected" : ""}>Number Input</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Result Type</label>
              <select id="criteriaResultType">
                <option value="PASS_FAIL" ${selectedResultType === "PASS_FAIL" ? "selected" : ""}>PASS / FAIL</option>
                <option value="MEASURED" ${selectedResultType === "MEASURED" ? "selected" : ""}>Measured</option>
                <option value="YES_NO" ${selectedResultType === "YES_NO" ? "selected" : ""}>YES / NO</option>
              </select>
            </div>

            <div class="form-group">
              <label>Inspection Category</label>
              <select id="criteriaInspectionGroup">
                <option value="FREQUENT_INSPECTION" ${selectedInspectionGroup === "FREQUENT_INSPECTION" ? "selected" : ""}>
                  Frequent Inspection
                </option>
                <option value="PERIODIC_THOROUGH_INSPECTION" ${selectedInspectionGroup === "PERIODIC_THOROUGH_INSPECTION" ? "selected" : ""}>
                  Periodic Thorough Inspection
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>Severity</label>
              <select id="criteriaSeverity">
                <option value="CRITICAL" ${selectedSeverity === "CRITICAL" ? "selected" : ""}>Critical</option>
                <option value="MAJOR" ${selectedSeverity === "MAJOR" ? "selected" : ""}>Major</option>
                <option value="MINOR" ${selectedSeverity === "MINOR" ? "selected" : ""}>Minor</option>
                <option value="OBSERVATION" ${selectedSeverity === "OBSERVATION" ? "selected" : ""}>Observation</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Display Order</label>
              <input id="criteriaDisplayOrder" type="number" min="1" value="${escapeAttribute(row.displayorder || row.sortorder || 1)}">
            </div>

            <div class="form-group">
              <label>Active</label>
              <select id="criteriaActive">
                <option value="true" ${row.active === false ? "" : "selected"}>Active</option>
                <option value="false" ${row.active === false ? "selected" : ""}>Inactive</option>
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
    criteriadescription: criterianame,
    fieldtype: document.querySelector('#criteriaFieldType').value,
    resulttype: document.querySelector('#criteriaResultType').value,
    required: true,
    sortorder: Number(document.querySelector('#criteriaDisplayOrder')?.value || 1),
    displayorder: Number(document.querySelector('#criteriaDisplayOrder')?.value || 1),
    inspectioncategory,
    inspection_category: document.querySelector('#criteriaInspectionGroup').value,
    severity: document.querySelector('#criteriaSeverity').value,
    active: document.querySelector('#criteriaActive').value === "true"
  }

  const response = await fetch(
    criteriaid
      ? `${API_BASE}/equipment-type-criteria/${criteriaid}`
      : `${API_BASE}/equipment-type-criteria`,
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
    `${API_BASE}/equipment-type-criteria/${criteriaid}`,
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

window.showInspections = async function () {
  if (!ensurePageAccess('inspections')) return

  localStorage.setItem("currentPage", "inspections")

  await loadInspectionAssetPage()
}

window.showCertificateSearch = function () {
  if (!ensurePageAccess('certificates')) return

  localStorage.setItem("currentPage", "certificates")

  renderCertificateSearch(
    customers,
    sites,
    sections
  )
}

window.showCustomerDetailedReport = function (options = {}) {
  if (!ensurePageAccess('customer-report')) return

  localStorage.setItem("currentPage", "customer-report")

  renderCustomerDetailedReport(customers, equipmentTypes, sites, sections, responsiblePersons, options)
}

window.showSystemHealth = function () {
  if (!ensurePageAccess('system-health')) return

  localStorage.setItem("currentPage", "system-health")
  renderSystemHealthPage()
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
      <option value="${safeAttr(site.siteid)}">
        ${escapeHtml(site.sitename)}
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
      <option value="${safeAttr(section.sectionid)}">
        ${escapeHtml(section.sectionname)}
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
  window.certCurrentPage = 1

  searchCertificates()
}

window.searchCertificates = async function (resetPage = true) {
  if (resetPage) window.certCurrentPage = 1

  const params = new URLSearchParams()

  params.append("search", document.querySelector('#certSearch')?.value || "")
  params.append("inspectiontype", document.querySelector('#certInspectionType')?.value || "")
  params.append("status", document.querySelector('#certStatus')?.value || "")
  params.append("clientid", document.querySelector('#certClient')?.value || "")
  params.append("siteid", document.querySelector('#certSite')?.value || "")
  params.append("sectionid", document.querySelector('#certSection')?.value || "")
  params.append("datefrom", document.querySelector('#certDateFrom')?.value || "")
  params.append("dateto", document.querySelector('#certDateTo')?.value || "")
  params.append("page", String(window.certCurrentPage || 1))
  params.append("limit", String(window.certRowsPerPage || 25))

  const sort = getTableSortState('certificates', 'testid', 'desc')
  params.append("sortKey", sort.key || "testid")
  params.append("sortDir", sort.direction || "desc")

  const response = await fetch(
    `${API_BASE}/certificates/search?${params.toString()}`
  )

  const payload = await response.json()

  if (!response.ok) {
    alert("Error searching certificates: " + payload.error)
    return
  }

  const certificates = Array.isArray(payload) ? payload : payload.rows || []
  window.currentCertificatePageInfo = Array.isArray(payload)
    ? null
    : {
        currentPage: Number(payload.page || 1),
        pageSize: Number(payload.limit || window.certRowsPerPage || 25),
        totalRows: Number(payload.total || certificates.length),
        totalPages: Number(payload.totalPages || 1),
        startIndex: ((Number(payload.page || 1) - 1) * Number(payload.limit || window.certRowsPerPage || 25)),
        endIndex: ((Number(payload.page || 1) - 1) * Number(payload.limit || window.certRowsPerPage || 25)) + certificates.length
      }

  const summary = payload.summary || null
  const safeCount = summary ? summary.safe : certificates.filter(c => c.status === "SAFE").length
  const notSafeCount = summary ? summary.notSafe : certificates.filter(c => c.status === "NOT SAFE").length
  const loadTestCount = summary ? summary.loadTest : certificates.filter(c => c.inspectiontype === "LOADTEST").length
  const visualCount = summary ? summary.visual : certificates.filter(c => c.inspectiontype === "VISUAL").length
  const totalCount = summary
    ? Number(summary.total || window.currentCertificatePageInfo?.totalRows || certificates.length)
    : certificates.length

  document.querySelector('#certificateStats').innerHTML = `
    <p><strong>Total:</strong> ${totalCount || window.currentCertificatePageInfo?.totalRows || certificates.length}</p>
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

  window.currentCertificateResults = certificates
  renderCertificateResultRows(certificates)
}

function activeCertificateSortHeader(label, key) {
  const sort = getTableSortState('certificates', 'testid', 'desc')
  const isActive = sort.key === key
  const arrow = isActive
    ? sort.direction === 'desc' ? 'v' : '^'
    : '^v'

  return `
    <span class="certificate-sort-heading">
      <span>${label}</span>
      <button
        type="button"
        class="certificate-sort-btn ${isActive ? 'active' : ''}"
        onclick="sortTable('certificates', '${key}', 'rerenderCertificateResults')"
        aria-label="Sort ${label}"
        title="Sort ${label}"
      >${arrow}</button>
    </span>
  `
}

window.rerenderCertificateResults = function () {
  window.certCurrentPage = 1
  searchCertificates(false)
}

function renderCertificateResultRows(certificates) {
  const sortedCertificates = window.currentCertificatePageInfo ? certificates : sortTableRows(certificates, 'certificates', {
    testid: cert => cert.testid,
    tagnumber: cert => cert.tagnumber,
    clientname: cert => cert.clientname,
    sitename: cert => cert.sitename,
    description: cert => cert.description,
    serialno: cert => cert.serialno,
    inspectiontype: cert => cert.inspectiontype,
    testdate: cert => cert.testdate,
    status: cert => cert.status,
    inspector: cert => cert.inspector
  }, 'testid', 'desc')

  const pagination = window.currentCertificatePageInfo
    ? {
        ...window.currentCertificatePageInfo,
        rows: sortedCertificates
      }
    : getPaginationState(sortedCertificates, "certCurrentPage", "certRowsPerPage")

  document.querySelector('#certificateResults').innerHTML = `
    ${renderPaginationControls({
      ...pagination,
      label: "certificates",
      onPage: "goToCertificatePage",
      onPageSize: "setCertificateRowsPerPage"
    })}

    <table>
      <thead>
        <tr>
          <th>${activeCertificateSortHeader('Test ID', 'testid')}</th>
          <th>${activeCertificateSortHeader('Tag No', 'tagnumber')}</th>
          <th>${activeCertificateSortHeader('Client', 'clientname')}</th>
          <th>${activeCertificateSortHeader('Site', 'sitename')}</th>
          <th>${activeCertificateSortHeader('Asset', 'description')}</th>
          <th>${activeCertificateSortHeader('Serial No', 'serialno')}</th>
          <th>${activeCertificateSortHeader('Type', 'inspectiontype')}</th>
          <th>${activeCertificateSortHeader('Date', 'testdate')}</th>
          <th>${activeCertificateSortHeader('Status', 'status')}</th>
          <th>${activeCertificateSortHeader('Inspector', 'inspector')}</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        ${pagination.rows.map(cert => `
          <tr>
            <td>${escapeHtml(cert.testid)}</td>
            <td>${escapeHtml(cert.tagnumber || "-")}</td>
            <td>${escapeHtml(cert.clientname || "")}</td>
            <td>${escapeHtml(cert.sitename || "")}</td>
            <td>${escapeHtml(cert.description || "")}</td>
            <td>${escapeHtml(cert.serialno || "")}</td>
            <td>${escapeHtml(cert.inspectiontype || "")}</td>
            <td>${escapeHtml(cert.testdate ? cert.testdate.split("T")[0] : "")}</td>
            <td>
              <strong class="${
                cert.status === "SAFE"
                  ? "status-safe"
                  : "status-unsafe"
              }">
                ${escapeHtml(cert.status || "")}
              </strong>
            </td>
            <td>${escapeHtml(cert.inspector || "-")}</td>
            <td>
              <button onclick="previewCertificate(${cert.testid})">Preview</button>
              <button onclick="openCertificateModal(${cert.testid})">View</button>
              <a
                class="cert-action-link"
                href="${safeAttr(`${API_BASE}/inspections/${encodeURIComponent(cert.testid)}/certificate.pdf?t=${Date.now()}`)}"
                download="certificate-${safeAttr(cert.testid)}.pdf"
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

window.setCertificateRowsPerPage = function (value) {
  window.certRowsPerPage = Number(value) || 25
  window.certCurrentPage = 1
  searchCertificates(false)
}

window.goToCertificatePage = function (page) {
  window.certCurrentPage = Math.max(1, Number(page) || 1)
  searchCertificates(false)
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
  if (!ensurePageAccess('quick-inspection')) return

  localStorage.setItem("currentPage", "quick-inspection")
  renderQuickInspection()
}

window.handleQuickInspectionEnter = function (event) {
  if (event.key === "Enter") {
    quickFindAsset()
  }
}

function normalizeQuickAssetScan(value = '') {
  const raw = String(value || '').trim()
  const lower = raw.toLowerCase()

  const qrParamMatch = raw.match(/[?&]qr=([^&\s]+)/i)
  if (qrParamMatch) return decodeURIComponent(qrParamMatch[1]).trim()

  const atecCodeMatch = raw.match(/ATEC-ASSET-\d+/i)
  if (atecCodeMatch) return atecCodeMatch[0].trim()

  const preferredLineMatch = raw.match(/(?:Asset ID|Serial No|Hoist Serial No|Asset Tag)\s*:\s*([^\n\r]+)/i)
  if (preferredLineMatch) {
    const value = preferredLineMatch[1].replace(/^-$/, '').trim()
    if (value) return value
  }

  if (lower.includes('atec asset label')) {
    const fallbackLine = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line && !/^(atec asset label|website|landline|equipment|status|inspection pdf|load test pdf|last |next )/i.test(line))

    if (fallbackLine) return fallbackLine.replace(/^[^:]+:\s*/, '').trim()
  }

  return raw
}

window.quickFindAsset = async function () {
  const searchInput = document.querySelector('#quickAssetSearch')
  const normalizedSearch = normalizeQuickAssetScan(searchInput?.value || '')
  const search = normalizedSearch.toLowerCase().trim()

  if (searchInput && normalizedSearch !== searchInput.value.trim()) {
    searchInput.value = normalizedSearch
  }

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
    (asset.hoistserialno || '').toLowerCase().includes(search) ||
    (asset.auxhoistserialno || '').toLowerCase().includes(search) ||
    (asset.qrcode || '').toLowerCase().includes(search)
  )

  if (matchedAssets.length === 0) {
    try {
      const response = await fetch(`${API_BASE}/assets/qr/${encodeURIComponent(search)}`)

      if (response.ok) {
        const asset = await response.json()
        quickOpenAsset(asset.assetid)
        return
      }

      const broadResponse = await fetch(`${API_BASE}/inspections/assets/search?q=${encodeURIComponent(search)}`)

      if (broadResponse.ok) {
        const broadMatches = await broadResponse.json()

        if (broadMatches.length === 1) {
          quickOpenAsset(broadMatches[0].assetid)
          return
        }

        if (broadMatches.length > 1) {
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
                  ${broadMatches.map(asset => `
                    <tr>
                      <td>${escapeHtml(asset.assetid)}</td>
                      <td>${escapeHtml(asset.assettagno || '')}</td>
                      <td>${escapeHtml(asset.serialno || asset.hoistserialno || asset.auxhoistserialno || '')}</td>
                      <td>${escapeHtml(asset.description || '')}</td>
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
      }
    } catch (err) {
      console.error("Asset lookup failed:", err)
    }

    resultBox.innerHTML = `
      <div class="filter-card">
        <h3>No Asset Found</h3>
        <p>No asset matched: <strong>${escapeHtml(search)}</strong></p>
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
                <td>${escapeHtml(asset.assetid)}</td>
                <td>${escapeHtml(asset.assettagno || '')}</td>
                <td>${escapeHtml(asset.serialno || '')}</td>
                <td>${escapeHtml(asset.description || '')}</td>
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

let quickScannerStream = null
let quickScannerLoopActive = false

window.startQuickCameraScan = async function () {
  const scanner = document.querySelector('#quickCameraScanner')
  const video = document.querySelector('#quickCameraVideo')
  const status = document.querySelector('#quickScanStatus')

  if (!('BarcodeDetector' in window)) {
    if (status) status.textContent = 'Camera scanning is not supported by this browser. Use the scan/type box above.'
    scanner?.removeAttribute('hidden')
    return
  }

  try {
    const supportedFormats = await window.BarcodeDetector.getSupportedFormats()
    const formats = ['qr_code', 'code_128', 'code_39', 'ean_13'].filter(format =>
      supportedFormats.includes(format)
    )
    const detector = new window.BarcodeDetector({ formats })

    quickScannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    })

    video.srcObject = quickScannerStream
    scanner?.removeAttribute('hidden')
    await video.play()

    quickScannerLoopActive = true
    if (status) status.textContent = 'Scanning... point the camera at the QR label or barcode.'

    const scanFrame = async () => {
      if (!quickScannerLoopActive) return

      try {
        const codes = await detector.detect(video)
        if (codes.length) {
          const scannedValue = normalizeQuickAssetScan(codes[0].rawValue)
          document.querySelector('#quickAssetSearch').value = scannedValue
          stopQuickCameraScan()
          quickFindAsset()
          return
        }
      } catch (err) {
        console.error('Quick camera scan failed:', err)
      }

      requestAnimationFrame(scanFrame)
    }

    scanFrame()
  } catch (err) {
    console.error('Unable to start camera scanner:', err)
    scanner?.removeAttribute('hidden')
    if (status) status.textContent = 'Camera could not start. Please allow camera access or use the scan/type box.'
  }
}

window.stopQuickCameraScan = function () {
  quickScannerLoopActive = false

  if (quickScannerStream) {
    quickScannerStream.getTracks().forEach(track => track.stop())
    quickScannerStream = null
  }

  const video = document.querySelector('#quickCameraVideo')
  if (video) video.srcObject = null

  document.querySelector('#quickCameraScanner')?.setAttribute('hidden', '')
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
    `${API_BASE}/assets/${assetid}/quick-details`
  )

  const asset = await response.json()

  if (!response.ok) {
    alert("Asset details not found: " + asset.error)
    return
  }

  resultBox.innerHTML = `
    <div class="filter-card quick-result-card">
      <div class="quick-result-header">
        <h3>Asset Found</h3>
        <strong>${escapeHtml(asset.assetid)}</strong>
      </div>

      <div class="quick-asset-grid">

        <div class="quick-detail-grid">
          <p><span>Asset Tag</span><strong>${escapeHtml(asset.assettagno || '-')}</strong></p>
          <p><span>Serial No</span><strong>${escapeHtml(asset.serialno || '-')}</strong></p>
          <p><span>Equipment</span><strong>${escapeHtml(asset.equipmenttype || '-')}</strong></p>
          <p class="quick-wide"><span>Description</span><strong>${escapeHtml(asset.description || '-')}</strong></p>
          <p><span>Client</span><strong>${escapeHtml(asset.clientname || '-')}</strong></p>
          <p><span>Site</span><strong>${escapeHtml(asset.sitename || '-')}</strong></p>
          <p><span>Section</span><strong>${escapeHtml(asset.sectionname || '-')}</strong></p>
        </div>

        <div class="quick-history-card">
          <h4>Inspection History</h4>
          <p><span>Last Visual</span><strong>${escapeHtml(asset.lastvisualdate ? asset.lastvisualdate.split('T')[0] : 'No record')}</strong><em>${escapeHtml(asset.lastvisualstatus || '-')}</em></p>
          <p><span>Last Load Test</span><strong>${escapeHtml(asset.lastloadtestdate ? asset.lastloadtestdate.split('T')[0] : 'No record')}</strong><em>${escapeHtml(asset.lastloadteststatus || '-')}</em></p>
        </div>

      </div>

      <div class="quick-result-bottom">
        <div class="quick-photo-grid">
        ${asset.media1 ? `
          <div class="quick-photo-card">
            <img src="${safeAttr(uploadUrl(asset.media1))}">
            <span>Photo 1</span>
          </div>
        ` : ''}

        ${asset.media2 ? `
          <div class="quick-photo-card">
            <img src="${safeAttr(uploadUrl(asset.media2))}">
            <span>Photo 2</span>
          </div>
        ` : ''}
        </div>

        <div class="form-actions quick-result-actions">
          <button onclick="startInspection(${asset.assetid}, 'VISUAL', '${returnPage}')">Visual Inspection</button>

          <button class="load-test-btn" onclick="startInspection(${asset.assetid}, 'LOADTEST', '${returnPage}')">Load Test</button>

          <button onclick="openAssetQrLabel(${asset.assetid})">QR Label</button>
        </div>

      </div>
    </div>
  `
}

window.startQuickInspection = function (assetid, inspectiontype) {
  startInspection(assetid, inspectiontype, "quick")
}

function rememberInspectionAssetListState() {
  const searchTypeInput = document.querySelector('#inspectionSearchType')
  const searchInput = document.querySelector('#inspectionAssetSearch')

  window.inspectionAssetListState = {
    searchType: searchTypeInput ? searchTypeInput.value : window.inspectionAssetListState?.searchType || "all",
    search: searchInput ? searchInput.value : window.inspectionAssetListState?.search || "",
    currentPage: window.inspectionCurrentPage || window.inspectionAssetListState?.currentPage || 1,
    rowsPerPage: Number(window.inspectionRowsPerPage || window.inspectionAssetListState?.rowsPerPage || 25)
  }
}

function restoreInspectionAssetListState() {
  const state = window.inspectionAssetListState || {}
  const searchTypeInput = document.querySelector('#inspectionSearchType')
  const searchInput = document.querySelector('#inspectionAssetSearch')

  if (searchTypeInput) searchTypeInput.value = state.searchType || "all"
  if (searchInput) searchInput.value = state.search || ""
}

function getInspectionSearchFocusState() {
  const activeElement = document.activeElement
  if (!activeElement || !["inspectionAssetSearch", "inspectionSearchType"].includes(activeElement.id)) {
    return null
  }

  return {
    id: activeElement.id,
    selectionStart: typeof activeElement.selectionStart === "number" ? activeElement.selectionStart : null,
    selectionEnd: typeof activeElement.selectionEnd === "number" ? activeElement.selectionEnd : null
  }
}

function restoreInspectionSearchFocus(focusState) {
  if (!focusState?.id) return

  const element = document.getElementById(focusState.id)
  if (!element) return

  element.focus()

  if (
    typeof element.setSelectionRange === "function" &&
    typeof focusState.selectionStart === "number" &&
    typeof focusState.selectionEnd === "number"
  ) {
    element.setSelectionRange(focusState.selectionStart, focusState.selectionEnd)
  }
}

let inspectionAssetRequestId = 0

async function loadInspectionAssetPage() {
  const focusState = getInspectionSearchFocusState()
  rememberInspectionAssetListState()

  const state = window.inspectionAssetListState || {}
  const sort = getTableSortState('inspectionAssets', 'client_section_serial', 'asc')
  const requestId = ++inspectionAssetRequestId
  const params = new URLSearchParams({
    page: String(window.inspectionCurrentPage || state.currentPage || 1),
    limit: String(window.inspectionRowsPerPage || state.rowsPerPage || 25),
    searchBy: state.searchType || "all",
    search: state.search || "",
    sortKey: sort.key || "client_section_serial",
    sortDir: sort.direction || "asc",
    archiveMode: "active"
  })

  const data = await fetchJsonOrDefault(`${API_BASE}/inspections/assets?${params.toString()}`, {
    rows: [],
    total: 0,
    page: 1,
    limit: Number(window.inspectionRowsPerPage || 25)
  })

  if (requestId !== inspectionAssetRequestId) return

  assets = data.rows || []
  window.inspectionCurrentPage = Number(data.page || window.inspectionCurrentPage || 1)
  window.inspectionRowsPerPage = Number(data.limit || window.inspectionRowsPerPage || 25)

  renderInspections(assets, {
    serverPaged: true,
    total: data.total || 0,
    page: window.inspectionCurrentPage,
    limit: window.inspectionRowsPerPage
  })
  restoreInspectionAssetListState()
  restoreInspectionSearchFocus(focusState)
}

window.filterInspectionAssets = async function (resetPage = false) {
  if (resetPage) window.inspectionCurrentPage = 1
  await loadInspectionAssetPage()
}

window.setInspectionFilterKey = function (key) {
  const searchType = document.querySelector('#inspectionSearchType')
  if (!searchType) return

  searchType.value = key
  filterInspectionAssets(true)
}

window.setInspectionRowsPerPage = function (value) {
  window.inspectionRowsPerPage = Number(value) || 25
  window.inspectionCurrentPage = 1
  filterInspectionAssets()
}

window.goToInspectionPage = function (page) {
  window.inspectionCurrentPage = Math.max(1, Number(page) || 1)
  filterInspectionAssets()
}

function hasInspectionSummaryValue(value) {
  return value !== null &&
    value !== undefined &&
    String(value).trim() !== "" &&
    String(value).trim() !== "-"
}

function inspectionSummaryCard(label, value, unit = "") {
  if (!hasInspectionSummaryValue(value)) return ""

  const suffix = unit ? ` ${unit}` : ""
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}${escapeHtml(suffix)}</strong></div>`
}

const criteriaAssetMap = {
  "Top Hook Dimensions": "oemtophooksize",
  "Bottom Hook Dimensions": "oembottomhooksize",
  "Load Chain Diameter": "loadchaindiameter",
  "Hook Size mm": "hooksize",
  "Hoist Serial Number": "hoistserialno",
  "WLL Main Hoist - Load Mass kg": "wll",
  "WLL Auxiliary Hoist - Load Mass kg": "auxhoistwll",
  "SWL of Beam - Load Mass kg": "wll",
  "SWL Installed Hoist - Load Mass kg": "wll",
  "SWL of Beam - Length Span mm": "span",
  "WLL Main Hoist - Length Span/Jib mm": "span",
  "WLL Auxiliary Hoist - Length Span/Jib mm": "span",
  "Permissible Deflection mm": "permissibledeflection",
  "WLL Main Hoist - Deflection mm": "permissibledeflection",
  "WLL Auxiliary Hoist - Deflection mm": "permissibledeflection",
  "Steel Wire Rope mm": "steelwireropemm"
}

function normalizeCriteriaName(criteriaName = "") {
  return String(criteriaName)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function formatStandardNumber(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) return ""
  return Number.isInteger(numericValue)
    ? String(numericValue)
    : String(Number(numericValue.toFixed(2)))
}

function dateInputValue(date = new Date()) {
  const localDate = new Date(date)
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset())
  return localDate.toISOString().split("T")[0]
}

function calculateValidDateFromTestDate(testDateValue, inspectiontype = "VISUAL") {
  const testDate = testDateValue ? new Date(`${testDateValue}T00:00:00`) : new Date()
  const validDate = new Date(testDate)

  if (inspectiontype === "LOADTEST") {
    validDate.setFullYear(validDate.getFullYear() + 1)
  } else {
    validDate.setMonth(validDate.getMonth() + 3)
  }

  return dateInputValue(validDate)
}

window.updateInspectionValidDateFromTestDate = function (inspectiontype = "VISUAL") {
  const testDate = document.querySelector("#inspectionTestDate")?.value || ""
  const validDateInput = document.querySelector("#inspectionValidDate")

  if (!validDateInput || !testDate) return
  validDateInput.value = calculateValidDateFromTestDate(testDate, inspectiontype)
}

function isProofLoadCriteria(row) {
  return normalizeCriteriaName([
    row?.criterianame,
    row?.criteriadescription
  ].filter(Boolean).join(" ")).includes("proof load")
}

function isHookMeasuredSizeCriteria(row) {
  const criteriaText = normalizeCriteriaName([
    row?.criterianame,
    row?.criteriadescription
  ].filter(Boolean).join(" "))

  return criteriaText.includes("hook measured size") ||
    criteriaText.includes("measured hook throat opening")
}

const noProofLoadMultiplierEquipTypeIds = new Set(["401", "402", "404", "406"])

function getCalculatedProofLoadValue(asset) {
  const wll = Number(asset?.wll)

  if (!Number.isFinite(wll) || wll <= 0) return ""

  const multiplier = noProofLoadMultiplierEquipTypeIds.has(String(asset?.equiptypeid))
    ? 1
    : 1.10

  return formatStandardNumber(wll * multiplier)
}

function getCriteriaStandardValue(asset, row) {
  const criteriaName = row?.criterianame || row?.criteriadescription || ""
  const normalizedName = normalizeCriteriaName(criteriaName)
  const assetField = criteriaAssetMap[criteriaName]
  const isAuxiliaryHoist = normalizedName.includes("auxiliary hoist")

  if (assetField) return asset?.[assetField] || ""

  if (isProofLoadCriteria(row)) return ""
  if (isHookMeasuredSizeCriteria(row)) return ""

  if (normalizedName.includes("top hook")) {
    return asset?.oemtophooksize || asset?.hooksize || ""
  }

  if (normalizedName.includes("bottom hook")) {
    return asset?.oembottomhooksize || asset?.hooksize || ""
  }

  if (normalizedName.includes("load chain") || normalizedName.includes("chain diameter")) {
    return asset?.loadchaindiameter || ""
  }

  if (
    normalizedName.includes("load mass") ||
    normalizedName.includes("swl installed hoist") ||
    normalizedName.includes("swl of beam")
  ) {
    if (isAuxiliaryHoist) return asset?.auxhoistwll || ""
    return asset?.wll || ""
  }

  if (
    normalizedName.includes("span") ||
    normalizedName.includes("length span") ||
    normalizedName.includes("span/jib")
  ) {
    return asset?.span || ""
  }

  if (normalizedName.includes("deflection")) {
    return asset?.permissibledeflection || ""
  }

  if (normalizedName.includes("wire rope")) {
    if (isAuxiliaryHoist) return asset?.auxhoistropemm || ""
    return asset?.steelwireropemm || ""
  }

  if (normalizedName.includes("hook opening")) {
    if (isAuxiliaryHoist) return asset?.auxhoisthooksize || ""
    return asset?.hooksize || ""
  }

  if (normalizedName.includes("hook size")) {
    if (isAuxiliaryHoist) return asset?.auxhoisthooksize || ""
    return asset?.hooksize || ""
  }

  if (normalizedName.includes("hoist serial")) {
    if (isAuxiliaryHoist) return asset?.auxhoistserialno || ""
    return asset?.hoistserialno || ""
  }

  return ""
}

function getCriteriaMeasuredDefaultValue(asset, row, standardValue) {
  if (isProofLoadCriteria(row)) {
    return getCalculatedProofLoadValue(asset)
  }

  if (isHookMeasuredSizeCriteria(row)) {
    return asset?.hooksize || ""
  }

  return standardValue || ""
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
    "WLL Auxiliary Hoist - Load Mass kg",
    "SWL of Beam - Load Mass kg",
    "SWL Installed Hoist - Load Mass kg",
    "Hoist Proof Load Test kg"
  ].includes(criteriaName)
}

function assetSupportsLoadTest(asset) {
  if (["100", "400", "500"].includes(String(asset?.equipgroupid || ""))) {
    return true
  }

  return (window.atecCriteria || []).some(row =>
    String(row.equiptypeid) === String(asset?.equiptypeid) &&
    String(row.inspectioncategory || row.inspection_category || "").toUpperCase() === "LOADTEST" &&
    row.active !== false &&
    row.active !== "false"
  )
}

function isCrawlBeamHoistSerialLoadTestCriteria(asset, row, inspectiontype) {
  if (inspectiontype !== "LOADTEST") return false

  const equipmentType = normalizeCriteriaName(asset?.equipmenttype || "")
  if (!equipmentType.includes("crawl beam")) return false

  const criteriaText = normalizeCriteriaName([
    row?.criterianame,
    row?.criteriadescription
  ].filter(Boolean).join(" "))

  return (
    criteriaText.includes("serial number") &&
    criteriaText.includes("hoist") &&
    (
      criteriaText.includes("trolley") ||
      criteriaText.includes("beam")
    )
  )
}

function isTextCriteria(row) {
  const name = (row.criterianame || "").toLowerCase()

  return (
    row.fieldtype === "TEXT" ||
    name.includes("defects and recommendations")
  )
}

function isDefaultNoneTextCriteria(row) {
  if (String(row.fieldtype || "").toUpperCase() !== "TEXT") return false

  const name = [
    row.criterianame,
    row.criteriadescription
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .trim()

  return (
    name.includes("any defects noted") ||
    name.includes("comments") ||
    name.includes("remarks")
  )
}

function textCriteriaValue(row, savedValue = "") {
  const value = String(savedValue ?? "")

  if (value.trim()) return value
  return isDefaultNoneTextCriteria(row) ? "None" : ""
}

function isSafeForServiceCriteria(row) {
  return isSafeContinuationCriteria(row)
}

function isHookWearCriteria(row) {
  return normalizeCriteriaName([
    row?.criterianame,
    row?.criteriadescription
  ].filter(Boolean).join(" ")).includes("hook wear does not exceed allowable limits")
}

function getInspectionCriteriaRows(allCriteria, inspectiontype) {
  return allCriteria
    .filter(row =>
      inspectiontype !== "LOADTEST" ||
      !loadTestAssetOnlyCriteria.has(row.criterianame)
    )
    .filter(row => !isHookWearCriteria(row))
    .sort((a, b) => {
      if (isSafeForServiceCriteria(a)) return 1
      if (isSafeForServiceCriteria(b)) return -1
      return 0
    })
}

function returnToInspectionOrigin(returnPage = "quick") {
  if (returnPage === "quick") {
    showQuickInspection()
    return
  }

  if (returnPage === "assets") {
    showAssetSetup()
    return
  }

  showInspections()
}

window.returnToInspectionOrigin = returnToInspectionOrigin

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

  remarksBox.style.display = result === "FAIL" || result === "NO" ? "block" : "none"
}

function isSafeContinuationCriteria(row) {
  const name = String(row?.criteriadescription || row?.criterianame || "").trim().toUpperCase()
  return name === "SAFE FOR CONTINUED OPERATION" || name === "SAFE FOR SERVICE"
}

function criteriaSavedResult(row) {
  return String(
    row?.result ??
    row?.savedresult ??
    row?.measuredvalue ??
    row?.value ??
    ""
  ).trim().toUpperCase()
}

function criteriaDefaultResult(row) {
  const savedResult = criteriaSavedResult(row)

  if (savedResult) return savedResult
  if (row.resulttype === "YES_NO" || isSafeContinuationCriteria(row)) return "YES"

  return "PASS"
}

function criteriaResultOption(value, label, selectedValue) {
  return `<option value="${value}" ${selectedValue === value ? "selected" : ""}>${label}</option>`
}

function isCriticalCriteria(row) {
  return String(row?.severity || "").toUpperCase() === "CRITICAL"
}

window.updateInspectionSafetyWarning = function () {
  const inspectionCriteria = window.currentInspectionCriteria || []
  const failedCriticalCriteria = inspectionCriteria.filter(row => {
    const result = document.querySelector(`#result-${row.criteriaid}`)?.value
    return isCriticalCriteria(row) && !isSafeContinuationCriteria(row) && ["FAIL", "NO"].includes(result)
  })

  const warning = document.querySelector("#inspectionCriticalWarning")
  const safeCriteria = inspectionCriteria.find(isSafeContinuationCriteria)

  if (safeCriteria && failedCriticalCriteria.length) {
    const safeSelect = document.querySelector(`#result-${safeCriteria.criteriaid}`)

    if (safeSelect) {
      safeSelect.value = safeSelect.querySelector('option[value="NO"]') ? "NO" : "FAIL"
      safeSelect.disabled = true
      safeSelect.dataset.autoForcedSafety = "true"
      toggleFailRemark(safeCriteria.criteriaid)
    }
  }

  if (safeCriteria && failedCriticalCriteria.length === 0) {
    const safeSelect = document.querySelector(`#result-${safeCriteria.criteriaid}`)
    if (safeSelect) {
      safeSelect.disabled = false

      if (safeSelect.dataset.autoForcedSafety === "true") {
        safeSelect.value = safeSelect.querySelector('option[value="YES"]') ? "YES" : "PASS"
        delete safeSelect.dataset.autoForcedSafety
        toggleFailRemark(safeCriteria.criteriaid)
      }
    }
  }

  if (!warning) return

  warning.style.display = failedCriticalCriteria.length ? "block" : "none"
  warning.innerHTML = failedCriticalCriteria.length
    ? `<strong>NOT SAFE rule applied:</strong> ${failedCriticalCriteria.length} critical item failed. SAFE FOR CONTINUED OPERATION is forced to NO and the certificate will be NOT SAFE.`
    : ""
}

function getInspectionWizardKey(asset, inspectiontype = "VISUAL") {
  if (inspectiontype !== "VISUAL" && inspectiontype !== "LOADTEST") return "GENERIC"

  const equipmentText = normalizeCriteriaName([
    asset?.equipmenttype,
    asset?.equipmenttypedescription,
    asset?.description
  ].filter(Boolean).join(" "))

  if (
    equipmentText.includes("manual chain hoist") ||
    equipmentText.includes("manual lever hoist") ||
    equipmentText.includes("chain block") ||
    equipmentText.includes("lever hoist")
  ) {
    return "CHAIN_BLOCK_LEVER_HOIST"
  }

  return "GENERIC"
}

function inspectionCriteriaText(row) {
  return String(row?.criteriadescription || row?.criterianame || "")
}

function renderMeasurementCriteriaRow(row, asset, inspectiontype) {
  const assetValue = getCriteriaStandardValue(asset, row)
  const measuredDefaultValue = getCriteriaMeasuredDefaultValue(asset, row, assetValue)

  return `
    <div class="inspection-row compact-row ${inspectiontype === "LOADTEST" ? "loadtest-measurement-row" : ""}">
      <div class="inspection-criteria">
        ${escapeHtml(inspectionCriteriaText(row))}
        ${row.severity ? `<span class="inspection-criteria-badge ${safeAttr(String(row.severity).toLowerCase())}">${escapeHtml(row.severity)}</span>` : ""}
      </div>

      <div class="comparison-grid">
        ${assetValue ? `
          <input
            type="text"
            value="${escapeAttribute(assetValue)}"
            readonly
            class="readonly-value"
          >
        ` : `
          <div class="readonly-value readonly-value-empty"></div>
        `}

        <input
          id="measured-${row.criteriaid}"
          type="text"
          value="${escapeAttribute(measuredDefaultValue)}"
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
}

function renderVisualCriteriaRow(row) {
  const selectedResult = criteriaDefaultResult(row)

  if (isTextCriteria(row)) {
    return `
      <div class="inspection-row compact-row">
        <div class="inspection-criteria">
          ${escapeHtml(inspectionCriteriaText(row))}
          ${row.severity ? `<span class="inspection-criteria-badge ${safeAttr(String(row.severity).toLowerCase())}">${escapeHtml(row.severity)}</span>` : ""}
        </div>

        <div class="inspection-result inspection-text-result">
          <textarea
            id="remarks-${row.criteriaid}"
            rows="3"
            placeholder="${escapeAttribute(row.criterianame)}"
          >${escapeAttribute(textCriteriaValue(row))}</textarea>
        </div>
      </div>
    `
  }

  return `
    <div class="inspection-row compact-row">
      <div class="inspection-criteria">
        ${escapeHtml(inspectionCriteriaText(row))}
        ${row.severity ? `<span class="inspection-criteria-badge ${safeAttr(String(row.severity).toLowerCase())}">${escapeHtml(row.severity)}</span>` : ""}
      </div>

      <div class="inspection-result">
        <select
          id="result-${row.criteriaid}"
          onchange="toggleFailRemark(${row.criteriaid}); updateInspectionSafetyWarning()"
        >
          ${
            row.resulttype === "YES_NO" || isSafeContinuationCriteria(row)
              ? `
                ${criteriaResultOption("YES", "YES", selectedResult)}
                ${criteriaResultOption("NO", "NO", selectedResult)}
                ${criteriaResultOption("N/A", "N/A", selectedResult)}
              `
              : `
                ${criteriaResultOption("PASS", "PASS", selectedResult)}
                ${criteriaResultOption("FAIL", "FAIL", selectedResult)}
                ${criteriaResultOption("N/A", "N/A", selectedResult)}
              `
          }
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
  `
}

function renderGenericInspectionCriteria(asset, measurementCriteria, visualCriteria, inspectiontype) {
  return `
    ${measurementCriteria.length ? `
      <div class="inspection-section-title">
        Measurements
      </div>

      <div class="inspection-header measurements ${inspectiontype === "LOADTEST" ? "loadtest-measurements" : ""}">
        <div>Criteria</div>
        <div>Standard Dimension</div>
        <div>Measured Dimension</div>
        ${inspectiontype === "LOADTEST" ? "<div>Comments / Remarks</div>" : ""}
      </div>

      ${measurementCriteria.map(row => renderMeasurementCriteriaRow(row, asset, inspectiontype)).join("")}
    ` : ""}

    <div class="inspection-section-title">
      Visual Inspection
    </div>

    <div class="inspection-header visual">
      <div>Criteria</div>
      <div>Result</div>
      <div>Reason for FAIL (required)</div>
    </div>

    ${visualCriteria.map(row => renderVisualCriteriaRow(row)).join("")}
  `
}

function getChainBlockWizardSection(row) {
  const text = normalizeCriteriaName(inspectionCriteriaText(row))

  if (isSafeContinuationCriteria(row) || text.includes("defect") || text.includes("recommendation") || text.includes("comment")) {
    return "Final Result"
  }

  if (text.includes("hook") || text.includes("latch") || text.includes("throat")) {
    return "Hooks"
  }

  if (text.includes("chain") || text.includes("link")) {
    return "Load Chain"
  }

  if (text.includes("brake") || text.includes("load holding") || text.includes("proof load") || text.includes("load limiter") || text.includes("loadcell")) {
    return "Brake / Load Holding"
  }

  if (text.includes("marking") || text.includes("swl") || text.includes("wll") || text.includes("identification") || text.includes("serial")) {
    return "Markings"
  }

  if (text.includes("body") || text.includes("casing") || text.includes("cover") || text.includes("frame") || text.includes("structure")) {
    return "Body / Casing"
  }

  if (text.includes("function") || text.includes("operate") || text.includes("movement") || text.includes("raising") || text.includes("lowering") || text.includes("test")) {
    return "Functional Test"
  }

  return "Identification"
}

function renderChainBlockWizard(asset, assetCriteria, inspectiontype) {
  const wizardSections = [
    "Identification",
    "Hooks",
    "Load Chain",
    "Body / Casing",
    "Brake / Load Holding",
    "Markings",
    "Functional Test",
    "Final Result"
  ]

  const groupedRows = wizardSections.reduce((sections, section) => {
    sections[section] = []
    return sections
  }, {})

  assetCriteria.forEach(row => {
    groupedRows[getChainBlockWizardSection(row)].push(row)
  })

  return `
    <div class="inspection-wizard-banner">
      <div>
        <span>Inspection Wizard</span>
        <strong>Chain Block / Lever Hoist</strong>
      </div>
      <p>Guided sections use the same saved criteria and certificate output as the normal inspection form.</p>
    </div>

    ${wizardSections.map(section => {
      const rows = groupedRows[section] || []
      if (!rows.length) return ""

      const measurementRows = rows.filter(row => row.fieldtype === "NUMBER")
      const visualRows = rows.filter(row => row.fieldtype !== "NUMBER")

      return `
        <div class="inspection-wizard-section">
          <div class="inspection-section-title">${section}</div>

          ${measurementRows.length ? `
            <div class="inspection-header measurements ${inspectiontype === "LOADTEST" ? "loadtest-measurements" : ""}">
              <div>Criteria</div>
              <div>Standard Dimension</div>
              <div>Measured Dimension</div>
              ${inspectiontype === "LOADTEST" ? "<div>Comments / Remarks</div>" : ""}
            </div>
            ${measurementRows.map(row => renderMeasurementCriteriaRow(row, asset, inspectiontype)).join("")}
          ` : ""}

          ${visualRows.length ? `
            <div class="inspection-header visual">
              <div>Criteria</div>
              <div>Result</div>
              <div>Reason for FAIL (required)</div>
            </div>
            ${visualRows.map(row => renderVisualCriteriaRow(row)).join("")}
          ` : ""}
        </div>
      `
    }).join("")}
  `
}

function renderInspectionCriteriaLayout(asset, assetCriteria, measurementCriteria, visualCriteria, inspectiontype) {
  const wizardKey = getInspectionWizardKey(asset, inspectiontype)

  if (wizardKey === "CHAIN_BLOCK_LEVER_HOIST") {
    return renderChainBlockWizard(asset, assetCriteria, inspectiontype)
  }

  return renderGenericInspectionCriteria(asset, measurementCriteria, visualCriteria, inspectiontype)
}

window.pendingInspectionPhotos = []

function inspectionPhotoTypeOptions(selected = "GENERAL") {
  return [
    "GENERAL",
    "DEFECT",
    "REPAIR",
    "LOAD_TEST",
    "NAMEPLATE",
    "HOOK",
    "WIRE_ROPE",
    "STRUCTURE",
    "ELECTRICAL"
  ].map(type => `
    <option value="${type}" ${selected === type ? "selected" : ""}>
      ${type.replaceAll("_", " ")}
    </option>
  `).join("")
}

window.handleInspectionPhotoSelection = function (event) {
  const files = Array.from(event.target.files || [])

  files.forEach(file => {
    window.pendingInspectionPhotos.push({
      id: `${Date.now()}-${Math.random()}`,
      file,
      caption: "",
      photoType: "GENERAL",
      previewUrl: URL.createObjectURL(file)
    })
  })

  event.target.value = ""
  renderInspectionPhotoPreview()
}

window.updateInspectionPhotoMeta = function (photoId, field, value) {
  const photo = window.pendingInspectionPhotos.find(item => item.id === photoId)
  if (!photo) return
  photo[field] = value
}

window.removeInspectionPhoto = function (photoId) {
  const photo = window.pendingInspectionPhotos.find(item => item.id === photoId)
  if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl)
  window.pendingInspectionPhotos =
    window.pendingInspectionPhotos.filter(item => item.id !== photoId)
  renderInspectionPhotoPreview()
}

function renderInspectionPhotoPreview() {
  const container = document.querySelector("#inspectionPhotoPreview")
  if (!container) return

  if (!window.pendingInspectionPhotos.length) {
    container.innerHTML = `<p class="muted-text">No inspection photos selected.</p>`
    return
  }

  container.innerHTML = window.pendingInspectionPhotos.map(photo => `
    <div class="inspection-photo-preview-card">
      <img src="${photo.previewUrl}" alt="Inspection photo preview">
      <div class="inspection-photo-preview-fields">
        <label>
          Photo Type
          <select onchange="updateInspectionPhotoMeta('${photo.id}', 'photoType', this.value)">
            ${inspectionPhotoTypeOptions(photo.photoType)}
          </select>
        </label>
        <label>
          Caption
          <input
            type="text"
            value="${escapeAttribute(photo.caption)}"
            placeholder="Optional caption"
            oninput="updateInspectionPhotoMeta('${photo.id}', 'caption', this.value)"
          >
        </label>
        <button type="button" class="secondary-btn" onclick="removeInspectionPhoto('${photo.id}')">
          Remove
        </button>
      </div>
    </div>
  `).join("")
}

window.startInspection = async function (assetid, inspectiontype = "VISUAL", returnPage = "quick") {
  if (!canPerformInspections()) {
    alert("You do not have permission to create inspections or load tests.")
    return
  }

  if (returnPage === "assets") {
    rememberAssetListState()
  }

  let asset

  try {
    asset = await getAssetForAction(assetid)
  } catch (err) {
    alert(err.message || "Asset not found")
    return
  }

  const quickDetailsResponse = await fetch(
    `${API_BASE}/assets/${assetid}/quick-details`
  )
  const defaultTestDate = dateInputValue()
  const defaultValidDate = calculateValidDateFromTestDate(defaultTestDate, inspectiontype)

  const quickDetails = await quickDetailsResponse.json()

  window.scrollTo(0, 0)

window.pendingInspectionPhotos = []

let assetCriteria = getInspectionCriteriaRows(criteria.filter(
    c =>
    String(c.equiptypeid) === String(asset.equiptypeid) &&
    String(c.inspectioncategory) === String(inspectiontype) &&
    c.active !== false
), inspectiontype)

assetCriteria = assetCriteria.filter(row =>
  !isCrawlBeamHoistSerialLoadTestCriteria(asset, row, inspectiontype)
)

const measurementCriteria = assetCriteria.filter(row => row.fieldtype === "NUMBER")
const visualCriteria = assetCriteria.filter(row => row.fieldtype !== "NUMBER")

window.currentInspectionCriteria = assetCriteria

  document.querySelector('#page').innerHTML = `
    <h2>${escapeHtml(inspectiontype)} - Asset ${escapeHtml(asset.assetid)}</h2>

    <div class="filter-card">
      <div class="inspection-asset-summary">
        <div class="inspection-asset-title">
          <strong>${escapeHtml(asset.description || '')}</strong>
          <span>Asset ${escapeHtml(asset.assetid)}</span>
        </div>

        <div class="inspection-asset-details">
          <div><span>Serial No</span><strong>${escapeHtml(asset.serialno || '-')}</strong></div>
          <div><span>Equipment Type</span><strong>${escapeHtml(asset.equipmenttype || '-')}</strong></div>
          <div><span>WLL</span><strong>${escapeHtml(asset.wll || '-')} kg</strong></div>
          ${inspectionSummaryCard("Span/Jib", asset.span, "mm")}
          ${inspectionSummaryCard("Permissible Deflection", asset.permissibledeflection, "mm")}
        </div>

        <div class="inspection-asset-actions">
          <button onclick="passAllCriteria(${asset.assetid}, '${inspectiontype}', '${returnPage}')">
            Pass All & Save
          </button>

          <button onclick="returnToInspectionOrigin('${returnPage}')">
            Cancel
          </button>
        </div>
      </div>
    </div>

    <div class="quick-photo-grid">

  ${asset.media1 ? `
    <div class="quick-photo-card">
      <img src="${safeAttr(uploadUrl(asset.media1))}">
    </div>
  ` : ''}

  ${asset.media2 ? `
    <div class="quick-photo-card">
      <img src="${safeAttr(uploadUrl(asset.media2))}">
    </div>
  ` : ''}

</div>

<div class="filter-card">

  <h3>Inspection Photos</h3>

  <input
    id="inspectionPhotoFiles"
    type="file"
    accept="image/*"
    multiple
    onchange="handleInspectionPhotoSelection(event)"
  >

  <div id="inspectionPhotoPreview" class="inspection-photo-preview-grid">
    <p class="muted-text">No inspection photos selected.</p>
  </div>

</div>

<div id="inspectionCriticalWarning" class="inspection-critical-warning" style="display:none;"></div>

<div class="inspection-tag-card">

  <div class="inspection-tag-title">
    INSPECTION DETAILS
  </div>

  <div class="inspector-identity-card">
    <div>
      <span>Logged-in Inspector</span>
      <strong>${escapeHtml(currentUser?.full_name || '-')}</strong>
    </div>
    <div>
      <span>LMI Number</span>
      <strong>${escapeHtml(currentUser?.lmi_number || '-')}</strong>
    </div>
  </div>

  <div class="form-row">

    <div class="form-group">
      <label>${inspectiontype === "LOADTEST" ? "Load Test Date" : "Inspection Date"}</label>
      <input
        id="inspectionTestDate"
        type="date"
        value="${defaultTestDate}"
        onchange="updateInspectionValidDateFromTestDate('${inspectiontype}')"
      >
    </div>

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
            ${escapeHtml(quickDetails.lastinspectiondate || 'Never Inspected')}
          </div>

          <div>
            <strong>Tag Number:</strong><br>
            ${escapeHtml(quickDetails.lastinspectiontag || '-')}
          </div>

          <div>
            <strong>Type:</strong><br>
            ${escapeHtml(quickDetails.lastinspectiontype || '-')}
          </div>

          <div>
            <strong>Status:</strong><br>
           <span class="${
              quickDetails.lastinspectionstatus === 'SAFE'
                ? 'status-safe'
                : 'status-unsafe'
            }">
              ${escapeHtml(quickDetails.lastinspectionstatus || '-')}
            </span>
          </div>

          <div>
            <strong>Inspector:</strong><br>
            ${escapeHtml(quickDetails.lastinspector || '-')}
          </div>

        </div>

      </div>

<div class="inspection-list">
  ${renderInspectionCriteriaLayout(asset, assetCriteria, measurementCriteria, visualCriteria, inspectiontype)}
</div>

    <div class="filter-card">
      <button type="button" onclick="window.saveInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}')">
        Save ${inspectiontype}
      </button>

      <button onclick="returnToInspectionOrigin('${returnPage}')">
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
    `${API_BASE}/assets/${assetid}/inspection-history`
  )

  const history = await response.json()

  if (!response.ok) {
    alert("Error loading inspection history: " + history.error)
    return
  }

  const rows = history.map(row => `
    <tr>
      <td>${escapeHtml(row.testdate || '')}</td>
      <td>${escapeHtml(row.inspectiontype || '')}</td>
      <td><strong>${escapeHtml(row.tagnumber || '-')}</strong></td>
      <td>${escapeHtml(row.status || '')}</td>
      <td>${escapeHtml(row.inspector || '-')}</td>
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
  rememberAssetListState()

  const response = await fetch(
    `${API_BASE}/assets/${assetid}/inspection-history`
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
              <td>${escapeHtml(row.testdate || '')}</td>
              <td>${escapeHtml(row.inspectiontype || '')}</td>
              <td><strong>${escapeHtml(row.tagnumber || '-')}</strong></td>
              <td>${escapeHtml(row.status || '')}</td>
              <td>${escapeHtml(row.inspector || '-')}</td>
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
      const hasYesOption = Array.from(select.options).some(option => option.value === "YES")
      select.value = hasYesOption ? "YES" : "PASS"
    })

  updateInspectionSafetyWarning()

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

window.dashboardFindAsset = async function () {
  const searchInput = document.querySelector("#dashboardAssetSearch")
  const normalizedSearch = normalizeQuickAssetScan(searchInput?.value || "")
  const search = normalizedSearch.trim()
  const resultBox = document.querySelector("#dashboardAssetSearchResult")

  if (searchInput && normalizedSearch !== searchInput.value.trim()) {
    searchInput.value = normalizedSearch
  }

  if (!search) {
    resultBox.innerHTML = `<p>Please enter or scan an asset number, tag, serial number or QR code.</p>`
    return
  }

  resultBox.innerHTML = `<p>Searching...</p>`

  try {
    const response = await fetch(`${API_BASE}/inspections/assets/search?q=${encodeURIComponent(search)}`)

    if (!response.ok) {
      throw new Error("Asset search failed")
    }

    const matchedAssets = await response.json()

    if (!matchedAssets.length) {
      resultBox.innerHTML = `
        <p>No asset found for <strong>${escapeHtml(search)}</strong>.</p>
      `
      return
    }

    if (matchedAssets.length === 1) {
      quickOpenAsset(matchedAssets[0].assetid)
      return
    }

    resultBox.innerHTML = `
      <div class="dashboard-result-table">
        <table class="dashboard-table">
          <thead>
            <tr>
              <th>Asset ID</th>
              <th>Tag No</th>
              <th>Serial No</th>
              <th>Hoist Serial No</th>
              <th>Description</th>
              <th>Equipment Type</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            ${matchedAssets.slice(0, 10).map(asset => `
              <tr>
                <td>${escapeHtml(asset.assetid)}</td>
                <td>${escapeHtml(asset.assettagno || "-")}</td>
                <td>${escapeHtml(asset.serialno || "-")}</td>
                <td>${escapeHtml(asset.hoistserialno || "-")}</td>
                <td>${escapeHtml(asset.description || "")}</td>
                <td>${escapeHtml(asset.equipmenttype || "")}</td>
                <td class="dashboard-search-actions">
                  <button onclick="startInspection(${asset.assetid}, 'VISUAL', 'quick')">Inspect</button>
                  ${
                    assetSupportsLoadTest(asset)
                      ? `<button class="load-test-btn" onclick="startInspection(${asset.assetid}, 'LOADTEST', 'quick')">Load Test</button>`
                      : ""
                  }
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
  } catch (err) {
    console.error("Dashboard asset search error:", err)
    resultBox.innerHTML = `<p>Unable to search assets. Please try again.</p>`
  }
}

let dashboardScannerStream = null
let dashboardScannerLoopActive = false

window.startDashboardCameraScan = async function () {
  const scanner = document.querySelector('#dashboardCameraScanner')
  const video = document.querySelector('#dashboardCameraVideo')
  const status = document.querySelector('#dashboardScanStatus')

  if (!('BarcodeDetector' in window)) {
    if (status) status.textContent = 'Camera scanning is not supported by this browser. Use the scan/type box above.'
    scanner?.removeAttribute('hidden')
    return
  }

  try {
    const supportedFormats = await window.BarcodeDetector.getSupportedFormats()
    const formats = ['qr_code', 'code_128', 'code_39', 'ean_13'].filter(format =>
      supportedFormats.includes(format)
    )
    const detector = new window.BarcodeDetector({ formats })

    dashboardScannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    })

    video.srcObject = dashboardScannerStream
    scanner?.removeAttribute('hidden')
    await video.play()

    dashboardScannerLoopActive = true
    if (status) status.textContent = 'Scanning... point the camera at the QR label or barcode.'

    const scanFrame = async () => {
      if (!dashboardScannerLoopActive) return

      try {
        const codes = await detector.detect(video)
        if (codes.length) {
          const scannedValue = normalizeQuickAssetScan(codes[0].rawValue)
          document.querySelector('#dashboardAssetSearch').value = scannedValue
          stopDashboardCameraScan()
          dashboardFindAsset()
          return
        }
      } catch (err) {
        console.error('Dashboard camera scan failed:', err)
      }

      requestAnimationFrame(scanFrame)
    }

    scanFrame()
  } catch (err) {
    console.error('Unable to start dashboard camera scanner:', err)
    scanner?.removeAttribute('hidden')
    if (status) status.textContent = 'Camera could not start. Please allow camera access or use the scan/type box.'
  }
}

window.stopDashboardCameraScan = function () {
  dashboardScannerLoopActive = false

  if (dashboardScannerStream) {
    dashboardScannerStream.getTracks().forEach(track => track.stop())
    dashboardScannerStream = null
  }

  const video = document.querySelector('#dashboardCameraVideo')
  if (video) video.srcObject = null

  document.querySelector('#dashboardCameraScanner')?.setAttribute('hidden', '')
}

async function loadDashboardSummary() {
  try {
    const response = await fetch(`${API_BASE}/dashboard/summary`)

    if (!response.ok) {
      throw new Error("Failed to load dashboard summary")
    }

    const data = await response.json()
    loadDashboardAlerts(data.alerts || {})
    loadDashboardFailedEquipment(data.failedEquipmentByCustomer || [])
    loadDashboardUpcomingExpiries(data.upcomingExpiriesByCustomer || [])
    loadDashboardTopCustomers(data.topCustomers || [])
    loadDashboardEquipmentTypes(data.equipmentByType || [])
  } catch (err) {
    console.error("Failed to load dashboard summary:", err)
    loadDashboardAlerts()
    loadDashboardFailedEquipment()
    loadDashboardUpcomingExpiries()
    loadDashboardTopCustomers()
    loadDashboardEquipmentTypes()
  }
}

async function loadDashboardAlerts(preloadedData = null) {
  try {
    let data = preloadedData

    if (!data) {
      const response = await fetch(`${API_BASE}/dashboard/alerts`)

      if (!response.ok) {
        throw new Error("Failed to load dashboard alerts")
      }

      data = await response.json()
    }

    const alertBox = document.querySelector("#dashboardAlerts")

    if (!alertBox) return

    let html = ""

    if (Number(data.overdue) > 0) {
      html += `
        <div class="alert-card danger">
          ALERT: ${data.overdue} Assets Overdue
        </div>
      `
    }

    if (Number(data.expiring) > 0) {
      html += `
        <div class="alert-card warning">
          WARNING: ${data.expiring} Certificates Expiring Within 30 Days
        </div>
      `
    }

    if (Number(data.failed) > 0) {
      html += `
        <div class="alert-card danger">
          ALERT: ${data.failed} Failed Assets
        </div>
      `
    }

    if (html === "") {
      html = `
        <div class="alert-card success">
          OK: No operational alerts
        </div>
      `
    }

    alertBox.innerHTML = html

  } catch (err) {
    console.error("Failed to load dashboard alerts:", err)
    const alertBox = document.querySelector("#dashboardAlerts")
    if (alertBox) {
      alertBox.innerHTML = `
        <div class="alert-card warning">
          Unable to load dashboard alerts
        </div>
      `
    }
  }
}

async function loadDashboardFailedEquipment(preloadedData = null) {
  const tbody = document.querySelector("#failedEquipmentTableBody")
  if (!tbody) return

  try {
    let data = preloadedData

    if (!data) {
      const response = await fetch(`${API_BASE}/dashboard/failed-equipment-by-customer`)

      if (!response.ok) {
        throw new Error("Failed to load failed equipment")
      }

      data = await response.json()
    }

    if (!Array.isArray(data) || !data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="empty-row">
            No failed equipment found
          </td>
        </tr>
      `
      return
    }

    const sortedData = sortTableRows(data, 'dashboardFailed', {
      clientname: item => item.clientname,
      failed_assets: item => item.failed_assets,
      latest_failed_date: item => item.latest_failed_date
    }, 'failed_assets')

    tbody.innerHTML = sortedData.map(item => {
      const reportArgs = safeAttr(JSON.stringify({ clientid: item.clientid, autoLoad: true }))

      return `
      <tr>
        <td>${escapeHtml(item.clientname || "")}</td>
        <td><strong>${escapeHtml(item.failed_assets || 0)}</strong></td>
        <td>${escapeHtml(item.latest_failed_date ? item.latest_failed_date.split("T")[0] : "")}</td>
        <td>
          <button
            class="small-btn"
            onclick="showCustomerDetailedReport(${reportArgs})"
          >
            View Assets
          </button>
        </td>
      </tr>
    `}).join("")

  } catch (err) {
    console.error("Failed to load failed equipment:", err)
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-row">Unable to load failed equipment data</td>
      </tr>
    `
  }
}

async function loadDashboardUpcomingExpiries(preloadedData = null) {
  const tbody = document.querySelector("#upcomingExpiriesTableBody")
  if (!tbody) return

  try {
    let data = preloadedData

    if (!data) {
      const response = await fetch(`${API_BASE}/dashboard/upcoming-expiries-by-customer`)

      if (!response.ok) {
        throw new Error("Failed to load upcoming certificate expiries")
      }

      data = await response.json()
    }

    if (!Array.isArray(data) || !data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-row">
            No upcoming certificate expiries
          </td>
        </tr>
      `
      return
    }

    const sortedData = sortTableRows(data, 'dashboardExpiries', {
      clientname: item => item.clientname,
      upcoming_assets: item => item.upcoming_assets,
      next_expiry_date: item => item.next_expiry_date,
      days_remaining: item => item.days_remaining
    }, 'days_remaining')

    tbody.innerHTML = sortedData.map(item => {
      const reportArgs = safeAttr(JSON.stringify({ clientid: item.clientid, autoLoad: true }))

      return `
      <tr>
        <td>${escapeHtml(item.clientname || "")}</td>
        <td><strong>${escapeHtml(item.upcoming_assets || 0)}</strong></td>
        <td>${escapeHtml(item.next_expiry_date ? item.next_expiry_date.split("T")[0] : "")}</td>
        <td><strong>${escapeHtml(item.days_remaining ?? "")}</strong></td>
        <td>
          <button
            class="small-btn"
            onclick="showCustomerDetailedReport(${reportArgs})"
          >
            View Assets
          </button>
        </td>
      </tr>
    `}).join("")

  } catch (err) {
    console.error("Failed to load upcoming expiries:", err)
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-row">Unable to load upcoming certificate expiry data</td>
      </tr>
    `
  }
}

async function loadDashboardTopCustomers(preloadedData = null) {
  const tbody = document.querySelector("#dashboardTopCustomersBody")
  if (!tbody) return

  try {
    let data = preloadedData

    if (!data) {
      const response = await fetch(`${API_BASE}/dashboard/top-customers`)

      if (!response.ok) {
        throw new Error("Failed to load top customers")
      }

      data = await response.json()
    }

    if (!Array.isArray(data) || !data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" class="empty-row">No customer asset data found</td>
        </tr>
      `
      return
    }

    const sortedData = sortTableRows(data, 'dashboardCustomers', {
      clientname: item => item.clientname,
      sites: item => item.sites,
      assets: item => item.assets
    }, 'assets').slice(0, 10)

    tbody.innerHTML = sortedData.map(item => `
      <tr>
        <td>${escapeHtml(item.clientname || "")}</td>
        <td>${escapeHtml(item.sites || 0)}</td>
        <td><strong>${escapeHtml(item.assets || 0)}</strong></td>
      </tr>
    `).join("")
  } catch (err) {
    console.error("Failed to load top customers:", err)
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="empty-row">Unable to load customer asset data</td>
      </tr>
    `
  }
}

async function loadDashboardEquipmentTypes(preloadedData = null) {
  const tbody = document.querySelector("#dashboardEquipmentTypeBody")
  if (!tbody) return

  try {
    let data = preloadedData

    if (!data) {
      const response = await fetch(`${API_BASE}/dashboard/equipment-by-type`)

      if (!response.ok) {
        throw new Error("Failed to load equipment by type")
      }

      data = await response.json()
    }

    if (!Array.isArray(data) || !data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="2" class="empty-row">No equipment type data found</td>
        </tr>
      `
      return
    }

    const sortedData = sortTableRows(data, 'dashboardEquipment', {
      equipmenttype: item => item.equipmenttype,
      total: item => item.total
    }, 'total').slice(0, 10)

    tbody.innerHTML = sortedData.map(item => `
      <tr>
        <td>${escapeHtml(item.equipmenttype || "Unknown")}</td>
        <td><strong>${escapeHtml(item.total || 0)}</strong></td>
      </tr>
    `).join("")
  } catch (err) {
    console.error("Failed to load equipment by type:", err)
    tbody.innerHTML = `
      <tr>
        <td colspan="2" class="empty-row">Unable to load equipment type data</td>
      </tr>
    `
  }
}


window.saveInspection = async function(assetid, inspectiontype = "VISUAL", returnPage = "quick") {
  const tagnumber =
    document.querySelector('#inspectionTagNo')?.value.trim() || ""

  const testdate =
    document.querySelector("#inspectionTestDate")?.value || dateInputValue()

  let asset

  try {
    asset = await getAssetForAction(assetid)
  } catch (err) {
    alert(err.message || "Asset not found")
    return
  }

  let assetCriteria = getInspectionCriteriaRows(criteria.filter(
    c =>
      String(c.equiptypeid) === String(asset.equiptypeid) &&
      String(c.inspectioncategory) === String(inspectiontype) &&
      c.active !== false
  ), inspectiontype)

  assetCriteria = assetCriteria.filter(row =>
    !isCrawlBeamHoistSerialLoadTestCriteria(asset, row, inspectiontype)
  )

  let results = []
  let overallStatus = "SAFE"
  let missingFailReason = null

  for (const row of assetCriteria) {

    const resultInput =
      document.querySelector(`#result-${row.criteriaid}`)

    const measuredInput =
      document.querySelector(`#measured-${row.criteriaid}`)

    let result =
      resultInput ? resultInput.value : "RECORDED"

      const remarksInput =
        document.querySelector(`#remarks-${row.criteriaid}`)

      const remarks =
        isTextCriteria(row)
          ? remarksInput?.value || ""
          : inspectiontype === "LOADTEST"
            ? remarksInput?.value || ""
            : ["FAIL", "NO"].includes(result)
              ? remarksInput?.value || ""
              : ""

    const autoForcedSafety =
      isSafeContinuationCriteria(row) &&
      resultInput?.dataset.autoForcedSafety === "true"

    if (
      !isTextCriteria(row) &&
      ["FAIL", "NO"].includes(result) &&
      !autoForcedSafety &&
      !String(remarks || "").trim()
    ) {
      missingFailReason = row
      break
    }

    if (isSafeContinuationCriteria(row) && !["PASS", "YES"].includes(result)) {
      overallStatus = "NOT SAFE"
    }

    if (isCriticalCriteria(row) && !isSafeContinuationCriteria(row) && ["FAIL", "NO"].includes(result)) {
      overallStatus = "NOT SAFE"
    }

    const assetValue =
      getCriteriaStandardValue(asset, row) || null

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

  if (missingFailReason) {
    alert(`Please enter a reason/comment for the failed item: ${inspectionCriteriaText(missingFailReason)}`)
    const remarksInput = document.querySelector(`#remarks-${missingFailReason.criteriaid}`)
    const remarksWrapper = document.querySelector(`#fail-remarks-${missingFailReason.criteriaid}`)
    if (remarksWrapper) remarksWrapper.style.display = "block"
    if (remarksInput) remarksInput.focus()
    return
  }

  const formData = new FormData()

  formData.append("assetid", assetid)
  formData.append("testdate", testdate)
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

  ;(window.pendingInspectionPhotos || []).forEach(photo => {
    formData.append("inspectionPhotos", photo.file)
    formData.append("photoCaptions", photo.caption || "")
    formData.append("photoTypes", photo.photoType || "GENERAL")
  })

  let response
  let savedInspection

  try {
    response = await fetch(
      `${API_BASE}/inspections`,
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

  alert("Inspection saved. Status: " + (savedInspection.status || overallStatus))

  await loadData()
  returnToInspectionOrigin(returnPage)
}



let currentPage =
  localStorage.getItem("currentPage") || "dashboard"

if (!hasAccess(currentPage)) {
  currentPage = currentUser.role === "CUSTOMER" ? "certificates" : "dashboard"
  localStorage.setItem("currentPage", currentPage)
}

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

  case "she":
    showRiskAssessments()
    break

  case "users":
    showUserManagement()
    break

  case "system-health":
    showSystemHealth()
    break

  case "profile":
    showMyProfile()
    break

  default:
    showDashboard()
    break
}

}

loadData()


