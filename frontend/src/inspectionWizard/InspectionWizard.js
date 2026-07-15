import { groupCriteriaRows } from "./wizardCriteria.js"
import { getWizardConfig, resolveInspectionWizard } from "./wizardRegistry.js"
import { createWizardState } from "./wizardState.js"

export function createInspectionWizardContext({ asset, criteria = [], inspectiontype = "VISUAL", wizardId = null }) {
  const config = wizardId
    ? getWizardConfig(wizardId)
    : resolveInspectionWizard(asset, criteria, inspectiontype)

  if (!config) {
    return {
      config: null,
      state: createWizardState(),
      groupedCriteria: []
    }
  }

  return {
    config,
    state: createWizardState(),
    groupedCriteria: groupCriteriaRows(criteria, config, inspectiontype)
  }
}
