// Only append a unit to bare numeric values when the criterion states one.
function formatCertificateMeasurement(value, row = {}) {
  const text = String(value ?? "").trim()
  if (!text || !/^[+-]?\d[\d\s,.]*$/.test(text)) return text

  const criteria = `${row.criterianame || ""} ${row.criteriadescription || ""}`
  const units = [
    [/\b(?:kg|kilograms?|kilogrammes?)\b/i, "kg"],
    [/\b(?:mm|millimetres?|millimeters?)\b/i, "mm"]
  ].filter(([pattern]) => pattern.test(criteria))

  // Ambiguous or unspecified units must not be guessed.
  return units.length === 1 ? `${text} ${units[0][1]}` : text
}

module.exports = { formatCertificateMeasurement }
