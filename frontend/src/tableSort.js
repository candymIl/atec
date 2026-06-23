export function getTableSortState(tableKey, defaultKey = '') {
  const stateKey = `${tableKey}Sort`
  window[stateKey] = window[stateKey] || {
    key: defaultKey,
    direction: 'asc'
  }

  return window[stateKey]
}

export function sortTableRows(rows, tableKey, columns, defaultKey = '') {
  const sort = getTableSortState(tableKey, defaultKey)
  const activeKey = sort.key || defaultKey
  const getValue = columns[activeKey]

  if (!getValue) return [...rows]

  const direction = sort.direction === 'desc' ? -1 : 1

  return [...rows].sort((left, right) => {
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

export function sortHeader(label, tableKey, key, renderFunctionName) {
  const sort = getTableSortState(tableKey, key)
  const isActive = sort.key === key
  const directionClass = isActive ? sort.direction : ''

  return `
    <span class="user-table-heading">
      <span>${label}</span>
      <button
        type="button"
        class="user-sort-btn ${isActive ? `active ${directionClass}` : ''}"
        onclick="sortTable('${tableKey}', '${key}', '${renderFunctionName}')"
        aria-label="Sort ${label}"
        title="Sort ${label}"
      ></button>
    </span>
  `
}

window.sortTable = function (tableKey, key, renderFunctionName) {
  const sort = getTableSortState(tableKey, key)

  window[`${tableKey}Sort`] = {
    key,
    direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc'
  }

  const renderFunction = window[renderFunctionName]
  if (typeof renderFunction === 'function') {
    renderFunction()
  }
}
