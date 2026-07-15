import { inspectionCriteriaText, normalizeCriteriaName } from "../wizardCriteria.js"

export const chainBlockWizardConfig = {
  id: "CHAIN_BLOCK_LEVER_HOIST",
  displayName: "Chain Block / Lever Hoist",
  supportedEquipmentTypes: [],
  supportedEquipmentGroups: [],
  supportedInspectionTypes: ["VISUAL", "LOADTEST"],
  equipmentTextMatches: [
    "manual chain hoist",
    "manual lever hoist",
    "chain block",
    "lever hoist"
  ],
  genericFallback: true,
  sections: {
    default: [
      "Identification",
      "Hooks",
      "Load Chain",
      "Body / Casing",
      "Brake / Load Holding",
      "Markings",
      "Functional Test",
      "Final Result"
    ]
  },
  getCriteriaSection(row) {
    const text = normalizeCriteriaName(inspectionCriteriaText(row))

    if (text.includes("safe for continued operation") || text.includes("safe for service") || text.includes("defect") || text.includes("recommendation") || text.includes("comment")) return "Final Result"
    if (text.includes("hook") || text.includes("latch") || text.includes("throat")) return "Hooks"
    if (text.includes("chain") || text.includes("link")) return "Load Chain"
    if (text.includes("brake") || text.includes("load holding") || text.includes("proof load") || text.includes("load limiter") || text.includes("loadcell")) return "Brake / Load Holding"
    if (text.includes("marking") || text.includes("swl") || text.includes("wll") || text.includes("identification") || text.includes("serial")) return "Markings"
    if (text.includes("body") || text.includes("casing") || text.includes("cover") || text.includes("frame") || text.includes("structure")) return "Body / Casing"
    if (text.includes("function") || text.includes("operate") || text.includes("movement") || text.includes("raising") || text.includes("lowering") || text.includes("test")) return "Functional Test"

    return "Identification"
  }
}
