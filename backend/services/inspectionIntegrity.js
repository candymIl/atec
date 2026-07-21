const FAILED_RESULT_VALUES = new Set(["FAIL", "NO", "NOT SAFE", "UNSAFE"])
const PASSED_RESULT_VALUES = new Set(["PASS", "YES", "SAFE"])

function normalizeText(value) {
  return String(value || "").trim()
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase()
}

function isSafeForContinuedOperationName(value) {
  const normalized = normalizeUpper(value)
  return normalized === "SAFE FOR CONTINUED OPERATION" ||
    normalized === "SAFE FOR SERVICE"
}

function isFailedInspectionResult(resultRow = {}) {
  return FAILED_RESULT_VALUES.has(normalizeUpper(resultRow.result)) ||
    FAILED_RESULT_VALUES.has(normalizeUpper(resultRow.measuredvalue))
}

function isPassedInspectionResult(resultRow = {}) {
  return PASSED_RESULT_VALUES.has(normalizeUpper(resultRow.result)) ||
    PASSED_RESULT_VALUES.has(normalizeUpper(resultRow.measuredvalue))
}

function isCriticalCriteria(criteriaRow = {}) {
  return normalizeUpper(criteriaRow.severity) === "CRITICAL"
}

function inspectionTypeMatchesCriteria(inspection = {}, criteriaRow = {}) {
  const inspectionType = normalizeUpper(inspection.inspectiontype)
  const criteriaInspectionType = normalizeUpper(criteriaRow.inspectioncategory)
  const legacyCategory = normalizeUpper(criteriaRow.inspection_category)
  const effectiveCriteriaType = criteriaInspectionType ||
    (legacyCategory === "LOADTEST" ? "LOADTEST" : "VISUAL")

  if (inspectionType === "LOADTEST") {
    return effectiveCriteriaType === "LOADTEST" ||
      isSafeForContinuedOperationName(criteriaRow.criterianame || criteriaRow.criteriadescription)
  }

  if (effectiveCriteriaType === "LOADTEST") return false

  if (
    normalizeUpper(inspection.inspectionfrequency) === "FREQUENT" &&
    legacyCategory === "PERIODIC_THOROUGH_INSPECTION"
  ) {
    return false
  }

  return true
}

function isRetiredCriteria(criteriaRow = {}) {
  return normalizeUpper(
    criteriaRow.criterianame || criteriaRow.criteriadescription
  ).includes("HOOK WEAR DOES NOT EXCEED ALLOWABLE LIMITS")
}

function relevantCriteriaRows(inspection = {}, criteriaRows = []) {
  return criteriaRows
    .filter(row => !isRetiredCriteria(row))
    .filter(row => inspectionTypeMatchesCriteria(inspection, row))
}

function resultCriteriaIdSet(results = []) {
  return new Set(
    results
      .map(row => Number(row.criteriaid))
      .filter(value => Number.isInteger(value) && value > 0)
  )
}

function getMissingCriteriaIds(inspection = {}, results = [], criteriaRows = []) {
  const resultIds = resultCriteriaIdSet(results)
  return relevantCriteriaRows(inspection, criteriaRows)
    .map(row => Number(row.criteriaid))
    .filter(value => Number.isInteger(value) && value > 0 && !resultIds.has(value))
}

function deriveInspectionStatus(results = [], criteriaRows = [], fallbackStatus = "") {
  const criteriaById = new Map(criteriaRows.map(row => [String(row.criteriaid), row]))
  const hasCriticalFailure = results.some(row => {
    const criteria = criteriaById.get(String(row.criteriaid))
    return criteria && isCriticalCriteria(criteria) && isFailedInspectionResult(row)
  })

  if (hasCriticalFailure || results.some(isFailedInspectionResult)) {
    return "NOT SAFE"
  }

  const safeRow = results.find(row => {
    const criteria = criteriaById.get(String(row.criteriaid))
    return isSafeForContinuedOperationName(
      criteria?.criterianame ||
      criteria?.criteriadescription ||
      row.criterianame ||
      row.criteriadescription
    )
  })

  if (safeRow) {
    if (isFailedInspectionResult(safeRow)) return "NOT SAFE"
    if (isPassedInspectionResult(safeRow)) return "SAFE"
  }

  const normalizedFallback = normalizeUpper(fallbackStatus)
  if (FAILED_RESULT_VALUES.has(normalizedFallback)) return "NOT SAFE"
  if (PASSED_RESULT_VALUES.has(normalizedFallback)) return "SAFE"

  return ""
}

function normalizeCriteriaRows(input = {}) {
  if (Array.isArray(input.criteriaRows)) return input.criteriaRows
  if (Array.isArray(input.criteria)) return input.criteria
  return []
}

function evaluateInspectionCompleteness(input = {}) {
  const { inspection = {}, results = [] } = input
  const criteriaRows = normalizeCriteriaRows(input)
  const reasons = []
  const relevantCriteria = relevantCriteriaRows(inspection, criteriaRows)
  const missingCriteriaIds = getMissingCriteriaIds(inspection, results, criteriaRows)
  const derivedStatus = deriveInspectionStatus(results, criteriaRows, inspection.status)
  const storedStatus = normalizeUpper(inspection.status)

  if (!inspection.assetid) reasons.push("Inspection is not linked to an asset.")
  if (!inspection.equiptypeid) reasons.push("Asset equipment type is missing.")
  if (!inspection.clientid || !inspection.sitename || !inspection.sectionname) {
    reasons.push("Asset customer, site or section hierarchy is incomplete.")
  }
  if (!inspection.testdate) reasons.push("Inspection date is missing.")
  if (!normalizeText(inspection.inspector) && !normalizeText(inspection.inspector_name)) {
    reasons.push("Inspector identity is missing.")
  }
  if (!normalizeText(inspection.inspector_lmi_number)) {
    reasons.push("Inspector LMI snapshot is missing.")
  }
  if (!normalizeText(inspection.inspector_signature_image)) {
    reasons.push("Inspector signature snapshot is missing.")
  }
  if (!relevantCriteria.length) {
    reasons.push("No approved criteria are configured for this equipment type and inspection type.")
  }
  if (!results.length) {
    reasons.push("Inspection has no result rows.")
  }
  // inspectionfrequency was introduced with criteria-set versioning. Rows
  // saved before that rollout have no criteria snapshot, so today's active
  // criteria must not be applied to them retroactively. Keep the missing IDs
  // for audit visibility. New visual inspections carry a frequency and remain
  // subject to the strict completeness check.
  const isLegacyCriteriaSet = Boolean(inspection.testid) &&
    !normalizeText(inspection.inspectionfrequency)
  if (missingCriteriaIds.length && !isLegacyCriteriaSet) {
    reasons.push("One or more required criteria results are missing.")
  }
  if (!derivedStatus) {
    reasons.push("SAFE/UNSAFE status cannot be derived from the inspection results.")
  }
  if (storedStatus === "SAFE" && derivedStatus === "NOT SAFE") {
    reasons.push("Stored SAFE status conflicts with failed or critical criteria.")
  }

  return {
    complete: reasons.length === 0,
    reasons,
    derivedStatus,
    missingCriteriaIds
  }
}

function evaluateCertificateEligibility(input = {}) {
  const completeness = evaluateInspectionCompleteness(input)

  return {
    eligible: completeness.complete,
    reasons: completeness.reasons,
    derivedStatus: completeness.derivedStatus,
    missingCriteriaIds: completeness.missingCriteriaIds
  }
}

module.exports = {
  deriveInspectionStatus,
  evaluateCertificateEligibility,
  evaluateInspectionCompleteness,
  getMissingCriteriaIds,
  isFailedInspectionResult,
  isSafeForContinuedOperationName,
  relevantCriteriaRows
}
