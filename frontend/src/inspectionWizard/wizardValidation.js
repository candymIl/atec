export function normalizeInspectionTagValue(value) {
  const trimmed = String(value || "").trim()
  return trimmed || null
}

export function shouldValidateInspectionTagUniqueness(value) {
  return normalizeInspectionTagValue(value) !== null
}

export function isNumericInputValid(value) {
  const trimmed = String(value || "").trim()
  return !trimmed || Number.isFinite(Number(trimmed))
}

export function failedResultNeedsComment(result) {
  return ["FAIL", "NO"].includes(String(result || "").toUpperCase())
}

export function validateRequiredDeclaration(checked) {
  return checked === true
}
