export function inspectionTagDisplay(value) {
  return String(value || "").trim() || "Not Issued"
}

export function finalStatusFromFailures(failedRows = [], criticalRows = []) {
  return failedRows.length || criticalRows.length ? "NOT SAFE" : "SAFE"
}
