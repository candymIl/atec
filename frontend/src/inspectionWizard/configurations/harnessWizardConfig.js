import { inspectionCriteriaText, normalizeCriteriaName } from "../wizardCriteria.js"

export const harnessWizardConfig = {
  id: "HARNESS_FALL_ARREST",
  displayName: "Harness / Fall-Arrest",
  supportedEquipmentTypes: ["601", "339"],
  supportedEquipmentGroups: ["600"],
  supportedInspectionTypes: ["VISUAL"],
  requireCriteriaForExplicitType: true,
  requireFamilyMatchForExplicitType: false,
  genericFallback: true,
  photoPrompts: [
    "General equipment view",
    "Identification label",
    "Serial or batch marking",
    "Front webbing",
    "Rear webbing",
    "Stitching",
    "D-rings",
    "Buckles and adjusters",
    "Connectors",
    "Lanyard",
    "Shock absorber",
    "Defect",
    "Quarantine or rejection marking"
  ],
  declarations: ["inspectorDeclaration", "submitConfirmation"],
  sections: {
    VISUAL: [
      "Identification and Traceability",
      "Webbing and Textile Components",
      "Stitching and Seams",
      "Buckles, Adjusters and Connectors",
      "D-rings and Attachment Points",
      "Lanyards, Shock Absorbers and Fall-Arrest Components",
      "Labels, Markings and Instructions",
      "Contamination, Heat and Chemical Exposure",
      "Previous Fall / Loading History",
      "Defects and Rejection Decision",
      "Final Safe For Service"
    ]
  },
  setupQuestions: [
    {
      id: "harnessAvailableForFullExamination",
      label: "Item available for full examination"
    },
    {
      id: "harnessCleanEnoughForInspection",
      label: "Clean enough for a reliable inspection"
    },
    {
      id: "harnessInspectionHistoryAvailable",
      label: "Inspection history available"
    },
    {
      id: "harnessInspectionIncompleteReason",
      label: "Reason if inspection could not be completed",
      type: "text"
    },
    {
      id: "harnessArrestedFall",
      label: "Known to have arrested a fall"
    },
    {
      id: "harnessShockLoaded",
      label: "Known to have been shock-loaded"
    },
    {
      id: "harnessHeatChemicalExposure",
      label: "Exposed to fire, extreme heat or chemicals"
    },
    {
      id: "harnessUnknownHistory",
      label: "History is unknown"
    }
  ],
  getCriteriaSection(row) {
    const text = normalizeCriteriaName(inspectionCriteriaText(row))

    if (text.includes("safe for service") || text.includes("safe for continued") || text.includes("confirm whether the equipment is safe")) return "Final Safe For Service"
    if (text.includes("serial") || text.includes("batch") || text.includes("identification") || text.includes("label") || text.includes("marking") || text.includes("traceability") || text.includes("manufacturer") || text.includes("instruction")) return "Identification and Traceability"
    if (text.includes("webbing") || text.includes("textile") || text.includes("cut") || text.includes("tear") || text.includes("abrasion") || text.includes("fray") || text.includes("fibre") || text.includes("knot")) return "Webbing and Textile Components"
    if (text.includes("stitch") || text.includes("seam") || text.includes("thread")) return "Stitching and Seams"
    if (text.includes("buckle") || text.includes("adjuster") || text.includes("connector") || text.includes("snap hook") || text.includes("karabiner") || text.includes("carabiner") || text.includes("gate") || text.includes("lock")) return "Buckles, Adjusters and Connectors"
    if (text.includes("d-ring") || text.includes("d ring") || text.includes("attachment point") || text.includes("eyelet") || text.includes("rivet")) return "D-rings and Attachment Points"
    if (text.includes("lanyard") || text.includes("shock absorber") || text.includes("energy absorber") || text.includes("lifeline") || text.includes("fall arrest") || text.includes("fall-arrest")) return "Lanyards, Shock Absorbers and Fall-Arrest Components"
    if (text.includes("contamination") || text.includes("chemical") || text.includes("heat") || text.includes("burn") || text.includes("uv") || text.includes("mould") || text.includes("glazing")) return "Contamination, Heat and Chemical Exposure"
    if (text.includes("fall") || text.includes("shock-load") || text.includes("shock load") || text.includes("history") || text.includes("quarantine")) return "Previous Fall / Loading History"
    if (text.includes("defect") || text.includes("reject") || text.includes("repair") || text.includes("alteration") || text.includes("modification")) return "Defects and Rejection Decision"

    return "Identification and Traceability"
  }
}
