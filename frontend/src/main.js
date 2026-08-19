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
import { renderCustomerPortal } from './pages/CustomerPortal.js'
import { renderRiskAssessments, renderRiskAssessmentReports, renderRiskAssessmentTable } from './pages/RiskAssessments.js'
import { renderSystemHealthPage } from './pages/SystemHealth.js'
import { renderMpiReportsPage } from './pages/MpiReports.js'
import {
  addWorkforceTime,
  approveCorrectedTimesheet,
  closeEmployeeTimeEditor,
  deleteEmployeeTimeEntry,
  deleteMyTimeEntry,
  editMyTimeEntry,
  editEmployeeTimes,
  exportTimesheetHistoryCsv,
  exportPayrollExcel,
  loadTimesheetHistory,
  loadWorkSchedule,
  setAllPayrollEmployees,
  setPayrollPeriod,
  renderHrTimesheets,
  renderMyDay,
  renderTimesheetApprovals,
  renderTimesheetHistory,
  renderWorkSchedules,
  updateScheduleHours,
  saveWorkSchedule,
  saveEmployeeTimeEdit,
  submitMyDay,
  workforceAction
} from './pages/Workforce.js'
import { getPaginationState, renderPaginationControls } from './pagination.js'
import { getTableSortState, sortHeader, sortTableRows } from './tableSort.js'
import { API_BASE, assetUrl, uploadUrl } from './api.js'
import { FRONTEND_BUILD_ID } from './buildInfo.js'
import { escapeHtml, safeAttr } from './utils/security.js'
import {
  assetSupportsInspectionWizard,
  assetSupportsCraneWizard,
  getInspectionWizardKey,
  wizardActionLabel
} from './inspectionWizard/wizardRegistry.js'
import {
  groupCriteriaRows,
  inspectionCriteriaText,
  normalizeCriteriaName
} from './inspectionWizard/wizardCriteria.js'
import { craneWizardConfig } from './inspectionWizard/configurations/craneWizardConfig.js'
import { chainBlockWizardConfig } from './inspectionWizard/configurations/chainBlockWizardConfig.js'
import { harnessWizardConfig } from './inspectionWizard/configurations/harnessWizardConfig.js'
import { slingWizardConfig } from './inspectionWizard/configurations/slingWizardConfig.js'
import { inspectionTagDisplay } from './inspectionWizard/WizardReview.js'

if (window.location.pathname.toLowerCase().startsWith('/atec/atec')) {
  window.history.replaceState({}, '', '/atec/')
}

const originalFetch = window.fetch.bind(window)
let sessionExpiryReloadStarted = false

window.fetch = async function (input, options = {}) {
  const url = typeof input === 'string' ? input : input?.url || ''
  const isApiRequest = url.startsWith(API_BASE)

  const response = await originalFetch(input, {
    ...options,
    credentials: isApiRequest ? 'include' : options.credentials
  })

  if (
    isApiRequest &&
    response.status === 401 &&
    currentUser &&
    !sessionExpiryReloadStarted
  ) {
    sessionExpiryReloadStarted = true
    currentUser = null
    window.currentUser = null
    localStorage.removeItem('currentPage')
    window.location.reload()
  }

  return response
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
let updateNoticeShown = false
let updateChecksStarted = false
let sessionChecksStarted = false
let sessionCheckTimer = null
let browserHistoryReady = false
let browserHistoryRestoring = false
let googleMapsLoader = null
let addressReviewQueue = []
let addressReviewResults = []
let addressReviewPosition = 0

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

function setCurrentPage(pageKey) {
  localStorage.setItem('currentPage', pageKey)
  updateSidebarActivePage(pageKey)

  if (!browserHistoryReady || browserHistoryRestoring) return
  if (window.history.state?.atecPage === pageKey) return

  window.history.pushState(
    { ...window.history.state, atecPage: pageKey },
    '',
    window.location.href
  )
}

function replaceCurrentHistoryPage(pageKey) {
  window.history.replaceState(
    { ...window.history.state, atecPage: pageKey },
    '',
    window.location.href
  )
  browserHistoryReady = true
}

const pageAccess = {
  portal: ['CUSTOMER'],
  dashboard: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER'],
  customers: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  sites: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  responsible: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  sections: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  assets: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER'],
  inspections: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  visits: ['ADMIN', 'MANAGER', 'INSPECTOR'],
  'job-cards': ['ADMIN', 'MANAGER', 'INSPECTOR'],
  'my-day': ['ADMIN', 'MANAGER', 'INSPECTOR', 'ASSISTANT'],
  'timesheet-approvals': ['ADMIN', 'MANAGER', 'HR'],
  'timesheet-history': ['ADMIN', 'MANAGER', 'HR'],
  'hr-timesheets': ['ADMIN', 'HR'],
  'work-schedules': ['ADMIN', 'MANAGER', 'HR'],
  'quick-inspection': ['ADMIN', 'MANAGER', 'INSPECTOR'],
  certificates: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER', 'CUSTOMER'],
  mpi: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER', 'CUSTOMER'],
  'customer-report': ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER', 'CUSTOMER'],
  she: ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER'],
  'she-reports': ['ADMIN', 'MANAGER', 'INSPECTOR', 'VIEWER'],
  criteria: ['ADMIN'],
  users: ['ADMIN', 'MANAGER'],
  'system-health': ['ADMIN'],
  profile: ['ADMIN', 'MANAGER', 'INSPECTOR', 'ASSISTANT', 'HR', 'VIEWER', 'CUSTOMER']
}

function hasAccess(pageKey) {
  if (pageKey === 'portal') return currentUser?.role === 'CUSTOMER'

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
    ? `<button class="sidebar-nav-button" data-page="${safeAttr(pageKey)}" data-menu-label="${safeAttr(label.toLowerCase())}" onclick="closeMobileMenu(); ${action}">${escapeHtml(label)}</button>`
    : ''
}

function menuGroup(groupKey, label, items) {
  const content = items.filter(Boolean).join('')
  if (!content) return ''
  const activePage = localStorage.getItem('currentPage') || 'dashboard'
  const containsActive = items.some(item => item && item.includes(`data-page="${activePage}"`))
  const storedGroup = localStorage.getItem(`sidebarGroup:${currentUser?.role || ''}`)
  const open = containsActive || storedGroup === groupKey
  return `<details class="sidebar-menu-group" data-menu-group="${safeAttr(groupKey)}" ${open ? 'open' : ''} ontoggle="rememberSidebarGroup(this)">
    <summary>${escapeHtml(label)}<span aria-hidden="true">›</span></summary><div class="sidebar-menu-items">${content}</div>
  </details>`
}

function renderRoleMenu() {
  if (currentUser?.role === 'CUSTOMER') return menuGroup('portal','Portal',[
    menuButton('portal', 'Customer Portal', 'showCustomerPortal()'),
    menuButton('certificates','Certificates','showCertificateSearch()'),
    menuButton('mpi','MPI / NDT Reports','showMpiReports()'),
    menuButton('customer-report','Reports','showCustomerDetailedReport()')
  ])
  return [
    menuButton('dashboard','Dashboard','showDashboard()'),
    menuGroup('inspections','Inspections',[
      menuButton('quick-inspection','Quick Inspection/Testing','showQuickInspection()'),
      menuButton('mpi','MPI / NDT Reports','showMpiReports()'),
      menuButton('certificates','Certificates','showCertificateSearch()'),
      menuButton('customer-report','Reports','showCustomerDetailedReport()')
    ]),
    menuGroup('jobs-time','Jobs & Time',[
      menuButton('visits','On-Site Visits','showInspectionVisits()'),
      menuButton('job-cards','Technician Job Cards','showJobCards()'),
      menuButton('my-day','My Day / Timesheet','showMyDay()'),
      menuButton('timesheet-approvals','Timesheet Approvals','showTimesheetApprovals()'),
      menuButton('timesheet-history','Timesheet History & Reports','showTimesheetHistory()'),
      menuButton('hr-timesheets','HR Time Dashboard','showHrTimesheets()')
    ]),
    menuGroup('customers-assets','Customers & Assets',[
      menuButton('customers','Customer Setup','showCustomerSetup()'),menuButton('sites','Sites','showSites()'),
      menuButton('responsible','Responsible Persons','showResponsiblePersons()'),menuButton('sections','Sections','showSections()'),
      menuButton('assets','Assets','showAssetSetup()')
    ]),
    menuGroup('people','People & Access',[
      canManageInternalUsers() ? menuButton('users', 'ATEC Users', 'showInternalUserManagement()') : '',
      canManageCustomerPortalUsers() ? menuButton('users', 'Customer Portal Users', 'showCustomerUserManagement()') : '',
      menuButton('work-schedules','Work Schedules','showWorkSchedules()')
    ]),
    menuGroup('risk-assessment','Risk Assesment',[
      menuButton('she','SLAMM','showRiskAssessments()'),
      menuButton('she-reports','Reporting','showRiskAssessmentReports()')
    ]),
    menuGroup('system','System Setup',[
      menuButton('criteria','Equipment Type Criteria','showEquipmentTypeCriteria()'),
      menuButton('system-health','System Health','showSystemHealth()')
    ]),
    menuGroup('account','Account',[menuButton('profile','My Profile','showMyProfile()')])
  ].join('')
}

function updateSidebarActivePage(pageKey) {
  document.querySelectorAll('.sidebar-nav-button').forEach(button => {
    const active = button.dataset.page === pageKey
    button.classList.toggle('active',active)
    if (active) button.closest('.sidebar-menu-group')?.setAttribute('open','')
  })
}

function canManageAssetRecords() {
  return ['ADMIN', 'MANAGER', 'INSPECTOR'].includes(currentUser?.role)
}

function canArchiveOrMoveAssetRecords() {
  return ['ADMIN', 'MANAGER'].includes(currentUser?.role)
}

function showUpdateAvailableNotice() {
  if (updateNoticeShown || document.querySelector('#appUpdateNotice')) return

  updateNoticeShown = true
  const notice = document.createElement('div')
  notice.id = 'appUpdateNotice'
  notice.className = 'app-update-notice'
  notice.innerHTML = `
    <div>
      <strong>New version available</strong>
      <span>Refresh when you are ready to load the latest ATEC update.</span>
    </div>
    <button type="button" onclick="window.location.reload()">Refresh</button>
  `
  document.body.appendChild(notice)
}

async function checkForFrontendUpdate() {
  try {
    const basePath = import.meta.env.BASE_URL || '/'
    const buildInfoUrl = `${basePath.replace(/\/$/, '')}/build-info.json?t=${Date.now()}`
    const response = await originalFetch(buildInfoUrl, {
      cache: 'no-store',
      credentials: 'same-origin'
    })

    if (!response.ok) return

    const info = await response.json()
    if (info.buildId && info.buildId !== FRONTEND_BUILD_ID) {
      showUpdateAvailableNotice()
    }
  } catch (err) {
    // Ignore temporary network errors; the next check will try again.
  }
}

function startFrontendUpdateChecks() {
  if (updateChecksStarted || FRONTEND_BUILD_ID === 'local-dev') return

  updateChecksStarted = true
  window.setTimeout(checkForFrontendUpdate, 30000)
  window.setInterval(checkForFrontendUpdate, 60000)
}

async function checkSession() {
  if (!currentUser || sessionExpiryReloadStarted) return

  try {
    await fetch(`${API_BASE}/auth/me`, { cache: 'no-store' })
  } catch (err) {
    // A connection failure is not an expired session. Try again on the next check.
  }
}

function checkSessionWhenVisible() {
  if (document.visibilityState === 'visible') checkSession()
}

function startSessionChecks() {
  if (sessionChecksStarted) return

  sessionChecksStarted = true
  sessionCheckTimer = window.setInterval(checkSession, 60000)
  window.addEventListener('focus', checkSession)
  document.addEventListener('visibilitychange', checkSessionWhenVisible)
}

function stopSessionChecks() {
  if (sessionCheckTimer) window.clearInterval(sessionCheckTimer)
  sessionCheckTimer = null
  sessionChecksStarted = false
  window.removeEventListener('focus', checkSession)
  document.removeEventListener('visibilitychange', checkSessionWhenVisible)
}

function installPageScrollControls() {
  window.removePageScrollControls?.()
  document.querySelector('#pageScrollControls')?.remove()

  const controls = document.createElement('div')
  controls.id = 'pageScrollControls'
  controls.className = 'page-scroll-controls'
  controls.setAttribute('aria-label', 'Page navigation')
  controls.innerHTML = `
    <button type="button" class="page-scroll-button page-scroll-top" aria-label="Go to top of page" title="Go to top">
      <span aria-hidden="true">↑</span><span>Top</span>
    </button>
    <button type="button" class="page-scroll-button page-scroll-bottom" aria-label="Go to bottom of page" title="Go to bottom">
      <span aria-hidden="true">↓</span><span>Bottom</span>
    </button>
  `
  document.body.appendChild(controls)

  const topButton = controls.querySelector('.page-scroll-top')
  const bottomButton = controls.querySelector('.page-scroll-bottom')
  topButton.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))
  bottomButton.addEventListener('click', () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }))

  const updateControls = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop
    const pageHeight = document.documentElement.scrollHeight
    const hasLongPage = pageHeight > window.innerHeight + 240
    controls.classList.toggle('is-visible', hasLongPage)
    topButton.disabled = scrollTop < 80
    bottomButton.disabled = scrollTop + window.innerHeight >= pageHeight - 80
  }

  window.addEventListener('scroll', updateControls, { passive: true })
  window.addEventListener('resize', updateControls)
  const resizeObserver = new ResizeObserver(updateControls)
  resizeObserver.observe(document.querySelector('#page'))
  window.removePageScrollControls = () => {
    resizeObserver.disconnect()
    window.removeEventListener('scroll', updateControls)
    window.removeEventListener('resize', updateControls)
    controls.remove()
    window.removePageScrollControls = null
  }
  updateControls()
}

function canManageNfcTokens() {
  return ['ADMIN', 'MANAGER'].includes(currentUser?.role)
}

function canArchiveSetupRecords() {
  return currentUser?.role === 'ADMIN'
}

function canPerformInspections() {
  return ['ADMIN', 'MANAGER', 'INSPECTOR'].includes(currentUser?.role)
}

function renderLogin(message = '') {
  window.removePageScrollControls?.()
  document.querySelector('#app').innerHTML = `
    <div class="login-page">
      <main class="login-shell">
        <form class="login-card" onsubmit="event.preventDefault(); loginUser()">
          <img src="${assetUrl('logo.jpg')}" alt="ATEC Logo" class="login-logo">
          <p class="login-eyebrow">Secure customer and operations access</p>
          <h1>Sign in to ATEC</h1>
          ${message ? `<p class="login-error">${message}</p>` : ''}
          <label for="loginUsername">Username or Email</label>
          <input id="loginUsername" type="text" autocomplete="username">
          <label for="loginPassword">Password</label>
          <input id="loginPassword" type="password" autocomplete="current-password">
          <button type="submit">Sign In</button>
        </form>
        <section class="login-discovery" aria-labelledby="demoHeading">
          <p class="login-eyebrow">New to ATEC?</p>
          <h2 id="demoHeading">Discover the ATEC Inspection Platform</h2>
          <p>See how ATEC connects asset registers, job planning, field inspections, workforce activity, certificates and customer reporting in one controlled platform.</p>
          <ul><li>Connected customer and asset records</li><li>Guided inspections and field evidence</li><li>Workforce, approval and reporting workflows</li></ul>
          <button type="button" class="demo-cta" onclick="showDemonstrationRequest()">Request a Live Demonstration</button>
          <p class="demo-contact">Prefer to speak to us? <a href="tel:+27795297683">079 529 7683</a></p>
          <form id="demonstrationRequestForm" class="demo-request-form" hidden onsubmit="event.preventDefault(); submitDemonstrationRequest()">
            <div class="demo-form-heading"><h3>Request a live demonstration</h3><button type="button" class="demo-close" onclick="hideDemonstrationRequest()" aria-label="Close demonstration request">&times;</button></div>
            <div class="demo-form-grid">
              <label>Full name *<input id="demoFullName" maxlength="120" autocomplete="name" required></label>
              <label>Company *<input id="demoCompany" maxlength="160" autocomplete="organization" required></label>
              <label>Work email *<input id="demoEmail" type="email" maxlength="254" autocomplete="email" required></label>
              <label>Telephone *<input id="demoPhone" type="tel" maxlength="40" autocomplete="tel" required></label>
              <label>Area of interest<select id="demoInterest"><option>General platform overview</option><option>Asset inspections and certificates</option><option>Job cards and workforce</option><option>Customer portal and reporting</option><option>Risk and compliance</option></select></label>
              <label>Preferred contact<select id="demoContactMethod"><option>Email</option><option>Telephone</option></select></label>
            </div>
            <label>How can we help?<textarea id="demoMessage" maxlength="2000" rows="3"></textarea></label>
            <label class="demo-honeypot" aria-hidden="true">Website<input id="demoWebsite" tabindex="-1" autocomplete="off"></label>
            <label class="demo-consent"><input id="demoConsent" type="checkbox" required> I agree that ATEC may contact me about this request.</label>
            <p id="demoFormStatus" class="demo-form-status" role="status" aria-live="polite"></p>
            <button id="demoSubmitButton" type="submit" class="demo-cta">Send Demonstration Request</button>
          </form>
        </section>
      </main>
    </div>
  `
}

window.showDemonstrationRequest = function () {
  const form = document.querySelector('#demonstrationRequestForm')
  if (!form) return
  form.hidden = false
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  document.querySelector('#demoFullName')?.focus()
}

window.hideDemonstrationRequest = function () {
  const form = document.querySelector('#demonstrationRequestForm')
  if (form) form.hidden = true
}

window.submitDemonstrationRequest = async function () {
  const form = document.querySelector('#demonstrationRequestForm')
  const status = document.querySelector('#demoFormStatus')
  const button = document.querySelector('#demoSubmitButton')
  if (!form?.reportValidity() || !status || !button) return
  button.disabled = true
  button.textContent = 'Sending...'
  status.className = 'demo-form-status'
  status.textContent = ''
  try {
    const response = await fetch(`${API_BASE}/public/demonstration-request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: document.querySelector('#demoFullName')?.value,
        company: document.querySelector('#demoCompany')?.value,
        email: document.querySelector('#demoEmail')?.value,
        phone: document.querySelector('#demoPhone')?.value,
        interest: document.querySelector('#demoInterest')?.value,
        contact_method: document.querySelector('#demoContactMethod')?.value,
        message: document.querySelector('#demoMessage')?.value,
        website: document.querySelector('#demoWebsite')?.value,
        consent: document.querySelector('#demoConsent')?.checked === true
      })
    })
    const result = await readApiResponse(response)
    if (!response.ok) throw new Error(result.error || 'Your request could not be sent.')
    form.reset()
    status.className = 'demo-form-status success'
    status.textContent = result.message
  } catch (err) {
    status.className = 'demo-form-status error'
    status.textContent = err.message
  } finally {
    button.disabled = false
    button.textContent = 'Send Demonstration Request'
  }
}

window.loginUser = async function () {
  const username = document.querySelector('#loginUsername')?.value || ''
  const password = document.querySelector('#loginPassword')?.value || ''

  let response

  try {
    response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
  } catch (err) {
    renderLogin('Cannot connect to the ATEC backend. Please check that the backend is running.')
    return
  }

  const result = await readApiResponse(response)

  if (!response.ok) {
    renderLogin(result.error || 'Login failed')
    return
  }

  currentUser = result.user
  window.currentUser = currentUser
  setCurrentPage(currentUser.role === 'CUSTOMER' ? 'portal' : 'dashboard')
  await loadData()
}

window.logoutUser = async function () {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST' })
  currentUser = null
  window.currentUser = null
  stopSessionChecks()
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

function userSitesForCustomer(clientid, selectedSiteId = '') {
  if (!clientid) return []

  return getUserManagementLookups().sites
    .filter(site =>
      String(site.clientid) === String(clientid) &&
      (
        !(site?.archived === true || site?.archived === 'true') ||
        String(site.siteid) === String(selectedSiteId || '')
      )
    )
    .sort((left, right) => String(left.sitename || '').localeCompare(String(right.sitename || '')))
}

function renderCustomerUserSiteOptions(clientid, selectedSiteId = '') {
  const emptyLabel = clientid ? 'No site selected' : 'Select customer first'
  return renderUserLookupOptions(
    userSitesForCustomer(clientid, selectedSiteId),
    'siteid',
    'sitename',
    selectedSiteId,
    emptyLabel
  )
}

window.filterCustomerUserSites = function (userId = '') {
  const isCreateForm = userId === '' || userId === null || userId === undefined
  const clientSelect = document.querySelector(isCreateForm ? '#newUserClientId' : `#user-client-${userId}`)
  const siteSelect = document.querySelector(isCreateForm ? '#newUserSiteId' : `#user-site-${userId}`)
  if (!clientSelect || !siteSelect) return

  siteSelect.innerHTML = renderCustomerUserSiteOptions(clientSelect.value)
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

const internalUserRoles = ['ADMIN', 'MANAGER', 'INSPECTOR', 'ASSISTANT', 'HR', 'VIEWER']
const customerUserRoles = ['CUSTOMER']

function canManageInternalUsers() {
  return currentUser?.role === 'ADMIN'
}

function canManageCustomerPortalUsers() {
  return ['ADMIN', 'MANAGER'].includes(currentUser?.role)
}

function getUserManagementMode() {
  if (!canManageInternalUsers()) return 'customers'

  const mode = localStorage.getItem('userManagementMode') || 'internal'
  return mode === 'customers' ? 'customers' : 'internal'
}

function userRolesForManagementMode(mode) {
  return mode === 'customers' ? customerUserRoles : internalUserRoles
}

function userBelongsToManagementMode(user, mode) {
  return mode === 'customers'
    ? user.role === 'CUSTOMER'
    : user.role !== 'CUSTOMER'
}

function getUserStatusFilter(mode = getUserManagementMode()) {
  const savedFilter = localStorage.getItem(`userStatusFilter:${mode}`) || 'both'
  return ['active', 'inactive'].includes(savedFilter) ? savedFilter : 'both'
}

function userMatchesStatusFilter(user, statusFilter) {
  if (statusFilter === 'both') return true

  const isActive = Boolean(user.is_active)
  return statusFilter === 'active' ? isActive : !isActive
}

window.setUserStatusFilter = function (statusFilter) {
  if (!['both', 'active', 'inactive'].includes(statusFilter)) return

  localStorage.setItem(`userStatusFilter:${getUserManagementMode()}`, statusFilter)
  showUserManagement()
}

window.showInternalUserManagement = function () {
  if (!canManageInternalUsers()) {
    localStorage.setItem('userManagementMode', 'customers')
    showUserManagement()
    return
  }

  localStorage.setItem('userManagementMode', 'internal')
  showUserManagement()
}

window.showCustomerUserManagement = function () {
  if (!canManageCustomerPortalUsers()) {
    showAccessDenied()
    return
  }

  localStorage.setItem('userManagementMode', 'customers')
  showUserManagement()
}

window.syncCustomerUsernameWithEmail = function () {
  if (getUserManagementMode() !== 'customers') return

  const emailInput = document.querySelector('#newUserEmail')
  const usernameInput = document.querySelector('#newUserUsername')

  if (emailInput && usernameInput) {
    usernameInput.value = emailInput.value.trim()
  }
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

  setCurrentPage('users')

  document.querySelector('#page').innerHTML = `
    <div class="user-management-page">
      <h1>${getUserManagementMode() === 'customers' ? 'Customer Portal Users' : 'ATEC Users'}</h1>
      <div class="filter-card">
        <p>Loading users...</p>
      </div>
    </div>
  `

  let response
  let userCustomers
  let userSites

  try {
    [response, userCustomers, userSites] = await Promise.all([
      fetch(`${API_BASE}/users`),
      fetchJsonOrDefault(`${API_BASE}/customers`, []),
      fetchJsonOrDefault(`${API_BASE}/sites`, [])
    ])
  } catch (err) {
    document.querySelector('#page').innerHTML = `
      <div class="user-management-page">
        <h1>Customer Portal Users</h1>
        <div class="filter-card">
          <h2>Unable to load users</h2>
          <p>Could not connect to the server. Please try again.</p>
          <button type="button" onclick="showCustomerUserManagement()">Try Again</button>
        </div>
      </div>
    `
    return
  }

  const users = await readApiResponse(response)

  if (!response.ok) {
    document.querySelector('#page').innerHTML = `
      <div class="user-management-page">
        <h1>Customer Portal Users</h1>
        <div class="filter-card">
          <h2>Unable to load users</h2>
          <p>${escapeHtml(users.error || 'You do not have permission to load customer portal users.')}</p>
          <button type="button" onclick="showCustomerUserManagement()">Try Again</button>
        </div>
      </div>
    `
    return
  }

  window.userManagementLookups = {
    customers: userCustomers,
    sites: userSites
  }

  const managementMode = getUserManagementMode()
  localStorage.setItem('userManagementMode', managementMode)
  const modeRoles = userRolesForManagementMode(managementMode)
  const statusFilter = getUserStatusFilter(managementMode)
  const modeUsers = users.filter(user => userBelongsToManagementMode(user, managementMode))
  const filteredUsers = modeUsers.filter(user => userMatchesStatusFilter(user, statusFilter))
  const sortedUsers = sortUserManagementRows(filteredUsers)
  const modeTitle = managementMode === 'customers' ? 'Customer Portal Users' : 'ATEC Users'
  const createTitle = managementMode === 'customers' ? 'Create Customer Portal User' : 'Create ATEC User'
  const createNote = managementMode === 'customers'
    ? 'Customer login username is always the email address. Customer portal users are linked to the customer and site, not to one section.'
    : 'Create ATEC staff login accounts here. Customer login accounts are managed separately under Customer Portal Users.'
  const pageNote = managementMode === 'customers'
    ? 'This is where Kenny Naidoo and other customer logins will appear after you create them. Responsible Persons remain separate contact records.'
    : 'This list is only for ATEC admins, managers, inspectors, and viewers.'

  document.querySelector('#page').innerHTML = `
    <div class="user-management-page">
    <h1>${modeTitle}</h1>
    <p class="page-subtitle">${pageNote}</p>

    <div class="filter-card user-management-mode-tabs">
      ${canManageInternalUsers() ? `
        <button
          type="button"
          class="${managementMode === 'internal' ? 'active' : ''}"
          onclick="showInternalUserManagement()"
        >
          ATEC Users
        </button>
      ` : ''}
      <button
        type="button"
        class="${managementMode === 'customers' ? 'active' : ''}"
        onclick="showCustomerUserManagement()"
      >
        Customer Portal Users
      </button>
    </div>

    <div class="filter-card user-create-card">
      <h2>${createTitle}</h2>
      <p>${createNote}</p>
      <div class="asset-form-grid">
        <div class="form-group">
          <label>${managementMode === 'customers' ? 'Username (uses email)' : 'Username'}</label>
          <input
            id="newUserUsername"
            type="text"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            ${managementMode === 'customers' ? 'readonly placeholder="Filled from email address"' : ''}
          >
        </div>
        <div class="form-group">
          <label>Email</label>
          <input id="newUserEmail" type="email" ${managementMode === 'customers' ? 'oninput="syncCustomerUsernameWithEmail()"' : ''}>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input id="newUserPassword" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true">
        </div>
        <div class="form-group">
          <label>Full Name</label>
          <input id="newUserFullName" type="text">
        </div>
        <div class="form-group">
          <label>Role</label>
          <select id="newUserRole">
            ${modeRoles.map(role => `<option value="${role}">${role}</option>`).join('')}
          </select>
        </div>
        ${managementMode === 'internal' ? `
          <div class="form-group">
            <label>LMI Number</label>
            <input id="newUserLmi" type="text">
          </div>
          <div class="form-group">
            <label>Employee Number</label>
            <input id="newUserEmployeeNumber" type="text">
          </div>
          <div class="form-group">
            <label>Approving Manager</label>
            <select id="newUserManager"><option value="">Not assigned</option>${users.filter(user => ['ADMIN','MANAGER'].includes(user.role)).map(user => `<option value="${safeAttr(user.user_id)}">${escapeHtml(user.full_name)}</option>`).join('')}</select>
          </div>
        ` : ''}
        ${managementMode === 'customers' ? `
          <div class="form-group">
            <label>Customer Name</label>
            <select id="newUserClientId" onchange="filterCustomerUserSites()">
              ${renderUserLookupOptions(userCustomers, "clientid", "clientname", "", "No customer selected")}
            </select>
          </div>
          <div class="form-group">
            <label>Site Name</label>
            <select id="newUserSiteId">
              ${renderCustomerUserSiteOptions("")}
            </select>
          </div>
        ` : ''}
      </div>
      <button id="createUserButton" type="button" onclick="createUser()">Create User</button>
    </div>

    <div class="filter-card user-signature-card">
      <div class="user-signature-copy">
        <h2>My Signature</h2>
        <p>Upload your inspector signature for new inspections saved under your login.</p>
      </div>
      <div class="user-signature-controls">
        <input id="mySignatureUpload" type="file" accept="image/*">
        <button onclick="uploadMySignature()">Upload Signature</button>
      </div>
    </div>

    <div class="user-management-table-wrap">
    <div class="user-list-toolbar">
      <p><strong>${sortedUsers.length}</strong> of <strong>${modeUsers.length}</strong> ${managementMode === 'customers' ? 'customer portal user(s)' : 'ATEC user(s)'} shown.</p>
      <div class="user-status-filter" role="group" aria-label="Filter users by active status">
        <span>Status:</span>
        ${[
          ['both', 'Both'],
          ['active', 'Active'],
          ['inactive', 'Inactive']
        ].map(([value, label]) => `
          <button
            type="button"
            class="${statusFilter === value ? 'active' : ''}"
            onclick="setUserStatusFilter('${value}')"
            aria-pressed="${statusFilter === value}"
          >${label}</button>
        `).join('')}
      </div>
    </div>
    <table class="user-management-table ${managementMode === 'customers' ? 'customer-users-table' : 'internal-users-table'}">
      <thead>
        <tr>
          <th>${userSortHeader('User', 'username')}</th>
          <th>${userSortHeader('Email', 'email')}</th>
          <th>${userSortHeader('Full Name', 'full_name')}</th>
          <th>${userSortHeader('Role', 'role')}</th>
          ${managementMode === 'internal' ? `<th>${userSortHeader('LMI Number', 'lmi_number')}</th><th>Employee No.</th><th>Manager</th>` : ''}
          ${managementMode === 'customers' ? `
            <th>${userSortHeader('Customer Name', 'clientid')}</th>
            <th>${userSortHeader('Site Name', 'siteid')}</th>
          ` : ''}
          <th>${userSortHeader('Active', 'is_active')}</th>
          <th>${userSortHeader('Signature', 'signature_image')}</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${sortedUsers.length ? sortedUsers.map(user => `
          <tr class="${user.is_active ? '' : 'inactive-user-row'}">
            <td class="user-name-cell">${escapeHtml(user.username)}</td>
            <td><input id="user-email-${safeAttr(user.user_id)}" value="${safeAttr(user.email || '')}"></td>
            <td><input id="user-name-${safeAttr(user.user_id)}" value="${safeAttr(user.full_name || '')}"></td>
            <td>
              <select id="user-role-${user.user_id}">
                ${modeRoles.map(role => `
                  <option value="${role}" ${role === user.role ? 'selected' : ''}>${role}</option>
                `).join('')}
              </select>
            </td>
            ${managementMode === 'internal' ? `<td><input id="user-lmi-${safeAttr(user.user_id)}" value="${safeAttr(user.lmi_number || '')}"></td><td><input id="user-employee-${safeAttr(user.user_id)}" value="${safeAttr(user.employee_number || '')}"></td><td><select id="user-manager-${safeAttr(user.user_id)}"><option value="">Not assigned</option>${users.filter(manager => ['ADMIN','MANAGER'].includes(manager.role) && String(manager.user_id) !== String(user.user_id)).map(manager => `<option value="${safeAttr(manager.user_id)}" ${String(manager.user_id) === String(user.manager_user_id || '') ? 'selected' : ''}>${escapeHtml(manager.full_name)}</option>`).join('')}</select></td>` : ''}
            ${managementMode === 'customers' ? `
              <td>
                <select id="user-client-${user.user_id}" onchange="filterCustomerUserSites(${user.user_id})">
                  ${renderUserLookupOptions(userCustomers, "clientid", "clientname", user.clientid, "No customer selected")}
                </select>
              </td>
              <td>
                <select id="user-site-${user.user_id}">
                  ${renderCustomerUserSiteOptions(user.clientid, user.siteid)}
                </select>
              </td>
            ` : ''}
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
              <div class="user-row-action-buttons">
                <button onclick="saveUser(${user.user_id})">Save</button>
                <button class="secondary-small-btn" onclick="resetUserPassword(${user.user_id})">Reset Password</button>
                ${user.is_active ? '' : `<button class="secondary-small-btn" onclick="deleteUser(${user.user_id})">Delete Permanently</button>`}
              </div>
            </td>
          </tr>
        `).join('') : `
          <tr>
            <td class="user-list-empty" colspan="${managementMode === 'internal' ? 8 : 9}">
              No ${statusFilter === 'both' ? '' : `${statusFilter} `}${managementMode === 'customers' ? 'customer portal users' : 'ATEC users'} found.
            </td>
          </tr>
        `}
      </tbody>
    </table>
    </div>
    </div>
  `
}

window.createUser = async function () {
  const createButton = document.querySelector('#createUserButton')
  if (createButton?.disabled) return

  const managementMode = getUserManagementMode()
  const role = managementMode === 'customers'
    ? 'CUSTOMER'
    : document.querySelector('#newUserRole').value
  const clientid = managementMode === 'customers'
    ? document.querySelector('#newUserClientId').value
    : null
  const email = document.querySelector('#newUserEmail').value.trim()
  const username = managementMode === 'customers'
    ? email
    : document.querySelector('#newUserUsername').value

  if (managementMode === 'customers' && !clientid) {
    alert('Please link this customer portal user to a customer.')
    return
  }

  if (managementMode === 'customers' && !email) {
    alert('Please enter the customer portal user email address.')
    return
  }

  if (createButton) {
    createButton.disabled = true
    createButton.textContent = 'Creating...'
  }

  try {
    const response = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        password: document.querySelector('#newUserPassword').value,
        full_name: document.querySelector('#newUserFullName').value,
        role,
        lmi_number: managementMode === 'internal'
          ? document.querySelector('#newUserLmi')?.value || null
          : null,
        employee_number: managementMode === 'internal'
          ? document.querySelector('#newUserEmployeeNumber')?.value || ''
          : '',
        manager_user_id: managementMode === 'internal'
          ? document.querySelector('#newUserManager')?.value || null
          : null,
        clientid,
        siteid: managementMode === 'customers'
          ? document.querySelector('#newUserSiteId').value
          : null,
        sectionid: null
      })
    })
    const result = await readApiResponse(response)

    if (!response.ok) {
      alert(result.error || 'Unable to create user')
      return
    }

    alert(managementMode === 'customers'
      ? 'Customer portal user created successfully'
      : 'ATEC user created successfully')
    await showUserManagement()
  } catch (err) {
    alert('Could not connect to the server. Please try again.')
  } finally {
    if (createButton?.isConnected) {
      createButton.disabled = false
      createButton.textContent = 'Create User'
    }
  }
}

window.saveUser = async function (userId) {
  if (!userId || userId === 'null') {
    alert('This user record is missing an account ID. The list will refresh now.')
    showUserManagement()
    return
  }

  const managementMode = getUserManagementMode()

  const response = await fetch(`${API_BASE}/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: document.querySelector(`#user-email-${userId}`).value,
      full_name: document.querySelector(`#user-name-${userId}`).value,
      role: document.querySelector(`#user-role-${userId}`).value,
      lmi_number: managementMode === 'internal'
        ? document.querySelector(`#user-lmi-${userId}`)?.value || null
        : null,
      employee_number: managementMode === 'internal'
        ? document.querySelector(`#user-employee-${userId}`)?.value || ''
        : '',
      manager_user_id: managementMode === 'internal'
        ? document.querySelector(`#user-manager-${userId}`)?.value || null
        : null,
      clientid: managementMode === 'customers'
        ? document.querySelector(`#user-client-${userId}`).value
        : null,
      siteid: managementMode === 'customers'
        ? document.querySelector(`#user-site-${userId}`).value
        : null,
      sectionid: null,
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
  if (!confirm('Permanently delete this inactive user? This is allowed only when the account has no linked history and cannot be undone.')) return

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

  setCurrentPage('profile')

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
    throw new Error(errorBody.error || `Unable to load ${url}`, {
      cause: { url, status: response.status }
    })
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

function renderStartupError(message, details = {}) {
  const requestedUrl = details.url || ''
  const statusText = details.status ? `Status ${details.status}` : ''
  const detailText = [statusText, requestedUrl].filter(Boolean).join(' - ')

  document.querySelector('#app').innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <img src="${assetUrl('logo.jpg')}" alt="ATEC Logo" class="login-logo">
        <h1>ATEC could not finish loading</h1>
        <p>${message}</p>
        ${detailText ? `<p><strong>${escapeHtml(detailText)}</strong></p>` : ''}
        <button type="button" onclick="location.reload()">Reload</button>
      </div>
    </div>
  `
}

async function loadData() {
  startFrontendUpdateChecks()

  const startupNfcToken = String(new URLSearchParams(window.location.search || '').get('nfc') || '').trim()
  if (/^nfc_[A-Za-z0-9_-]{32,64}$/.test(startupNfcToken)) {
    window.location.replace(`${API_BASE}/public/nfc/${encodeURIComponent(startupNfcToken)}`)
    return
  }

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
  startSessionChecks()

  assets = []

  if (currentUser.role === 'CUSTOMER') {
    customers = []
    sites = []
    responsiblePersons = []
    sections = []
    equipmentTypes = []
    dashboardStats = {}
    criteria = []
    window.atecCriteria = []
  } else {

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
    renderStartupError(
      err.message || "The app could not load its startup data.",
      err.cause || {}
    )
    return
  }
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
    ${currentUser.role === 'ADMIN' ? '<label class="sidebar-search"><span>Find a page</span><input type="search" placeholder="Search menu..." oninput="filterSidebarMenu(this.value)"></label>' : ''}
    ${renderRoleMenu()}
    <button class="sidebar-logout" onclick="logoutUser()">Logout</button>
    </div>

  </div>

  <div class="content">
    <div id="page"></div>
  </div>

</div>

</div>

  `

  installPageScrollControls()

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

  setCurrentPage("dashboard")

  renderDashboard(
    customers,
    assets,
    sites,
    equipmentTypes,
    dashboardStats
  )

  loadDashboardSummary()
}

window.rememberSidebarGroup = function (details) {
  if (!details.open) return
  localStorage.setItem(`sidebarGroup:${currentUser?.role || ''}`,details.dataset.menuGroup || '')
  document.querySelectorAll('.sidebar-menu-group[open]').forEach(group => {
    if (group !== details) group.removeAttribute('open')
  })
}

window.filterSidebarMenu = function (value) {
  const query = String(value || '').trim().toLowerCase()
  let firstMatchingGroup = null
  document.querySelectorAll('.sidebar-menu-group').forEach(group => {
    let matches = 0
    group.querySelectorAll('.sidebar-nav-button').forEach(button => {
      const visible = !query || button.dataset.menuLabel.includes(query)
      button.hidden = !visible
      if (visible) matches += 1
    })
    group.hidden = matches === 0
    if (query && matches && !firstMatchingGroup) firstMatchingGroup = group
  })
  if (query && firstMatchingGroup) firstMatchingGroup.setAttribute('open','')
}

window.showMyDay = function () { setCurrentPage('my-day'); return renderMyDay() }
window.addWorkforceTime = addWorkforceTime
window.editMyTimeEntry = editMyTimeEntry
window.deleteMyTimeEntry = deleteMyTimeEntry
window.submitMyDay = submitMyDay
window.showTimesheetApprovals = function () { setCurrentPage('timesheet-approvals'); return renderTimesheetApprovals() }
window.workforceAction = workforceAction
window.approveCorrectedTimesheet = approveCorrectedTimesheet
window.editEmployeeTimes = editEmployeeTimes
window.saveEmployeeTimeEdit = saveEmployeeTimeEdit
window.deleteEmployeeTimeEntry = deleteEmployeeTimeEntry
window.closeEmployeeTimeEditor = closeEmployeeTimeEditor
window.showTimesheetHistory = function () { setCurrentPage('timesheet-history'); return renderTimesheetHistory() }
window.loadTimesheetHistory = loadTimesheetHistory
window.exportTimesheetHistoryCsv = exportTimesheetHistoryCsv
window.exportPayrollExcel = exportPayrollExcel
window.setAllPayrollEmployees = setAllPayrollEmployees
window.setPayrollPeriod = setPayrollPeriod
window.showHrTimesheets = function () { setCurrentPage('hr-timesheets'); return renderHrTimesheets() }
window.showWorkSchedules = function () { setCurrentPage('work-schedules'); return renderWorkSchedules() }
window.updateScheduleHours = updateScheduleHours
window.loadWorkSchedule = loadWorkSchedule
window.saveWorkSchedule = saveWorkSchedule

window.showCustomerPortal = function () {
  if (!ensurePageAccess('portal')) return

  setCurrentPage("portal")
  renderCustomerPortal(currentUser)
}

let customerArchiveMode = localStorage.getItem("customerArchiveMode") || "active"

window.showCustomerSetup = function (mode = customerArchiveMode) {
  if (!ensurePageAccess('customers')) return

  customerArchiveMode = mode

  setCurrentPage("customers")
  localStorage.setItem("customerArchiveMode", mode)

  renderCustomerSetup(customers, customerArchiveMode)

}

function loadGoogleMaps() {
  if (!GOOGLE_MAPS_API_KEY) return Promise.resolve(null)
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google)
  if (googleMapsLoader) return googleMapsLoader

  googleMapsLoader = new Promise((resolve, reject) => {
    const callbackName = `initAtecGoogleMaps${Date.now()}`
    window[callbackName] = () => {
      delete window[callbackName]
      resolve(window.google)
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&v=weekly&loading=async&libraries=places&callback=${callbackName}`
    script.async = true
    script.onerror = () => reject(new Error('Google Maps could not be loaded'))
    document.head.appendChild(script)
  })

  return googleMapsLoader
}

function renderCustomerForm(customer = null) {
  const isEditing = Boolean(customer)
  const notificationLeadDays = Number(customer?.notification_lead_days ?? 30)

  document.querySelector('#page').innerHTML = `
    <div class="customer-form-page">
      <div class="customer-form-heading">
        <div>
          <h2>${isEditing ? 'Edit Customer' : 'Create Customer'}</h2>
          <p>${isEditing ? 'Update the customer name or registered address.' : 'Add the customer and their registered or head-office address.'}</p>
        </div>
        <button class="secondary-button" type="button" onclick="showCustomerSetup()">Back</button>
      </div>

      <form class="customer-form" onsubmit="saveCustomer(event, ${customer?.clientid || 'null'})">
        <div class="form-group customer-name-field">
          <label for="customerName">Customer name</label>
          <input id="customerName" type="text" value="${safeAttr(customer?.clientname || '')}" required autofocus autocomplete="organization">
        </div>

        <div class="form-group customer-address-field">
          <label for="customerAddress">Registered or head-office address</label>
          <div id="customerAddressSearch">
            <input id="customerAddressManual" type="text" value="${safeAttr(customer?.clientaddr || '')}" placeholder="Start typing a street address or business name" autocomplete="street-address" required aria-required="true" oninput="syncCustomerAddress(this.value)">
          </div>
          <input id="customerAddress" type="hidden" value="${safeAttr(customer?.clientaddr || '')}">
          <p id="customerAddressStatus" class="field-note">${GOOGLE_MAPS_API_KEY ? 'Choose a suggestion to confirm the location, or enter the address manually.' : 'Enter the complete address manually. Address search will activate when the Google Maps key is configured.'}</p>
        </div>

        <div id="customerAddressMap" class="customer-address-map" ${GOOGLE_MAPS_API_KEY ? '' : 'hidden'} aria-label="Selected customer address map"></div>

        <fieldset class="customer-notification-preferences">
          <legend>Notification Preferences</legend>
          <div class="customer-notification-grid">
            <label>
              <input
                id="notifyExpiringCertificates"
                type="checkbox"
                ${customer?.notify_expiring_certificates === false ? '' : 'checked'}
              >
              Certificate expiry reminders
            </label>
            <label>
              <input
                id="notifyOverdueAssets"
                type="checkbox"
                ${customer?.notify_overdue_assets === false ? '' : 'checked'}
              >
              Overdue asset reminders
            </label>
            <label>
              <input
                id="notifyFailedAssets"
                type="checkbox"
                ${customer?.notify_failed_assets === false ? '' : 'checked'}
              >
              Failed asset alerts
            </label>
            <label>
              <input
                id="notifyVisitExceptions"
                type="checkbox"
                ${customer?.notify_visit_exceptions === false ? '' : 'checked'}
              >
              Visit exception alerts
            </label>
          </div>
          <div class="form-group customer-notification-days">
            <label for="notificationLeadDays">Expiry reminder days</label>
            <input id="notificationLeadDays" type="number" min="0" max="365" value="${safeAttr(Number.isFinite(notificationLeadDays) ? notificationLeadDays : 30)}">
          </div>
        </fieldset>

        <p id="customerFormError" class="login-error" hidden></p>

        <div class="form-actions">
          <button id="saveCustomerButton" type="submit">${isEditing ? 'Save Changes' : 'Create Customer'}</button>
          <button class="secondary-button" type="button" onclick="showCustomerSetup()">Cancel</button>
        </div>
      </form>
    </div>
  `

  initializeCustomerAddressSearch(customer?.clientaddr || '')
}

async function initializeCustomerAddressSearch(existingAddress) {
  if (!GOOGLE_MAPS_API_KEY) return

  const addressInput = document.querySelector('#customerAddress')
  const manualInput = document.querySelector('#customerAddressManual')
  const searchContainer = document.querySelector('#customerAddressSearch')
  const mapElement = document.querySelector('#customerAddressMap')
  const status = document.querySelector('#customerAddressStatus')

  try {
    const google = await loadGoogleMaps()
    if (!addressInput || !manualInput || !searchContainer || !mapElement || !google) return

    const { PlaceAutocompleteElement } = await google.maps.importLibrary('places')

    const defaultLocation = { lat: -26.2041, lng: 28.0473 }
    const map = new google.maps.Map(mapElement, {
      center: defaultLocation,
      zoom: 10,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    })
    const locationIndicator = new google.maps.Circle({
      map,
      radius: 24,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: '#2563eb',
      fillOpacity: 1,
      visible: false
    })
    const placeAutocomplete = new PlaceAutocompleteElement()
    placeAutocomplete.id = 'customerAddressAutocomplete'
    placeAutocomplete.placeholder = 'Start typing a street address or business name'
    placeAutocomplete.setAttribute('required', '')
    placeAutocomplete.setAttribute('aria-required', 'true')
    placeAutocomplete.includedRegionCodes = ['za']
    if (existingAddress) placeAutocomplete.value = existingAddress
    searchContainer.prepend(placeAutocomplete)
    manualInput.hidden = true
    manualInput.required = false

    placeAutocomplete.addEventListener('input', () => {
      addressInput.value = placeAutocomplete.value || ''
    })

    placeAutocomplete.addEventListener('gmp-select', async ({ placePrediction }) => {
      const place = placePrediction.toPlace()
      await place.fetchFields({ fields: ['formattedAddress', 'location'] })

      if (!place.location) {
        status.textContent = 'No exact location was found. You can refine the address or keep it as entered.'
        return
      }

      addressInput.value = place.formattedAddress || placeAutocomplete.value || ''
      placeAutocomplete.value = addressInput.value
      map.setCenter(place.location)
      map.setZoom(16)
      locationIndicator.setCenter(place.location)
      locationIndicator.setVisible(true)
      status.textContent = 'Address confirmed from Google Maps.'
    })
  } catch (err) {
    mapElement.hidden = true
    if (manualInput) {
      manualInput.hidden = false
      manualInput.required = true
    }
    status.textContent = 'Address search is unavailable right now. You can still enter the address manually.'
  }
}

window.syncCustomerAddress = function (value) {
  const addressInput = document.querySelector('#customerAddress')
  if (addressInput) addressInput.value = value
}

function currentAddressReviewCustomer() {
  return addressReviewQueue[addressReviewPosition] || null
}

function renderAddressReview() {
  const customer = currentAddressReviewCustomer()

  if (!customer) {
    document.querySelector('#page').innerHTML = `
      <div class="address-review-complete">
        <h2>Address Review Complete</h2>
        <p>You have reached the end of this review list.</p>
        <button type="button" onclick="showCustomerSetup()">Return to Customer Setup</button>
      </div>
    `
    return
  }

  addressReviewResults = []
  const remaining = addressReviewQueue.length - addressReviewPosition

  document.querySelector('#page').innerHTML = `
    <div class="address-review-page">
      <div class="customer-form-heading">
        <div>
          <h2>Find Missing Addresses</h2>
          <p>Reviewing ${addressReviewPosition + 1} of ${addressReviewQueue.length}. ${remaining} customer${remaining === 1 ? '' : 's'} remaining in this pass.</p>
        </div>
        <button class="secondary-button" type="button" onclick="showCustomerSetup()">Close</button>
      </div>

      <div class="address-review-customer">
        <span>Customer</span>
        <strong>${escapeHtml(customer.clientname || `Customer ${customer.clientid}`)}</strong>
        <small>Client ID ${escapeHtml(customer.clientid)}</small>
      </div>

      <div class="address-review-search">
        <div class="form-group">
          <label for="addressReviewQuery">Google search</label>
          <input id="addressReviewQuery" type="text" value="${safeAttr(`${customer.clientname || ''} South Africa`)}" onkeydown="if (event.key === 'Enter') { event.preventDefault(); searchAddressReview() }">
        </div>
        <button id="addressReviewSearchButton" type="button" onclick="searchAddressReview()">Search</button>
      </div>

      <p id="addressReviewMessage" class="field-note">Search by company name, then choose the correct branch or office.</p>
      <div id="addressReviewResults" class="address-review-results"></div>
      <div id="addressReviewMap" class="customer-address-map" hidden aria-label="Address result map"></div>

      <div class="form-actions address-review-footer">
        <button id="autoFillSingleAddressesButton" type="button" onclick="autoFillSingleCustomerAddresses()">Auto-fill Single Matches</button>
        <button class="secondary-button" type="button" onclick="skipAddressReviewCustomer()">Skip for Now</button>
        <button class="secondary-button" type="button" onclick="editClient(${customer.clientid})">Enter Manually</button>
      </div>
    </div>
  `

  window.searchAddressReview()
}

window.reviewMissingCustomerAddresses = function () {
  if (currentUser?.role !== 'ADMIN') {
    alert('Only administrators can review and update missing customer addresses.')
    return
  }

  addressReviewQueue = customers.filter(customer => {
    const isArchived = customer.archived === true || customer.archived === 'true'
    return !isArchived && !String(customer.clientaddr || '').trim()
  })
  addressReviewPosition = 0

  if (!addressReviewQueue.length) {
    alert('All active customers already have an address.')
    return
  }

  renderAddressReview()
}

window.searchAddressReview = async function () {
  const query = document.querySelector('#addressReviewQuery')?.value.trim()
  const resultsElement = document.querySelector('#addressReviewResults')
  const message = document.querySelector('#addressReviewMessage')
  const button = document.querySelector('#addressReviewSearchButton')

  if (!query || !resultsElement || !message || !button) return

  button.disabled = true
  button.textContent = 'Searching...'
  message.textContent = 'Searching Google Places...'
  resultsElement.innerHTML = ''
  document.querySelector('#addressReviewMap').hidden = true

  try {
    const google = await loadGoogleMaps()
    if (!google) throw new Error('Google Maps is not configured')

    const { Place } = await google.maps.importLibrary('places')
    const response = await Place.searchByText({
      textQuery: query,
      fields: ['displayName', 'formattedAddress', 'location', 'businessStatus'],
      language: 'en',
      region: 'za',
      maxResultCount: 5
    })
    addressReviewResults = (response.places || []).filter(place => place.formattedAddress && place.location)

    if (!addressReviewResults.length) {
      message.textContent = 'No suitable matches were found. Refine the search or enter the address manually.'
      return
    }

    message.textContent = `${addressReviewResults.length} possible match${addressReviewResults.length === 1 ? '' : 'es'} found. Check the branch carefully before saving.`
    resultsElement.innerHTML = addressReviewResults.map((place, index) => `
      <div class="address-review-result">
        <button class="address-result-preview" type="button" onclick="previewAddressReviewResult(${index})">
          <strong>${escapeHtml(place.displayName || 'Google Maps result')}</strong>
          <span>${escapeHtml(place.formattedAddress)}</span>
          ${place.businessStatus && place.businessStatus !== 'OPERATIONAL' ? `<small>${escapeHtml(place.businessStatus.replaceAll('_', ' '))}</small>` : ''}
        </button>
        <button type="button" onclick="saveAddressReviewResult(${index})">Use Address</button>
      </div>
    `).join('')

    window.previewAddressReviewResult(0)
  } catch (err) {
    message.textContent = `Address search failed: ${err.message}`
  } finally {
    button.disabled = false
    button.textContent = 'Search'
  }
}

window.previewAddressReviewResult = async function (index) {
  const place = addressReviewResults[index]
  const mapElement = document.querySelector('#addressReviewMap')
  if (!place?.location || !mapElement) return

  const google = await loadGoogleMaps()
  mapElement.hidden = false
  const map = new google.maps.Map(mapElement, {
    center: place.location,
    zoom: 15,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false
  })
  new google.maps.Circle({
    map,
    center: place.location,
    radius: 24,
    strokeColor: '#ffffff',
    strokeOpacity: 1,
    strokeWeight: 3,
    fillColor: '#2563eb',
    fillOpacity: 1
  })

  document.querySelectorAll('.address-result-preview').forEach((element, resultIndex) => {
    element.classList.toggle('selected', resultIndex === index)
  })
}

window.saveAddressReviewResult = async function (index) {
  const customer = currentAddressReviewCustomer()
  const place = addressReviewResults[index]
  const message = document.querySelector('#addressReviewMessage')
  if (!customer || !place?.formattedAddress || !message) return

  message.textContent = 'Saving address...'

  const response = await fetch(`${API_BASE}/customers/${customer.clientid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientname: customer.clientname,
      clientaddr: place.formattedAddress
    })
  })
  const result = await readApiResponse(response)

  if (!response.ok) {
    message.textContent = result.error || 'The address could not be saved.'
    return
  }

  const originalCustomer = customers.find(item => String(item.clientid) === String(customer.clientid))
  if (originalCustomer) originalCustomer.clientaddr = result.clientaddr || place.formattedAddress
  addressReviewPosition += 1
  renderAddressReview()
}

window.skipAddressReviewCustomer = function () {
  addressReviewPosition += 1
  renderAddressReview()
}

function normalizedCompanyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|incorporated|inc|cc|holdings|group|south africa|sa)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isStrongCompanyMatch(customerName, placeName) {
  const customer = normalizedCompanyName(customerName)
  const place = normalizedCompanyName(placeName)
  if (!customer || !place) return false
  if (customer.includes(place) || place.includes(customer)) return true

  const customerTokens = customer.split(' ').filter(token => token.length > 2)
  const placeTokens = new Set(place.split(' ').filter(token => token.length > 2))
  if (!customerTokens.length) return false

  const matchingTokens = customerTokens.filter(token => placeTokens.has(token)).length
  return matchingTokens / customerTokens.length >= 0.75
}

function waitForAddressSearch(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

window.autoFillSingleCustomerAddresses = async function () {
  if (currentUser?.role !== 'ADMIN') {
    alert('Only administrators can run automatic customer address matching.')
    return
  }

  const button = document.querySelector('#autoFillSingleAddressesButton')
  const message = document.querySelector('#addressReviewMessage')
  if (!button || !message) return

  const missingCustomers = customers.filter(customer => {
    const isArchived = customer.archived === true || customer.archived === 'true'
    return !isArchived && !String(customer.clientaddr || '').trim()
  })
  if (!missingCustomers.length) return

  button.disabled = true
  const google = await loadGoogleMaps()
  const { Place } = await google.maps.importLibrary('places')
  let saved = 0
  let multiple = 0
  let uncertain = 0
  let failed = 0

  for (let index = 0; index < missingCustomers.length; index += 1) {
    const customer = missingCustomers[index]
    message.textContent = `Checking ${index + 1} of ${missingCustomers.length}: ${customer.clientname}`

    try {
      const response = await Place.searchByText({
        textQuery: `${customer.clientname || ''} South Africa`,
        fields: ['displayName', 'formattedAddress', 'location', 'businessStatus'],
        language: 'en',
        region: 'za',
        maxResultCount: 2
      })
      const places = (response.places || []).filter(place => place.formattedAddress && place.location)

      if (places.length > 1) {
        multiple += 1
      } else if (
        places.length !== 1 ||
        places[0].businessStatus === 'CLOSED_PERMANENTLY' ||
        !isStrongCompanyMatch(customer.clientname, places[0].displayName)
      ) {
        uncertain += 1
      } else {
        const updateResponse = await fetch(`${API_BASE}/customers/${customer.clientid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientname: customer.clientname,
            clientaddr: places[0].formattedAddress
          })
        })
        const result = await readApiResponse(updateResponse)
        if (!updateResponse.ok) throw new Error(result.error || 'Address update failed')

        customer.clientaddr = result.clientaddr || places[0].formattedAddress
        saved += 1
      }
    } catch (err) {
      failed += 1
    }

    await waitForAddressSearch(250)
  }

  addressReviewQueue = customers.filter(customer => {
    const isArchived = customer.archived === true || customer.archived === 'true'
    return !isArchived && !String(customer.clientaddr || '').trim()
  })
  addressReviewPosition = 0
  renderAddressReview()
  alert(
    `Automatic address pass complete.\n\n` +
    `${saved} single strong matches saved.\n` +
    `${multiple} customers have multiple matches.\n` +
    `${uncertain} customers had no result or an uncertain name match.\n` +
    `${failed} searches or updates failed.\n\n` +
    `The remaining customers are ready for manual review.`
  )
}

window.addClient = function () {
  renderCustomerForm()
}

window.editClient = function (clientid) {
  const customer = customers.find(c => String(c.clientid) === String(clientid))

  if (!customer) {
    alert('Customer not found')
    return
  }

  renderCustomerForm(customer)
}

window.saveCustomer = async function (event, clientid) {
  event.preventDefault()

  const clientname = document.querySelector('#customerName')?.value.trim() || ''
  const clientaddr = document.querySelector('#customerAddress')?.value.trim() || ''
  const notificationLeadDays = Math.max(0, Number(document.querySelector('#notificationLeadDays')?.value || 30) || 30)
  const saveButton = document.querySelector('#saveCustomerButton')
  const errorElement = document.querySelector('#customerFormError')

  if (!clientname || !clientaddr) {
    errorElement.textContent = 'Customer name and registered or head-office address are required.'
    errorElement.hidden = false
    return
  }

  saveButton.disabled = true
  saveButton.textContent = 'Saving...'
  errorElement.hidden = true

  try {
    const response = await fetch(clientid ? `${API_BASE}/customers/${clientid}` : `${API_BASE}/customers`, {
      method: clientid ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientname,
        clientaddr,
        notify_expiring_certificates: document.querySelector('#notifyExpiringCertificates')?.checked === true,
        notify_overdue_assets: document.querySelector('#notifyOverdueAssets')?.checked === true,
        notify_failed_assets: document.querySelector('#notifyFailedAssets')?.checked === true,
        notify_visit_exceptions: document.querySelector('#notifyVisitExceptions')?.checked === true,
        notification_lead_days: notificationLeadDays
      })
    })
    const result = await readApiResponse(response)

    if (!response.ok) throw new Error(result.error || 'The customer could not be saved')

    await loadData()
    window.showCustomerSetup()
  } catch (err) {
    errorElement.textContent = err.message
    errorElement.hidden = false
    saveButton.disabled = false
    saveButton.textContent = clientid ? 'Save Changes' : 'Create Customer'
  }
}

window.saveClientChanges = function (clientid) {
  const form = document.querySelector('.customer-form')
  if (form) window.saveCustomer(new Event('submit', { cancelable: true }), clientid)
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

function activeRecords(rows) {
  return rows.filter(row => !(row.archived === true || row.archived === "true"))
}

function uniqueResponsiblePeopleForClient(clientid, selectedPersonId = '') {
  const seen = new Set()

  return responsiblePersons
    .filter(person =>
      String(person.clientid) === String(clientid) &&
      (
        !(person.archived === true || person.archived === "true") ||
        String(person.personid) === String(selectedPersonId)
      )
    )
    .filter(person => {
      const key = String(person.personid)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

function responsibleCustomerOptions(selectedClientId = '') {
  return [...customers]
    .sort((a, b) => (a.clientname || '').localeCompare(b.clientname || ''))
    .map(client => `
      <option value="${safeAttr(client.clientid)}" ${String(client.clientid) === String(selectedClientId) ? 'selected' : ''}>
        ${escapeHtml(client.clientname)}
      </option>
    `)
    .join('')
}

window.showResponsiblePersons = function (mode = responsibleArchiveMode) {
  if (!ensurePageAccess('responsible')) return

  responsibleArchiveMode = mode
  setCurrentPage("responsible")
  localStorage.setItem("responsibleArchiveMode", mode)
  renderResponsiblePersons(responsiblePersons, responsibleArchiveMode)
}

window.showAddResponsiblePersonForm = function () {
  document.querySelector('#page').innerHTML = `
    <h2>Add Responsible Person</h2>

    <label>Customer</label>
    <select id="responsibleClient">
      <option value="">Select Customer</option>
      ${responsibleCustomerOptions()}
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

    <label>Customer</label>
    <select id="responsibleClient">
      <option value="">Select Customer</option>
      ${responsibleCustomerOptions(person.clientid)}
    </select>

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
  const clientid =
    document.querySelector('#responsibleClient').value

  if (!clientid || !name) {
    alert("Please complete all fields")
    return
  }

  const response = await fetch(
    `${API_BASE}/responsible-persons/${personid}`,
    {
      method: "PUT",

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
      (person.sitename || '').toLowerCase().includes(search) ||
      (person.sectionname || '').toLowerCase().includes(search) ||
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
        <td>${escapeHtml(person.sitename || 'Not assigned')}</td>
        <td>${escapeHtml(person.sectionname || 'Not assigned')}</td>
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
  setCurrentPage("sections")
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

  const filteredResponsiblePersons = uniqueResponsiblePeopleForClient(clientid)

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

  const filteredResponsiblePersons = uniqueResponsiblePeopleForClient(section.clientid, section.responsibleid)

  document.querySelector('#page').innerHTML = `
    <h2>Edit Section</h2>

    <label>Client</label>
    <input type="text" value="${safeAttr(section.clientname || '')}" disabled>

    <label>Site</label>
    <input type="text" value="${safeAttr(section.sitename || '')}" disabled>

    <label>Responsible Person</label>
    <select id="editSectionResponsible">
      <option value="" ${section.responsibleid ? '' : 'selected'}>
        Select Responsible Person
      </option>
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
  setCurrentPage("sites")
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

  setCurrentPage("assets")
  const state = window.assetListState || {}
  window.assetCurrentPage = state.currentPage || window.assetCurrentPage || 1
  window.assetRowsPerPage = state.rowsPerPage || window.assetRowsPerPage || 25

  await loadAssetSetupPage()
}

window.showRiskAssessments = async function () {
  if (!ensurePageAccess('she')) return

  setCurrentPage("she")
  window.canWriteRiskAssessments = ['ADMIN', 'MANAGER', 'INSPECTOR'].includes(currentUser?.role)
  await renderRiskAssessments(assets, window.canWriteRiskAssessments)
}

window.showRiskAssessmentReports = async function () {
  if (!ensurePageAccess('she-reports')) return
  setCurrentPage('she-reports')
  window.canWriteRiskAssessments = ['ADMIN', 'MANAGER', 'INSPECTOR'].includes(currentUser?.role)
  await renderRiskAssessmentReports()
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

window.printRiskAssessments = function () {
  window.print()
}

window.downloadRiskAssessmentPdf = async function (riskid) {
  const response = await fetch(`${API_BASE}/she/risk-assessments/${riskid}.pdf`)
  if (!response.ok) {
    const data = await readApiResponse(response)
    alert(data.error || 'Unable to download this SLAMM')
    return
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ATEC-SLAMM-${riskid}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

window.printRiskAssessment = function (riskid) {
  window.open(`${API_BASE}/she/risk-assessments/${riskid}.pdf?disposition=inline`, '_blank', 'noopener')
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

window.editRiskAssessment = async function (riskid) {
  const risk = (window.riskAssessments || []).find(item => String(item.riskid) === String(riskid))

  if (!risk) return

  if (!document.querySelector('#riskId')) await window.showRiskAssessments()
  if (!document.querySelector('#riskId')) return

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

window.showBulkQrLabelForm = function () {
  if (!['ADMIN', 'MANAGER', 'INSPECTOR'].includes(currentUser?.role)) return

  document.querySelector('#page').innerHTML = `
    <h1>Bulk QR Labels</h1>
    <div class="filter-card">
      <p>Generate print-ready A4 sheets with eight 95 mm × 60 mm asset labels per page.</p>
      <div class="form-row">
        <div class="form-group">
          <label>Customer *</label>
          <select id="bulkQrClient" onchange="bulkQrCustomerChanged()">
            <option value="">Select customer</option>
            ${activeRecords(customers).map(row => `<option value="${safeAttr(row.clientid)}">${escapeHtml(row.clientname || '')}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Site</label>
          <select id="bulkQrSite" onchange="updateBulkQrCount()">
            <option value="">All sites</option>
          </select>
        </div>
        <div class="form-group">
          <label>Equipment Category / Type</label>
          <select id="bulkQrEquipment" onchange="updateBulkQrCount()">
            <option value="">All equipment types</option>
            ${activeRecords(equipmentTypes).slice().sort((a, b) => String(a.description || '').localeCompare(String(b.description || ''))).map(row => `<option value="${safeAttr(row.equiptypeid)}">${escapeHtml(row.description || '')}</option>`).join('')}
          </select>
        </div>
      </div>
      <p id="bulkQrCount">Select a customer to preview the matching active assets.</p>
      <div class="form-actions">
        <button type="button" onclick="downloadBulkQrLabels()">Generate Bulk Label PDF</button>
        <button type="button" class="secondary-btn" onclick="showAssetSetup()">Back to Assets</button>
      </div>
      <p class="muted-text">Maximum 500 labels per PDF. For larger fleets, generate separate PDFs per site or equipment type.</p>
    </div>
  `
}

window.bulkQrCustomerChanged = function () {
  const clientid = document.querySelector('#bulkQrClient')?.value || ''
  const siteSelect = document.querySelector('#bulkQrSite')
  const matchingSites = activeRecords(sites)
    .filter(row => String(row.clientid) === String(clientid))
    .sort((a, b) => String(a.sitename || '').localeCompare(String(b.sitename || '')))

  siteSelect.innerHTML = `<option value="">All sites</option>${matchingSites.map(row => `<option value="${safeAttr(row.siteid)}">${escapeHtml(row.sitename || '')}</option>`).join('')}`
  updateBulkQrCount()
}

window.updateBulkQrCount = function () {
  const clientid = document.querySelector('#bulkQrClient')?.value || ''
  const siteid = document.querySelector('#bulkQrSite')?.value || ''
  const equiptypeid = document.querySelector('#bulkQrEquipment')?.value || ''
  const countBox = document.querySelector('#bulkQrCount')

  if (!clientid) {
    countBox.textContent = 'Select a customer to preview the matching active assets.'
    return
  }

  const count = assets.filter(asset =>
    String(asset.clientid) === String(clientid) &&
    (!siteid || String(asset.siteid) === String(siteid)) &&
    (!equiptypeid || String(asset.equiptypeid) === String(equiptypeid)) &&
    asset.archived !== true && asset.archived !== 'true'
  ).length

  countBox.innerHTML = `<strong>${count}</strong> matching active asset(s). ${count > 500 ? 'Narrow the filters to 500 or fewer.' : ''}`
}

window.downloadBulkQrLabels = function () {
  const clientid = document.querySelector('#bulkQrClient')?.value || ''
  if (!clientid) {
    alert('Please select a customer.')
    return
  }

  const params = new URLSearchParams({ clientid })
  const siteid = document.querySelector('#bulkQrSite')?.value || ''
  const equiptypeid = document.querySelector('#bulkQrEquipment')?.value || ''
  if (siteid) params.set('siteid', siteid)
  if (equiptypeid) params.set('equiptypeid', equiptypeid)
  window.open(`${API_BASE}/assets/qr-labels/bulk.pdf?${params.toString()}`, '_blank')
}

window.showMpiReports = async function () {
  if (!ensurePageAccess('mpi')) return
  setCurrentPage('mpi')
  try {
    await renderMpiReportsPage({
      currentUser,
      customers,
      assets
    })
  } catch (error) {
    document.querySelector('#page').innerHTML = `
      <div class="filter-card">
        <h2>MPI reports unavailable</h2>
        <p>${escapeHtml(error.message || 'Unable to load MPI reports.')}</p>
      </div>
    `
  }
}

async function loadAssetNfcStatus(assetid) {
  if (!canManageNfcTokens()) return null

  const response = await fetch(`${API_BASE}/assets/${assetid}/nfc`)
  if (!response.ok) return null
  return response.json()
}

function renderNfcManagementPanel(asset, nfcStatus) {
  if (!canManageNfcTokens()) return ""

  if (!nfcStatus) {
    return `
      <div class="nfc-management-panel">
        <div class="nfc-management-header">
          <h4>NFC Tag</h4>
          <strong>Unavailable</strong>
        </div>
        <p class="nfc-writing-note">NFC management could not be loaded. Confirm the NFC database migration has been applied and try again.</p>
      </div>
    `
  }

  const enabled = Boolean(nfcStatus.nfc_enabled && nfcStatus.nfc_url)
  const issueDate = nfcStatus.nfc_issued_at ? nfcStatus.nfc_issued_at.split("T")[0] : "-"
  const lastScanned = nfcStatus.nfc_last_scanned_at ? nfcStatus.nfc_last_scanned_at.split("T")[0] : "-"
  const scanCount = Number(nfcStatus.nfc_scan_count || 0)

  return `
    <div class="nfc-management-panel">
      <div class="nfc-management-header">
        <h4>NFC Tag</h4>
        <strong>${enabled ? "Enabled" : nfcStatus.nfc_revoked_at ? "Revoked" : "Not issued"}</strong>
      </div>
      <div class="quick-detail-grid">
        <p><span>Issue Date</span><strong>${escapeHtml(issueDate)}</strong></p>
        <p><span>Last Scanned</span><strong>${escapeHtml(lastScanned)}</strong></p>
        <p><span>Scan Count</span><strong>${escapeHtml(scanCount)}</strong></p>
        <p class="quick-wide"><span>NFC URL</span><strong>${escapeHtml(nfcStatus.nfc_url || "Generate a token to create a URL")}</strong></p>
      </div>
      <div class="form-actions quick-result-actions">
        ${enabled ? `
          <button type="button" onclick="copyAssetNfcUrl('${safeAttr(nfcStatus.nfc_url)}')">Copy NFC URL</button>
          <button type="button" onclick="window.open('${safeAttr(nfcStatus.nfc_url)}', '_blank')">Preview Tap</button>
          <button type="button" onclick="rotateAssetNfcToken(${asset.assetid})">Replace Token</button>
          <button type="button" class="danger-btn" onclick="revokeAssetNfcToken(${asset.assetid})">Revoke NFC</button>
        ` : `
          <button type="button" onclick="generateAssetNfcToken(${asset.assetid})">Generate NFC URL</button>
        `}
      </div>
      <p class="nfc-writing-note">Write the copied HTTPS URL as an NDEF URI record. Test the tag before locking it read-only.</p>
    </div>
  `
}

async function refreshNfcPanelAsset(assetid) {
  const editPanel = document.querySelector('#editAssetNfcPanel')
  if (editPanel) {
    const asset = await getAssetForAction(assetid)
    const nfcStatus = await loadAssetNfcStatus(assetid)
    editPanel.innerHTML = renderNfcManagementPanel(asset, nfcStatus)
    return
  }

  await quickOpenAsset(assetid)
}

window.copyAssetNfcUrl = async function (url) {
  if (!url) return
  await navigator.clipboard.writeText(url)
  alert("NFC URL copied.")
}

window.generateAssetNfcToken = async function (assetid) {
  const response = await fetch(`${API_BASE}/assets/${assetid}/nfc`, { method: "POST" })
  const result = await response.json()
  if (!response.ok) {
    alert(result.error || "Could not generate NFC URL.")
    return
  }
  await refreshNfcPanelAsset(assetid)
}

window.rotateAssetNfcToken = async function (assetid) {
  if (!confirm("Replace this NFC token? Existing written NFC tags for this asset will stop working.")) return

  const response = await fetch(`${API_BASE}/assets/${assetid}/nfc/rotate`, { method: "PUT" })
  const result = await response.json()
  if (!response.ok) {
    alert(result.error || "Could not replace NFC token.")
    return
  }
  await refreshNfcPanelAsset(assetid)
}

window.revokeAssetNfcToken = async function (assetid) {
  if (!confirm("Revoke NFC access for this asset? Existing written NFC tags will stop working.")) return

  const response = await fetch(`${API_BASE}/assets/${assetid}/nfc`, { method: "DELETE" })
  const result = await response.json()
  if (!response.ok) {
    alert(result.error || "Could not revoke NFC access.")
    return
  }
  await refreshNfcPanelAsset(assetid)
}

function getStartupAssetTap() {
  const params = new URLSearchParams(window.location.search || "")
  const nfc = String(params.get("nfc") || "").trim()
  const qr = String(params.get("qr") || "").trim()

  if (nfc) return { type: "nfc", value: nfc }
  if (qr) return { type: "qr", value: qr }
  return null
}

async function resolveStartupAssetTap(tap) {
  const resultBox = document.querySelector("#quickInspectionResult")
  if (!tap || !resultBox) return false

  resultBox.innerHTML = `<p>Opening asset...</p>`

  const path = tap.type === "nfc"
    ? `/assets/nfc/${encodeURIComponent(tap.value)}`
    : `/assets/qr/${encodeURIComponent(tap.value)}`

  const response = await fetch(`${API_BASE}${path}`)
  const result = await response.json()

  if (!response.ok) {
    resultBox.innerHTML = `
      <div class="filter-card">
        <h2>Asset tag unavailable</h2>
        <p>${escapeHtml(result.error || "This asset tag could not be opened.")}</p>
      </div>
    `
    return false
  }

  quickOpenAsset(result.assetid)
  return true
}

function canCreateInspectionVisits() {
  return ['ADMIN', 'MANAGER'].includes(currentUser?.role)
}

function isActiveRecord(row) {
  return !(row?.archived === true || row?.archived === "true")
}

window.showInspectionVisits = async function () {
  if (!ensurePageAccess('visits')) return

  setCurrentPage("visits")
  document.querySelector('#page').innerHTML = `
    <h2>On-Site Inspection Visits</h2>

    ${canCreateInspectionVisits() ? `
      <div class="filter-card visit-create-card">
        <h3>Create Visit</h3>
        <div class="form-row">
          <div class="form-group">
            <label>Customer</label>
            <select id="visitClientId" onchange="renderVisitSiteOptions()">
              <option value="">Select customer</option>
              ${activeRecords(customers).map(customer => `<option value="${safeAttr(customer.clientid)}">${escapeHtml(customer.clientname || '')}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Site</label>
            <select id="visitSiteId" onchange="renderVisitSectionOptions()">
              <option value="">Select site</option>
            </select>
          </div>
          <div class="form-group">
            <label>Section</label>
            <select id="visitSectionId">
              <option value="">All sections</option>
            </select>
          </div>
          <div class="form-group">
            <label>Scope</label>
            <select id="visitType">
              <option value="VISUAL">Visual inspection</option>
              <option value="LOADTEST">Load test</option>
              <option value="COMBINED" selected>Combined</option>
              <option value="SURVEY">Survey / asset verification</option>
            </select>
          </div>
          <div class="form-group">
            <label>Due Cutoff</label>
            <input id="visitDueCutoff" type="date" value="${dateInputValue()}">
          </div>
        </div>
        <div class="form-actions">
          <button type="button" onclick="previewInspectionVisit()">Preview Due Assets</button>
          <button type="button" class="load-test-btn" onclick="createInspectionVisit()">Create Visit</button>
        </div>
        <div id="visitPreviewResult"></div>
      </div>
    ` : ""}

    <div class="filter-card">
      <h3>Open / Recent Visits</h3>
      <div id="inspectionVisitList"><p>Loading visits...</p></div>
    </div>
  `

  renderVisitSiteOptions()
  await loadInspectionVisits()
}

window.renderVisitSiteOptions = function () {
  const clientid = document.querySelector('#visitClientId')?.value || ''
  const siteSelect = document.querySelector('#visitSiteId')
  if (!siteSelect) return

  const matchingSites = sites
    .filter(site =>
      String(site.clientid) === String(clientid) &&
      isActiveRecord(site)
    )
    .sort((a, b) => (a.sitename || '').localeCompare(b.sitename || ''))
  siteSelect.innerHTML = `<option value="">Select site</option>` + matchingSites
    .map(site => `<option value="${safeAttr(site.siteid)}">${escapeHtml(site.sitename || '')}</option>`)
    .join('')
  renderVisitSectionOptions()
}

window.renderVisitSectionOptions = function () {
  const clientid = document.querySelector('#visitClientId')?.value || ''
  const siteid = document.querySelector('#visitSiteId')?.value || ''
  const sectionSelect = document.querySelector('#visitSectionId')
  if (!sectionSelect) return

  const matchingSections = sections.filter(section =>
    String(section.clientid) === String(clientid) &&
    String(section.siteid) === String(siteid) &&
    isActiveRecord(section)
  )
    .sort((a, b) => (a.sectionname || '').localeCompare(b.sectionname || ''))
  sectionSelect.innerHTML = `<option value="">All sections</option>` + matchingSections
    .map(section => `<option value="${safeAttr(section.sectionid)}">${escapeHtml(section.sectionname || '')}</option>`)
    .join('')
}

function visitPayloadFromForm() {
  return {
    clientid: document.querySelector('#visitClientId')?.value || null,
    siteid: document.querySelector('#visitSiteId')?.value || null,
    sectionid: document.querySelector('#visitSectionId')?.value || null,
    visit_type: document.querySelector('#visitType')?.value || 'COMBINED',
    due_cutoff: document.querySelector('#visitDueCutoff')?.value || dateInputValue(),
    visit_status: 'DRAFT'
  }
}

window.previewInspectionVisit = async function () {
  const response = await fetch(`${API_BASE}/inspection-visits/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(visitPayloadFromForm())
  })
  const result = await response.json()
  const box = document.querySelector('#visitPreviewResult')
  if (!box) return

  if (!response.ok) {
    box.innerHTML = `<p class="login-error">${escapeHtml(result.error || 'Preview failed')}</p>`
    return
  }

  const isSurvey = document.querySelector('#visitType')?.value === 'SURVEY'
  const coverage = result.coverage_summary || { total: 0, completed: 0, outstanding: 0 }
  const coveragePercent = Number(coverage.total)
    ? Math.round((Number(coverage.completed) / Number(coverage.total)) * 100)
    : 0
  window.currentVisitPreviewReport = {
    result,
    isSurvey,
    customer: document.querySelector('#visitClientId')?.selectedOptions?.[0]?.textContent || '',
    site: document.querySelector('#visitSiteId')?.selectedOptions?.[0]?.textContent || '',
    section: document.querySelector('#visitSectionId')?.selectedOptions?.[0]?.textContent || 'All sections',
    scope: document.querySelector('#visitType')?.selectedOptions?.[0]?.textContent || '',
    dueCutoff: document.querySelector('#visitDueCutoff')?.value || ''
  }

  box.innerHTML = `
    <div class="form-actions visit-preview-actions">
      <button type="button" onclick="printVisitPreviewTables()">Print Tables</button>
      <button type="button" class="load-test-btn" onclick="exportVisitPreviewTables()">Export CSV</button>
    </div>
    ${isSurvey ? '' : `
      <h4>Current Inspection Coverage</h4>
      <div class="visit-count-grid">
        <div><span>Total Registered Assets</span><strong>${escapeHtml(coverage.total || 0)}</strong></div>
        <div><span>Current / Done</span><strong>${escapeHtml(coverage.completed || 0)}</strong></div>
        <div><span>Outstanding by Cutoff</span><strong>${escapeHtml(coverage.outstanding || 0)}</strong></div>
        <div><span>Coverage</span><strong>${escapeHtml(coveragePercent)}%</strong></div>
      </div>
      <div class="visit-progress-table-wrap">
        <table class="visit-progress-table visit-preview-table">
          <thead><tr><th>Equipment Type</th><th>Total Assets</th><th>Current / Done</th><th>Outstanding</th><th>Coverage</th></tr></thead>
          <tbody>
            ${(result.coverage_by_equipment_type || []).map(row => {
              const percent = Number(row.total) ? Math.round((Number(row.completed) / Number(row.total)) * 100) : 0
              return `<tr><th scope="row">${escapeHtml(row.equipment_type)}</th><td>${escapeHtml(row.total)}</td><td>${escapeHtml(row.completed)}</td><td>${escapeHtml(row.outstanding)}</td><td>${escapeHtml(percent)}%</td></tr>`
            }).join('') || '<tr><td colspan="5">No registered assets found.</td></tr>'}
            <tr class="visit-progress-total"><th scope="row">Overall Total</th><td>${escapeHtml(coverage.total || 0)}</td><td>${escapeHtml(coverage.completed || 0)}</td><td>${escapeHtml(coverage.outstanding || 0)}</td><td>${escapeHtml(coveragePercent)}%</td></tr>
          </tbody>
        </table>
      </div>
    `}
    <h4>${isSurvey ? 'Assets Included in Survey' : 'Work Due for This Visit'}</h4>
    <div class="visit-count-grid">
      <div><span>Total</span><strong>${escapeHtml(result.summary.total)}</strong></div>
      <div><span>Visual Due</span><strong>${escapeHtml(result.summary.visual_due)}</strong></div>
      <div><span>Load Tests Due</span><strong>${escapeHtml(result.summary.loadtest_due)}</strong></div>
      <div><span>Both Due</span><strong>${escapeHtml(result.summary.both_due)}</strong></div>
      <div><span>Overdue</span><strong>${escapeHtml(result.summary.overdue)}</strong></div>
    </div>
    <div class="visit-progress-table-wrap">
      <table class="visit-progress-table visit-preview-table">
        <thead>
          <tr><th>Equipment Type</th><th>Assets Included</th><th>Visual Due</th><th>Load Tests Due</th><th>Both Due</th><th>Overdue</th></tr>
        </thead>
        <tbody>
          ${(result.equipment_type_summary || []).map(row => `
            <tr>
              <th scope="row">${escapeHtml(row.equipment_type)}</th>
              <td>${escapeHtml(row.total || 0)}</td>
              <td>${escapeHtml(row.visual_due || 0)}</td>
              <td>${escapeHtml(row.loadtest_due || 0)}</td>
              <td>${escapeHtml(row.both_due || 0)}</td>
              <td>${escapeHtml(row.overdue || 0)}</td>
            </tr>
          `).join('') || '<tr><td colspan="6">No assets match this visit scope and cutoff date.</td></tr>'}
        </tbody>
      </table>
    </div>
  `
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

window.exportVisitPreviewTables = function () {
  const preview = window.currentVisitPreviewReport
  if (!preview) return
  const { result, isSurvey } = preview
  const lines = [
    ['On-Site Inspection Coverage Report'],
    ['Customer', preview.customer],
    ['Site', preview.site],
    ['Section', preview.section],
    ['Scope', preview.scope],
    ['Due Cutoff', preview.dueCutoff],
    []
  ]

  if (!isSurvey) {
    lines.push(
      ['Current Inspection Coverage'],
      ['Equipment Type', 'Total Assets', 'Current / Done', 'Outstanding', 'Coverage %'],
      ...(result.coverage_by_equipment_type || []).map(row => [
        row.equipment_type,
        row.total,
        row.completed,
        row.outstanding,
        Number(row.total) ? Math.round((Number(row.completed) / Number(row.total)) * 100) : 0
      ]),
      []
    )
  }

  lines.push(
    [isSurvey ? 'Assets Included in Survey' : 'Work Due for This Visit'],
    ['Equipment Type', 'Assets Included', 'Visual Due', 'Load Tests Due', 'Both Due', 'Overdue'],
    ...(result.equipment_type_summary || []).map(row => [
      row.equipment_type,
      row.total,
      row.visual_due,
      row.loadtest_due,
      row.both_due,
      row.overdue
    ])
  )

  const csv = '\uFEFF' + lines.map(row => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  const safeSite = (preview.site || 'site').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  link.href = URL.createObjectURL(blob)
  link.download = `inspection-coverage-${safeSite}-${preview.dueCutoff || dateInputValue()}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(link.href)
}

window.printVisitPreviewTables = function () {
  const preview = window.currentVisitPreviewReport
  if (!preview) return
  const { result, isSurvey } = preview
  const coverageRows = (result.coverage_by_equipment_type || []).map(row => {
    const percent = Number(row.total) ? Math.round((Number(row.completed) / Number(row.total)) * 100) : 0
    return `<tr><th>${escapeHtml(row.equipment_type)}</th><td>${escapeHtml(row.total)}</td><td>${escapeHtml(row.completed)}</td><td>${escapeHtml(row.outstanding)}</td><td>${escapeHtml(percent)}%</td></tr>`
  }).join('')
  const dueRows = (result.equipment_type_summary || []).map(row => `
    <tr><th>${escapeHtml(row.equipment_type)}</th><td>${escapeHtml(row.total)}</td><td>${escapeHtml(row.visual_due)}</td><td>${escapeHtml(row.loadtest_due)}</td><td>${escapeHtml(row.both_due)}</td><td>${escapeHtml(row.overdue)}</td></tr>
  `).join('')
  const win = window.open('', '_blank')
  win.document.write(`
    <style>
      body { color: #172033; font-family: Arial, sans-serif; margin: 28px; }
      h1 { margin-bottom: 5px; } h2 { margin-top: 24px; }
      .details { color: #475569; line-height: 1.6; }
      table { border-collapse: collapse; font-size: 12px; width: 100%; }
      th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: right; }
      th:first-child { text-align: left; } thead th { background: #e8f1fb; }
      @media print { body { margin: 10mm; } }
    </style>
    <h1>On-Site Inspection Coverage Report</h1>
    <div class="details">
      <strong>${escapeHtml(preview.customer)}</strong> / ${escapeHtml(preview.site)} / ${escapeHtml(preview.section)}<br>
      Scope: ${escapeHtml(preview.scope)} | Due cutoff: ${escapeHtml(preview.dueCutoff)}
    </div>
    ${isSurvey ? '' : `
      <h2>Current Inspection Coverage</h2>
      <table><thead><tr><th>Equipment Type</th><th>Total Assets</th><th>Current / Done</th><th>Outstanding</th><th>Coverage</th></tr></thead><tbody>${coverageRows || '<tr><td colspan="5">No registered assets found.</td></tr>'}</tbody></table>
    `}
    <h2>${isSurvey ? 'Assets Included in Survey' : 'Work Due for This Visit'}</h2>
    <table><thead><tr><th>Equipment Type</th><th>Assets Included</th><th>Visual Due</th><th>Load Tests Due</th><th>Both Due</th><th>Overdue</th></tr></thead><tbody>${dueRows || '<tr><td colspan="6">No assets match this selection.</td></tr>'}</tbody></table>
  `)
  win.document.close()
  win.focus()
  win.print()
}

window.createInspectionVisit = async function () {
  const response = await fetch(`${API_BASE}/inspection-visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(visitPayloadFromForm())
  })
  const result = await response.json()

  if (!response.ok) {
    alert(result.error || 'Could not create visit.')
    return
  }

  await openInspectionVisit(result.visit.visitid)
}

async function loadInspectionVisits() {
  const response = await fetch(`${API_BASE}/inspection-visits`)
  const visits = await response.json()
  const box = document.querySelector('#inspectionVisitList')
  if (!box) return

  if (!response.ok) {
    box.innerHTML = `<p class="login-error">${escapeHtml(visits.error || 'Could not load visits')}</p>`
    return
  }

  box.innerHTML = `
    <div class="visit-list">
      ${visits.map(visit => `
        <button type="button" class="visit-list-item" onclick="openInspectionVisit(${visit.visitid})">
          <strong>${escapeHtml(visit.visit_reference || `Visit ${visit.visitid}`)}</strong>
          <span>${escapeHtml(visit.clientname || '')} / ${escapeHtml(visit.sitename || '')}</span>
          <span>${escapeHtml(visit.visit_type)} | ${escapeHtml(visit.visit_status)} | Outstanding ${escapeHtml(visit.outstanding_assets || 0)}</span>
        </button>
      `).join('') || '<p>No visits found.</p>'}
    </div>
  `
}

window.openInspectionVisit = async function (visitid) {
  setCurrentPage("visits")
  const [visitResponse, assetsResponse] = await Promise.all([
    fetch(`${API_BASE}/inspection-visits/${visitid}`),
    fetch(`${API_BASE}/inspection-visits/${visitid}/assets?limit=250`)
  ])
  const visit = await visitResponse.json()
  const worklist = await assetsResponse.json()

  if (!visitResponse.ok || !assetsResponse.ok) {
    alert(visit.error || worklist.error || "Could not open visit.")
    return
  }

  const visitIsClosed = ['COMPLETED', 'CANCELLED'].includes(visit.visit_status)
  const totalAssets = Number(worklist.counts.total || 0)
  const completedAssets = Number(worklist.counts.completed || 0)
  const completionPercent = totalAssets ? Math.round((completedAssets / totalAssets) * 100) : 0

  document.querySelector('#page').innerHTML = `
    <div class="visit-detail-header">
      <div>
        <h2>${escapeHtml(visit.visit_reference || `Visit ${visit.visitid}`)}</h2>
        <p>${escapeHtml(visit.clientname || '')} / ${escapeHtml(visit.sitename || '')} ${visit.sectionname ? `/ ${escapeHtml(visit.sectionname)}` : ''}</p>
      </div>
      <div class="form-actions">
        ${canCreateInspectionVisits() && ['DRAFT','PAUSED'].includes(visit.visit_status) ? `<button onclick="startInspectionVisit(${visit.visitid})">Start Visit</button>` : ''}
        <button onclick="printInspectionVisitReport(${visit.visitid})">Report</button>
        ${canCreateInspectionVisits() && !visitIsClosed ? `<button class="load-test-btn" onclick="closeInspectionVisit(${visit.visitid})">Close Visit</button>` : ''}
      </div>
    </div>

    <div class="visit-count-grid">
      <div><span>Total Assets in Visit</span><strong>${escapeHtml(totalAssets)}</strong></div>
      <div><span>Done</span><strong>${escapeHtml(completedAssets)}</strong></div>
      <div><span>Still Outstanding</span><strong>${escapeHtml(worklist.counts.outstanding || 0)}</strong></div>
      <div><span>Not Found</span><strong>${escapeHtml(worklist.counts.not_found || 0)}</strong></div>
      <div><span>Unable to Inspect</span><strong>${escapeHtml(worklist.counts.inaccessible || 0)}</strong></div>
      <div><span>Completion</span><strong>${escapeHtml(completionPercent)}%</strong></div>
    </div>

    ${renderVisitEquipmentTypeSummary(worklist.equipment_type_summary || [], worklist.counts)}

    <div class="filter-card">
      <h3>Worklist</h3>
      <div class="visit-worklist">
        ${worklist.rows.map(row => renderVisitAssetCard(visit, row)).join('') || '<p>No due assets in this visit scope.</p>'}
      </div>
    </div>

    ${visitIsClosed ? '' : `<div class="filter-card">
      <h3>Newly Discovered Asset</h3>
      <div class="form-row">
        <input id="visitDiscoveryDescription" placeholder="Description">
        <input id="visitDiscoverySerial" placeholder="Serial number">
        <input id="visitDiscoveryTag" placeholder="Asset tag">
        <input id="visitDiscoveryLocation" placeholder="Section / location">
      </div>
      <textarea id="visitDiscoveryNotes" placeholder="Notes"></textarea>
      <button onclick="addVisitDiscovery(${visit.visitid})">Record Discovery</button>
    </div>`}
  `
}

function visitProgressSummaryRow(label, row, isTotal = false) {
  const total = Number(row.total || 0)
  const completed = Number(row.completed || 0)
  const completion = total ? Math.round((completed / total) * 100) : 0
  return `
    <tr class="${isTotal ? 'visit-progress-total' : ''}">
      <th scope="row">${escapeHtml(label)}</th>
      <td>${escapeHtml(total)}</td>
      <td>${escapeHtml(completed)}</td>
      <td>${escapeHtml(row.outstanding || 0)}</td>
      <td>${escapeHtml(row.not_found || 0)}</td>
      <td>${escapeHtml(row.inaccessible || 0)}</td>
      <td>${escapeHtml(row.deferred || 0)}</td>
      <td>${escapeHtml(row.other_resolved || 0)}</td>
      <td>${escapeHtml(completion)}%</td>
    </tr>
  `
}

function renderVisitEquipmentTypeSummary(rows, counts) {
  const knownStatuses = ['completed', 'outstanding', 'not_found', 'inaccessible', 'deferred', 'removed']
  const knownTotal = knownStatuses.reduce((sum, key) => sum + Number(counts[key] || 0), 0)
  const overall = {
    ...counts,
    other_resolved: Math.max(0, Number(counts.total || 0) - knownTotal + Number(counts.removed || 0))
  }

  return `
    <div class="filter-card visit-progress-card">
      <h3>Progress by Equipment Type</h3>
      <p class="muted-text">Done means all inspections required for this visit have been completed.</p>
      <div class="visit-progress-table-wrap">
        <table class="visit-progress-table">
          <thead>
            <tr>
              <th>Equipment Type</th>
              <th>Total</th>
              <th>Done</th>
              <th>Outstanding</th>
              <th>Not Found</th>
              <th>Unable to Inspect</th>
              <th>Deferred</th>
              <th>Other Resolved</th>
              <th>Completion</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => visitProgressSummaryRow(row.equipment_type, row)).join('') || '<tr><td colspan="9">No assets in this visit.</td></tr>'}
            ${visitProgressSummaryRow('Overall Total', overall, true)}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function renderVisitAssetCard(visit, row) {
  const safeStatus = safeAttr(row.reconciliation_status || 'OUTSTANDING')
  const visitIsClosed = ['COMPLETED', 'CANCELLED'].includes(visit.visit_status)
  const actions = visitIsClosed ? '<span class="muted-text">Read-only completed visit</span>' : `
        ${row.assetid ? `<button onclick="markVisitAssetScanned(${visit.visitid}, ${row.assetid})">Scanned</button>` : ''}
        ${row.visual_due_flag ? `<button onclick="startInspection(${row.assetid}, 'VISUAL', 'visit:${visit.visitid}', 'auto', ${visit.visitid})">Visual</button>` : ''}
        ${row.loadtest_due_flag ? `<button class="load-test-btn" onclick="startInspection(${row.assetid}, 'LOADTEST', 'visit:${visit.visitid}', 'auto', ${visit.visitid})">Load Test</button>` : ''}
        <select onchange="setVisitAssetDisposition(${visit.visitid}, ${row.visitassetid}, this.value, '${safeStatus}')">
          <option value="">Disposition...</option>
          <option value="NOT_FOUND">Not found</option>
          <option value="OUT_OF_SERVICE">Out of service</option>
          <option value="REMOVED_FROM_SITE">Removed from site</option>
          <option value="INACCESSIBLE">Inaccessible</option>
          <option value="DEFERRED">Deferred</option>
          <option value="CUSTOMER_CONFIRMED_REMOVED">Customer confirmed removed</option>
          <option value="DUPLICATE_RECORD">Duplicate record</option>
          <option value="NOT_REQUIRED">Not required</option>
          <option value="OTHER">Other</option>
        </select>`

  return `
    <div class="visit-asset-card ${safeAttr((row.reconciliation_status || '').toLowerCase())}">
      <div>
        <strong>${escapeHtml(row.assettag_snapshot || row.assetid || '-')}</strong>
        <span>${escapeHtml(row.equipmenttype_snapshot || '-')} | ${escapeHtml(row.serial_snapshot || '-')}</span>
        <span>${escapeHtml(row.due_reason || '')}</span>
      </div>
      <div class="visit-asset-meta">
        <span>${escapeHtml(row.required_inspection_scope)}</span>
        <strong>${escapeHtml(row.reconciliation_status)}</strong>
      </div>
      <div class="form-actions">
        ${actions}
      </div>
    </div>
  `
}

window.startInspectionVisit = async function (visitid) {
  const response = await fetch(`${API_BASE}/inspection-visits/${visitid}/start`, { method: 'POST' })
  const result = await response.json()
  if (!response.ok) {
    alert(result.error || 'Could not start visit.')
    return
  }
  await openInspectionVisit(visitid)
}

window.markVisitAssetScanned = async function (visitid, assetid) {
  const response = await fetch(`${API_BASE}/inspection-visits/${visitid}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetid })
  })
  const result = await response.json()
  if (!response.ok) {
    alert(result.error || 'Could not mark asset scanned.')
    return
  }
  await openInspectionVisit(visitid)
}

window.setVisitAssetDisposition = async function (visitid, visitassetid, status) {
  if (!status) return
  const comments = prompt("Enter reconciliation comments:") || ""
  const customerConfirmation = status === 'CUSTOMER_CONFIRMED_REMOVED'
    ? prompt("Enter customer representative or confirmation note:") || ""
    : ""
  const response = await fetch(`${API_BASE}/inspection-visits/${visitid}/assets/${visitassetid}/disposition`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reconciliation_status: status,
      disposition_reason: status,
      disposition_comments: comments,
      customer_confirmation: customerConfirmation
    })
  })
  const result = await response.json()
  if (!response.ok) {
    alert(result.error || 'Could not save disposition.')
    return
  }
  await openInspectionVisit(visitid)
}

window.addVisitDiscovery = async function (visitid) {
  const response = await fetch(`${API_BASE}/inspection-visits/${visitid}/discoveries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: document.querySelector('#visitDiscoveryDescription')?.value || '',
      serialno: document.querySelector('#visitDiscoverySerial')?.value || '',
      assettagno: document.querySelector('#visitDiscoveryTag')?.value || '',
      section_location: document.querySelector('#visitDiscoveryLocation')?.value || '',
      notes: document.querySelector('#visitDiscoveryNotes')?.value || ''
    })
  })
  const result = await response.json()
  if (!response.ok) {
    alert(result.error || 'Could not record discovery.')
    return
  }
  await openInspectionVisit(visitid)
}

window.closeInspectionVisit = async function (visitid) {
  let body = {}
  let response = await fetch(`${API_BASE}/inspection-visits/${visitid}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  let result = await response.json()

  if (response.status === 409) {
    const reason = prompt(`Due assets still unaccounted for: ${result.unresolved}. Enter override reason or cancel:`)
    if (!reason) return
    body = { override: true, override_reason: reason }
    response = await fetch(`${API_BASE}/inspection-visits/${visitid}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    result = await response.json()
  }

  if (!response.ok) {
    alert(result.error || 'Could not close visit.')
    return
  }
  await openInspectionVisit(visitid)
}

window.printInspectionVisitReport = async function (visitid) {
  const response = await fetch(`${API_BASE}/inspection-visits/${visitid}/report`)
  const report = await response.json()
  if (!response.ok) {
    alert(report.error || 'Could not load report.')
    return
  }
  const win = window.open('', '_blank')
  const equipmentRows = report.equipment_type_summary || []
  const reportTotal = equipmentRows.reduce((sum, row) => sum + Number(row.total || 0), 0)
  const reportDone = equipmentRows.reduce((sum, row) => sum + Number(row.completed || 0), 0)
  const reportOutstanding = equipmentRows.reduce((sum, row) => sum + Number(row.outstanding || 0), 0)
  const reportNotFound = equipmentRows.reduce((sum, row) => sum + Number(row.not_found || 0), 0)
  const reportInaccessible = equipmentRows.reduce((sum, row) => sum + Number(row.inaccessible || 0), 0)
  const reportDeferred = equipmentRows.reduce((sum, row) => sum + Number(row.deferred || 0), 0)
  const reportOther = equipmentRows.reduce((sum, row) => sum + Number(row.other_resolved || 0), 0)
  const reportCompletion = reportTotal ? Math.round((reportDone / reportTotal) * 100) : 0
  win.document.write(`
    <style>
      body { color: #172033; font-family: Arial, sans-serif; margin: 28px; }
      h1 { margin-bottom: 4px; }
      .summary { display: grid; gap: 10px; grid-template-columns: repeat(4, 1fr); margin: 20px 0; }
      .summary div { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; }
      .summary span { color: #64748b; display: block; font-size: 12px; font-weight: 700; }
      .summary strong { display: block; font-size: 20px; margin-top: 4px; }
      table { border-collapse: collapse; font-size: 12px; width: 100%; }
      th, td { border: 1px solid #cbd5e1; padding: 7px; text-align: right; }
      th:first-child, td:first-child { text-align: left; }
      thead th, tfoot th, tfoot td { background: #e8f1fb; font-weight: 700; }
      @media print { body { margin: 10mm; } }
    </style>
    <h1>${escapeHtml(report.visit.visit_reference || `Visit ${visitid}`)}</h1>
    <p>${escapeHtml(report.visit.clientname || '')} / ${escapeHtml(report.visit.sitename || '')}${report.visit.sectionname ? ` / ${escapeHtml(report.visit.sectionname)}` : ''}</p>
    <div class="summary">
      <div><span>Total Assets</span><strong>${escapeHtml(reportTotal)}</strong></div>
      <div><span>Done</span><strong>${escapeHtml(reportDone)}</strong></div>
      <div><span>Outstanding</span><strong>${escapeHtml(reportOutstanding)}</strong></div>
      <div><span>Completion</span><strong>${escapeHtml(reportCompletion)}%</strong></div>
    </div>
    <h2>Progress by Equipment Type</h2>
    <table>
      <thead><tr><th>Equipment Type</th><th>Total</th><th>Done</th><th>Outstanding</th><th>Not Found</th><th>Unable to Inspect</th><th>Deferred</th><th>Other Resolved</th><th>Completion</th></tr></thead>
      <tbody>
        ${equipmentRows.map(row => visitProgressSummaryRow(row.equipment_type, row)).join('') || '<tr><td colspan="9">No assets in this visit.</td></tr>'}
      </tbody>
      <tfoot>
        ${visitProgressSummaryRow('Overall Total', {
          total: reportTotal,
          completed: reportDone,
          outstanding: reportOutstanding,
          not_found: reportNotFound,
          inaccessible: reportInaccessible,
          deferred: reportDeferred,
          other_resolved: reportOther
        }, true)}
      </tfoot>
    </table>
    <p><strong>Newly discovered assets:</strong> ${escapeHtml(report.discoveries.length)}</p>
  `)
  win.document.close()
  win.print()
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
    <select id="assetResponsibleSelect" style="display:none;" onchange="syncAssetResponsibleFromSelect()">
      <option value="">Select Responsible Person</option>
    </select>
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
    const isElectricRopeHoist = String(selectedType.equiptypeid) === '105'
    html = `
      <div class="form-group"><label>WLL(kg)</label><input id="assetWLL" type="number"></div>
      <div class="form-group"><label>Height of Lift(mm)</label><input id="assetHeightOfLift" type="number"></div>
      <div class="form-group"><label>${isElectricRopeHoist ? 'Number of Rope Falls' : 'Number of Chain Falls'}</label><input id="assetNumberOfChainFalls" type="number"></div>
      ${isElectricRopeHoist ? '' : '<div class="form-group"><label>OEM Top Hook Size(mm)</label><input id="assetOEMTopHookSize" type="number"></div>'}
      <div class="form-group"><label>OEM Bottom Hook Size(mm)</label><input id="assetOEMBottomHookSize" type="number"></div>
      <div class="form-group"><label>${isElectricRopeHoist ? 'Rope Size(mm)' : 'Load Chain Diameter(mm)'}</label><input id="assetLoadChainDiameter" type="number"></div>
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
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="assetPermissibleDeflection" type="number" min="0" step="1" placeholder="Whole number, e.g. 19"></div>
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
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="assetPermissibleDeflection" type="number" min="0" step="1" placeholder="Whole number, e.g. 19"></div>
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
  hideAssetResponsibleFallback()

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
  const clientid = document.querySelector('#assetClient').value
  const siteid =
    document.querySelector('#assetSite').value

  const sectionSelect =
    document.querySelector('#assetSection')

  document.querySelector('#assetResponsibleName').value = ''
  document.querySelector('#assetResponsible').value = ''
  hideAssetResponsibleFallback()

  if (!siteid) {
    sectionSelect.innerHTML =
      `<option value="">Select Site First</option>`
    return
  }

  const filteredSections = sections
    .filter(section =>
      String(section.clientid) === String(clientid) &&
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

function hideAssetResponsibleFallback() {
  const responsibleNameInput = document.querySelector('#assetResponsibleName')
  const responsibleSelect = document.querySelector('#assetResponsibleSelect')

  if (responsibleNameInput) responsibleNameInput.style.display = ''
  if (responsibleSelect) {
    responsibleSelect.style.display = 'none'
    responsibleSelect.innerHTML = '<option value="">Select Responsible Person</option>'
  }
}

function showAssetResponsibleFallback(selectedResponsibleId = '') {
  const clientid = document.querySelector('#assetClient')?.value || ''
  const responsibleNameInput = document.querySelector('#assetResponsibleName')
  const responsibleSelect = document.querySelector('#assetResponsibleSelect')

  if (!responsibleSelect || !responsibleNameInput) return

  const filteredResponsiblePersons = uniqueResponsiblePeopleForClient(clientid)

  responsibleNameInput.style.display = 'none'
  responsibleSelect.style.display = ''
  responsibleSelect.innerHTML = `
    <option value="">Select Responsible Person</option>
    ${filteredResponsiblePersons.map(person => `
      <option value="${safeAttr(person.personid)}" ${String(person.personid) === String(selectedResponsibleId) ? 'selected' : ''}>
        ${escapeHtml(person.name || `Responsible Person ${person.personid}`)}
      </option>
    `).join('')}
  `
}

window.syncAssetResponsibleFromSelect = function () {
  const responsibleSelect = document.querySelector('#assetResponsibleSelect')
  const responsibleIdInput = document.querySelector('#assetResponsible')

  if (responsibleIdInput) {
    responsibleIdInput.value = responsibleSelect?.value || ''
  }
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
  hideAssetResponsibleFallback()

  if (!sectionid) return

  const section = sections.find(
    s => String(s.sectionid) === String(sectionid)
  )

  if (!section) return

  responsibleNameInput.value =
    section.responsiblename || ''

  responsibleIdInput.value =
    section.responsibleid || ''

  if (!section.responsibleid) {
    showAssetResponsibleFallback()
  }
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

function validatePermissibleDeflection(selector) {
  const input = document.querySelector(selector)
  const value = input?.value.trim() || ''

  if (!value) return true

  const numericValue = Number(value)
  if (Number.isInteger(numericValue) && numericValue >= 0) return true

  alert(
    `Permissible Deflection must be a whole number of zero or more, in millimetres.\n\n` +
    `Entered value: ${value}\n` +
    `Correct examples: 19 or 20\n` +
    `Decimals such as 19.9 are not accepted. Round to the appropriate whole millimetre before saving.`
  )
  input?.focus()
  return false
}

function formatAssetSaveError(result, fallbackMessage) {
  const lines = [result?.error || fallbackMessage]

  if (result?.field) lines.push(`Field: ${result.field}`)
  if (result?.enteredValue !== undefined) lines.push(`Entered value: ${result.enteredValue}`)
  if (result?.acceptedFormat) lines.push(`Required format: ${result.acceptedFormat}`)

  return lines.join('\n')
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

  if (!validatePermissibleDeflection('#assetPermissibleDeflection')) {
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
    alert("Error saving asset:\n\n" + formatAssetSaveError(newAsset, "The asset could not be saved."))
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
    rowsPerPage: Number(rowsInput?.value || window.assetRowsPerPage || window.assetListState?.rowsPerPage || 25),
    archiveMode: window.assetListState?.archiveMode || "active"
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

function buildEditAssetDynamicFields(groupid, values = {}, equiptypeid = '') {
  let dynamicEditFields = ''

  if (groupid === '100') {
    const isElectricRopeHoist = String(equiptypeid) === '105'
    dynamicEditFields = `
      <div class="form-group"><label>WLL(kg)</label><input id="editAssetWLL" type="number" value="${safeAttr(values.wll || '')}"></div>
      <div class="form-group"><label>Height of Lift(mm)</label><input id="editAssetHeightOfLift" type="number" value="${safeAttr(values.heightoflift || '')}"></div>
      <div class="form-group"><label>${isElectricRopeHoist ? 'Number of Rope Falls' : 'Number of Chain Falls'}</label><input id="editAssetNumberOfChainFalls" type="number" value="${safeAttr(values.numberofchainfalls || '')}"></div>
      ${isElectricRopeHoist ? '' : `<div class="form-group"><label>OEM Top Hook Size(mm)</label><input id="editAssetOEMTopHookSize" type="number" value="${safeAttr(values.oemtophooksize || '')}"></div>`}
      <div class="form-group"><label>OEM Bottom Hook Size(mm)</label><input id="editAssetOEMBottomHookSize" type="number" value="${safeAttr(values.oembottomhooksize || '')}"></div>
      <div class="form-group"><label>${isElectricRopeHoist ? 'Rope Size(mm)' : 'Load Chain Diameter(mm)'}</label><input id="editAssetLoadChainDiameter" type="number" value="${safeAttr(values.loadchaindiameter || '')}"></div>
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
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="editAssetPermissibleDeflection" type="number" min="0" step="1" placeholder="Whole number, e.g. 19" value="${safeAttr(values.permissibledeflection || '')}"></div>
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
      <div class="form-group"><label>Permissible Deflection(mm)</label><input id="editAssetPermissibleDeflection" type="number" min="0" step="1" placeholder="Whole number, e.g. 19" value="${safeAttr(values.permissibledeflection || '')}"></div>
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

  container.innerHTML = buildEditAssetDynamicFields(groupid, collectCurrentEditAssetValues(), equiptypeid)

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
  const dynamicEditFields = buildEditAssetDynamicFields(groupid, asset, asset.equiptypeid)
  const nfcStatus = await loadAssetNfcStatus(asset.assetid)
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
            <button type="button" class="secondary-btn" onclick="showMoveAssetForm(${asset.assetid})">
              Set Site / Section
            </button>

            <button class="danger-btn" onclick="archiveAsset(${asset.assetid})">
              Archive
            </button>
          ` : ''}
        </div>

      </div>
    </div>

    ${canManageNfcTokens() ? `
      <div id="editAssetNfcPanel" class="filter-card">
        ${renderNfcManagementPanel(asset, nfcStatus)}
      </div>
    ` : ''}

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

  if (!validatePermissibleDeflection('#editAssetPermissibleDeflection')) {
    return
  }

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
    alert("Error updating asset:\n\n" + formatAssetSaveError(updatedAsset, "The asset could not be updated."))
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

  const reasonInput = prompt(
    "Why is asset " + assetid + " being archived?\n\nThis reason will be retained in the asset history."
  )

  if (reasonInput === null) return

  const reason = reasonInput.trim()
  if (!reason) {
    alert("An archive reason is required.")
    return
  }

  if (reason.length > 1000) {
    alert("The archive reason must be 1000 characters or fewer.")
    return
  }

  const response = await fetch(`${API_BASE}/assets/${assetid}/archive`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
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

  setCurrentPage("criteria")

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

window.setAssetArchiveMode = function (mode) {
  window.assetListState = {
    ...(window.assetListState || {}),
    archiveMode: ['active', 'archived', 'all'].includes(mode) ? mode : 'active'
  }
  window.assetCurrentPage = 1
  filterAssets()
}

window.showAllocateAssetForm = async function (assetid) {
  if (!canArchiveOrMoveAssetRecords()) {
    showAccessDenied()
    return
  }

  rememberAssetListState()
  let asset
  try {
    asset = await getAssetForAction(assetid)
  } catch (err) {
    alert(err.message || 'Asset not found')
    return
  }

  const people = uniqueResponsiblePeopleForClient(asset.clientid, asset.responsibleid)
    .filter(person => !(person.archived === true || person.archived === 'true'))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  document.querySelector('#page').innerHTML = `
    <h2>Allocate Asset ${escapeHtml(asset.assetid)}</h2>
    <div class="filter-card">
      <div class="asset-form-grid">
        <div class="form-group"><label>Customer</label><input value="${safeAttr(asset.clientname || '')}" disabled></div>
        <div class="form-group"><label>Asset</label><input value="${safeAttr(asset.description || asset.serialno || asset.assetid)}" disabled></div>
        <div class="form-group">
          <label>Responsible Person</label>
          <select id="allocateAssetResponsible">
            <option value="">Select Responsible Person</option>
            ${people.map(person => `<option value="${safeAttr(person.personid)}" ${String(person.personid) === String(asset.responsibleid) ? 'selected' : ''}>${escapeHtml(person.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button onclick="saveAssetAllocation(${asset.assetid})">Save Allocation</button>
        <button onclick="showAssetSetup()">Cancel</button>
      </div>
    </div>
  `
}

window.saveAssetAllocation = async function (assetid) {
  if (!canArchiveOrMoveAssetRecords()) return
  const responsibleid = document.querySelector('#allocateAssetResponsible')?.value || ''
  if (!responsibleid) {
    alert('Please select a responsible person')
    return
  }
  const response = await fetch(`${API_BASE}/assets/${assetid}/allocate`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ responsibleid })
  })
  const result = await response.json()
  if (!response.ok) {
    alert(result.error || 'Unable to allocate asset')
    return
  }
  alert('Asset allocated successfully')
  await loadData()
  showAssetSetup()
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

  const selectedEquipmentTypeRow = sortedEquipmentTypes.find(type =>
    String(type.equiptypeid) === String(selectedEquipmentType)
  )
  const frequentOnlyEquipmentSelected = selectedCategory !== "LOADTEST" && [
    "beam clamp",
    "beam clamps",
    "bottle jack",
    "bottlejack",
    "bow shackle",
    "bow shackles",
    "chain sling",
    "chain slings",
    "crawls (plain/geared)",
    "d shackle",
    "d shackles",
    "d-shackle",
    "d-shackles",
    "dee shackle",
    "dee shackles",
    "drum lifter",
    "drum lifters",
    "endless round sling",
    "endless round slings",
    "endless round sling polyester",
    "eye bolt",
    "eye bolts",
    "eye bolt / nut",
    "eyebolt",
    "eyebolts",
    "fall arrestor",
    "fall arrestors",
    "fall arrester",
    "fall arresters",
    "winch",
    "wire rope winch",
    "winch / wire rope winch",
    "winch/wire rope winch",
    "trolley jack",
    "pallet jack",
    "trolley jack / pallet jack",
    "trolley jack/pallet jack",
    "trestle",
    "trestles",
    "steel wire rope sling",
    "steel wire rope slings",
    "safety harness lanyard",
    "safety harness lanyards",
    "safety harness",
    "safety harnesses",
    "polyester sling",
    "polyester slings",
    "webbing sling",
    "webbing slings",
    "polyester sling / webbing sling",
    "polyester sling/webbing sling",
    "plate grab",
    "plate grabs",
    "man cage",
    "man cages",
    "boatswain chair",
    "boatswain chairs",
    "man cage / boatswain chair",
    "man cage/boatswain chair",
    "fork attachments / hooks",
    "hydraulic bottle jack",
    "general lifting devices/equipment",
    "general lifting devices and equipment",
    "manual chain hoist",
    "hoists - manual chain hoist",
    "manual lever hoist",
    "hoists - manual lever hoist"
  ].includes(
    String(selectedEquipmentTypeRow?.description || "").trim().toLowerCase().replace(/\s+/g, " ")
  )
  const selectedInspectionGroup = selectedCategory === "LOADTEST"
    ? "PERIODIC_THOROUGH_INSPECTION"
    : frequentOnlyEquipmentSelected
      ? "FREQUENT_INSPECTION"
      : row.inspection_category || "PERIODIC_THOROUGH_INSPECTION"

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
              <select id="criteriaEquipType" onchange="syncCriteriaInspectionGroup()">
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
              <select id="criteriaCategory" onchange="syncCriteriaInspectionGroup()">
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
              <select id="criteriaFieldType" onchange="syncCriteriaResultType()">
                <option value="PASS_FAIL" ${selectedFieldType === "PASS_FAIL" || selectedFieldType === "PASSFAIL" ? "selected" : ""}>Pass / Fail / N/A</option>
                <option value="YESNO" ${selectedFieldType === "YESNO" || selectedFieldType === "YES_NO" ? "selected" : ""}>YES / NO / N/A</option>
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
                <option value="PERIODIC_THOROUGH_INSPECTION" ${selectedInspectionGroup === "PERIODIC_THOROUGH_INSPECTION" ? "selected" : ""} ${frequentOnlyEquipmentSelected ? "disabled" : ""}>
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

  setCurrentPage("inspections")

  await loadInspectionAssetPage()
}

window.showCertificateSearch = function () {
  if (!ensurePageAccess('certificates')) return

  setCurrentPage("certificates")

  renderCertificateSearch(
    customers,
    sites,
    sections
  )
}

window.showCustomerDetailedReport = function (options = {}) {
  if (!ensurePageAccess('customer-report')) return

  setCurrentPage("customer-report")

  renderCustomerDetailedReport(customers, equipmentTypes, sites, sections, responsiblePersons, options)
}

window.syncCriteriaInspectionGroup = function () {
  const equipmentTypeId = document.querySelector('#criteriaEquipType')?.value
  const inspectionType = document.querySelector('#criteriaCategory')?.value
  const inspectionGroup = document.querySelector('#criteriaInspectionGroup')
  if (!inspectionGroup) return

  const equipmentType = equipmentTypes.find(type =>
    String(type.equiptypeid) === String(equipmentTypeId)
  )
  const isFrequentOnlyEquipment = [
    "beam clamp",
    "beam clamps",
    "bottle jack",
    "bottlejack",
    "bow shackle",
    "bow shackles",
    "chain sling",
    "chain slings",
    "crawls (plain/geared)",
    "d shackle",
    "d shackles",
    "d-shackle",
    "d-shackles",
    "dee shackle",
    "dee shackles",
    "drum lifter",
    "drum lifters",
    "endless round sling",
    "endless round slings",
    "endless round sling polyester",
    "eye bolt",
    "eye bolts",
    "eye bolt / nut",
    "eyebolt",
    "eyebolts",
    "fall arrestor",
    "fall arrestors",
    "fall arrester",
    "fall arresters",
    "winch",
    "wire rope winch",
    "winch / wire rope winch",
    "winch/wire rope winch",
    "trolley jack",
    "pallet jack",
    "trolley jack / pallet jack",
    "trolley jack/pallet jack",
    "trestle",
    "trestles",
    "steel wire rope sling",
    "steel wire rope slings",
    "safety harness lanyard",
    "safety harness lanyards",
    "safety harness",
    "safety harnesses",
    "polyester sling",
    "polyester slings",
    "webbing sling",
    "webbing slings",
    "polyester sling / webbing sling",
    "polyester sling/webbing sling",
    "plate grab",
    "plate grabs",
    "man cage",
    "man cages",
    "boatswain chair",
    "boatswain chairs",
    "man cage / boatswain chair",
    "man cage/boatswain chair",
    "fork attachments / hooks",
    "hydraulic bottle jack",
    "general lifting devices/equipment",
    "general lifting devices and equipment",
    "manual chain hoist",
    "hoists - manual chain hoist",
    "manual lever hoist",
    "hoists - manual lever hoist"
  ].includes(
    String(equipmentType?.description || "").trim().toLowerCase().replace(/\s+/g, " ")
  )
  const periodicOption = inspectionGroup.querySelector('option[value="PERIODIC_THOROUGH_INSPECTION"]')
  const frequentOption = inspectionGroup.querySelector('option[value="FREQUENT_INSPECTION"]')

  if (inspectionType === "LOADTEST") {
    if (periodicOption) periodicOption.disabled = false
    if (frequentOption) frequentOption.disabled = true
    inspectionGroup.value = "PERIODIC_THOROUGH_INSPECTION"
    return
  }

  if (frequentOption) frequentOption.disabled = false
  if (periodicOption) periodicOption.disabled = isFrequentOnlyEquipment
  if (isFrequentOnlyEquipment) inspectionGroup.value = "FREQUENT_INSPECTION"
}

window.syncCriteriaResultType = function () {
  const fieldType = document.querySelector('#criteriaFieldType')?.value
  const resultType = document.querySelector('#criteriaResultType')
  if (!resultType) return

  if (fieldType === "NUMBER") resultType.value = "MEASURED"
  if (fieldType === "YESNO" || fieldType === "YES_NO") resultType.value = "YES_NO"
  if (fieldType === "PASS_FAIL" || fieldType === "PASSFAIL") resultType.value = "PASS_FAIL"
}

window.showSystemHealth = function () {
  if (!ensurePageAccess('system-health')) return

  setCurrentPage("system-health")
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
            <td class="certificate-asset-cell">${escapeHtml(cert.description || "")}</td>
            <td class="certificate-serial-cell">${escapeHtml(cert.serialno || "")}</td>
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

  setCurrentPage("quick-inspection")
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

  const publicAssetCertificatesMatch = raw.match(/\/public\/assets\/(\d+)\/certificates(?:[/?#]|$)/i)
  if (publicAssetCertificatesMatch) return publicAssetCertificatesMatch[1]

  const publicNfcMatch = raw.match(/\/public\/nfc\/(nfc_[A-Za-z0-9_-]{32,64})(?:[/?#]|$)/i)
  if (publicNfcMatch) return publicNfcMatch[1]

  const qrParamMatch = raw.match(/[?&]qr=([^&\s]+)/i)
  if (qrParamMatch) return decodeURIComponent(qrParamMatch[1]).trim()

  const nfcParamMatch = raw.match(/[?&]nfc=([^&\s]+)/i)
  if (nfcParamMatch) return decodeURIComponent(nfcParamMatch[1]).trim()

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
      const lookupPath = /^nfc_[A-Za-z0-9_-]{32,64}$/.test(normalizedSearch)
        ? `/assets/nfc/${encodeURIComponent(normalizedSearch)}`
        : `/assets/qr/${encodeURIComponent(search)}`
      const response = await fetch(`${API_BASE}${lookupPath}`)

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
let quickNfcAbortController = null

function quickNfcRecordValue(record) {
  if (!record?.data) return ''

  try {
    return new TextDecoder(record.encoding || 'utf-8').decode(record.data).trim()
  } catch (err) {
    console.error('Unable to decode NFC record:', err)
    return ''
  }
}

window.startQuickNfcScan = async function ({
  statusSelector = '#quickNfcStatus',
  inputSelector = '#quickAssetSearch',
  findAsset = quickFindAsset
} = {}) {
  const status = document.querySelector(statusSelector)

  if (!('NDEFReader' in window)) {
    if (status) {
      status.hidden = false
      status.textContent = 'NFC scanning is not supported by this browser. Use Chrome on an NFC-enabled Android phone.'
    }
    return
  }

  quickNfcAbortController?.abort()
  quickNfcAbortController = new AbortController()

  try {
    const reader = new window.NDEFReader()
    await reader.scan({ signal: quickNfcAbortController.signal })

    if (status) {
      status.hidden = false
      status.textContent = 'Ready—hold the back of the phone against the NFC tag.'
    }

    reader.addEventListener('readingerror', () => {
      if (status) status.textContent = 'The NFC tag could not be read. Hold the phone against the tag and try again.'
    })

    reader.addEventListener('reading', event => {
      const values = Array.from(event.message?.records || [])
        .map(quickNfcRecordValue)
        .filter(Boolean)
      const scannedValue = values
        .map(normalizeQuickAssetScan)
        .find(value => /^nfc_[A-Za-z0-9_-]{32,64}$/.test(value))

      if (!scannedValue) {
        if (status) status.textContent = 'This NFC tag does not contain a valid ATEC asset link.'
        return
      }

      const searchInput = document.querySelector(inputSelector)
      if (searchInput) searchInput.value = scannedValue
      if (status) status.textContent = 'NFC tag read. Opening the asset…'
      quickNfcAbortController?.abort()
      quickNfcAbortController = null
      findAsset()
    })
  } catch (err) {
    if (err?.name === 'AbortError') return
    console.error('Unable to start NFC scanner:', err)
    if (status) {
      status.hidden = false
      status.textContent = err?.name === 'NotAllowedError'
        ? 'NFC permission was not allowed. Enable NFC and allow access, then try again.'
        : 'NFC scanning could not start. Confirm NFC is enabled and use Chrome on Android.'
    }
  }
}

window.startDashboardNfcScan = function () {
  return window.startQuickNfcScan({
    statusSelector: '#dashboardNfcStatus',
    inputSelector: '#dashboardAssetSearch',
    findAsset: dashboardFindAsset
  })
}

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

  const nfcStatus = await loadAssetNfcStatus(asset.assetid)
  const activeVisitMatch = await loadActiveVisitMatch(asset.assetid)
  const archived = Boolean(asset.archived)
  const canCreateAssetInspection = canPerformInspections() && !archived

  resultBox.innerHTML = `
    <div class="filter-card quick-result-card">
      <div class="quick-result-header">
        <h3>${archived ? "Archived Asset" : "Asset Found"}</h3>
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

        ${archived ? `<p class="login-error">This asset is archived. Inspection and load test actions are disabled.</p>` : ""}

        <div class="form-actions quick-result-actions">
          ${activeVisitMatch.length === 1 ? `
            <button type="button" onclick="openAssetInActiveVisit(${activeVisitMatch[0].visitid}, ${asset.assetid})">
              Open in Visit ${escapeHtml(activeVisitMatch[0].visit_reference || activeVisitMatch[0].visitid)}
            </button>
          ` : activeVisitMatch.length > 1 ? `
            <button type="button" onclick="showVisitChoicesForAsset(${asset.assetid})">
              Choose Active Visit
            </button>
          ` : ""}

          ${canCreateAssetInspection && assetSupportsInspectionWizard(asset, criteria, 'VISUAL') ? `
            <button class="load-test-btn" onclick="startInspection(${asset.assetid}, 'VISUAL', '${returnPage}', 'wizard')">Wizard Inspect</button>
          ` : canCreateAssetInspection ? `
            <button onclick="startInspection(${asset.assetid}, 'VISUAL', '${returnPage}')">Visual Inspection</button>
          ` : ""}

          ${canCreateAssetInspection ? `
            <button class="load-test-btn" onclick="startInspection(${asset.assetid}, 'LOADTEST', '${returnPage}', '${assetSupportsCraneWizard(asset) ? 'wizard' : 'auto'}')">${assetSupportsCraneWizard(asset) ? 'Wizard Load Test' : 'Load Test'}</button>
          ` : ""}

          <button onclick="openAssetQrLabel(${asset.assetid})">QR Label</button>
        </div>

      </div>
      ${renderNfcManagementPanel(asset, nfcStatus)}
    </div>
  `
}

async function loadActiveVisitMatch(assetid) {
  try {
    const response = await fetch(`${API_BASE}/inspection-visits/active-match?assetid=${encodeURIComponent(assetid)}`)
    if (!response.ok) return []
    const result = await response.json()
    return Array.isArray(result.visits) ? result.visits : []
  } catch (err) {
    return []
  }
}

window.openAssetInActiveVisit = async function (visitid, assetid) {
  await markVisitAssetScanned(visitid, assetid)
  await openInspectionVisit(visitid)
}

window.showVisitChoicesForAsset = async function (assetid) {
  const visits = await loadActiveVisitMatch(assetid)
  const choice = prompt(`Choose visit ID:\n${visits.map(visit => `${visit.visitid}: ${visit.visit_reference || ''}`).join('\n')}`)
  const selected = visits.find(visit => String(visit.visitid) === String(choice))
  if (selected) await openAssetInActiveVisit(selected.visitid, assetid)
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

function calculateValidDateFromTestDate(testDateValue, inspectiontype = "VISUAL", inspectionFrequency = "") {
  const testDate = testDateValue ? new Date(`${testDateValue}T00:00:00`) : new Date()
  const validDate = new Date(testDate)
  const normalizedFrequency = String(inspectionFrequency || "").toUpperCase()

  if (inspectiontype === "LOADTEST" || normalizedFrequency === "ANNUAL") {
    validDate.setFullYear(validDate.getFullYear() + 1)
  } else {
    validDate.setMonth(validDate.getMonth() + 3)
  }

  return dateInputValue(validDate)
}

function canSelectInspectionFrequency(asset, inspectiontype = "VISUAL") {
  return inspectiontype !== "LOADTEST" && String(asset?.equipgroupid || "") === "400"
}

function defaultInspectionFrequencyForAsset(asset, inspectiontype = "VISUAL") {
  if (inspectiontype === "LOADTEST") return ""
  return canSelectInspectionFrequency(asset, inspectiontype) ? "ANNUAL" : "FREQUENT"
}

function renderInspectionFrequencyControl(asset, inspectiontype = "VISUAL", selectedFrequency = "") {
  if (inspectiontype === "LOADTEST") {
    return `<input id="inspectionFrequency" type="hidden" value="">`
  }

  if (!canSelectInspectionFrequency(asset, inspectiontype)) {
    return `<input id="inspectionFrequency" type="hidden" value="FREQUENT">`
  }

  const effectiveFrequency = selectedFrequency || window.currentInspectionFrequency || defaultInspectionFrequencyForAsset(asset, inspectiontype)

  return `
    <div class="form-group">
      <label>Inspection Frequency</label>
      <select id="inspectionFrequency" onchange="changeInspectionFrequency(this.value)">
        <option value="ANNUAL" ${effectiveFrequency !== "FREQUENT" ? "selected" : ""}>Annual</option>
        <option value="FREQUENT" ${effectiveFrequency === "FREQUENT" ? "selected" : ""}>Frequent</option>
      </select>
    </div>
  `
}

function criteriaMatchesSelectedFrequency(row, asset, inspectiontype = "VISUAL", inspectionFrequency = "") {
  if (!canSelectInspectionFrequency(asset, inspectiontype)) return true
  if (String(inspectionFrequency || "").toUpperCase() !== "FREQUENT") return true

  return String(row?.inspection_category || "PERIODIC_THOROUGH_INSPECTION").toUpperCase() === "FREQUENT_INSPECTION"
}

window.changeInspectionFrequency = function (inspectionFrequency) {
  const context = window.currentInspectionContext
  if (!context) return

  window.startInspection(
    context.assetid,
    context.inspectiontype,
    context.returnPage,
    context.formMode,
    context.visitid,
    inspectionFrequency
  )
}

window.updateInspectionValidDateFromTestDate = function (inspectiontype = "VISUAL") {
  const testDate = document.querySelector("#inspectionTestDate")?.value || ""
  const validDateInput = document.querySelector("#inspectionValidDate")
  const inspectionFrequency = document.querySelector("#inspectionFrequency")?.value || ""

  if (!validDateInput || !testDate) return
  validDateInput.value = calculateValidDateFromTestDate(testDate, inspectiontype, inspectionFrequency)
}

window.assetSupportsCraneWizard = assetSupportsCraneWizard

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
  if (String(returnPage || "").startsWith("visit:")) {
    const visitid = String(returnPage).split(":")[1]
    if (visitid) {
      window.currentInspectionVisitId = null
      openInspectionVisit(visitid)
      return
    }
  }

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

function isFailedInspectionResultValue(result) {
  return ["FAIL", "NO", "NOT SAFE", "UNSAFE"].includes(String(result || "").trim().toUpperCase())
}

window.updateInspectionSafetyWarning = function () {
  const inspectionCriteria = window.currentInspectionCriteria || []
  const failedCriticalCriteria = inspectionCriteria.filter(row => {
    const result = document.querySelector(`#result-${row.criteriaid}`)?.value
    return isCriticalCriteria(row) && !isSafeContinuationCriteria(row) && isFailedInspectionResultValue(result)
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

function renderCraneAssetDetailGrid(asset, quickDetails = {}) {
  const detailRows = [
    ["Asset ID", asset.assetid],
    ["Asset Tag", asset.assettagno],
    ["Customer", asset.clientname || quickDetails.clientname],
    ["Site", asset.sitename || quickDetails.sitename],
    ["Section", asset.sectionname || quickDetails.sectionname],
    ["Equipment Type", asset.equipmenttype || quickDetails.equipmenttype],
    ["Description", asset.description],
    ["Manufacturer", asset.manufacturer],
    ["Model", asset.model],
    ["Serial No", asset.serialno],
    ["WLL/SWL", asset.wll ? `${asset.wll} kg` : ""],
    ["Span", asset.span ? `${asset.span} mm` : ""],
    ["Height of Lift", asset.heightoflift ? `${asset.heightoflift} mm` : ""],
    ["Hoist", asset.hoistdescription],
    ["Hoist Serial", asset.hoistserialno],
    ["Aux Hoist", asset.auxhoistdescription],
    ["Aux Hoist Serial", asset.auxhoistserialno],
    ["Previous Visual", [quickDetails.lastvisualdate, quickDetails.lastvisualstatus].filter(Boolean).join(" / ")],
    ["Previous Load Test", [quickDetails.lastloadtestdate, quickDetails.lastloadteststatus].filter(Boolean).join(" / ")],
    ["Previous Expiry", quickDetails.lastinspectionvaliddate || quickDetails.lastvisualvaliddate || quickDetails.lastloadtestvaliddate]
  ]

  return `
    <div class="crane-asset-detail-grid">
      ${detailRows.map(([label, value]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value || "-")}</strong>
        </div>
      `).join("")}
    </div>
  `
}

function renderHarnessAssetDetailGrid(asset, quickDetails = {}) {
  const detailRows = [
    ["Asset ID", asset.assetid],
    ["Asset Tag", asset.assettagno],
    ["Customer", asset.clientname || quickDetails.clientname],
    ["Site", asset.sitename || quickDetails.sitename],
    ["Section", asset.sectionname || quickDetails.sectionname],
    ["Equipment Type", asset.equipmenttype || quickDetails.equipmenttype],
    ["Description", asset.description],
    ["Manufacturer", asset.manufacturer],
    ["Model", asset.model],
    ["Serial / Batch No", asset.serialno],
    ["Size", asset.size],
    ["Manufacture Date", asset.manufactdate],
    ["Previous Inspection", [quickDetails.lastvisualdate, quickDetails.lastvisualstatus].filter(Boolean).join(" / ")],
    ["Previous Valid Date", quickDetails.lastinspectionvaliddate || quickDetails.lastvisualvaliddate]
  ]

  return `
    <div class="crane-asset-detail-grid">
      ${detailRows.map(([label, value]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value || "-")}</strong>
        </div>
      `).join("")}
    </div>
  `
}

function renderSlingAssetDetailGrid(asset, quickDetails = {}) {
  const detailRows = [
    ["Asset ID", asset.assetid],
    ["Asset Tag", asset.assettagno],
    ["Customer", asset.clientname || quickDetails.clientname],
    ["Site", asset.sitename || quickDetails.sitename],
    ["Section", asset.sectionname || quickDetails.sectionname],
    ["Equipment Type", asset.equipmenttype || quickDetails.equipmenttype],
    ["Description", asset.description],
    ["Manufacturer", asset.manufacturer],
    ["Model", asset.model],
    ["Serial / ID", asset.serialno],
    ["WLL/SWL", asset.wll ? `${asset.wll} kg` : ""],
    ["Length", asset.effectivelength ? `${asset.effectivelength} mm` : ""],
    ["Diameter", asset.steelwireropemm ? `${asset.steelwireropemm} mm` : ""],
    ["Hook Size", asset.hooksize ? `${asset.hooksize} mm` : ""],
    ["Previous Inspection", [quickDetails.lastvisualdate, quickDetails.lastvisualstatus].filter(Boolean).join(" / ")],
    ["Previous Valid Date", quickDetails.lastinspectionvaliddate || quickDetails.lastvisualvaliddate]
  ]

  return `
    <div class="crane-asset-detail-grid">
      ${detailRows.map(([label, value]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value || "-")}</strong>
        </div>
      `).join("")}
    </div>
  `
}

function renderCraneWizardCriteriaStep(stepTitle, rows, asset, inspectiontype) {
  const measurementRows = rows.filter(row => row.fieldtype === "NUMBER")
  const visualRows = rows.filter(row => row.fieldtype !== "NUMBER")

  return `
    <section class="crane-wizard-step" data-step-title="${escapeAttribute(stepTitle)}">
      <div class="inspection-section-title">${escapeHtml(stepTitle)}</div>

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
    </section>
  `
}

function renderHarnessSetupQuestions() {
  return `
    <div class="harness-setup-fields">
      ${harnessWizardConfig.setupQuestions.map(question => question.type === "text" ? `
        <label class="harness-setup-field harness-setup-field-wide">${escapeHtml(question.label)}
          <input id="${safeAttr(question.id)}" type="text">
        </label>
      ` : `
        <label class="harness-setup-field">${escapeHtml(question.label)}
          <select id="${safeAttr(question.id)}" class="harness-setup-answer">
            <option value="">Select</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>
        </label>
      `).join("")}
    </div>
  `
}

function renderSlingSetupQuestions() {
  return `
    <div class="harness-setup-fields sling-setup-fields">
      ${slingWizardConfig.setupQuestions.map(question => question.type === "text" ? `
        <label class="harness-setup-field harness-setup-field-wide">${escapeHtml(question.label)}
          <input id="${safeAttr(question.id)}" type="text">
        </label>
      ` : `
        <label class="harness-setup-field">${escapeHtml(question.label)}
          <select id="${safeAttr(question.id)}" class="sling-setup-answer">
            <option value="">Select</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>
        </label>
      `).join("")}
    </div>
  `
}

function renderHarnessWizard(asset, assetCriteria, inspectiontype, quickDetails, returnPage) {
  const criteriaSteps = groupCriteriaRows(assetCriteria, harnessWizardConfig, inspectiontype)

  return `
    <div class="crane-wizard harness-wizard" data-return-page="${safeAttr(returnPage)}" data-wizard-name="harness" data-inspection-type="${safeAttr(inspectiontype)}">
      <div class="inspection-wizard-banner crane-wizard-banner">
        <div>
          <span>Guided Harness / Fall-Arrest Inspection</span>
          <strong>${escapeHtml(asset.equipmenttype || "Harness / Fall-Arrest")} - Asset ${escapeHtml(asset.assetid)}</strong>
        </div>
        <p>Uses live equipment criteria, the existing save route, photos, signature, and certificate renderer.</p>
      </div>

      <div class="crane-wizard-progress">
        <div><strong id="craneWizardStepLabel">Step 1</strong><span id="craneWizardStepTitle">Asset confirmation</span></div>
        <progress id="craneWizardProgress" value="1" max="${criteriaSteps.length + 5}"></progress>
      </div>

      <section class="crane-wizard-step" data-step-title="Asset confirmation">
        ${renderHarnessAssetDetailGrid(asset, quickDetails)}
        <div class="quick-photo-grid">
          ${asset.media1 ? `<div class="quick-photo-card"><img src="${safeAttr(uploadUrl(asset.media1))}"></div>` : ""}
          ${asset.media2 ? `<div class="quick-photo-card"><img src="${safeAttr(uploadUrl(asset.media2))}"></div>` : ""}
        </div>
        <label class="crane-confirm-check">
          <input id="craneAssetConfirmed" type="checkbox">
          I confirm this is the correct harness or fall-arrest item.
        </label>
      </section>

      <section class="crane-wizard-step" data-step-title="Inspection setup">
        <div class="inspection-tag-card">
          <div class="inspection-tag-title">INSPECTION SETUP</div>
          <div class="inspector-identity-card">
            <div><span>Logged-in Inspector</span><strong>${escapeHtml(currentUser?.full_name || "-")}</strong></div>
            <div><span>Inspector ID</span><strong>${escapeHtml(currentUser?.user_id || "-")}</strong></div>
            <div><span>Signature</span><strong>${currentUser?.signature_image ? "Saved" : "Not uploaded"}</strong></div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Inspection Date</label>
              <input id="inspectionTestDate" type="date" value="${dateInputValue()}" onchange="updateInspectionValidDateFromTestDate('${inspectiontype}')">
            </div>
            <div class="form-group">
              <label>Inspection Tag No <span class="optional-label">(Optional)</span></label>
              <input id="inspectionTagNo" class="inspection-tag-input" type="text" placeholder="Not issued yet" autocomplete="off">
            </div>
            <div class="form-group">
              <label>Job Number <span class="optional-label">(Accelo reference)</span></label>
              <input id="inspectionJobNumber" type="text" maxlength="200" placeholder="Enter Accelo job number" autocomplete="off">
            </div>
            <div class="form-group">
              <label>Certificate Expiry Date</label>
              <input id="inspectionValidDate" type="date" value="${calculateValidDateFromTestDate(dateInputValue(), inspectiontype, defaultInspectionFrequencyForAsset(asset, inspectiontype))}">
            </div>
            ${renderInspectionFrequencyControl(asset, inspectiontype)}
          </div>
          ${renderHarnessSetupQuestions()}
          <label class="harness-setup-field harness-setup-field-wide">Defect / rejection summary<textarea id="inspectionComments" rows="3"></textarea></label>
        </div>
      </section>

      ${criteriaSteps.map(([section, rows]) => renderCraneWizardCriteriaStep(section, rows, asset, inspectiontype)).join("")}

      <section class="crane-wizard-step" data-step-title="Photos">
        <h3>Photos</h3>
        <p class="muted-text">${escapeHtml(harnessWizardConfig.photoPrompts.join(", "))}</p>
        <input id="inspectionPhotoFiles" type="file" accept="image/*" multiple onchange="handleInspectionPhotoSelection(event)">
        <div id="inspectionPhotoPreview" class="inspection-photo-preview-grid">
          <p class="muted-text">No inspection photos selected.</p>
        </div>
      </section>

      <section class="crane-wizard-step" data-step-title="Inspector declaration">
        <div id="inspectionCriticalWarning" class="inspection-critical-warning" style="display:none;"></div>
        <label class="crane-confirm-check">
          <input id="craneInspectorDeclaration" type="checkbox">
          I examined the relevant accessible components, recorded known defects and limitations, and confirm the final decision reflects this inspection.
        </label>
      </section>

      <section class="crane-wizard-step" data-step-title="Review and submit">
        <div id="craneWizardReview" class="crane-review-panel"></div>
        <label class="crane-confirm-check">
          <input id="craneSubmitConfirmed" type="checkbox">
          I confirm this harness / fall-arrest inspection is ready to save.
        </label>
      </section>

      <div class="crane-wizard-nav">
        <button type="button" class="secondary-btn" onclick="startInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}', 'generic')">Use Generic Form</button>
        <button type="button" class="secondary-btn" onclick="craneWizardBack()">Back</button>
        <button type="button" id="craneWizardNextButton" onclick="craneWizardNext()">Next</button>
        <button type="button" class="load-test-btn" id="craneWizardSubmit" onclick="saveInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}')" hidden>Save ${inspectiontype}</button>
        <button type="button" onclick="returnToInspectionOrigin('${returnPage}')">Cancel</button>
      </div>
    </div>
  `
}

function renderSlingWizard(asset, assetCriteria, inspectiontype, quickDetails, returnPage) {
  const setupTitle = inspectiontype === "LOADTEST" ? "Load-Test Setup" : "Inspection Setup"
  const criteriaSteps = groupCriteriaRows(assetCriteria, slingWizardConfig, inspectiontype)

  return `
    <div class="crane-wizard sling-wizard" data-return-page="${safeAttr(returnPage)}" data-wizard-name="sling" data-inspection-type="${safeAttr(inspectiontype)}">
      <div class="inspection-wizard-banner crane-wizard-banner">
        <div>
          <span>Guided Sling ${inspectiontype === "LOADTEST" ? "Load Test" : "Inspection"}</span>
          <strong>${escapeHtml(asset.equipmenttype || "Sling")} - Asset ${escapeHtml(asset.assetid)}</strong>
        </div>
        <p>Uses live equipment criteria, the existing save route, photos, signature, and certificate renderer.</p>
      </div>

      <div class="crane-wizard-progress">
        <div><strong id="craneWizardStepLabel">Step 1</strong><span id="craneWizardStepTitle">Asset confirmation</span></div>
        <progress id="craneWizardProgress" value="1" max="${criteriaSteps.length + 5}"></progress>
      </div>

      <section class="crane-wizard-step" data-step-title="Asset confirmation">
        ${renderSlingAssetDetailGrid(asset, quickDetails)}
        <div class="quick-photo-grid">
          ${asset.media1 ? `<div class="quick-photo-card"><img src="${safeAttr(uploadUrl(asset.media1))}"></div>` : ""}
          ${asset.media2 ? `<div class="quick-photo-card"><img src="${safeAttr(uploadUrl(asset.media2))}"></div>` : ""}
        </div>
        <label class="crane-confirm-check">
          <input id="craneAssetConfirmed" type="checkbox">
          I confirm this is the correct sling asset.
        </label>
      </section>

      <section class="crane-wizard-step" data-step-title="${escapeAttribute(setupTitle)}">
        <div class="inspection-tag-card">
          <div class="inspection-tag-title">${escapeHtml(setupTitle.toUpperCase())}</div>
          <div class="inspector-identity-card">
            <div><span>Logged-in Inspector</span><strong>${escapeHtml(currentUser?.full_name || "-")}</strong></div>
            <div><span>Inspector ID</span><strong>${escapeHtml(currentUser?.user_id || "-")}</strong></div>
            <div><span>Signature</span><strong>${currentUser?.signature_image ? "Saved" : "Not uploaded"}</strong></div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>${inspectiontype === "LOADTEST" ? "Load Test Date" : "Inspection Date"}</label>
              <input id="inspectionTestDate" type="date" value="${dateInputValue()}" onchange="updateInspectionValidDateFromTestDate('${inspectiontype}')">
            </div>
            <div class="form-group">
              <label>Inspection Tag No <span class="optional-label">(Optional)</span></label>
              <input id="inspectionTagNo" class="inspection-tag-input" type="text" placeholder="Not issued yet" autocomplete="off">
            </div>
            <div class="form-group">
              <label>Job Number <span class="optional-label">(Accelo reference)</span></label>
              <input id="inspectionJobNumber" type="text" maxlength="200" placeholder="Enter Accelo job number" autocomplete="off">
            </div>
            <div class="form-group">
              <label>Certificate Expiry Date</label>
              <input id="inspectionValidDate" type="date" value="${calculateValidDateFromTestDate(dateInputValue(), inspectiontype, defaultInspectionFrequencyForAsset(asset, inspectiontype))}">
            </div>
            ${renderInspectionFrequencyControl(asset, inspectiontype)}
          </div>
          ${inspectiontype === "LOADTEST" ? `
            <div class="crane-load-test-grid">
              <label>Rated WLL<input id="craneRatedCapacity" type="text" value="${escapeAttribute(asset.wll || "")}" readonly></label>
              <label>Intended Test Load<input id="craneIntendedTestLoad" type="number" step="0.01" min="0" placeholder="Manual capture required"></label>
              <label>SWL / Test Load Actually Lifted<input id="craneActualTestLoad" type="number" step="0.01" min="0" placeholder="Enter load actually lifted" required></label>
              <label>Test Duration<input id="craneTestDuration" type="text"></label>
              <label class="crane-wide-field">Reason if full test could not be completed<input id="craneLoadExceptionReason" type="text"></label>
            </div>
          ` : ""}
          ${renderSlingSetupQuestions()}
          <label class="harness-setup-field harness-setup-field-wide">Defect / rejection summary<textarea id="inspectionComments" rows="3"></textarea></label>
        </div>
      </section>

      ${criteriaSteps.map(([section, rows]) => renderCraneWizardCriteriaStep(section, rows, asset, inspectiontype)).join("")}

      <section class="crane-wizard-step" data-step-title="Photos">
        <h3>Photos</h3>
        <p class="muted-text">${escapeHtml(slingWizardConfig.photoPrompts.join(", "))}</p>
        <input id="inspectionPhotoFiles" type="file" accept="image/*" multiple onchange="handleInspectionPhotoSelection(event)">
        <div id="inspectionPhotoPreview" class="inspection-photo-preview-grid">
          <p class="muted-text">No inspection photos selected.</p>
        </div>
      </section>

      <section class="crane-wizard-step" data-step-title="Inspector declaration">
        <div id="inspectionCriticalWarning" class="inspection-critical-warning" style="display:none;"></div>
        <label class="crane-confirm-check">
          <input id="craneInspectorDeclaration" type="checkbox">
          I examined the accessible load-bearing components, recorded known defects and limitations, and confirm the final decision reflects this inspection.
        </label>
      </section>

      <section class="crane-wizard-step" data-step-title="Review and submit">
        <div id="craneWizardReview" class="crane-review-panel"></div>
        <label class="crane-confirm-check">
          <input id="craneSubmitConfirmed" type="checkbox">
          I confirm this sling ${inspectiontype === "LOADTEST" ? "load test" : "inspection"} is ready to save.
        </label>
      </section>

      <div class="crane-wizard-nav">
        <button type="button" class="secondary-btn" onclick="startInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}', 'generic')">Use Generic Form</button>
        <button type="button" class="secondary-btn" onclick="craneWizardBack()">Back</button>
        <button type="button" id="craneWizardNextButton" onclick="craneWizardNext()">Next</button>
        <button type="button" class="load-test-btn" id="craneWizardSubmit" onclick="saveInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}')" hidden>Save ${inspectiontype}</button>
        <button type="button" onclick="returnToInspectionOrigin('${returnPage}')">Cancel</button>
      </div>
    </div>
  `
}

function renderCraneWizard(asset, assetCriteria, inspectiontype, quickDetails, returnPage) {
  const setupTitle = inspectiontype === "LOADTEST" ? "Test Setup" : "Inspection Setup"
  const criteriaSteps = groupCriteriaRows(assetCriteria, craneWizardConfig, inspectiontype)

  return `
    <div class="crane-wizard" data-return-page="${safeAttr(returnPage)}">
      <div class="inspection-wizard-banner crane-wizard-banner">
        <div>
          <span>Guided Crane ${inspectiontype === "LOADTEST" ? "Load Test" : "Inspection"}</span>
          <strong>${escapeHtml(asset.equipmenttype || "Crane")} - Asset ${escapeHtml(asset.assetid)}</strong>
        </div>
        <p>Uses live equipment criteria, the existing save route, photos, signature, and certificate renderer.</p>
      </div>

      <div class="crane-wizard-progress">
        <div><strong id="craneWizardStepLabel">Step 1</strong><span id="craneWizardStepTitle">Asset confirmation</span></div>
        <progress id="craneWizardProgress" value="1" max="${criteriaSteps.length + 5}"></progress>
      </div>

      <section class="crane-wizard-step" data-step-title="Asset confirmation">
        ${renderCraneAssetDetailGrid(asset, quickDetails)}
        <div class="quick-photo-grid">
          ${asset.media1 ? `<div class="quick-photo-card"><img src="${safeAttr(uploadUrl(asset.media1))}"></div>` : ""}
          ${asset.media2 ? `<div class="quick-photo-card"><img src="${safeAttr(uploadUrl(asset.media2))}"></div>` : ""}
        </div>
        <label class="crane-confirm-check">
          <input id="craneAssetConfirmed" type="checkbox">
          I confirm this is the correct crane asset.
        </label>
      </section>

      <section class="crane-wizard-step" data-step-title="${escapeAttribute(setupTitle)}">
        <div class="inspection-tag-card">
          <div class="inspection-tag-title">${escapeHtml(setupTitle.toUpperCase())}</div>
          <div class="inspector-identity-card">
            <div><span>Logged-in Inspector</span><strong>${escapeHtml(currentUser?.full_name || "-")}</strong></div>
            <div><span>LMI Number</span><strong>${escapeHtml(currentUser?.lmi_number || "-")}</strong></div>
            <div><span>Signature</span><strong>${currentUser?.signature_image ? "Saved" : "Not uploaded"}</strong></div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>${inspectiontype === "LOADTEST" ? "Load Test Date" : "Inspection Date"}</label>
              <input id="inspectionTestDate" type="date" value="${dateInputValue()}" onchange="updateInspectionValidDateFromTestDate('${inspectiontype}')">
            </div>
            <div class="form-group">
              <label>Inspection Tag No <span class="optional-label">(Optional)</span></label>
              <input id="inspectionTagNo" class="inspection-tag-input" type="text" placeholder="Not issued yet" autocomplete="off">
            </div>
            <div class="form-group">
              <label>Job Number <span class="optional-label">(Accelo reference)</span></label>
              <input id="inspectionJobNumber" type="text" maxlength="200" placeholder="Enter Accelo job number" autocomplete="off">
            </div>
            <div class="form-group">
              <label>Certificate Expiry Date</label>
              <input id="inspectionValidDate" type="date" value="${calculateValidDateFromTestDate(dateInputValue(), inspectiontype, defaultInspectionFrequencyForAsset(asset, inspectiontype))}">
            </div>
            ${renderInspectionFrequencyControl(asset, inspectiontype)}
          </div>
          ${inspectiontype === "LOADTEST" ? `
            <div class="crane-load-test-grid">
              <label>Rated Capacity<input id="craneRatedCapacity" type="text" value="${escapeAttribute(asset.wll || "")}" readonly></label>
              <label>Intended Test Load<input id="craneIntendedTestLoad" type="number" step="0.01" min="0" placeholder="Manual capture required"></label>
              <label>SWL / Test Load Actually Lifted<input id="craneActualTestLoad" type="number" step="0.01" min="0" placeholder="Enter load actually lifted" required></label>
              <label>Test Duration<input id="craneTestDuration" type="text" placeholder="e.g. 10 min"></label>
              <label class="crane-wide-field">Reason if full prescribed load could not be applied<input id="craneLoadExceptionReason" type="text"></label>
            </div>
          ` : ""}
          <label class="crane-wide-field">Defect summary / inspection notes<textarea id="inspectionComments" rows="3"></textarea></label>
        </div>
      </section>

      ${criteriaSteps.map(([section, rows]) => renderCraneWizardCriteriaStep(section, rows, asset, inspectiontype)).join("")}

      <section class="crane-wizard-step" data-step-title="Photos">
        <h3>Photos</h3>
        <p class="muted-text">Add crane, identification plate, hook, hoist, rope/chain, control station, safety-device, defect, or load-test setup photos where needed.</p>
        <input id="inspectionPhotoFiles" type="file" accept="image/*" multiple onchange="handleInspectionPhotoSelection(event)">
        <div id="inspectionPhotoPreview" class="inspection-photo-preview-grid">
          <p class="muted-text">No inspection photos selected.</p>
        </div>
      </section>

      <section class="crane-wizard-step" data-step-title="Inspector declaration">
        <div id="inspectionCriticalWarning" class="inspection-critical-warning" style="display:none;"></div>
        <label class="crane-confirm-check">
          <input id="craneInspectorDeclaration" type="checkbox">
          I conducted or supervised this inspection, recorded known defects, and confirm the final status reflects the result.
        </label>
      </section>

      <section class="crane-wizard-step" data-step-title="Review and submit">
        <div id="craneWizardReview" class="crane-review-panel"></div>
        <label class="crane-confirm-check">
          <input id="craneSubmitConfirmed" type="checkbox">
          I confirm this crane ${inspectiontype === "LOADTEST" ? "load test" : "inspection"} is ready to save.
        </label>
      </section>

      <div class="crane-wizard-nav">
        <button type="button" class="secondary-btn" onclick="startInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}', 'generic')">Use Generic Form</button>
        <button type="button" class="secondary-btn" onclick="craneWizardBack()">Back</button>
        <button type="button" id="craneWizardNextButton" onclick="craneWizardNext()">Next</button>
        <button type="button" class="load-test-btn" id="craneWizardSubmit" onclick="saveInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}')" hidden>Save ${inspectiontype}</button>
        <button type="button" onclick="returnToInspectionOrigin('${returnPage}')">Cancel</button>
      </div>
    </div>
  `
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

function renderGenericInspectionCriteria(asset, measurementCriteria, visualCriteria, inspectiontype, showTypeHeadings = true) {
  return `
    ${measurementCriteria.length ? `
      ${showTypeHeadings ? `<div class="inspection-section-title">
        Measurements
      </div>` : ""}

      <div class="inspection-header measurements ${inspectiontype === "LOADTEST" ? "loadtest-measurements" : ""}">
        <div>Criteria</div>
        <div>Standard Dimension</div>
        <div>Measured Dimension</div>
        ${inspectiontype === "LOADTEST" ? "<div>Comments / Remarks</div>" : ""}
      </div>

      ${measurementCriteria.map(row => renderMeasurementCriteriaRow(row, asset, inspectiontype)).join("")}
    ` : ""}

    ${visualCriteria.length ? `
      ${showTypeHeadings ? `<div class="inspection-section-title">
        Visual Inspection
      </div>` : ""}

      <div class="inspection-header visual">
        <div>Criteria</div>
        <div>Result</div>
        <div>Reason for FAIL (required)</div>
      </div>

      ${visualCriteria.map(row => renderVisualCriteriaRow(row)).join("")}
    ` : ""}
  `
}

function renderGroupedGenericInspectionCriteria(asset, assetCriteria, inspectiontype, config) {
  return groupCriteriaRows(assetCriteria, config, inspectiontype)
    .map(([section, rows]) => {
      const measurementRows = rows.filter(row => row.fieldtype === "NUMBER")
      const visualRows = rows.filter(row => row.fieldtype !== "NUMBER")

      return `
        <section class="generic-inspection-section" data-section-title="${escapeAttribute(section)}">
          <div class="inspection-section-title">${escapeHtml(section)}</div>
          ${renderGenericInspectionCriteria(asset, measurementRows, visualRows, inspectiontype, false)}
        </section>
      `
    })
    .join("")
}

function renderChainBlockWizard(asset, assetCriteria, inspectiontype) {
  const groupedSections = groupCriteriaRows(assetCriteria, chainBlockWizardConfig, inspectiontype)

  return `
    <div class="inspection-wizard-banner">
      <div>
        <span>Inspection Wizard</span>
        <strong>Chain Block / Lever Hoist</strong>
      </div>
      <p>Guided sections use the same saved criteria and certificate output as the normal inspection form.</p>
    </div>

    ${groupedSections.map(([section, rows]) => {
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
  const wizardKey = getInspectionWizardKey(asset, assetCriteria, inspectiontype)

  if (wizardKey === "CRANE") {
    return renderGroupedGenericInspectionCriteria(asset, assetCriteria, inspectiontype, craneWizardConfig)
  }

  if (wizardKey === "CHAIN_BLOCK_LEVER_HOIST") {
    return renderChainBlockWizard(asset, assetCriteria, inspectiontype)
  }

  return renderGenericInspectionCriteria(asset, measurementCriteria, visualCriteria, inspectiontype)
}

window.pendingInspectionPhotos = []
window.craneWizardCurrentStep = 0
window.inspectionSaveInProgress = false

function getCraneWizardSteps() {
  return Array.from(document.querySelectorAll(".crane-wizard-step"))
}

function getCraneFailedCriticalCriteria() {
  return (window.currentInspectionCriteria || []).filter(row => {
    const result = document.querySelector(`#result-${row.criteriaid}`)?.value
    return isCriticalCriteria(row) && !isSafeContinuationCriteria(row) && isFailedInspectionResultValue(result)
  })
}

function validateCraneWizardStep(stepIndex) {
  const steps = getCraneWizardSteps()
  const step = steps[stepIndex]
  if (!step) return true

  if (step.querySelector("#craneAssetConfirmed") && !document.querySelector("#craneAssetConfirmed")?.checked) {
    alert("Confirm the correct asset before continuing.")
    return false
  }

  const testDateInput = step.querySelector("#inspectionTestDate")
  const validDateInput = step.querySelector("#inspectionValidDate")
  if (testDateInput && !testDateInput.value) {
    alert("Select an inspection date before continuing.")
    testDateInput.focus()
    return false
  }
  if (validDateInput && !validDateInput.value) {
    alert("Select a valid date before continuing.")
    validDateInput.focus()
    return false
  }
  if (testDateInput?.value && validDateInput?.value && new Date(validDateInput.value) < new Date(testDateInput.value)) {
    alert("Valid date cannot be before the inspection date.")
    validDateInput.focus()
    return false
  }

  const unansweredHarnessSetup = Array.from(step.querySelectorAll(".harness-setup-answer")).find(input => !input.value)
  if (unansweredHarnessSetup) {
    alert("Complete the harness inspection setup questions before continuing.")
    unansweredHarnessSetup.focus()
    return false
  }

  const harnessIncompleteReason = document.querySelector("#harnessInspectionIncompleteReason")
  const needsIncompleteReason = [
    "#harnessAvailableForFullExamination",
    "#harnessCleanEnoughForInspection"
  ].some(selector => document.querySelector(selector)?.value === "NO")
  if (step.querySelector("#harnessInspectionIncompleteReason") && needsIncompleteReason && !harnessIncompleteReason?.value.trim()) {
    alert("Enter a reason when the harness inspection could not be fully completed.")
    harnessIncompleteReason?.focus()
    return false
  }

  const unansweredSlingSetup = Array.from(step.querySelectorAll(".sling-setup-answer")).find(input => !input.value)
  if (unansweredSlingSetup) {
    alert("Complete the sling inspection setup questions before continuing.")
    unansweredSlingSetup.focus()
    return false
  }

  const slingIncompleteReason = document.querySelector("#slingInspectionIncompleteReason")
  const needsSlingIncompleteReason = document.querySelector("#slingCleanAvailable")?.value === "NO"
  if (step.querySelector("#slingInspectionIncompleteReason") && needsSlingIncompleteReason && !slingIncompleteReason?.value.trim()) {
    alert("Enter a reason when the sling inspection could not be fully completed.")
    slingIncompleteReason?.focus()
    return false
  }

  const badNumber = Array.from(step.querySelectorAll('input[type="number"], input[id^="measured-"]')).find(input =>
    input.value.trim() && !Number.isFinite(Number(input.value))
  )

  if (badNumber) {
    alert("Enter a valid numeric measurement.")
    badNumber.focus()
    return false
  }

  const failedWithoutComment = Array.from(step.querySelectorAll('select[id^="result-"]')).find(select => {
    if (!["FAIL", "NO"].includes(select.value)) return false
    const id = select.id.replace("result-", "")
    const row = (window.currentInspectionCriteria || []).find(item => String(item.criteriaid) === id)
    if (isSafeContinuationCriteria(row) && select.dataset.autoForcedSafety === "true") return false
    return !document.querySelector(`#remarks-${id}`)?.value.trim()
  })

  if (failedWithoutComment) {
    const id = failedWithoutComment.id.replace("result-", "")
    document.querySelector(`#fail-remarks-${id}`)?.style.removeProperty("display")
    alert("Enter a reason/comment for every failed crane criterion.")
    document.querySelector(`#remarks-${id}`)?.focus()
    return false
  }

  if (step.querySelector("#craneInspectorDeclaration") && !document.querySelector("#craneInspectorDeclaration")?.checked) {
    alert("Confirm the inspector declaration before review.")
    return false
  }

  if (step.querySelector("#craneSubmitConfirmed") && !document.querySelector("#craneSubmitConfirmed")?.checked) {
    alert("Confirm the review before saving.")
    return false
  }

  return true
}

function getHarnessSetupReviewRows() {
  if (!document.querySelector(".harness-wizard")) return []

  return harnessWizardConfig.setupQuestions.map(question => {
    const value = document.querySelector(`#${question.id}`)?.value || ""
    return [question.label, value || "-"]
  })
}

function getSlingSetupReviewRows() {
  if (!document.querySelector(".sling-wizard")) return []

  return slingWizardConfig.setupQuestions.map(question => {
    const value = document.querySelector(`#${question.id}`)?.value || ""
    return [question.label, value || "-"]
  })
}

function renderCraneWizardReview() {
  const review = document.querySelector("#craneWizardReview")
  if (!review) return

  updateInspectionSafetyWarning()
  const failedRows = (window.currentInspectionCriteria || []).filter(row => {
    const result = document.querySelector(`#result-${row.criteriaid}`)?.value
    return isFailedInspectionResultValue(result)
  })
  const measuredRows = (window.currentInspectionCriteria || []).filter(row =>
    document.querySelector(`#measured-${row.criteriaid}`)?.value
  )
  const criticalRows = getCraneFailedCriticalCriteria()
  const finalStatus = failedRows.length || criticalRows.length ? "NOT SAFE" : "SAFE"
  const photoCount = (window.pendingInspectionPhotos || []).length
  const harnessRows = getHarnessSetupReviewRows()
  const slingRows = getSlingSetupReviewRows()

  review.innerHTML = `
    <div class="crane-review-grid">
      <div><span>Inspection Type</span><strong>${escapeHtml(document.querySelector("#inspectionTestDate") ? (document.querySelector(".crane-wizard")?.dataset.inspectionType || "") : "")}</strong></div>
      <div><span>Test Date</span><strong>${escapeHtml(document.querySelector("#inspectionTestDate")?.value || "-")}</strong></div>
      <div><span>Valid Date</span><strong>${escapeHtml(document.querySelector("#inspectionValidDate")?.value || "-")}</strong></div>
      <div><span>Inspection Tag Number</span><strong>${escapeHtml(inspectionTagDisplay(document.querySelector("#inspectionTagNo")?.value))}</strong></div>
      <div><span>Job Number</span><strong>${escapeHtml(document.querySelector("#inspectionJobNumber")?.value || "-")}</strong></div>
      <div><span>Inspector</span><strong>${escapeHtml(currentUser?.full_name || "-")}</strong></div>
      <div><span>Signature</span><strong>${currentUser?.signature_image ? "Saved" : "Not uploaded"}</strong></div>
      <div><span>Photos</span><strong>${photoCount}</strong></div>
      <div><span>Final Status</span><strong class="${finalStatus === "SAFE" ? "status-safe" : "status-unsafe"}">${finalStatus}</strong></div>
    </div>
    ${harnessRows.length ? `<h3>Fall-Arrest History / Inspection Conditions</h3><ul>${harnessRows.map(([label, value]) => `<li>${escapeHtml(label)}: ${escapeHtml(value)}</li>`).join("")}</ul>` : ""}
    ${slingRows.length ? `<h3>Sling Setup / Load History</h3><ul>${slingRows.map(([label, value]) => `<li>${escapeHtml(label)}: ${escapeHtml(value)}</li>`).join("")}</ul>` : ""}
    ${criticalRows.length ? `<div class="inspection-critical-warning"><strong>Forced NOT SAFE:</strong> ${criticalRows.map(inspectionCriteriaText).map(escapeHtml).join("; ")}</div>` : ""}
    ${failedRows.length ? `<h3>Failed / Not Safe Criteria</h3><ul>${failedRows.map(row => `<li>${escapeHtml(inspectionCriteriaText(row))}</li>`).join("")}</ul>` : "<p>No failed criteria recorded.</p>"}
    ${measuredRows.length ? `<h3>Measured Values</h3><ul>${measuredRows.map(row => `<li>${escapeHtml(inspectionCriteriaText(row))}: ${escapeHtml(document.querySelector(`#measured-${row.criteriaid}`)?.value || "")}</li>`).join("")}</ul>` : ""}
    <h3>Defect Summary</h3>
    <p>${escapeHtml(document.querySelector("#inspectionComments")?.value || "-")}</p>
  `
}

function updateCraneWizardStep() {
  const steps = getCraneWizardSteps()
  if (!steps.length) return
  window.craneWizardCurrentStep = Math.max(0, Math.min(window.craneWizardCurrentStep || 0, steps.length - 1))
  steps.forEach((step, index) => {
    step.hidden = index !== window.craneWizardCurrentStep
  })
  const title = steps[window.craneWizardCurrentStep]?.dataset.stepTitle || ""
  const label = document.querySelector("#craneWizardStepLabel")
  const titleNode = document.querySelector("#craneWizardStepTitle")
  const progress = document.querySelector("#craneWizardProgress")
  const submit = document.querySelector("#craneWizardSubmit")
  const navNext = document.querySelector("#craneWizardNextButton")

  if (label) label.textContent = `Step ${window.craneWizardCurrentStep + 1} of ${steps.length}`
  if (titleNode) titleNode.textContent = title
  if (progress) {
    progress.max = steps.length
    progress.value = window.craneWizardCurrentStep + 1
  }
  if (window.craneWizardCurrentStep === steps.length - 1) renderCraneWizardReview()
  if (submit) submit.hidden = window.craneWizardCurrentStep !== steps.length - 1
  if (navNext) navNext.hidden = window.craneWizardCurrentStep === steps.length - 1
  window.scrollTo({ top: 0, behavior: "smooth" })
}

window.craneWizardNext = function () {
  if (!validateCraneWizardStep(window.craneWizardCurrentStep || 0)) return
  window.craneWizardCurrentStep = (window.craneWizardCurrentStep || 0) + 1
  updateCraneWizardStep()
}

window.craneWizardBack = function () {
  window.craneWizardCurrentStep = Math.max(0, (window.craneWizardCurrentStep || 0) - 1)
  updateCraneWizardStep()
}

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

window.startInspection = async function (assetid, inspectiontype = "VISUAL", returnPage = "quick", formMode = "auto", visitid = null, selectedFrequency = "") {
  if (!canPerformInspections()) {
    alert("You do not have permission to create inspections or load tests.")
    return
  }

  window.currentInspectionVisitId = visitid || null
  window.currentInspectionContext = { assetid, inspectiontype, returnPage, formMode, visitid }

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

  const quickDetails = await quickDetailsResponse.json()

  window.scrollTo(0, 0)

window.pendingInspectionPhotos = []

let assetCriteria = getInspectionCriteriaRows(criteria.filter(
    c =>
    String(c.equiptypeid) === String(asset.equiptypeid) &&
    String(c.inspectioncategory) === String(inspectiontype) &&
    c.active !== false
), inspectiontype)

const defaultInspectionFrequency = ["ANNUAL", "FREQUENT"].includes(String(selectedFrequency).toUpperCase())
  ? String(selectedFrequency).toUpperCase()
  : defaultInspectionFrequencyForAsset(asset, inspectiontype)
window.currentInspectionFrequency = defaultInspectionFrequency

assetCriteria = assetCriteria.filter(row =>
  criteriaMatchesSelectedFrequency(row, asset, inspectiontype, defaultInspectionFrequency)
)

assetCriteria = assetCriteria.filter(row =>
  !isCrawlBeamHoistSerialLoadTestCriteria(asset, row, inspectiontype)
)

const measurementCriteria = assetCriteria.filter(row => row.fieldtype === "NUMBER")
const visualCriteria = assetCriteria.filter(row => row.fieldtype !== "NUMBER")

window.currentInspectionCriteria = assetCriteria
window.currentInspectionType = inspectiontype
const showInspectionPhotoUpload = String(asset.equipgroupid || "") === "400"
const defaultValidDate = calculateValidDateFromTestDate(defaultTestDate, inspectiontype, defaultInspectionFrequency)

const inspectionWizardKey = getInspectionWizardKey(asset, assetCriteria, inspectiontype)

if (formMode !== "generic" && inspectionWizardKey === "CRANE") {
  document.querySelector('#page').innerHTML = renderCraneWizard(asset, assetCriteria, inspectiontype, quickDetails, returnPage)
  document.querySelector(".crane-wizard")?.setAttribute("data-inspection-type", inspectiontype)
  window.craneWizardCurrentStep = 0
  updateCraneWizardStep()
  return
}

if (formMode !== "generic" && inspectionWizardKey === "HARNESS_FALL_ARREST") {
  document.querySelector('#page').innerHTML = renderHarnessWizard(asset, assetCriteria, inspectiontype, quickDetails, returnPage)
  window.craneWizardCurrentStep = 0
  updateCraneWizardStep()
  return
}

if (formMode !== "generic" && inspectionWizardKey === "SLING") {
  document.querySelector('#page').innerHTML = renderSlingWizard(asset, assetCriteria, inspectiontype, quickDetails, returnPage)
  window.craneWizardCurrentStep = 0
  updateCraneWizardStep()
  return
}

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
          ${assetSupportsInspectionWizard(asset, assetCriteria, inspectiontype) ? `
            <button class="load-test-btn" onclick="startInspection(${asset.assetid}, '${inspectiontype}', '${returnPage}', 'wizard')">
              ${escapeHtml(wizardActionLabel(asset, assetCriteria, inspectiontype))}
            </button>
          ` : ""}

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

  <h3>Replace Asset Photos</h3>

  <p class="muted-text">
    Choose a replacement only when the asset master photo should be updated on save.
  </p>

  <div class="asset-photo-row inspection-asset-photo-row">
    <div class="form-group">
      <label>Replace Asset Photo 1</label>
      <input id="inspectionAssetPhoto1" type="file" accept="image/*">
    </div>

    <div class="form-group">
      <label>Replace Asset Photo 2</label>
      <input id="inspectionAssetPhoto2" type="file" accept="image/*">
    </div>
  </div>

  ${showInspectionPhotoUpload ? `
    <hr>

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
  ` : ""}

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
        autocomplete="off"
        placeholder="ENTER TAG NUMBER"
      >
    </div>

    <div class="form-group">
      <label>Job Number <span class="optional-label">(Accelo reference)</span></label>
      <input
        id="inspectionJobNumber"
        type="text"
        maxlength="200"
        autocomplete="off"
        placeholder="Enter Accelo job number"
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

    ${renderInspectionFrequencyControl(asset, inspectiontype)}

  </div>

  ${inspectiontype === "LOADTEST" ? `
    <div class="crane-load-test-grid">
      <label>Rated Capacity / WLL<input id="craneRatedCapacity" type="text" value="${escapeAttribute(asset.wll || "")}" readonly></label>
      <label>Required Test Load<input id="craneIntendedTestLoad" type="number" step="0.01" min="0" placeholder="Enter prescribed test load"></label>
      <label>SWL / Test Load Actually Lifted<input id="craneActualTestLoad" type="number" step="0.01" min="0" placeholder="Enter load actually lifted" required></label>
      <label>Test Duration<input id="craneTestDuration" type="text" placeholder="e.g. 10 minutes"></label>
      <label class="crane-wide-field">Reason if prescribed test could not be completed<input id="craneLoadExceptionReason" type="text"></label>
    </div>
  ` : ""}

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

  const [response, archiveResponse] = await Promise.all([
    fetch(`${API_BASE}/assets/${assetid}/inspection-history`),
    fetch(`${API_BASE}/assets/${assetid}/archive-history`)
  ])

  const history = await response.json()
  const archiveHistory = await archiveResponse.json()

  if (!response.ok) {
    alert("Error loading inspection history: " + history.error)
    return
  }

  if (!archiveResponse.ok) {
    alert("Error loading archive history: " + archiveHistory.error)
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

    <div class="filter-card">
      <h3>Archive History</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Action</th>
            <th>Reason</th>
            <th>Performed By</th>
          </tr>
        </thead>
        <tbody>
          ${archiveHistory.length ? archiveHistory.map(row => `
            <tr>
              <td>${escapeHtml(row.created_at ? new Date(row.created_at).toLocaleString() : '')}</td>
              <td>${escapeHtml(row.action || '')}</td>
              <td>${escapeHtml(row.reason || '-')}</td>
              <td>${escapeHtml(row.performed_by || 'System')}</td>
            </tr>
          `).join('') : `
            <tr>
              <td colspan="4">No archive history found</td>
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
                  ${!canManageAssetRecords()
                    ? `<button onclick="quickOpenAsset(${asset.assetid})">View Asset</button>`
                    : `
                  ${
                    assetSupportsInspectionWizard(asset, criteria, 'VISUAL')
                      ? `<button class="load-test-btn" onclick="startInspection(${asset.assetid}, 'VISUAL', 'quick', 'wizard')">${escapeHtml(wizardActionLabel(asset, criteria, 'VISUAL'))}</button>`
                      : `<button onclick="startInspection(${asset.assetid}, 'VISUAL', 'quick')">Inspect</button>`
                  }
                  ${
                    assetSupportsLoadTest(asset)
                      ? `<button class="load-test-btn" onclick="startInspection(${asset.assetid}, 'LOADTEST', 'quick', '${assetSupportsCraneWizard(asset) ? 'wizard' : 'auto'}')">${assetSupportsCraneWizard(asset) ? 'Wizard Load Test' : 'Load Test'}</button>`
                      : ""
                  }
                  `}
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
    loadDashboardNotificationScheduler()
    loadDashboardNotificationCentre(data.notificationCentre || [])
    loadDashboardNotificationHistory()
    loadDashboardFailedEquipment(data.failedEquipmentByCustomer || [])
    loadDashboardUpcomingExpiries(data.upcomingExpiriesByCustomer || [])
    loadDashboardTopCustomers(data.topCustomers || [])
    loadDashboardEquipmentTypes(data.equipmentByType || [])
  } catch (err) {
    console.error("Failed to load dashboard summary:", err)
    loadDashboardAlerts()
    loadDashboardNotificationScheduler()
    loadDashboardNotificationCentre()
    loadDashboardNotificationHistory()
    loadDashboardFailedEquipment()
    loadDashboardUpcomingExpiries()
    loadDashboardTopCustomers()
    loadDashboardEquipmentTypes()
  }
}

const dashboardReviewQueues = {
  "incomplete-inspections": {
    title: "Incomplete Inspections",
    empty: "No incomplete inspections found.",
    columns: [
      ["Inspection", row => row.testid],
      ["Asset", row => row.assetid],
      ["Customer", row => row.clientname],
      ["Site", row => row.sitename],
      ["Type", row => row.inspectiontype],
      ["Date", row => formatDashboardReviewDate(row.testdate)],
      ["Inspector", row => row.inspector],
      ["Issue", row => row.issue]
    ],
    action: row => `<button class="small-btn" onclick="showDashboardCustomerReport(${safeAttr(row.clientid)})">View Report</button>`
  },
  "certificate-metadata": {
    title: "Certificate Metadata Review",
    empty: "No certificate metadata issues found.",
    columns: [
      ["Asset", row => row.assetid],
      ["Customer", row => row.clientname],
      ["Site", row => row.sitename],
      ["Equipment", row => row.equipmenttype],
      ["Issue", row => row.issue],
      ["Visual Date", row => formatDashboardReviewDate(row.visualtestdate)],
      ["Load Date", row => formatDashboardReviewDate(row.loadtestdate)]
    ],
    action: row => `
      ${currentUser?.role === 'ADMIN' ? [row.visualtestid, row.loadtestid]
        .filter(testid => testid && String(row.issue || '').toLowerCase().includes(testid === row.visualtestid ? 'visual missing signature' : 'load test missing signature'))
        .map(testid => `<label class="metadata-repair-select"><input type="checkbox" class="metadata-repair-checkbox" value="${safeAttr(testid)}"> Repair ${testid === row.visualtestid ? 'visual' : 'load'} signature</label>`)
        .join('') : ''}
      <button class="small-btn" onclick="showDashboardCustomerReport(${safeAttr(row.clientid)})">View Report</button>
    `
  },
  "missing-section": {
    title: "Assets Missing Section",
    empty: "No assets are missing a section.",
    columns: [
      ["Asset", row => row.assetid],
      ["Customer", row => row.clientname],
      ["Site", row => row.sitename],
      ["Asset Tag", row => row.assettagno],
      ["Serial No", row => row.serialno],
      ["Equipment", row => row.equipmenttype],
      ["Issue", row => row.issue]
    ],
    action: row => canArchiveOrMoveAssetRecords()
      ? row.siteid
        ? `<button class="small-btn" onclick="openDashboardSectionAllocation(${safeAttr(row.assetid)}, ${safeAttr(row.siteid)})">Allocate Section</button>`
        : `<button class="small-btn" onclick="editAsset(${safeAttr(row.assetid)})">Set Site & Section</button>`
      : `<button class="small-btn" onclick="quickOpenAsset(${safeAttr(row.assetid)})">View Asset</button>`
  },
  "types-without-criteria": {
    title: "Types Without Criteria",
    empty: "Every active equipment type in use has active criteria.",
    columns: [
      ["Equipment Type", row => row.equipmenttype],
      ["Assets", row => row.assets],
      ["Customers", row => row.customers],
      ["Sample Asset", row => row.sampleassetid],
      ["Issue", row => row.issue]
    ],
    action: row => currentUser?.role === 'ADMIN'
      ? `<button class="small-btn" onclick="openCriteriaForEquipmentType(${safeAttr(row.equiptypeid)})">Open Criteria</button>`
      : `<button class="small-btn" onclick="showCustomerDetailedReport(${safeAttr(JSON.stringify({ equiptypeid: row.equiptypeid, autoLoad: true }))})">View Assets</button>`
  },
  overdue: {
    title: "Overdue Assets",
    empty: "No overdue assets found.",
    columns: [
      ["Asset", row => row.assetid],
      ["Customer", row => row.clientname],
      ["Site", row => row.sitename],
      ["Section", row => row.sectionname],
      ["Equipment", row => row.equipmenttype],
      ["Issue", row => row.issue],
      ["Visual Due", row => formatDashboardReviewDate(row.nextvisualdue)],
      ["Load Due", row => formatDashboardReviewDate(row.nextloaddue)]
    ],
    action: row => `<button class="small-btn" onclick="showDashboardCustomerReport(${safeAttr(row.clientid)})">View Report</button>`
  }
}

window.showDashboardReviewQueue = async function (queueKey) {
  const config = dashboardReviewQueues[queueKey]
  const panel = document.querySelector("#dashboardReviewQueue")
  const title = document.querySelector("#dashboardReviewQueueTitle")
  const body = document.querySelector("#dashboardReviewQueueBody")

  if (!config || !panel || !title || !body) return

  panel.hidden = false
  title.textContent = config.title
  body.innerHTML = `<div class="report-preview-empty">Loading review queue...</div>`
  panel.scrollIntoView({ behavior: "smooth", block: "start" })

  try {
    const response = await fetch(`${API_BASE}/dashboard/review-queue/${queueKey}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || "Failed to load review queue")
    }

    window.dashboardReviewQueueState = {
      key: queueKey,
      title: config.title,
      rows: data.rows || []
    }

    body.innerHTML = renderDashboardReviewQueue(config, data.rows || [])
  } catch (err) {
    console.error("Failed to load dashboard review queue:", err)
    body.innerHTML = `
      <div class="alert-card warning">
        Unable to load this review queue.
      </div>
    `
  }
}

window.closeDashboardReviewQueue = function () {
  const panel = document.querySelector("#dashboardReviewQueue")
  if (panel) panel.hidden = true
}

window.showDashboardCustomerReport = function (clientid) {
  showCustomerDetailedReport({ clientid, autoLoad: true })
}

window.openDashboardSectionAllocation = function (assetid, siteid) {
  if (!canArchiveOrMoveAssetRecords()) {
    alert('You do not have permission to allocate asset sections.')
    return
  }

  const queueRow = window.dashboardReviewQueueState?.rows?.find(row => String(row.assetid) === String(assetid))
  const sitename = queueRow?.sitename || 'Selected site'
  const availableSections = sections
    .filter(section => String(section.siteid) === String(siteid) && !(section.archived === true || section.archived === 'true'))
    .sort((a, b) => String(a.sectionname || '').localeCompare(String(b.sectionname || '')))

  if (!availableSections.length) {
    alert(`No active sections are available for ${sitename}. Add a section to the site first.`)
    return
  }

  document.querySelector('#dashboardSectionAllocationDialog')?.remove()
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="dashboardSectionAllocationDialog" class="dashboard-section-dialog">
      <form method="dialog">
        <div class="section-header">
          <div><h2>Allocate Asset ${escapeHtml(assetid)}</h2><p>${escapeHtml(sitename)}</p></div>
          <button type="button" class="secondary-btn" onclick="closeDashboardSectionAllocation()">Close</button>
        </div>
        <label for="dashboardSectionAllocationSelect">Section</label>
        <select id="dashboardSectionAllocationSelect">
          <option value="">Select section</option>
          ${availableSections.map(section => `<option value="${safeAttr(section.sectionid)}">${escapeHtml(section.sectionname || '')}</option>`).join('')}
        </select>
        <div class="form-actions">
          <button type="button" onclick="saveDashboardSectionAllocation(${safeAttr(assetid)}, ${safeAttr(siteid)})">Allocate Section</button>
          <button type="button" class="secondary-btn" onclick="closeDashboardSectionAllocation()">Cancel</button>
        </div>
      </form>
    </dialog>
  `)
  document.querySelector('#dashboardSectionAllocationDialog')?.showModal()
}

window.closeDashboardSectionAllocation = function () {
  const dialog = document.querySelector('#dashboardSectionAllocationDialog')
  dialog?.close()
  dialog?.remove()
}

window.saveDashboardSectionAllocation = async function (assetid, siteid) {
  const sectionid = document.querySelector('#dashboardSectionAllocationSelect')?.value || ''
  if (!sectionid) return alert('Select a section first.')

  try {
    const response = await fetch(`${API_BASE}/assets/${assetid}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteid, sectionid })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Unable to allocate the section')

    closeDashboardSectionAllocation()
    await loadData()
    await showDashboardReviewQueue('missing-section')
    await loadDashboardSummary()
  } catch (err) {
    console.error('Section allocation failed:', err)
    alert(err.message || 'Unable to allocate the section.')
  }
}

window.openCriteriaForEquipmentType = function (equiptypeid) {
  window.criteriaEquipmentFilter = String(equiptypeid || "")
  window.criteriaCurrentPage = 1
  showEquipmentTypeCriteria()
}

window.exportDashboardReviewQueue = function () {
  const state = window.dashboardReviewQueueState
  const config = dashboardReviewQueues[state?.key]

  if (!state || !config || !state.rows?.length) {
    alert("There is no review queue data to export.")
    return
  }

  const headers = config.columns.map(([label]) => label)
  const rows = state.rows.map(row =>
    config.columns.map(([, value]) => dashboardCsvValue(value(row)))
  )
  const csv = [headers, ...rows]
    .map(values => values.map(dashboardCsvCell).join(","))
    .join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `${state.key}-review-queue.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

function renderDashboardReviewQueue(config, rows) {
  if (!rows.length) {
    return `
      <div class="alert-card success">
        ${escapeHtml(config.empty)}
      </div>
    `
  }

  const sortedRows = sortDashboardReviewRows(config, rows)

  return `
    <p class="dashboard-review-summary">
      Showing ${escapeHtml(rows.length)} items. Use the action column to open the relevant cleanup screen.
    </p>
    ${window.dashboardReviewQueueState?.key === 'certificate-metadata' && currentUser?.role === 'ADMIN' ? `
      <div class="dashboard-review-repair-bar">
        <button type="button" class="primary-btn" onclick="repairSelectedCertificateMetadata()">Preview and repair selected signatures</button>
        <span>Only signatures linked to the inspection's saved inspector account can be copied.</span>
      </div>
    ` : ''}
    <div class="dashboard-review-table-wrap">
      <table class="dashboard-table">
        <thead>
          <tr>
            ${config.columns.map(([label], index) => `<th>${dashboardReviewSortHeader(label, index)}</th>`).join("")}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${sortedRows.map(row => `
            <tr>
              ${config.columns.map(([, value]) => `<td>${escapeHtml(value(row) || "-")}</td>`).join("")}
              <td>${config.action(row)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

  `
}

function dashboardReviewSortHeader(label, columnIndex) {
  const sort = window.dashboardReviewQueueState?.sort
  const isActive = sort?.columnIndex === columnIndex
  const arrow = isActive ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'

  return `
    <button
      type="button"
      class="dashboard-review-sort-btn ${isActive ? 'active' : ''}"
      onclick="sortDashboardReviewQueue(${columnIndex})"
      aria-label="Sort ${safeAttr(label)} ${isActive && sort.direction === 'asc' ? 'descending' : 'ascending'}"
      title="Sort ${safeAttr(label)}"
    ><span>${escapeHtml(label)}</span><span class="dashboard-review-sort-arrow">${arrow}</span></button>
  `
}

function sortDashboardReviewRows(config, rows) {
  const sort = window.dashboardReviewQueueState?.sort
  if (!sort || !config.columns[sort.columnIndex]) return rows

  const value = config.columns[sort.columnIndex][1]
  const direction = sort.direction === 'desc' ? -1 : 1
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = value(left.row)
    const b = value(right.row)
    const aDate = /^\d{4}-\d{2}-\d{2}/.test(String(a || '')) ? Date.parse(a) : NaN
    const bDate = /^\d{4}-\d{2}-\d{2}/.test(String(b || '')) ? Date.parse(b) : NaN
    let compared

    if (Number.isFinite(aDate) && Number.isFinite(bDate)) {
      compared = aDate - bDate
    } else if (a !== '' && a !== null && a !== undefined && b !== '' && b !== null && b !== undefined && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) {
      compared = Number(a) - Number(b)
    } else {
      compared = String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
    }

    return compared === 0 ? left.index - right.index : compared * direction
  }).map(item => item.row)
}

window.sortDashboardReviewQueue = function (columnIndex) {
  const state = window.dashboardReviewQueueState
  const config = dashboardReviewQueues[state?.key]
  if (!state || !config?.columns[columnIndex]) return

  state.sort = {
    columnIndex,
    direction: state.sort?.columnIndex === columnIndex && state.sort.direction === 'asc' ? 'desc' : 'asc'
  }

  const body = document.querySelector('#dashboardReviewQueueBody')
  if (body) body.innerHTML = renderDashboardReviewQueue(config, state.rows || [])
}

window.repairSelectedCertificateMetadata = async function () {
  const testids = [...document.querySelectorAll('.metadata-repair-checkbox:checked')]
    .map(input => Number(input.value))
    .filter(Number.isSafeInteger)

  if (!testids.length) {
    alert('Select at least one visual or load-test inspection to repair.')
    return
  }

  try {
    const previewResponse = await fetch(`${API_BASE}/dashboard/certificate-metadata-repair/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testids })
    })
    const preview = await previewResponse.json()
    if (!previewResponse.ok) throw new Error(preview.error || 'Unable to preview the repair')

    if (!preview.repairable) {
      const reasonCounts = (preview.rows || []).reduce((counts, row) => {
        const reason = row.blocked_reason || 'Not repairable'
        counts[reason] = (counts[reason] || 0) + 1
        return counts
      }, {})
      const reasons = Object.entries(reasonCounts)
        .map(([reason, count]) => `${count} × ${reason}`)
        .join('\n')
      alert(`None of the selected signatures can be repaired yet.\n\n${reasons || 'No eligible inspection records were found.'}\n\nUpload the correct signature to the inspector's user profile, then try again.`)
      return
    }

    const message = [
      `${preview.repairable} inspection signature(s) can be safely copied from the saved inspector account.`,
      `${preview.blocked} inspection(s) will remain unchanged.`,
      '',
      'Continue with this audited repair?'
    ].join('\n')
    if (!confirm(message)) return

    const applyResponse = await fetch(`${API_BASE}/dashboard/certificate-metadata-repair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testids })
    })
    const result = await applyResponse.json()
    if (!applyResponse.ok) throw new Error(result.error || 'Unable to apply the repair')

    alert(`${result.updated.length} inspection signature(s) repaired. ${result.blocked.length} left unchanged.`)
    await showDashboardReviewQueue('certificate-metadata')
    await loadDashboardSummary()
  } catch (err) {
    console.error('Certificate metadata repair failed:', err)
    alert(err.message || 'Certificate metadata repair failed.')
  }
}

function formatDashboardReviewDate(value) {
  if (!value) return "-"
  return String(value).split("T")[0]
}

function dashboardCsvValue(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value)
}

function dashboardCsvCell(value) {
  return `"${dashboardCsvValue(value).replace(/"/g, '""')}"`
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

function formatDashboardNotificationDate(value) {
  if (!value) return "Not sent yet"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not sent yet"
  return date.toLocaleString()
}

async function loadDashboardNotificationScheduler() {
  const container = document.querySelector("#dashboardNotificationScheduler")
  if (!container) return

  try {
    const response = await fetch(`${API_BASE}/dashboard/notification-centre/scheduler`)
    const result = await readApiResponse(response)

    if (!response.ok) throw new Error(result.error || "Unable to load scheduler status")

    const lastResult = result.last_result
      ? `${result.last_result.sent || 0} sent, ${result.last_result.failed || 0} failed, ${result.last_result.skipped || 0} skipped`
      : "No scheduled run yet"

    container.innerHTML = `
      <div>
        <span>Automatic sending</span>
        <strong>${result.enabled ? `On at ${escapeHtml(result.time || "07:00")}` : "Off"}</strong>
      </div>
      <div>
        <span>Last run</span>
        <strong>${escapeHtml(formatDashboardNotificationDate(result.last_run_at))}</strong>
      </div>
      <div>
        <span>Result</span>
        <strong>${escapeHtml(lastResult)}</strong>
      </div>
      ${result.last_error ? `
        <div>
          <span>Last error</span>
          <strong>${escapeHtml(result.last_error)}</strong>
        </div>
      ` : ""}
    `
  } catch (err) {
    container.innerHTML = `
      <div class="alert-card warning">
        ${escapeHtml(err.message || "Unable to load scheduler status")}
      </div>
    `
  }
}

async function loadDashboardNotificationHistory() {
  const container = document.querySelector("#dashboardNotificationHistory")
  if (!container) return

  try {
    const response = await fetch(`${API_BASE}/dashboard/notification-centre/history?limit=15`)
    const rows = await readApiResponse(response)

    if (!response.ok) throw new Error(rows.error || "Unable to load notification history")

    if (!Array.isArray(rows) || !rows.length) {
      container.innerHTML = `
        <div class="section-header">
          <h3>Recent Notification History</h3>
          <button type="button" class="secondary-small-btn" onclick="loadDashboardNotificationHistory()">Refresh</button>
        </div>
        <div class="alert-card success">No notification emails have been recorded yet.</div>
      `
      return
    }

    container.innerHTML = `
      <div class="section-header">
        <h3>Recent Notification History</h3>
        <button type="button" class="secondary-small-btn" onclick="loadDashboardNotificationHistory()">Refresh</button>
      </div>
      <div class="dashboard-notification-table-wrap">
        <table class="dashboard-table dashboard-notification-history-table">
          <thead>
            <tr>
              <th>Sent</th>
              <th>Customer</th>
              <th>Site</th>
              <th>Type</th>
              <th>Status</th>
              <th>Recipients</th>
              <th>Counts</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${escapeHtml(formatDashboardNotificationDate(row.sent_at || row.created_at))}</td>
                <td>${escapeHtml(row.clientname || "")}</td>
                <td>${escapeHtml(row.sitename || "All Sites")}</td>
                <td>${escapeHtml(row.delivery_type || "")}</td>
                <td><span class="notification-recipient ${row.status === "SENT" ? "ready" : "missing"}">${escapeHtml(row.status || "")}</span></td>
                <td>${escapeHtml(row.recipient_count || 0)}</td>
                <td>${escapeHtml(notificationHistoryCounts(row))}</td>
                <td>${escapeHtml(row.error_message || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
  } catch (err) {
    container.innerHTML = `
      <div class="alert-card warning">
        ${escapeHtml(err.message || "Unable to load notification history")}
      </div>
    `
  }
}

function notificationHistoryCounts(row) {
  return [
    ["Due", row.due_assets],
    ["Overdue", row.overdue_assets],
    ["Expiring", row.expiring_certificates],
    ["Failed", row.failed_assets],
    ["Visits", row.unresolved_visit_items]
  ]
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([label, value]) => `${label}: ${value}`)
    .join(" | ") || "-"
}

window.loadDashboardNotificationHistory = loadDashboardNotificationHistory

async function loadDashboardNotificationCentre(preloadedData = null) {
  const container = document.querySelector("#dashboardNotificationCentre")
  if (!container) return

  try {
    let rows = preloadedData

    if (!rows) {
      const response = await fetch(`${API_BASE}/dashboard/notification-centre`)

      if (!response.ok) {
        throw new Error("Failed to load notification centre")
      }

      rows = await response.json()
    }

    if (!Array.isArray(rows) || !rows.length) {
      window.dashboardNotificationRows = []
      container.innerHTML = `
        <div class="alert-card success">
          No customer notifications need attention.
        </div>
      `
      return
    }

    window.dashboardNotificationRows = rows
    window.dashboardNotificationPage = 1
    renderDashboardNotificationCentre()
  } catch (err) {
    console.error("Failed to load notification centre:", err)
    container.innerHTML = `
      <div class="alert-card warning">
        Unable to load notification centre
      </div>
    `
  }
}

function dashboardNotificationFilters() {
  return {
    search: String(document.querySelector("#dashboardNotificationSearch")?.value || "").trim().toLowerCase(),
    recipients: String(document.querySelector("#dashboardNotificationRecipientFilter")?.value || ""),
    auto: String(document.querySelector("#dashboardNotificationAutoFilter")?.value || "")
  }
}

function dashboardNotificationPageSize() {
  const value = String(window.dashboardNotificationPageSize || localStorage.getItem('dashboardNotificationPageSize') || '25')
  return value === 'all' ? 'all' : [25, 50, 100].includes(Number(value)) ? Number(value) : 25
}

function dashboardNotificationFilterRows(rows) {
  const filters = dashboardNotificationFilters()

  return rows.filter(row => {
    const text = [
      row.clientname,
      row.sitename,
      row.due_assets,
      row.overdue_assets,
      row.expiring_certificates,
      row.failed_assets,
      row.unresolved_visit_items,
      formatDashboardNotificationDate(row.last_notification_sent_at)
    ].join(" ").toLowerCase()
    const hasRecipients = Number(row.portal_recipients || 0) > 0
    const autoReady = Boolean(row.automatic_notification_ready)

    if (filters.search && !text.includes(filters.search)) return false
    if (filters.recipients === "ready" && !hasRecipients) return false
    if (filters.recipients === "missing" && hasRecipients) return false
    if (filters.auto === "ready" && !autoReady) return false
    if (filters.auto === "waiting" && autoReady) return false

    return true
  })
}

function dashboardNotificationSortColumns() {
  return {
    clientname: row => row.clientname || "",
    sitename: row => row.sitename || "",
    due_assets: row => Number(row.due_assets || 0),
    overdue_assets: row => Number(row.overdue_assets || 0),
    expiring_certificates: row => Number(row.expiring_certificates || 0),
    failed_assets: row => Number(row.failed_assets || 0),
    unresolved_visit_items: row => Number(row.unresolved_visit_items || 0),
    portal_recipients: row => Number(row.portal_recipients || 0),
    last_notification_sent_at: row => row.last_notification_sent_at ? new Date(row.last_notification_sent_at).getTime() : 0,
    automatic_notification_ready: row => row.automatic_notification_ready ? 1 : 0
  }
}

function renderDashboardNotificationCentre() {
  const container = document.querySelector("#dashboardNotificationCentre")
  if (!container) return

  const rows = window.dashboardNotificationRows || []

  if (!Array.isArray(rows) || !rows.length) {
    container.innerHTML = `
      <div class="alert-card success">
        No customer notifications need attention.
      </div>
    `
    return
  }

  const filteredRows = dashboardNotificationFilterRows(rows)
  const displayRows = sortTableRows(
    filteredRows,
    "dashboardNotifications",
    dashboardNotificationSortColumns(),
    "overdue_assets",
    "desc"
  )
  const pageSize = dashboardNotificationPageSize()
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(displayRows.length / pageSize))
  const currentPage = Math.min(Math.max(1, Number(window.dashboardNotificationPage || 1)), totalPages)
  window.dashboardNotificationPage = currentPage
  const pageStart = pageSize === 'all' ? 0 : (currentPage - 1) * pageSize
  const pageRows = pageSize === 'all' ? displayRows : displayRows.slice(pageStart, pageStart + pageSize)
  const firstShown = displayRows.length ? pageStart + 1 : 0
  const lastShown = displayRows.length ? pageStart + pageRows.length : 0

  container.innerHTML = `
    <div class="dashboard-notification-summary">
      <span><strong>${escapeHtml(displayRows.length)}</strong> actionable customer/site row(s) match the filters. Showing <strong>${firstShown}-${lastShown}</strong>.</span>
      <span>This is the attention list, not the complete customer register. Preview before sending to customer portal users.</span>
    </div>
    <div class="dashboard-notification-filter-row">
      <input
        id="dashboardNotificationSearch"
        type="text"
        placeholder="Filter customer, site or numbers..."
        value="${escapeHtml(document.querySelector("#dashboardNotificationSearch")?.value || "")}"
        oninput="dashboardNotificationSearchChanged(this)"
      >
      <select id="dashboardNotificationRecipientFilter" onchange="dashboardNotificationFiltersChanged()">
        <option value="">All portal users</option>
        <option value="ready" ${dashboardNotificationFilters().recipients === "ready" ? "selected" : ""}>Has portal users</option>
        <option value="missing" ${dashboardNotificationFilters().recipients === "missing" ? "selected" : ""}>No portal users</option>
      </select>
      <select id="dashboardNotificationAutoFilter" onchange="dashboardNotificationFiltersChanged()">
        <option value="">All automatic status</option>
        <option value="ready" ${dashboardNotificationFilters().auto === "ready" ? "selected" : ""}>Automatic ready</option>
        <option value="waiting" ${dashboardNotificationFilters().auto === "waiting" ? "selected" : ""}>Automatic waiting</option>
      </select>
      <button type="button" class="secondary-small-btn" onclick="clearDashboardNotificationFilters()">Clear</button>
    </div>
    <div id="dashboardNotificationPreview" class="dashboard-notification-preview" hidden></div>
    <div class="report-scroll-control dashboard-notification-scroll-control">
      <button id="dashboardNotificationScrollLeft" type="button" class="dashboard-notification-scroll-button" onclick="scrollDashboardNotificationTable(-1)" aria-label="Scroll table left" title="Scroll table left">&#8592;</button>
      <input id="dashboardNotificationTableSlider" type="range" min="0" max="0" value="0" step="1">
      <button id="dashboardNotificationScrollRight" type="button" class="dashboard-notification-scroll-button" onclick="scrollDashboardNotificationTable(1)" aria-label="Scroll table right" title="Scroll table right">&#8594;</button>
    </div>
    <div class="dashboard-notification-table-wrap">
      <table class="dashboard-table dashboard-notification-table">
        <thead>
          <tr>
            <th>${sortHeader("Customer", "dashboardNotifications", "clientname", "renderDashboardNotificationCentre")}</th>
            <th>${sortHeader("Site", "dashboardNotifications", "sitename", "renderDashboardNotificationCentre")}</th>
            <th>${sortHeader("Due", "dashboardNotifications", "due_assets", "renderDashboardNotificationCentre")}</th>
            <th>${sortHeader("Overdue", "dashboardNotifications", "overdue_assets", "renderDashboardNotificationCentre")}</th>
            <th>${sortHeader("Expiring", "dashboardNotifications", "expiring_certificates", "renderDashboardNotificationCentre")}</th>
            <th>${sortHeader("Failed", "dashboardNotifications", "failed_assets", "renderDashboardNotificationCentre")}</th>
            <th>${sortHeader("Visit Items", "dashboardNotifications", "unresolved_visit_items", "renderDashboardNotificationCentre")}</th>
            <th>${sortHeader("Portal Recipients", "dashboardNotifications", "portal_recipients", "renderDashboardNotificationCentre")}</th>
            <th>${sortHeader("Last Sent", "dashboardNotifications", "last_notification_sent_at", "renderDashboardNotificationCentre")}</th>
            <th>${sortHeader("Auto", "dashboardNotifications", "automatic_notification_ready", "renderDashboardNotificationCentre")}</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${pageRows.length ? pageRows.map(row => renderDashboardNotificationRow(row)).join("") : `
            <tr>
              <td colspan="11" class="empty-row">No notification rows match the selected filters.</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
    ${displayRows.length ? `
      <div class="dashboard-notification-pagination">
        <label>Rows per page
          <select onchange="setDashboardNotificationPageSize(this.value)">
            <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
            <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
            <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
            <option value="all" ${pageSize === 'all' ? 'selected' : ''}>All filtered</option>
          </select>
        </label>
        <div class="dashboard-notification-page-buttons">
          <button type="button" class="secondary-small-btn" onclick="setDashboardNotificationPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>Previous</button>
          <span>Page <strong>${currentPage}</strong> of <strong>${totalPages}</strong></span>
          <button type="button" class="secondary-small-btn" onclick="setDashboardNotificationPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    ` : ''}
  `

  bindDashboardNotificationSlider()
}

window.dashboardNotificationFiltersChanged = function () {
  window.dashboardNotificationPage = 1
  renderDashboardNotificationCentre()
}

window.dashboardNotificationSearchChanged = function (input) {
  const value = String(input?.value || '')
  const cursor = Number(input?.selectionStart ?? value.length)
  window.dashboardNotificationPage = 1
  renderDashboardNotificationCentre()
  const replacement = document.querySelector('#dashboardNotificationSearch')
  if (!replacement) return
  replacement.focus({ preventScroll: true })
  replacement.setSelectionRange(cursor, cursor)
}

window.setDashboardNotificationPage = function (page) {
  window.dashboardNotificationPage = Math.max(1, Number(page || 1))
  renderDashboardNotificationCentre()
  document.querySelector('#dashboardNotificationCentre')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

window.setDashboardNotificationPageSize = function (value) {
  window.dashboardNotificationPageSize = value === 'all' ? 'all' : Number(value)
  localStorage.setItem('dashboardNotificationPageSize', String(window.dashboardNotificationPageSize))
  window.dashboardNotificationPage = 1
  renderDashboardNotificationCentre()
}

function bindDashboardNotificationSlider() {
  const slider = document.querySelector("#dashboardNotificationTableSlider")
  const tableWrap = document.querySelector(".dashboard-notification-table-wrap")
  const leftButton = document.querySelector('#dashboardNotificationScrollLeft')
  const rightButton = document.querySelector('#dashboardNotificationScrollRight')

  if (!slider || !tableWrap) return

  const updateSliderRange = () => {
    const maxScroll = Math.max(0, tableWrap.scrollWidth - tableWrap.clientWidth)
    slider.max = String(maxScroll)
    slider.value = String(Math.min(tableWrap.scrollLeft, maxScroll))
    slider.disabled = maxScroll === 0
    if (leftButton) leftButton.disabled = maxScroll === 0 || tableWrap.scrollLeft <= 1
    if (rightButton) rightButton.disabled = maxScroll === 0 || tableWrap.scrollLeft >= maxScroll - 1
  }

  updateSliderRange()

  slider.addEventListener("input", () => {
    tableWrap.scrollLeft = Number(slider.value)
  })

  tableWrap.addEventListener("scroll", () => {
    slider.value = String(tableWrap.scrollLeft)
    updateSliderRange()
  })

  window.addEventListener("resize", updateSliderRange, { once: true })
}

window.scrollDashboardNotificationTable = function (direction) {
  const tableWrap = document.querySelector('.dashboard-notification-table-wrap')
  if (!tableWrap) return
  const distance = Math.max(240, Math.round(tableWrap.clientWidth * 0.7))
  tableWrap.scrollBy({ left: Number(direction) * distance, behavior: 'smooth' })
}

function renderDashboardNotificationRow(row) {
  const reportArgs = safeAttr(JSON.stringify({
    clientid: row.clientid,
    siteid: row.siteid || '',
    autoLoad: true
  }))
  const recipientClass = Number(row.portal_recipients || 0) > 0 ? "ready" : "missing"
  const recipientText = Number(row.portal_recipients || 0) > 0
    ? `${row.portal_recipients} ready`
    : "No portal users"
  const autoClass = row.automatic_notification_ready ? "ready" : "missing"
  const autoText = row.automatic_notification_ready ? "Ready" : "Waiting"

  return `
    <tr>
      <td>${escapeHtml(row.clientname || "")}</td>
      <td>${escapeHtml(row.sitename || "All Sites")}</td>
      <td><strong>${escapeHtml(row.due_assets || 0)}</strong></td>
      <td><strong>${escapeHtml(row.overdue_assets || 0)}</strong></td>
      <td>${escapeHtml(row.expiring_certificates || 0)}</td>
      <td>${escapeHtml(row.failed_assets || 0)}</td>
      <td>${escapeHtml(row.unresolved_visit_items || 0)}</td>
      <td><span class="notification-recipient ${recipientClass}">${escapeHtml(recipientText)}</span></td>
      <td>${escapeHtml(formatDashboardNotificationDate(row.last_notification_sent_at))}</td>
      <td><span class="notification-recipient ${autoClass}">${escapeHtml(autoText)}</span></td>
      <td class="dashboard-notification-actions">
        <button class="small-btn" onclick="previewDashboardNotification(${safeAttr(row.clientid)}, '${safeAttr(row.siteid || '')}')">
          Preview
        </button>
        <button class="small-btn" onclick="sendDashboardNotification(${safeAttr(row.clientid)}, '${safeAttr(row.siteid || '')}')">
          Send
        </button>
        <button class="small-btn" onclick="showCustomerDetailedReport(${reportArgs})">
          Report
        </button>
      </td>
    </tr>
  `
}

window.renderDashboardNotificationCentre = renderDashboardNotificationCentre

window.clearDashboardNotificationFilters = function () {
  const search = document.querySelector("#dashboardNotificationSearch")
  const recipients = document.querySelector("#dashboardNotificationRecipientFilter")
  const auto = document.querySelector("#dashboardNotificationAutoFilter")

  if (search) search.value = ""
  if (recipients) recipients.value = ""
  if (auto) auto.value = ""
  window.dashboardNotificationPage = 1
  renderDashboardNotificationCentre()
}

window.runDashboardNotificationScheduler = async function () {
  const proceed = window.confirm('Run the scheduled customer notification check now?')
  if (!proceed) return

  try {
    const response = await fetch(`${API_BASE}/dashboard/notification-centre/scheduler/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    const result = await readApiResponse(response)

    if (!response.ok) throw new Error(result.error || 'Unable to run scheduled notifications')

    const summary = result.result || {}
    alert(`Scheduled check complete. Sent: ${summary.sent || 0}. Failed: ${summary.failed || 0}. Skipped: ${summary.skipped || 0}.`)
    loadDashboardNotificationScheduler()
    loadDashboardNotificationCentre()
    loadDashboardNotificationHistory()
  } catch (err) {
    alert(err.message || 'Unable to run scheduled notifications')
  }
}

window.previewDashboardNotification = async function (clientid, siteid = '') {
  const preview = document.querySelector('#dashboardNotificationPreview')
  if (!preview) return

  preview.hidden = false
  preview.innerHTML = '<div class="report-preview-empty">Loading notification preview...</div>'

  try {
    const params = new URLSearchParams()
    params.set('clientid', clientid)
    if (siteid) params.set('siteid', siteid)

    const response = await fetch(`${API_BASE}/dashboard/notification-centre/preview?${params.toString()}`)
    const result = await readApiResponse(response)

    if (!response.ok) throw new Error(result.error || 'Unable to load notification preview')

    const recipients = result.recipients || []

    preview.innerHTML = `
      <div class="section-header">
        <h3>Email Preview</h3>
        <button type="button" class="secondary-small-btn" onclick="closeDashboardNotificationPreview()">Close</button>
      </div>
      <div class="notification-preview-grid">
        <div>
          <span>To</span>
          <strong>${escapeHtml(recipients.length ? recipients.map(item => item.email).join(', ') : 'No active customer portal users')}</strong>
        </div>
        <div>
          <span>Subject</span>
          <strong>${escapeHtml(result.subject || '')}</strong>
        </div>
      </div>
      ${result.mail_config_issues?.length ? `
        <div class="alert-card warning">
          Email settings missing: ${escapeHtml(result.mail_config_issues.join(', '))}
        </div>
      ` : ''}
      <pre class="notification-preview-message">${escapeHtml(result.message || '')}</pre>
    `
  } catch (err) {
    preview.innerHTML = `
      <div class="alert-card warning">
        ${escapeHtml(err.message || 'Unable to load notification preview')}
      </div>
    `
  }
}

window.closeDashboardNotificationPreview = function () {
  const preview = document.querySelector('#dashboardNotificationPreview')
  if (preview) preview.hidden = true
}

window.sendDashboardNotification = async function (clientid, siteid = '') {
  const proceed = window.confirm('Send this customer notification email now?')
  if (!proceed) return

  try {
    const response = await fetch(`${API_BASE}/dashboard/notification-centre/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientid, siteid: siteid || null })
    })
    const result = await readApiResponse(response)

    if (!response.ok) throw new Error(result.error || 'Unable to send notification')

    alert(result.history_warning
      ? `Notification sent to ${result.sent_to || 0} recipient(s).\n\n${result.history_warning}`
      : `Notification sent to ${result.sent_to || 0} recipient(s).`)
    loadDashboardNotificationCentre()
    loadDashboardNotificationHistory()
  } catch (err) {
    alert(err.message || 'Unable to send notification')
  }
}

window.exportDashboardNotifications = function () {
  const rows = window.dashboardNotificationRows || []

  if (!rows.length) {
    alert("There are no notification rows to export.")
    return
  }

  const headers = [
    "Customer",
    "Site",
    "Active Assets",
    "Due Assets",
    "Overdue Assets",
    "Expiring Certificates",
    "Failed Assets",
    "Open Visits",
    "Unresolved Visit Items",
    "Deferred Follow-ups Due",
    "Portal Recipients",
    "Last Notification Sent",
    "Automatic Ready",
    "Next Due Date",
    "Next Expiry Date"
  ]

  const csvRows = rows.map(row => [
    row.clientname,
    row.sitename,
    row.active_assets,
    row.due_assets,
    row.overdue_assets,
    row.expiring_certificates,
    row.failed_assets,
    row.open_visits,
    row.unresolved_visit_items,
    row.deferred_followups_due,
    row.portal_recipients,
    formatDashboardNotificationDate(row.last_notification_sent_at),
    row.automatic_notification_ready ? "Ready" : "Waiting",
    formatDashboardReviewDate(row.next_due_date),
    formatDashboardReviewDate(row.next_expiry_date)
  ])

  const csv = [headers, ...csvRows]
    .map(values => values.map(dashboardCsvCell).join(","))
    .join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `notification-centre-${dateInputValue()}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
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
  if (window.inspectionSaveInProgress) return

  if (document.querySelector(".crane-wizard")) {
    const steps = getCraneWizardSteps()
    const reviewStepIndex = Math.max(0, steps.length - 1)
    if ((window.craneWizardCurrentStep || 0) !== reviewStepIndex) {
      alert("Review the crane inspection before saving.")
      window.craneWizardCurrentStep = reviewStepIndex
      updateCraneWizardStep()
      return
    }
    if (!validateCraneWizardStep(reviewStepIndex)) return
  }

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

  if (inspectiontype === "LOADTEST") {
    const requiredTestLoad = Number(document.querySelector("#craneIntendedTestLoad")?.value)
    const actualTestLoad = Number(document.querySelector("#craneActualTestLoad")?.value)
    const testDuration = String(document.querySelector("#craneTestDuration")?.value || "").trim()
    const exceptionReason = String(document.querySelector("#craneLoadExceptionReason")?.value || "").trim()

    if (!Number.isFinite(requiredTestLoad) || requiredTestLoad <= 0) {
      alert("Enter the required test load.")
      document.querySelector("#craneIntendedTestLoad")?.focus()
      return
    }
    if (!Number.isFinite(actualTestLoad) || actualTestLoad <= 0) {
      alert("Enter the actual applied test load.")
      document.querySelector("#craneActualTestLoad")?.focus()
      return
    }
    if (!testDuration) {
      alert("Enter the test duration.")
      document.querySelector("#craneTestDuration")?.focus()
      return
    }
    if (actualTestLoad < requiredTestLoad && !exceptionReason) {
      alert("Enter a reason why the required test load was not fully applied.")
      document.querySelector("#craneLoadExceptionReason")?.focus()
      return
    }
  }

  let assetCriteria = getInspectionCriteriaRows(criteria.filter(
    c =>
      String(c.equiptypeid) === String(asset.equiptypeid) &&
      String(c.inspectioncategory) === String(inspectiontype) &&
      c.active !== false
  ), inspectiontype)

  const selectedInspectionFrequency = document.querySelector("#inspectionFrequency")?.value ||
    window.currentInspectionFrequency ||
    defaultInspectionFrequencyForAsset(asset, inspectiontype)

  assetCriteria = assetCriteria.filter(row =>
    criteriaMatchesSelectedFrequency(row, asset, inspectiontype, selectedInspectionFrequency)
  )

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

    if (isFailedInspectionResultValue(result)) {
      overallStatus = "NOT SAFE"
    }

    const assetValue =
      getCriteriaStandardValue(asset, row) || null

    let measuredValue = measuredInput ? measuredInput.value : null

    if (
      inspectiontype === "LOADTEST" &&
      !String(measuredValue || "").trim() &&
      normalizeCriteriaName(inspectionCriteriaText(row)).includes("actual applied test load")
    ) {
      measuredValue = document.querySelector("#craneActualTestLoad")?.value || null
    }

    if (measuredValue && !Number.isFinite(Number(measuredValue))) {
      alert(`Please enter a valid numeric value for: ${inspectionCriteriaText(row)}`)
      measuredInput?.focus()
      return
    }

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
  const loadTestNotes = inspectiontype === "LOADTEST"
    ? [
        `Rated capacity: ${document.querySelector("#craneRatedCapacity")?.value || "-"}`,
        `Intended test load: ${document.querySelector("#craneIntendedTestLoad")?.value || "-"}`,
        `SWL / test load actually lifted: ${document.querySelector("#craneActualTestLoad")?.value || "-"}`,
        `Test duration: ${document.querySelector("#craneTestDuration")?.value || "-"}`,
        `Load exception reason: ${document.querySelector("#craneLoadExceptionReason")?.value || "-"}`
      ].join("\n")
    : ""
  const harnessNotes = document.querySelector(".harness-wizard")
    ? getHarnessSetupReviewRows()
        .map(([label, value]) => `${label}: ${value || "-"}`)
        .join("\n")
    : ""
  const slingNotes = document.querySelector(".sling-wizard")
    ? getSlingSetupReviewRows()
        .map(([label, value]) => `${label}: ${value || "-"}`)
        .join("\n")
    : ""
  const inspectionComments = [
    document.querySelector("#inspectionComments")?.value || "",
    loadTestNotes,
    harnessNotes,
    slingNotes
  ].filter(value => String(value || "").trim()).join("\n\n")

  formData.append("assetid", assetid)
  formData.append("testdate", testdate)
  formData.append(
    "validdate",
    document.querySelector("#inspectionValidDate")?.value || ""
  )
  formData.append("comments", inspectionComments)
  formData.append("status", overallStatus)
  formData.append("inspectiontype", inspectiontype)
  if (window.currentInspectionVisitId) {
    formData.append("visitid", window.currentInspectionVisitId)
  }
  formData.append("inspectionfrequency", document.querySelector("#inspectionFrequency")?.value || "")
  formData.append("tagnumber", tagnumber)
  const inspectionJobNumber = document.querySelector("#inspectionJobNumber")?.value.trim() || ""
  if (!/^[0-9]+$/.test(inspectionJobNumber)) {
    alert("Enter the Accelo Job Number using numeric digits only.")
    document.querySelector("#inspectionJobNumber")?.focus()
    return
  }
  formData.append("job_number", inspectionJobNumber)
  formData.append("results", JSON.stringify(results))

  const replacementPhoto1 = document.querySelector("#inspectionAssetPhoto1")?.files?.[0] || null
  const replacementPhoto2 = document.querySelector("#inspectionAssetPhoto2")?.files?.[0] || null

  if (!validateAssetPhotoFiles([replacementPhoto1, replacementPhoto2])) {
    return
  }

  const updateAssetPhotos = Boolean(replacementPhoto1 || replacementPhoto2)

  formData.append("updateassetphotos", updateAssetPhotos)

  if (replacementPhoto1) {
    formData.append("photo1", replacementPhoto1)
  }

  if (replacementPhoto2) {
    formData.append("photo2", replacementPhoto2)
  }

  const allowInspectionPhotos = String(asset.equipgroupid || "") === "400"

  ;(allowInspectionPhotos ? window.pendingInspectionPhotos || [] : []).forEach(photo => {
    formData.append("inspectionPhotos", photo.file)
    formData.append("photoCaptions", photo.caption || "")
    formData.append("photoTypes", photo.photoType || "GENERAL")
  })

  let response
  let savedInspection

  try {
    window.inspectionSaveInProgress = true
    document.querySelectorAll(".crane-wizard-nav button, .filter-card button").forEach(button => {
      if (/save/i.test(button.textContent || "")) button.disabled = true
    })

    response = await fetch(
      `${API_BASE}/inspections`,
      {
        method: "POST",
        body: formData
      }
    )

    savedInspection = await response.json()

    if (response.status === 409 && savedInspection.code === "DUPLICATE_INSPECTION") {
      const existingId = savedInspection.existing?.testid || "unknown"
      const proceed = window.confirm(
        `Inspection ${existingId} already exists for this asset, inspection type and date.\n\nOnly continue if this is genuinely a separate inspection.`
      )
      if (proceed) {
        formData.set("force_duplicate", "true")
        response = await fetch(`${API_BASE}/inspections`, { method: "POST", body: formData })
        savedInspection = await response.json()
      }
    }
  } catch (err) {
    alert("Error saving inspection: " + err.message)
    window.inspectionSaveInProgress = false
    document.querySelectorAll(".crane-wizard-nav button, .filter-card button").forEach(button => {
      button.disabled = false
    })
    return
  }

  if (!response.ok) {
    const errorMessage = savedInspection.error || "An unexpected server error occurred"
    const referenceMessage = savedInspection.referenceId ? `\nReference: ${savedInspection.referenceId}` : ""
    const diagnosticMessage = savedInspection.diagnostic ? `\nLocal diagnostic: ${savedInspection.diagnostic}` : ""
    const userMessage = response.status >= 500
      ? `The inspection was not saved because the server encountered a problem. Please keep this page open and contact the system administrator.${referenceMessage}${diagnosticMessage}`
      : response.status === 401
        ? "Your session has expired. Please sign in again before saving this inspection."
        : `Error saving inspection: ${errorMessage}${referenceMessage}`
    if (savedInspection.diagnostic) console.error("Inspection save diagnostic:", savedInspection.diagnostic)
    alert(userMessage)
    window.inspectionSaveInProgress = false
    document.querySelectorAll(".crane-wizard-nav button, .filter-card button").forEach(button => {
      button.disabled = false
    })
    return
  }

  alert("Inspection saved. Status: " + (savedInspection.status || overallStatus))

  await loadData()
  window.inspectionSaveInProgress = false
  returnToInspectionOrigin(returnPage)
}



let jobCardEditing = null
let jobCardAssets = []
let jobCardTechnicians = []
let jobCardListRows = []
let jobCardListView = 'ACTIVE'
let jobCardListPage = 1
let jobCardListSearchTimer = null
const JOB_CARD_LIST_PAGE_SIZE = 15

function jobCardOption(value, label, selected) {
  return `<option value="${safeAttr(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${escapeHtml(label)}</option>`
}

window.showJobCards = async function () {
  if (!ensurePageAccess('job-cards')) return
  setCurrentPage('job-cards')
  const page = document.querySelector('#page')
  page.innerHTML = `<div class="page-heading job-card-page-heading"><div><h2>Technician Job Cards</h2><p>Find, track and manage field work without losing sight of what needs attention.</p></div><button class="load-test-btn" onclick="openJobCard()">+ New Job Card</button></div><div id="jobCardList"><div class="job-card-loading">Loading job cards...</div></div>`
  const response = await fetch(`${API_BASE}/job-cards`)
  const rows = await readApiResponse(response)
  const box = document.querySelector('#jobCardList')
  if (!response.ok) { box.innerHTML = `<p class="login-error">${escapeHtml(rows.error || 'Could not load job cards')}</p>`; return }
  jobCardListRows = Array.isArray(rows) ? rows : []
  jobCardListPage = 1
  renderJobCardList()
}

function jobCardListStatusGroup(status) {
  const value = String(status || '').toUpperCase()
  if (['DRAFT', 'ASSIGNED', 'IN_PROGRESS'].includes(value)) return 'ACTIVE'
  if (value === 'SUBMITTED') return 'REVIEW'
  if (['APPROVED', 'INVOICED'].includes(value)) return 'COMPLETED'
  if (value === 'CANCELLED') return 'CANCELLED'
  return 'ACTIVE'
}

function jobCardDateLabel(value) {
  if (!value) return 'No date set'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'No date set' : date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function renderJobCardList() {
  const box = document.querySelector('#jobCardList')
  if (!box) return
  const search = String(document.querySelector('#jobCardSearch')?.value || '').trim().toLowerCase()
  const status = String(document.querySelector('#jobCardStatusFilter')?.value || '')
  const technician = String(document.querySelector('#jobCardTechnicianFilter')?.value || '')
  const sort = String(document.querySelector('#jobCardSort')?.value || 'UPDATED_DESC')
  const counts = jobCardListRows.reduce((result, card) => {
    result[jobCardListStatusGroup(card.status)]++
    return result
  }, { ACTIVE: 0, REVIEW: 0, COMPLETED: 0, CANCELLED: 0 })
  const technicians = [...new Set(jobCardListRows.map(card => card.assigned_to_name || 'Unassigned'))].sort((a, b) => a.localeCompare(b))
  let filtered = jobCardListRows.filter(card => {
    const groupMatch = jobCardListView === 'ALL' || jobCardListStatusGroup(card.status) === jobCardListView
    const statusMatch = !status || String(card.status) === status
    const technicianMatch = !technician || String(card.assigned_to_name || 'Unassigned') === technician
    const haystack = [card.jobcard_reference, card.clientname, card.sitename, card.assigned_to_name, card.job_type].join(' ').toLowerCase()
    return groupMatch && statusMatch && technicianMatch && (!search || haystack.includes(search))
  })
  filtered.sort((a, b) => {
    if (sort === 'REFERENCE_DESC') return String(b.jobcard_reference).localeCompare(String(a.jobcard_reference), undefined, { numeric: true })
    if (sort === 'CUSTOMER_ASC') return String(a.clientname).localeCompare(String(b.clientname))
    if (sort === 'PLANNED_ASC') return new Date(a.planned_at || '9999-12-31') - new Date(b.planned_at || '9999-12-31')
    return new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / JOB_CARD_LIST_PAGE_SIZE))
  jobCardListPage = Math.min(jobCardListPage, totalPages)
  const start = (jobCardListPage - 1) * JOB_CARD_LIST_PAGE_SIZE
  const visible = filtered.slice(start, start + JOB_CARD_LIST_PAGE_SIZE)
  const views = [
    ['ACTIVE', 'Active', counts.ACTIVE], ['REVIEW', 'Awaiting review', counts.REVIEW],
    ['COMPLETED', 'Completed', counts.COMPLETED], ['CANCELLED', 'Cancelled', counts.CANCELLED],
    ['ALL', 'All job cards', jobCardListRows.length]
  ]
  box.innerHTML = `<section class="job-card-overview" aria-label="Job card workload">
      <div class="job-card-overview-copy"><span>Work queue</span><strong>${counts.ACTIVE + counts.REVIEW}</strong><small>job card${counts.ACTIVE + counts.REVIEW === 1 ? '' : 's'} still in the workflow</small></div>
      <div class="job-card-metric"><span class="job-card-metric-dot active"></span><div><strong>${counts.ACTIVE}</strong><small>Active</small></div></div>
      <div class="job-card-metric"><span class="job-card-metric-dot review"></span><div><strong>${counts.REVIEW}</strong><small>Awaiting review</small></div></div>
      <div class="job-card-metric"><span class="job-card-metric-dot complete"></span><div><strong>${counts.COMPLETED}</strong><small>Completed</small></div></div>
    </section>
    <section class="filter-card job-card-workspace">
      <div class="job-card-view-tabs" role="tablist" aria-label="Job card views">${views.map(([value, label, count]) => `<button type="button" role="tab" aria-selected="${jobCardListView === value}" class="${jobCardListView === value ? 'active' : ''}" onclick="setJobCardListView('${value}')"><span>${label}</span><b>${count}</b></button>`).join('')}</div>
      <div class="job-card-toolbar">
        <label class="job-card-search"><span>Search job cards</span><input id="jobCardSearch" type="search" placeholder="Job number, customer, site or inspector" value="${safeAttr(search)}" oninput="jobCardListSearchChanged()"></label>
        <label><span>Status</span><select id="jobCardStatusFilter" onchange="jobCardListFiltersChanged()"><option value="">All statuses</option>${['DRAFT','ASSIGNED','IN_PROGRESS','SUBMITTED','APPROVED','INVOICED','CANCELLED'].map(value => `<option value="${value}" ${status === value ? 'selected' : ''}>${value.replaceAll('_',' ')}</option>`).join('')}</select></label>
        <label><span>Inspector</span><select id="jobCardTechnicianFilter" onchange="jobCardListFiltersChanged()"><option value="">All inspectors</option>${technicians.map(value => `<option value="${safeAttr(value)}" ${technician === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>
        <label><span>Sort by</span><select id="jobCardSort" onchange="jobCardListFiltersChanged()"><option value="UPDATED_DESC" ${sort === 'UPDATED_DESC' ? 'selected' : ''}>Recently updated</option><option value="REFERENCE_DESC" ${sort === 'REFERENCE_DESC' ? 'selected' : ''}>Newest job number</option><option value="PLANNED_ASC" ${sort === 'PLANNED_ASC' ? 'selected' : ''}>Planned date</option><option value="CUSTOMER_ASC" ${sort === 'CUSTOMER_ASC' ? 'selected' : ''}>Customer A–Z</option></select></label>
      </div>
      <div class="job-card-results-heading"><p><strong>${filtered.length}</strong> job card${filtered.length === 1 ? '' : 's'} found</p>${(search || status || technician) ? '<button type="button" class="job-card-clear-filters" onclick="clearJobCardListFilters()">Clear filters</button>' : ''}</div>
      <div class="job-card-list">${visible.map(card => `<article class="job-card-list-row"><button type="button" class="job-card-list-item" onclick="openJobCard(${card.jobcardid})"><span class="job-card-primary"><strong>${escapeHtml(card.jobcard_reference)}</strong><small>${escapeHtml(card.clientname)}</small><span>${escapeHtml(card.sitename)}</span></span><span class="job-card-assignee"><small>Inspector</small><strong>${escapeHtml(card.assigned_to_name || 'Unassigned')}</strong></span><span class="job-card-date"><small>${card.planned_at ? 'Planned' : 'Updated'}</small><strong>${jobCardDateLabel(card.planned_at || card.updated_at)}</strong></span><span class="job-card-state"><b class="job-card-status status-${safeAttr(String(card.status).toLowerCase())}">${escapeHtml(String(card.status).replaceAll('_',' '))}</b>${Number(card.open_deviations) > 0 ? `<small class="job-card-deviation-count">${escapeHtml(card.open_deviations)} open deviation${Number(card.open_deviations) === 1 ? '' : 's'}</small>` : '<small>No open deviations</small>'}</span></button><button type="button" class="job-card-list-pdf" aria-label="Open PDF for ${safeAttr(card.jobcard_reference)}" title="Open PDF" onclick="window.open('${API_BASE}/job-cards/${card.jobcardid}/pdf','_blank','noopener')"><span aria-hidden="true">PDF</span></button></article>`).join('') || `<div class="job-card-empty"><strong>No job cards match this view</strong><p>Try another status or clear the search filters.</p></div>`}</div>
      ${filtered.length > JOB_CARD_LIST_PAGE_SIZE ? `<div class="job-card-pagination"><span>Showing ${start + 1}–${Math.min(start + JOB_CARD_LIST_PAGE_SIZE, filtered.length)} of ${filtered.length}</span><div><button type="button" onclick="changeJobCardListPage(-1)" ${jobCardListPage === 1 ? 'disabled' : ''}>Previous</button><b>Page ${jobCardListPage} of ${totalPages}</b><button type="button" onclick="changeJobCardListPage(1)" ${jobCardListPage === totalPages ? 'disabled' : ''}>Next</button></div></div>` : ''}
    </section>`
}

window.setJobCardListView = function (view) { jobCardListView = view; jobCardListPage = 1; renderJobCardList() }
window.jobCardListFiltersChanged = function () { jobCardListPage = 1; renderJobCardList() }
window.jobCardListSearchChanged = function () {
  clearTimeout(jobCardListSearchTimer)
  jobCardListSearchTimer = setTimeout(() => {
    jobCardListPage = 1
    renderJobCardList()
    const input = document.querySelector('#jobCardSearch')
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length) }
  }, 180)
}
window.clearJobCardListFilters = function () {
  const search = document.querySelector('#jobCardSearch'); const status = document.querySelector('#jobCardStatusFilter'); const technician = document.querySelector('#jobCardTechnicianFilter')
  if (search) search.value = ''; if (status) status.value = ''; if (technician) technician.value = ''
  jobCardListPage = 1; renderJobCardList()
}
window.changeJobCardListPage = function (change) { jobCardListPage += change; renderJobCardList(); document.querySelector('#jobCardList')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

async function loadJobCardAssets(clientid = '', siteid = '') {
  if (!clientid) { jobCardAssets = []; return }
  const params = new URLSearchParams({ clientid:String(clientid) })
  if (siteid) params.set('siteid', String(siteid))
  const assetResponse = await fetch(`${API_BASE}/job-cards/equipment?${params.toString()}`)
  const assetPayload = await readApiResponse(assetResponse)
  if (!assetResponse.ok) throw new Error(assetPayload.error || 'Could not load equipment for the selected customer and site')
  jobCardAssets = Array.isArray(assetPayload) ? assetPayload : []
}

async function loadJobCardFormData() {
  const techResponse = await fetch(`${API_BASE}/job-cards-technicians`)
  jobCardTechnicians = techResponse.ok ? await techResponse.json() : [{ user_id: currentUser.user_id, full_name: currentUser.full_name }]
}

window.openJobCard = async function (jobcardid = null) {
  if (!ensurePageAccess('job-cards')) return
  setCurrentPage('job-cards')
  await loadJobCardFormData()
  if (jobcardid) {
    const response = await fetch(`${API_BASE}/job-cards/${jobcardid}`)
    jobCardEditing = await readApiResponse(response)
    if (!response.ok) { alert(jobCardEditing.error || 'Could not open job card'); return }
    try { await loadJobCardAssets(jobCardEditing.clientid, jobCardEditing.siteid) }
    catch (error) { alert(error.message); jobCardAssets = [] }
  } else {
    jobCardEditing = { status: 'DRAFT', job_type: 'REPAIR', priority: 'NORMAL', equipment_status: 'NOT_TESTED', assets: [], materials: [], deviations: [], photos: [], assigned_to_user_id: ['ADMIN', 'INSPECTOR'].includes(currentUser.role) ? currentUser.user_id : '' }
  }
  renderJobCardForm()
}

function renderJobCardForm() {
  const card = jobCardEditing
  const crewLocked = ['SUBMITTED', 'APPROVED', 'INVOICED', 'CANCELLED'].includes(String(card.status || '').toUpperCase())
  const selectedAssets = new Set((card.assets || []).map(row => String(row.assetid)))
  const relevantSites = sites.filter(site => !card.clientid || String(site.clientid) === String(card.clientid))
  const relevantSections = sections.filter(section => !card.siteid || String(section.siteid) === String(card.siteid))
  const availableAssets = jobCardAssets.filter(asset => (!card.clientid || String(asset.clientid) === String(card.clientid)) && (!card.siteid || String(asset.siteid) === String(card.siteid)))
  const equipmentGroups = [...new Map(availableAssets.map(asset => [
    String(asset.equipgroupid || ''),
    String(asset.equipmentgroup || `Equipment group ${asset.equipgroupid || 'unassigned'}`).trim()
  ])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  document.querySelector('#page').innerHTML = `
    <div class="page-heading"><div><h2>${escapeHtml(card.jobcard_reference || 'New Technician Job Card')}</h2><p>Complete this worksheet on site. Fields are saved when you use a save button below.</p></div><div class="form-actions"><button onclick="showJobCards()">Back</button>${card.jobcardid ? `<button onclick="window.open('${API_BASE}/job-cards/${card.jobcardid}/pdf','_blank')">PDF</button>` : ''}</div></div>
    <form id="jobCardForm" class="job-card-form" onsubmit="return false">
      <section class="filter-card"><h3>Job and Customer</h3><div class="job-card-grid">
        <label class="job-card-customer-picker">Customer *<input id="jcCustomerSearch" type="search" placeholder="Search company name" autocomplete="off" oninput="filterJobCardCustomers()"><small>Type a company name, then open the filtered customer list.</small><select id="jcClient" onchange="jobCardCustomerChanged()"><option value="">Select customer</option>${customers.map(row => jobCardOption(row.clientid,row.clientname,card.clientid)).join('')}</select></label>
        <label>Site *<select id="jcSite" onchange="jobCardSiteChanged()"><option value="">Select site</option>${relevantSites.map(row => jobCardOption(row.siteid,row.sitename,card.siteid)).join('')}</select></label>
        <label>Section<select id="jcSection"><option value="">All / not specified</option>${relevantSections.map(row => jobCardOption(row.sectionid,row.sectionname,card.sectionid)).join('')}</select></label>
        <label>Assigned technician<select id="jcAssigned" onchange="refreshJobCardHours()"><option value="">Unassigned</option>${jobCardTechnicians.filter(row => row.role !== 'ASSISTANT').map(row => jobCardOption(row.user_id,row.full_name,card.assigned_to_user_id)).join('')}</select></label>
        ${['ADMIN','MANAGER'].includes(currentUser.role) ? `<label class="job-card-email-option"><span><input id="jcEmailTechnician" type="checkbox" checked> Email technician when assigned</span><small>The assignment still saves if email delivery fails.</small></label>` : ''}
        <label>Job type<select id="jcType">${['BREAKDOWN','REPAIR','LOAD_TEST','SERVICES','INSPECTIONS','INSTALLATION','INVESTIGATION','OTHER'].map(value => jobCardOption(value,value.replaceAll('_',' '),card.job_type)).join('')}</select></label>
        <label>Priority<select id="jcPriority">${['LOW','NORMAL','HIGH','URGENT'].map(value => jobCardOption(value,value,card.priority)).join('')}</select></label>
        <label>Accelo Job Number *<input id="jcReference" inputmode="numeric" pattern="[0-9]+" required value="${safeAttr(card.customer_reference || '')}" placeholder="e.g. 11927"><small>Email: job+number@fb-cranes.accelo.com</small></label>
        <label>Contact person<input id="jcContact" value="${safeAttr(card.customer_contact_name || '')}"></label>
        <label>Contact number<input id="jcPhone" value="${safeAttr(card.customer_contact_phone || '')}"></label>
        <label>Planned date/time<input id="jcPlanned" type="datetime-local" value="${safeAttr(dateTimeLocalValue(card.planned_at))}"></label>
      </div></section>
      <section class="filter-card"><h3>Job Crew</h3><p class="muted-text">${crewLocked
        ? 'Crew selection is read-only after submission. Return the job for changes before correcting the crew; adding someone after submission does not automatically backfill their time.'
        : 'Select everyone working on this job before submission. The job-card timeline will be copied to each person for individual confirmation and hours calculation when the job is submitted.'}</p>
        <div class="job-card-asset-choices">${jobCardTechnicians.filter(row => String(row.user_id) !== String(card.assigned_to_user_id)).map(row => {
          const existing = (card.crew || []).find(member => String(member.user_id) === String(row.user_id))
          return `<label><input type="checkbox" name="jcCrew" value="${safeAttr(row.user_id)}" data-role="${safeAttr(row.role === 'ASSISTANT' ? 'ASSISTANT' : 'ADDITIONAL_TECHNICIAN')}" ${existing ? 'checked' : ''} ${crewLocked ? 'disabled' : ''}><span><strong>${escapeHtml(row.full_name)}</strong><small>${escapeHtml(row.role === 'ASSISTANT' ? 'Assistant' : 'Additional technician')}</small></span></label>`
        }).join('') || '<p>No additional active crew members are available.</p>'}</div>
      </section>
      <section class="filter-card"><h3>Equipment</h3><p class="muted-text">Filter by equipment group or search by tag/serial number, then select the filtered results in one step. For Inspection jobs, matching inspected assets are also added automatically when saved.</p>
        <div class="job-card-asset-toolbar">
          <label>Equipment group<select id="jcAssetGroup" onchange="jobCardAssetGroupChanged()"><option value="">All equipment groups</option>${equipmentGroups.map(group => jobCardOption(group.id, group.name, '')).join('')}</select></label>
          <label>Equipment type<select id="jcAssetType" onchange="filterJobCardAssets()"><option value="">All equipment types</option></select></label>
          <label>Search assets<input id="jcAssetSearch" type="search" placeholder="Tag, serial or description" oninput="filterJobCardAssets()"></label>
          <div class="job-card-asset-actions"><button type="button" class="load-test-btn" onclick="setFilteredJobCardAssets(true)">Select filtered</button><button type="button" onclick="setFilteredJobCardAssets(false)">Clear filtered</button></div>
          <p id="jcAssetSelectionSummary" class="job-card-asset-summary" aria-live="polite"></p>
        </div>
        <div id="jcAssetChoices" class="job-card-asset-choices">${availableAssets.map(asset => {
          const group = String(asset.equipmentgroup || `Equipment group ${asset.equipgroupid || 'unassigned'}`).trim()
          const type = String(asset.equipmenttype || asset.description || 'Other equipment').trim()
          const search = [asset.assettagno, asset.serialno, group, type, asset.description, asset.wll].filter(Boolean).join(' ').toLowerCase()
          const swl = asset.wll === null || asset.wll === undefined || asset.wll === '' ? 'Not recorded' : `${asset.wll} kg`
          return `<label data-asset-group="${safeAttr(asset.equipgroupid || '')}" data-asset-type="${safeAttr(type)}" data-asset-search="${safeAttr(search)}"><input type="checkbox" name="jcAsset" value="${asset.assetid}" onchange="updateJobCardAssetSummary()" ${selectedAssets.has(String(asset.assetid)) ? 'checked' : ''}><span><strong>${escapeHtml(asset.assettagno || asset.serialno || `Asset ${asset.assetid}`)}</strong><small>${escapeHtml(group)} · ${escapeHtml(type)} · Serial: ${escapeHtml(asset.serialno || 'Not recorded')} · SWL: ${escapeHtml(swl)}</small></span></label>`
        }).join('') || '<p>No active assets match this customer and site.</p>'}</div>
      </section>
      <section class="filter-card"><h3>Fault, Findings and Work</h3><div class="job-card-text-grid">
        ${jobCardTextarea('jcFault','Fault reported',card.reported_fault)}${jobCardTextarea('jcFindings','Findings and diagnosis',card.findings)}${jobCardTextarea('jcRootCause','Root cause',card.root_cause)}${jobCardTextarea('jcWork','Repairs / work performed *',card.work_performed)}${jobCardTextarea('jcTest','Operational test performed',card.test_performed)}${jobCardTextarea('jcTestResult','Test result',card.test_result)}${jobCardTextarea('jcRecommendations','Recommendations / outstanding work',card.recommendations)}
      </div></section>
      <section class="filter-card"><div class="section-heading"><div><h3>Materials and Parts</h3><p class="muted-text">“Required” items can be used for follow-up quotations.</p></div><button type="button" onclick="addJobCardMaterialRow()">Add Material</button></div><div id="jcMaterials">${(card.materials || []).map(renderJobCardMaterialRow).join('')}</div></section>
      <section class="filter-card"><div class="section-heading"><div><h3>Deviations</h3><p class="muted-text">Record each defect separately. Critical deviations enforce a safe equipment decision.</p></div><button type="button" onclick="addJobCardDeviationRow()">Add Deviation</button></div><div id="jcDeviations">${(card.deviations || []).map(renderJobCardDeviationRow).join('')}</div></section>
      <section class="filter-card"><h3>Time and Travel</h3><p class="muted-text">Hours calculate automatically from the timestamps and the assigned person's work schedule. Sunday and active public-holiday work is double time. Travel is split into normal and overtime travel and is counted once in the daily total.</p><div class="job-card-grid">${jobCardDateField('jcDeparted','Departed workshop',card.departed_at)}${jobCardDateField('jcArrived','Arrived on site',card.arrived_at)}${jobCardDateField('jcStarted','Work started',card.work_started_at)}${jobCardDateField('jcCompleted','Work completed',card.work_completed_at)}${jobCardDateField('jcTravelDone','Travel completed',card.travel_completed_at)}<label>Kilometres<input id="jcKm" type="number" min="0" step="0.1" value="${safeAttr(card.kilometres || '')}"></label><label>Normal work time<input id="jcNormalHours" type="number" readonly value="${safeAttr(card.normal_hours ?? '')}"></label><label>Overtime work<input id="jcOvertimeHours" type="number" readonly value="${safeAttr(card.overtime_hours ?? '')}"></label><label>Double-time work<input id="jcDoubleTimeHours" type="number" readonly value="${safeAttr(card.double_time_hours ?? '')}"></label><label>Normal travel<input id="jcNormalTravelHours" type="number" readonly value="${safeAttr(card.normal_travel_hours ?? '')}"></label><label>Overtime travel<input id="jcOvertimeTravelHours" type="number" readonly value="${safeAttr(card.overtime_travel_hours ?? '')}"></label><label>Total calculated hours for the day<input id="jcTotalCalculatedHours" type="number" readonly value="${safeAttr([card.normal_hours,card.overtime_hours,card.double_time_hours,card.normal_travel_hours,card.overtime_travel_hours].reduce((total,value) => total + Number(value || 0),0).toFixed(2))}"></label></div><p id="jcHoursCalculationNote" class="muted-text"></p></section>
      <section class="filter-card"><h3>Final Equipment Status</h3><div class="job-card-grid"><label>Status *<select id="jcEquipmentStatus">${[['SAFE','Safe and returned to service'],['RESTRICTED','Temporarily operational with restrictions'],['FURTHER_WORK','Further work required'],['OUT_OF_SERVICE','Isolated / out of service'],['NOT_TESTED','Not tested']].map(row => jobCardOption(row[0],row[1],card.equipment_status)).join('')}</select></label><label class="job-card-wide">Reason / restrictions<textarea id="jcEquipmentReason">${escapeHtml(card.equipment_status_reason || '')}</textarea></label></div></section>
      <section id="jobCardCustomerSignature" class="filter-card"><h3>Customer Acknowledgement and Signature</h3><p class="muted-text">Ask the customer representative to enter their details and sign directly in the white box using a finger, pen or mouse. If they cannot or refuse to sign, record the reason instead.</p><div class="job-card-grid"><label>Customer representative name<input id="jcSignatory" value="${safeAttr(card.customer_signatory_name || '')}"></label><label>Designation<input id="jcDesignation" value="${safeAttr(card.customer_signatory_designation || '')}"></label><label>Customer email<input id="jcCustomerEmail" type="email" value="${safeAttr(card.customer_contact_email || '')}" placeholder="customer@example.com"></label><label>Unavailable / refused reason<input id="jcSignatureReason" value="${safeAttr(card.signature_unavailable_reason || '')}"></label></div>${card.customer_signature_path ? `<p><strong>Customer signature captured.</strong></p><img class="job-card-signature-image" src="${uploadUrl(card.customer_signature_path)}" alt="Customer signature"><div class="form-actions"><button type="button" class="load-test-btn" onclick="emailSignedJobCardToCustomer(${card.jobcardid})">Email Signed Job Card to Client</button>${card.customer_email_sent_at ? `<span class="muted-text">Last sent ${escapeHtml(new Date(card.customer_email_sent_at).toLocaleString('en-ZA'))} to ${escapeHtml(card.customer_email_to || '')}</span>` : ''}</div>` : `<div class="signature-pad-wrap"><strong>Customer signature — sign inside this box</strong><canvas id="jcSignatureCanvas" width="700" height="180" aria-label="Customer signature block"></canvas><button type="button" onclick="clearJobCardSignature()">Clear Signature</button></div><p class="muted-text">Save the signature before emailing the signed Job Card to the client.</p>`}</section>
      <section class="filter-card"><h3>Photographs</h3><div class="job-card-photo-grid">${(card.photos || []).map(photo => `<figure><img src="${uploadUrl(photo.photo_path)}" alt="Job card photograph"><figcaption>${escapeHtml(photo.photo_type)}: ${escapeHtml(photo.caption || '')}</figcaption></figure>`).join('')}</div><div class="job-card-grid"><label>Attach to deviation<select id="jcPhotoDeviation" ${card.jobcardid ? '' : 'disabled'}><option value="">General job card</option>${(card.deviations || []).map(row => jobCardOption(row.deviationid,`${row.severity}: ${row.description}`,null)).join('')}</select></label><label>Photo type<select id="jcPhotoType">${['GENERAL','BEFORE','AFTER','DEFECT','NAMEPLATE','TEST'].map(value => jobCardOption(value,value,null)).join('')}</select></label><label>Caption<input id="jcPhotoCaption"></label><label>Take photo or choose from gallery<input id="jcPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label></div>${card.jobcardid ? '<button type="button" onclick="uploadJobCardPhotos()">Upload Photos</button>' : '<p class="muted-text">Selected photos will upload automatically when the on-site job is submitted.</p>'}</section>
      ${card.jobcardid && ['ADMIN','MANAGER'].includes(currentUser.role) ? `<section class="filter-card"><div class="section-heading"><div><h3>Accelo Completion Package <small>(Admin/Manager only)</small></h3><p class="muted-text">Office control used after approval to check and send the Job Card, crew timesheets and linked certificates to Accelo. Inspectors do not need this section.</p></div><button type="button" onclick="checkAcceloPackage(${card.jobcardid})">Check readiness</button></div><div id="acceloPackageStatus">${card.accelo_email_sent_at ? `<p><strong>Sent:</strong> ${escapeHtml(new Date(card.accelo_email_sent_at).toLocaleString('en-ZA'))} to ${escapeHtml(card.accelo_email_to || '')}</p>` : '<p>Run the readiness check after the Job Card and crew timesheets are approved.</p>'}</div></section>` : ''}
      ${renderJobCardWorkflow(card)}
    </form>`
  if (!card.customer_signature_path) initialiseJobCardSignature()
  jobCardAssetGroupChanged()
  refreshJobCardHours()
}

function dateTimeLocalValue(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16) }
function jobCardTextarea(id,label,value) { return `<label>${label}<textarea id="${id}">${escapeHtml(value || '')}</textarea></label>` }
function jobCardDateField(id,label,value) { return `<label>${label}<input id="${id}" type="datetime-local" value="${safeAttr(dateTimeLocalValue(value))}" onchange="refreshJobCardHours()"></label>` }
window.refreshJobCardHours = async function () {
  const value = id => document.querySelector(id)?.value || null
  const payload = {
    assigned_to_user_id: value('#jcAssigned'),
    departed_at: value('#jcDeparted'),
    arrived_at: value('#jcArrived'),
    work_started_at: value('#jcStarted'),
    work_completed_at: value('#jcCompleted'),
    travel_completed_at: value('#jcTravelDone')
  }
  const hasCompleteInterval = (payload.departed_at && payload.arrived_at) ||
    (payload.work_started_at && payload.work_completed_at) ||
    (payload.work_completed_at && payload.travel_completed_at)
  if (!hasCompleteInterval) return
  const note = document.querySelector('#jcHoursCalculationNote')
  try {
    if (note) note.textContent = 'Calculating hours...'
    const response = await fetch(`${API_BASE}/job-cards/calculate-hours`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })
    const result = await readApiResponse(response)
    if (!response.ok) throw new Error(result.error || 'Hours could not be calculated')
    const values = {
      jcNormalHours: result.normal_hours,
      jcOvertimeHours: result.overtime_hours,
      jcDoubleTimeHours: result.double_time_hours,
      jcNormalTravelHours: result.normal_travel_hours,
      jcOvertimeTravelHours: result.overtime_travel_hours,
      jcTotalCalculatedHours: result.total_calculated_hours
    }
    Object.entries(values).forEach(([id, hours]) => {
      const input = document.querySelector(`#${id}`)
      if (input) input.value = Number(hours || 0).toFixed(2)
    })
    if (note) note.textContent = `Calculated using: ${result.schedule_name || 'assigned work schedule'}.`
  } catch (error) {
    if (note) note.textContent = error.message
  }
}
function renderJobCardWorkflow(card) {
  const status = card.status || 'DRAFT'
  const adminSelfApproval = currentUser.role === 'ADMIN' && String(card.assigned_to_user_id || '') === String(currentUser.user_id)
  const descriptions = {
    DRAFT: 'The job card is being prepared and is not yet allocated as active work.',
    ASSIGNED: card.assignment_email_sent_at
      ? `Allocated to ${card.assigned_to_name || 'the selected technician'} and emailed to ${card.assignment_email_to || card.assigned_to_email}. It is also visible in the technician's ATEC Job Cards list.`
      : card.assignment_email_error
        ? `Allocated to ${card.assigned_to_name || 'the selected technician'} and visible in ATEC. The assignment email failed: ${card.assignment_email_error}`
        : `Allocated to ${card.assigned_to_name || 'the selected technician'} and visible in the technician's ATEC Job Cards list.`,
    IN_PROGRESS: 'The technician has started travelling or working on this job.',
    AWAITING_SIGNATURE: 'The work is complete, but customer acknowledgement or a refusal reason is still required.',
    SUBMITTED: adminSelfApproval
      ? 'Your completed worksheet is ready for your own final approval. No separate Manager approval is required.'
      : 'The technician has completed the worksheet and submitted it to the office for review.',
    APPROVED: 'An Admin or Manager has reviewed and accepted the completed job card.',
    INVOICED: 'The office has processed this job card for invoicing.',
    CANCELLED: 'This job card has been cancelled and is no longer active.'
  }
  const officeUser = ['ADMIN', 'MANAGER'].includes(currentUser.role)
  const actions = []
  if (status === 'DRAFT') {
    if (officeUser) actions.push(`<button type="button" class="load-test-btn" onclick="saveJobCard('ASSIGNED')">Save & Assign</button>`)
    else actions.push('<button type="button" onclick="saveJobCard(\'IN_PROGRESS\')">Save & Continue On-site</button>', '<button type="button" class="load-test-btn" onclick="saveJobCard(\'SUBMITTED\')">Save & Submit On-site</button>')
  }
  if (status === 'ASSIGNED') actions.push('<button type="button" class="load-test-btn" onclick="saveJobCard(\'IN_PROGRESS\')">Start Job</button>')
  if (status === 'IN_PROGRESS') actions.push(`<button type="button" class="load-test-btn" onclick="saveJobCard('SUBMITTED')">${adminSelfApproval ? 'Submit for My Approval' : 'Submit to Office'}</button>`)
  if (status === 'AWAITING_SIGNATURE') actions.push('<button type="button" onclick="saveJobCard(\'IN_PROGRESS\')">Continue Editing</button>', `<button type="button" class="load-test-btn" onclick="saveJobCard('SUBMITTED')">${adminSelfApproval ? 'Submit for My Approval' : 'Submit to Office'}</button>`)
  if (status === 'SUBMITTED' && officeUser) actions.push('<button type="button" onclick="saveJobCard(\'IN_PROGRESS\')">Return for Changes</button>', '<button type="button" class="load-test-btn" onclick="saveJobCard(\'APPROVED\')">Approve Job Card</button>')
  if (status === 'APPROVED' && officeUser) actions.push('<button type="button" class="load-test-btn" onclick="saveJobCard(\'INVOICED\')">Mark as Invoiced</button>')
  if (officeUser && ['DRAFT','ASSIGNED','IN_PROGRESS','AWAITING_SIGNATURE'].includes(status)) actions.push('<button type="button" class="danger-btn" onclick="saveJobCard(\'CANCELLED\')">Cancel Job Card</button>')
  return `<section class="filter-card job-card-submit"><div class="job-card-workflow-copy"><span>Current stage</span><strong class="job-card-status status-${safeAttr(status.toLowerCase())}">${escapeHtml(status.replaceAll('_',' '))}</strong><p>${escapeHtml(descriptions[status] || '')}</p></div><div class="form-actions"><button type="button" onclick="showJobCards()">Back to Job Cards</button><button type="button" onclick="saveJobCard()">Save for Later</button>${actions.join('')}</div></section>`
}
function renderJobCardMaterialRow(row = {}) { return `<div class="job-card-repeat-row jc-material"><input class="jc-mat-qty" type="number" min="0" step="0.1" value="${safeAttr(row.quantity || 1)}" aria-label="Quantity"><input class="jc-mat-desc" value="${safeAttr(row.description || '')}" placeholder="Description"><input class="jc-mat-part" value="${safeAttr(row.part_number || '')}" placeholder="Part number"><select class="jc-mat-supplier">${['FB_CRANES','CUSTOMER'].map(value => jobCardOption(value,value.replace('_',' '),row.supplied_by)).join('')}</select><select class="jc-mat-status">${['USED','RETURNED','REQUIRED'].map(value => jobCardOption(value,value,row.material_status)).join('')}</select><button type="button" onclick="this.parentElement.remove()">Remove</button></div>` }
function renderJobCardDeviationRow(row = {}) { return `<div class="job-card-deviation jc-deviation" data-id="${safeAttr(row.deviationid || '')}"><div class="job-card-grid"><label>Category<select class="jc-dev-category">${['ELECTRICAL','MECHANICAL','STRUCTURAL','CONTROLS','SAFETY','HOUSEKEEPING','OTHER'].map(value => jobCardOption(value,value,row.category)).join('')}</select></label><label>Severity<select class="jc-dev-severity">${['OBSERVATION','MINOR','MAJOR','CRITICAL'].map(value => jobCardOption(value,value,row.severity)).join('')}</select></label><label>Status<select class="jc-dev-status">${['OPEN','CLOSED'].map(value => jobCardOption(value,value,row.deviation_status)).join('')}</select></label><label>Target date<input class="jc-dev-date" type="date" value="${safeAttr(row.target_date ? String(row.target_date).slice(0,10) : '')}"></label><label class="job-card-wide">Deviation description<textarea class="jc-dev-desc">${escapeHtml(row.description || '')}</textarea></label><label>Immediate action<textarea class="jc-dev-action">${escapeHtml(row.immediate_action || '')}</textarea></label><label>Further work required<textarea class="jc-dev-further">${escapeHtml(row.further_work_required || '')}</textarea></label></div><button type="button" onclick="this.parentElement.remove()">Remove Deviation</button></div>` }
window.addJobCardMaterialRow = () => document.querySelector('#jcMaterials').insertAdjacentHTML('beforeend', renderJobCardMaterialRow())
window.addJobCardDeviationRow = () => document.querySelector('#jcDeviations').insertAdjacentHTML('beforeend', renderJobCardDeviationRow())
window.jobCardCustomerChanged = async function () {
  jobCardEditing = { ...jobCardEditing, clientid: document.querySelector('#jcClient').value, siteid: '', sectionid: '' }
  try { await loadJobCardAssets(jobCardEditing.clientid) }
  catch (error) { alert(error.message); jobCardAssets = [] }
  renderJobCardForm()
}

window.filterJobCardCustomers = function () {
  const searchInput = document.querySelector('#jcCustomerSearch')
  const select = document.querySelector('#jcClient')
  if (!searchInput || !select) return
  const query = searchInput.value.trim().toLowerCase()
  const selectedId = select.value || String(jobCardEditing?.clientid || '')
  const matches = customers.filter(row =>
    !query || String(row.clientname || '').toLowerCase().includes(query)
  )
  const selectedCustomer = customers.find(row => String(row.clientid) === String(selectedId))
  if (selectedCustomer && !matches.some(row => String(row.clientid) === String(selectedId))) {
    matches.unshift(selectedCustomer)
  }
  select.innerHTML = `<option value="">${matches.length ? 'Select customer' : 'No companies match your search'}</option>${matches.map(row => jobCardOption(row.clientid,row.clientname,selectedId)).join('')}`
  select.value = selectedId
}
window.jobCardSiteChanged = async function () {
  jobCardEditing = { ...jobCardEditing, clientid: document.querySelector('#jcClient').value, siteid: document.querySelector('#jcSite').value, sectionid: '' }
  try { await loadJobCardAssets(jobCardEditing.clientid, jobCardEditing.siteid) }
  catch (error) { alert(error.message); jobCardAssets = [] }
  renderJobCardForm()
}

window.filterJobCardAssets = function () {
  const group = document.querySelector('#jcAssetGroup')?.value || ''
  const type = document.querySelector('#jcAssetType')?.value || ''
  const search = (document.querySelector('#jcAssetSearch')?.value || '').trim().toLowerCase()
  document.querySelectorAll('#jcAssetChoices > label').forEach(label => {
    label.hidden = !((!group || label.dataset.assetGroup === group) && (!type || label.dataset.assetType === type) && (!search || (label.dataset.assetSearch || '').includes(search)))
  })
  updateJobCardAssetSummary()
}

window.jobCardAssetGroupChanged = function () {
  const group = document.querySelector('#jcAssetGroup')?.value || ''
  const typeSelect = document.querySelector('#jcAssetType')
  if (!typeSelect) return
  const previousType = typeSelect.value
  const types = [...new Set([...document.querySelectorAll('#jcAssetChoices > label')]
    .filter(label => !group || label.dataset.assetGroup === group)
    .map(label => label.dataset.assetType)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b))
  typeSelect.innerHTML = `<option value="">All equipment types</option>${types.map(type => jobCardOption(type, type, previousType)).join('')}`
  if (!types.includes(previousType)) typeSelect.value = ''
  filterJobCardAssets()
}

window.setFilteredJobCardAssets = function (checked) {
  document.querySelectorAll('#jcAssetChoices > label:not([hidden]) input[name="jcAsset"]').forEach(input => { input.checked = checked })
  updateJobCardAssetSummary()
}

window.updateJobCardAssetSummary = function () {
  const all = [...document.querySelectorAll('#jcAssetChoices input[name="jcAsset"]')]
  const visible = all.filter(input => !input.closest('label')?.hidden)
  const selected = all.filter(input => input.checked)
  const summary = document.querySelector('#jcAssetSelectionSummary')
  if (summary) summary.textContent = `${selected.length} selected · ${visible.length} shown · ${all.length} available`
}

function initialiseJobCardSignature() { const canvas = document.querySelector('#jcSignatureCanvas'); if (!canvas) return; const ctx = canvas.getContext('2d'); ctx.lineWidth=2; ctx.lineCap='round'; let drawing=false; const point=e=>{ const r=canvas.getBoundingClientRect(), t=e.touches?.[0]||e; return {x:(t.clientX-r.left)*(canvas.width/r.width),y:(t.clientY-r.top)*(canvas.height/r.height)} }; const start=e=>{drawing=true;const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);e.preventDefault()}; const move=e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke();e.preventDefault()}; const stop=()=>drawing=false; canvas.addEventListener('pointerdown',start);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointerleave',stop) }
window.clearJobCardSignature = function () { const canvas=document.querySelector('#jcSignatureCanvas'); canvas?.getContext('2d').clearRect(0,0,canvas.width,canvas.height) }
function jobCardCanvasHasInk(canvas) { if (!canvas) return false; return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0) }

function collectJobCardPayload(forcedStatus) {
  const value=id=>document.querySelector(id)?.value || ''
  return { clientid:value('#jcClient'),siteid:value('#jcSite'),sectionid:value('#jcSection')||null,assigned_to_user_id:value('#jcAssigned')||null,crew:[...document.querySelectorAll('[name="jcCrew"]:checked')].map(node=>({user_id:Number(node.value),crew_role:node.dataset.role})),email_assigned_technician:document.querySelector('#jcEmailTechnician')?.checked===true,job_type:value('#jcType'),priority:value('#jcPriority'),status:forcedStatus||jobCardEditing?.status||'DRAFT',customer_reference:value('#jcReference').trim(),customer_contact_name:value('#jcContact'),customer_contact_phone:value('#jcPhone'),customer_contact_email:value('#jcCustomerEmail').trim(),planned_at:value('#jcPlanned')||null,assetids:[...document.querySelectorAll('[name="jcAsset"]:checked')].map(node=>Number(node.value)),reported_fault:value('#jcFault'),findings:value('#jcFindings'),root_cause:value('#jcRootCause'),work_performed:value('#jcWork'),test_performed:value('#jcTest'),test_result:value('#jcTestResult'),recommendations:value('#jcRecommendations'),materials:[...document.querySelectorAll('.jc-material')].map(row=>({quantity:row.querySelector('.jc-mat-qty').value,description:row.querySelector('.jc-mat-desc').value,part_number:row.querySelector('.jc-mat-part').value,supplied_by:row.querySelector('.jc-mat-supplier').value,material_status:row.querySelector('.jc-mat-status').value})),deviations:[...document.querySelectorAll('.jc-deviation')].map(row=>({deviationid:row.dataset.id||null,category:row.querySelector('.jc-dev-category').value,severity:row.querySelector('.jc-dev-severity').value,deviation_status:row.querySelector('.jc-dev-status').value,target_date:row.querySelector('.jc-dev-date').value||null,description:row.querySelector('.jc-dev-desc').value,immediate_action:row.querySelector('.jc-dev-action').value,further_work_required:row.querySelector('.jc-dev-further').value})),departed_at:value('#jcDeparted')||null,arrived_at:value('#jcArrived')||null,work_started_at:value('#jcStarted')||null,work_completed_at:value('#jcCompleted')||null,travel_completed_at:value('#jcTravelDone')||null,kilometres:value('#jcKm'),normal_hours:value('#jcNormalHours'),overtime_hours:value('#jcOvertimeHours'),standby_hours:value('#jcStandbyHours'),equipment_status:value('#jcEquipmentStatus'),equipment_status_reason:value('#jcEquipmentReason'),customer_signatory_name:value('#jcSignatory'),customer_signatory_designation:value('#jcDesignation'),signature_unavailable_reason:value('#jcSignatureReason'),customer_signature_data:jobCardCanvasHasInk(document.querySelector('#jcSignatureCanvas'))?document.querySelector('#jcSignatureCanvas').toDataURL('image/png'):null }
}

async function uploadJobCardPhotoFiles(jobcardid, files, { caption = '', photoType = 'GENERAL', deviationid = '' } = {}) {
  if (!files?.length) return { uploaded: 0 }
  const form = new FormData()
  ;[...files].forEach(file => {
    form.append('jobCardPhotos', file)
    form.append('photoCaptions', caption)
    form.append('photoTypes', photoType)
  })
  form.append('deviationid', deviationid)
  const response = await fetch(`${API_BASE}/job-cards/${jobcardid}/photos`, { method: 'POST', body: form })
  const result = await readApiResponse(response)
  if (!response.ok) throw new Error(result.error || 'Photo upload failed')
  return { uploaded: files.length, result }
}

window.saveJobCard = async function (forcedStatus = null) {
  const payload = collectJobCardPayload(forcedStatus)
  if (!/^[0-9]+$/.test(payload.customer_reference)) {
    alert('Enter the Accelo Job Number using numeric digits only.')
    document.querySelector('#jcReference')?.focus()
    return
  }
  if (!payload.assetids.length) {
    alert('Select at least one asset for the job card.')
    document.querySelector('#jcAssetSearch')?.focus()
    return
  }
  const id = jobCardEditing?.jobcardid
  const pendingFiles = !id ? [...(document.querySelector('#jcPhotos')?.files || [])] : []
  const pendingPhotoDetails = {
    caption: document.querySelector('#jcPhotoCaption')?.value || '',
    photoType: document.querySelector('#jcPhotoType')?.value || 'GENERAL',
    deviationid: ''
  }
  const response = await fetch(`${API_BASE}/job-cards${id ? `/${id}` : ''}`, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const result = await readApiResponse(response)
  if (!response.ok) {
    alert(result.error || 'Could not save job card')
    return
  }
  jobCardEditing = result
  try {
    if (pendingFiles.length) {
      await uploadJobCardPhotoFiles(result.jobcardid, pendingFiles, pendingPhotoDetails)
      const refreshed = await fetch(`${API_BASE}/job-cards/${result.jobcardid}`)
      if (refreshed.ok) jobCardEditing = await refreshed.json()
    }
  } catch (photoError) {
    alert(`Job card ${result.jobcard_reference} was saved, but follow-up processing was not completed: ${photoError.message}`)
    renderJobCardForm()
    return
  }
  const email = result.email_notification
  const managerEmail = result.manager_email_notification
  const acceloSubmission = result.accelo_submission_notification
  const acceloSubmissionMessage = acceloSubmission?.requested
    ? (acceloSubmission.sent ? ` The signed Job Card was also emailed to Accelo at ${acceloSubmission.to}.` : ` The Accelo email failed: ${acceloSubmission.error}`)
    : ''
  const assignedMessage = email?.requested
    ? (email.sent
      ? `Job card assigned to ${result.assigned_to_name}. Email sent to ${email.to}.`
      : `Job card assigned and visible in ${result.assigned_to_name}'s ATEC profile, but the email was not sent: ${email.error}`)
    : `Job card assigned to ${result.assigned_to_name || 'the technician'} and is visible in their ATEC profile. Email was not requested.`
  const messages = {
    ASSIGNED: assignedMessage,
    IN_PROGRESS: id ? 'Job started.' : 'On-site job created. You can now add photographs and continue working.',
    AWAITING_SIGNATURE: 'Job card is awaiting customer acknowledgement.',
    SUBMITTED: managerEmail?.self_approval
      ? `Job card submitted for your own approval${pendingFiles.length ? ` with ${pendingFiles.length} photograph(s) uploaded` : ''}. No separate Manager approval is required.`
      : managerEmail?.requested
      ? (managerEmail.sent
        ? `Job card submitted and emailed to ${managerEmail.name || 'the assigned Manager'}${pendingFiles.length ? ` with ${pendingFiles.length} photograph(s) uploaded` : ''}.${acceloSubmissionMessage}`
        : `Job card submitted, but the Manager email could not be sent: ${managerEmail.error}.${acceloSubmissionMessage}`)
      : `${pendingFiles.length ? `On-site job submitted to the office with ${pendingFiles.length} photograph(s).` : 'Job card submitted to the office.'}${acceloSubmissionMessage}`,
    APPROVED: 'Job card approved.',
    INVOICED: 'Job card marked as invoiced.',
    CANCELLED: 'Job card cancelled.'
  }
  alert(messages[forcedStatus] || `Job card ${result.jobcard_reference} saved for later.`)
  renderJobCardForm()
}

window.uploadJobCardPhotos = async function () {
  const files = [...(document.querySelector('#jcPhotos')?.files || [])]
  if (!files.length) return alert('Choose at least one photograph.')
  try {
    await uploadJobCardPhotoFiles(jobCardEditing.jobcardid, files, {
      caption: document.querySelector('#jcPhotoCaption').value,
      photoType: document.querySelector('#jcPhotoType').value,
      deviationid: document.querySelector('#jcPhotoDeviation').value
    })
    await openJobCard(jobCardEditing.jobcardid)
  } catch (error) {
    alert(error.message || 'Photo upload failed')
  }
}

window.emailSignedJobCardToCustomer = async function (jobcardid) {
  const email = document.querySelector('#jcCustomerEmail')?.value.trim() || ''
  if (!email || !document.querySelector('#jcCustomerEmail')?.checkValidity()) {
    alert('Enter a valid customer email address.')
    document.querySelector('#jcCustomerEmail')?.focus()
    return
  }
  if (!confirm(`Email the signed Job Card to ${email}?`)) return
  const response = await fetch(`${API_BASE}/job-cards/${jobcardid}/email-customer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
  })
  const result = await readApiResponse(response)
  if (!response.ok) return alert(result.error || 'The signed Job Card could not be emailed to the client.')
  alert(`Signed Job Card emailed to ${result.to}.`)
  await openJobCard(jobcardid)
}

window.checkAcceloPackage = async function (jobcardid) {
  const box = document.querySelector('#acceloPackageStatus')
  if (box) box.innerHTML = '<p>Checking package readiness...</p>'
  const response = await fetch(`${API_BASE}/workforce/job-cards/${jobcardid}/accelo-readiness`)
  const result = await readApiResponse(response)
  if (!response.ok) {
    if (box) box.innerHTML = `<p class="login-error">${escapeHtml(result.error || 'Could not check the Accelo package')}</p>`
    return
  }
  if (box) box.innerHTML = `
    <div class="job-card-grid">
      <p><strong>Recipient</strong><br>${escapeHtml(result.recipient || '-')}</p>
      <p><strong>Crew</strong><br>${result.crew.length}</p>
      <p><strong>Timesheets</strong><br>${result.timesheets.length}</p>
      <p><strong>Certificates</strong><br>${result.certificates.length}</p>
    </div>
    ${result.issues.length ? `<div class="login-error"><strong>Not ready:</strong><ul>${result.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul></div>` : `<p><strong>Ready to send.</strong> All workflow checks passed.</p><button type="button" class="load-test-btn" onclick="sendAcceloPackage(${jobcardid},${result.card.accelo_email_sent_at ? 'true' : 'false'})">${result.card.accelo_email_sent_at ? 'Resend package' : 'Send package to Accelo'}</button>`}`
}

window.sendAcceloPackage = async function (jobcardid, resend = false) {
  const destination = document.querySelector('#acceloPackageStatus strong')?.textContent || 'the derived Accelo job address'
  if (!window.confirm(`Send the completed Job Card package to ${destination}?`)) return
  const response = await fetch(`${API_BASE}/workforce/job-cards/${jobcardid}/accelo-send`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({resend})
  })
  const result = await readApiResponse(response)
  if (!response.ok) {
    const issues = Array.isArray(result.issues) ? `\n${result.issues.join('\n')}` : ''
    alert(`${result.error || 'Could not send the Accelo package'}${issues}`)
    return
  }
  alert(`Accelo package sent to ${result.recipient} with ${result.attachments.length} attachment(s).`)
  await openJobCard(jobcardid)
}

const startupTap = getStartupAssetTap()
if (startupTap) {
  setCurrentPage("quick-inspection")
  replaceCurrentHistoryPage("quick-inspection")
  showQuickInspection()
  await resolveStartupAssetTap(startupTap)
  return
}

let currentPage =
  localStorage.getItem("currentPage") || "dashboard"

if (!hasAccess(currentPage)) {
  currentPage = currentUser.role === "CUSTOMER"
    ? "portal"
    : currentUser.role === "ASSISTANT"
      ? "my-day"
      : currentUser.role === "HR"
        ? "hr-timesheets"
        : "dashboard"
  setCurrentPage(currentPage)
}

replaceCurrentHistoryPage(currentPage)

switch (currentPage) {
  case "portal":
    showCustomerPortal()
    break

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

  case "visits":
    showInspectionVisits()
    break

  case "job-cards":
    showJobCards()
    break

  case "my-day":
    showMyDay()
    break

  case "timesheet-approvals":
    showTimesheetApprovals()
    break

  case "timesheet-history":
    showTimesheetHistory()
    break

  case "hr-timesheets":
    showHrTimesheets()
    break

  case "work-schedules":
    showWorkSchedules()
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

  case "mpi":
    showMpiReports()
    break

  case "customer-report":
    showCustomerDetailedReport()
    break

  case "she":
    showRiskAssessments()
    break

  case "she-reports":
    showRiskAssessmentReports()
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

window.addEventListener('popstate', event => {
  if (!currentUser) return

  const requestedPage = event.state?.atecPage
  const fallbackPage = currentUser.role === 'CUSTOMER'
    ? 'portal'
    : currentUser.role === 'ASSISTANT'
      ? 'my-day'
      : currentUser.role === 'HR'
        ? 'hr-timesheets'
        : 'dashboard'
  const pageKey = requestedPage && hasAccess(requestedPage)
    ? requestedPage
    : fallbackPage

  const pageRenderers = {
    portal: window.showCustomerPortal,
    dashboard: window.showDashboard,
    customers: window.showCustomerSetup,
    sites: window.showSites,
    responsible: window.showResponsiblePersons,
    sections: window.showSections,
    assets: window.showAssetSetup,
    inspections: window.showInspections,
    visits: window.showInspectionVisits,
    'job-cards': window.showJobCards,
    'my-day': window.showMyDay,
    'timesheet-approvals': window.showTimesheetApprovals,
    'timesheet-history': window.showTimesheetHistory,
    'hr-timesheets': window.showHrTimesheets,
    'work-schedules': window.showWorkSchedules,
    'quick-inspection': window.showQuickInspection,
    criteria: window.showEquipmentTypeCriteria,
    certificates: window.showCertificateSearch,
    mpi: window.showMpiReports,
    'customer-report': window.showCustomerDetailedReport,
    she: window.showRiskAssessments,
    'she-reports': window.showRiskAssessmentReports,
    users: window.showUserManagement,
    'system-health': window.showSystemHealth,
    profile: window.showMyProfile
  }

  browserHistoryRestoring = true
  try {
    setCurrentPage(pageKey)
    ;(pageRenderers[pageKey] || window.showDashboard)?.()
  } finally {
    browserHistoryRestoring = false
  }
})

loadData()


