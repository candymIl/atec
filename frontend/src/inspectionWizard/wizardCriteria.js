export function normalizeCriteriaName(criteriaName = "") {
  return String(criteriaName)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function inspectionCriteriaText(row) {
  return String(row?.criteriadescription || row?.criterianame || "")
}

export function criteriaInspectionType(row) {
  return String(row?.inspectioncategory || row?.inspection_category || "").toUpperCase()
}

export function isCriteriaActive(row) {
  return row?.active !== false && row?.active !== "false"
}

export function hasInspectionCriteria(criteria = [], asset = {}, inspectiontype = "") {
  return criteria.some(row =>
    String(row.equiptypeid) === String(asset?.equiptypeid) &&
    criteriaInspectionType(row) === String(inspectiontype || "").toUpperCase() &&
    isCriteriaActive(row)
  )
}

export function groupCriteriaRows(rows = [], config, inspectiontype = "VISUAL") {
  const sections = config.sections?.[inspectiontype] || config.sections?.default || []
  const groupedRows = new Map()

  sections.forEach(section => groupedRows.set(section, []))

  rows.forEach(row => {
    const section = config.getCriteriaSection
      ? config.getCriteriaSection(row, inspectiontype)
      : sections[0] || "Inspection"

    if (!groupedRows.has(section)) groupedRows.set(section, [])
    groupedRows.get(section).push(row)
  })

  const configuredGroups = sections
    .map(section => [section, groupedRows.get(section) || []])
    .filter(([, sectionRows]) => sectionRows.length)

  const additionalGroups = Array.from(groupedRows.entries())
    .filter(([section, sectionRows]) => !sections.includes(section) && sectionRows.length)

  return [...configuredGroups, ...additionalGroups]
}
