import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'
import { escapeHtml } from '../utils/security.js'

export function renderCustomerSetup(customers, customerArchiveMode = "active") {
  const canArchiveCustomers = window.currentUser?.role === "ADMIN"
  const missingAddressCount = customers.filter(customer => {
    const isArchived = customer.archived === true || customer.archived === "true"
    return !isArchived && !String(customer.clientaddr || "").trim()
  }).length
  const filteredCustomers = customers.filter(customer => {
  const isArchived = customer.archived === true || customer.archived === "true";

  if (customerArchiveMode === "active") return !isArchived;
  if (customerArchiveMode === "archived") return isArchived;
  return true;
});
  const sortedCustomers = sortTableRows(filteredCustomers, 'customers', {
    clientid: customer => customer.clientid,
    clientname: customer => customer.clientname,
    clientaddr: customer => customer.clientaddr,
    notifications: customer => [
      customer.notify_expiring_certificates,
      customer.notify_overdue_assets,
      customer.notify_failed_assets,
      customer.notify_visit_exceptions
    ].filter(value => value !== false).length,
    archived: customer => customer.archived ? 'Archived' : 'Active'
  }, 'clientname')
  const pagination = getPaginationState(sortedCustomers, "customerCurrentPage", "customerRowsPerPage")

  document.querySelector("#page").innerHTML = `
    <h2>Customer Setup</h2>

    <div class="page-actions">
      <button onclick="addClient()">Add Client</button>
      ${canArchiveCustomers ? `<button onclick="reviewMissingCustomerAddresses()">Missing Addresses (${missingAddressCount})</button>` : ''}
      <button class="secondary-button" onclick="showCustomerSetup()">Refresh</button>
    </div>

    <div class="filter-card">
      <label>Show Customers</label>

      <div class="radio-row">
        <label>
          <input
            type="radio"
            name="customerArchiveFilter"
            value="active"
            ${customerArchiveMode === "active" ? "checked" : ""}
            onchange="showCustomerSetup('active')"
          >
          Active
        </label>

        <label>
          <input
            type="radio"
            name="customerArchiveFilter"
            value="archived"
            ${customerArchiveMode === "archived" ? "checked" : ""}
            onchange="showCustomerSetup('archived')"
          >
          Archived
        </label>

        <label>
          <input
            type="radio"
            name="customerArchiveFilter"
            value="all"
            ${customerArchiveMode === "all" ? "checked" : ""}
            onchange="showCustomerSetup('all')"
          >
          All
        </label>
      </div>
    </div>
</div>

      <br>

      <input
        id="customerSearch"
        type="text"
        placeholder="Search Client ID, Client Name or Address..."
        onkeyup="filterCustomers(true)"
      />

      <br><br>

      ${renderPaginationControls({
        ...pagination,
        label: "customers",
        onPage: "goToCustomerPage",
        onPageSize: "setCustomerRowsPerPage"
      })}

      <table>
      <thead>
        <tr>
          <th>${sortHeader('Client ID', 'customers', 'clientid', 'showCustomerSetup')}</th>
          <th>${sortHeader('Client Name', 'customers', 'clientname', 'showCustomerSetup')}</th>
          <th>${sortHeader('Address', 'customers', 'clientaddr', 'showCustomerSetup')}</th>
          <th>${sortHeader('Notifications', 'customers', 'notifications', 'showCustomerSetup')}</th>
          <th>${sortHeader('Status', 'customers', 'archived', 'showCustomerSetup')}</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody id="customerTableBody">
        ${pagination.rows.map(customer => `
          <tr>
            <td>${escapeHtml(customer.clientid)}</td>
            <td>${escapeHtml(customer.clientname || "")}</td>
            <td>${escapeHtml(customer.clientaddr || "")}</td>
            <td>${renderCustomerNotificationStatus(customer)}</td>
            <td>${customer.archived ? "Archived" : "Active"}</td>
            <td>
              <button onclick="editClient(${customer.clientid})">Edit</button>

              ${canArchiveCustomers ? `
              ${
                customer.archived
                  ? `<button onclick="unarchiveClient(${customer.clientid})">Unarchive</button>`
                  : `<button onclick="archiveClient(${customer.clientid})">Archive</button>`
              }
              ` : ''}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderCustomerNotificationStatus(customer) {
  const enabled = [
    customer.notify_expiring_certificates,
    customer.notify_overdue_assets,
    customer.notify_failed_assets,
    customer.notify_visit_exceptions
  ].filter(value => value !== false).length

  return `<span class="customer-notification-status ${enabled ? 'enabled' : 'disabled'}">${enabled}/4 on</span>`
}
