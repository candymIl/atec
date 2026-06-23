import { getPaginationState, renderPaginationControls } from '../pagination.js'
import { sortHeader, sortTableRows } from '../tableSort.js'

export function renderCustomerSetup(customers, customerArchiveMode = "active") {
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
    archived: customer => customer.archived ? 'Archived' : 'Active'
  }, 'clientname')
  const pagination = getPaginationState(sortedCustomers, "customerCurrentPage", "customerRowsPerPage")

  document.querySelector("#page").innerHTML = `
    <h2>Customer Setup</h2>

    <button onclick="addClient()">Add Client</button>
    <button onclick="showCustomerSetup()">Refresh</button>

    <br><br>

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
          <th>${sortHeader('Status', 'customers', 'archived', 'showCustomerSetup')}</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody id="customerTableBody">
        ${pagination.rows.map(customer => `
          <tr>
            <td>${customer.clientid}</td>
            <td>${customer.clientname || ""}</td>
            <td>${customer.clientaddr || ""}</td>
            <td>${customer.archived ? "Archived" : "Active"}</td>
            <td>
              <button onclick="editClient(${customer.clientid})">Edit</button>

              ${
                customer.archived
                  ? `<button onclick="unarchiveClient(${customer.clientid})">Unarchive</button>`
                  : `<button onclick="archiveClient(${customer.clientid})">Archive</button>`
              }
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}
