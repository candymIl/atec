import { chainBlockWizardConfig } from "./configurations/chainBlockWizardConfig.js"
import { craneWizardConfig } from "./configurations/craneWizardConfig.js"
import { harnessWizardConfig } from "./configurations/harnessWizardConfig.js"
import { slingWizardConfig } from "./configurations/slingWizardConfig.js"
import { hasInspectionCriteria, normalizeCriteriaName } from "./wizardCriteria.js"

export const wizardConfigurations = [
  craneWizardConfig,
  harnessWizardConfig,
  slingWizardConfig,
  chainBlockWizardConfig
]

export function getWizardConfig(wizardId) {
  return wizardConfigurations.find(config => config.id === wizardId) || null
}

function textMatchesConfig(asset = {}, config) {
  const equipmentText = normalizeCriteriaName([
    asset?.equipmenttype,
    asset?.equipmenttypedescription,
    asset?.description
  ].filter(Boolean).join(" "))

  return (config.equipmentTextMatches || []).some(text => equipmentText.includes(text))
}

export function resolveInspectionWizard(asset = {}, criteria = [], inspectiontype = "VISUAL", options = {}) {
  const normalizedInspectionType = String(inspectiontype || "").toUpperCase()

  if (!["VISUAL", "LOADTEST"].includes(normalizedInspectionType)) return null

  for (const config of wizardConfigurations) {
    if (options.disabledWizardIds?.includes(config.id)) continue
    if (!config.supportedInspectionTypes.includes(normalizedInspectionType)) continue

    const explicitTypeMatch = (config.supportedEquipmentTypes || []).includes(String(asset?.equiptypeid || ""))
    if (explicitTypeMatch && options.enabledWizardIds?.includes(config.id) !== false) {
      const criteriaMatch = hasInspectionCriteria(criteria, asset, normalizedInspectionType)
      const groupMatch = (config.supportedEquipmentGroups || []).includes(String(asset?.equipgroupid || ""))
      const textMatch = textMatchesConfig(asset, config)

      if (config.requireCriteriaForExplicitType && !criteriaMatch) continue
      if (config.requireFamilyMatchForExplicitType && !groupMatch && !textMatch) continue

      return config
    }
  }

  for (const config of wizardConfigurations) {
    if (options.disabledWizardIds?.includes(config.id)) continue
    if (!config.supportedInspectionTypes.includes(normalizedInspectionType)) continue

    const criteriaMatch = hasInspectionCriteria(criteria, asset, normalizedInspectionType)
    const groupMatch = (config.supportedEquipmentGroups || []).includes(String(asset?.equipgroupid || ""))
    const textMatch = textMatchesConfig(asset, config)

    if (criteriaMatch && (groupMatch || textMatch || config.matchAnyCriteria === true)) return config
    if (textMatch) return config
  }

  return null
}

export function getInspectionWizardKey(asset = {}, criteria = [], inspectiontype = "VISUAL", options = {}) {
  return resolveInspectionWizard(asset, criteria, inspectiontype, options)?.id || "GENERIC"
}

export function assetSupportsCraneWizard(asset = {}, criteria = [], inspectiontype = "VISUAL") {
  return resolveInspectionWizard(asset, criteria, inspectiontype)?.id === craneWizardConfig.id
}

export function assetSupportsHarnessWizard(asset = {}, criteria = [], inspectiontype = "VISUAL") {
  return resolveInspectionWizard(asset, criteria, inspectiontype)?.id === harnessWizardConfig.id
}

export function assetSupportsInspectionWizard(asset = {}, criteria = [], inspectiontype = "VISUAL") {
  return resolveInspectionWizard(asset, criteria, inspectiontype) !== null
}

export function wizardActionLabel(asset = {}, criteria = [], inspectiontype = "VISUAL") {
  const config = resolveInspectionWizard(asset, criteria, inspectiontype)
  if (!config) return inspectiontype === "LOADTEST" ? "Load Test" : "Inspect"
  if (config.id === craneWizardConfig.id) return inspectiontype === "LOADTEST" ? "Wizard Loadtest" : "Wizard Inspect"
  if (config.id === harnessWizardConfig.id) return "Wizard Inspect"
  if (config.id === slingWizardConfig.id) return inspectiontype === "LOADTEST" ? "Wizard Loadtest" : "Wizard Inspect"
  return "Wizard Inspect"
}
