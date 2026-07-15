import { inspectionCriteriaText, normalizeCriteriaName } from "../wizardCriteria.js"

export const craneWizardConfig = {
  id: "CRANE",
  displayName: "Crane",
  supportedEquipmentTypes: ["401", "402", "404", "406"],
  supportedEquipmentGroups: ["400"],
  supportedInspectionTypes: ["VISUAL", "LOADTEST"],
  requireCriteriaForGroupMatch: true,
  genericFallback: true,
  photoPrompts: [
    "Crane",
    "Identification plate",
    "Hook",
    "Hoist",
    "Rope or chain",
    "Control station",
    "Safety device",
    "Defect",
    "Load-test setup"
  ],
  declarations: ["inspectorDeclaration", "submitConfirmation"],
  sections: {
    VISUAL: [
      "Inspection Setup",
      "Crane Structure",
      "Hoist and Lifting Mechanism",
      "Hooks and Load-Bearing Components",
      "Ropes, Chains and Drums",
      "Electrical and Control Systems",
      "Safety Devices",
      "Travel System and End Stops",
      "Operational Checks",
      "Defects and Final Safety"
    ],
    LOADTEST: [
      "Pre/Post Test Inspection",
      "Test Equipment and Calibration",
      "Rated Capacity and Test Load",
      "Static Test",
      "Dynamic Test",
      "Brake and Holding Test",
      "Deflection Measurements",
      "Defects and Final Safety"
    ]
  },
  getCriteriaSection(row, inspectiontype = "VISUAL") {
    const text = normalizeCriteriaName(inspectionCriteriaText(row))

    if (
      text.includes("safe for continued operation") ||
      text.includes("safe for service") ||
      text.includes("defect") ||
      text.includes("recommendation") ||
      text.includes("comment")
    ) {
      return "Defects and Final Safety"
    }

    if (inspectiontype === "LOADTEST") {
      if (text.includes("load mass") || text.includes("proof load") || text.includes("test load") || text.includes("loadcell")) return "Rated Capacity and Test Load"
      if (text.includes("deflection")) return "Deflection Measurements"
      if (text.includes("brake") || text.includes("hold")) return "Brake and Holding Test"
      if (text.includes("static")) return "Static Test"
      if (text.includes("dynamic") || text.includes("travel") || text.includes("function")) return "Dynamic Test"
      if (text.includes("visual") || text.includes("structure") || text.includes("hook") || text.includes("rope") || text.includes("chain")) return "Pre/Post Test Inspection"
      return "Test Equipment and Calibration"
    }

    if (text.includes("structure") || text.includes("girder") || text.includes("carriage") || text.includes("rail") || text.includes("corrosion") || text.includes("crack") || text.includes("deformation")) return "Crane Structure"
    if (text.includes("hoist") || text.includes("motor") || text.includes("gearbox") || text.includes("brake")) return "Hoist and Lifting Mechanism"
    if (text.includes("hook") || text.includes("latch") || text.includes("load-bearing")) return "Hooks and Load-Bearing Components"
    if (text.includes("rope") || text.includes("chain") || text.includes("drum") || text.includes("sheave")) return "Ropes, Chains and Drums"
    if (text.includes("electrical") || text.includes("isolator") || text.includes("cable") || text.includes("earth") || text.includes("pendant") || text.includes("remote")) return "Electrical and Control Systems"
    if (text.includes("limit") || text.includes("emergency") || text.includes("warning") || text.includes("overload") || text.includes("safety")) return "Safety Devices"
    if (text.includes("travel") || text.includes("wheel") || text.includes("bearing") || text.includes("end stop") || text.includes("buffer")) return "Travel System and End Stops"
    if (text.includes("operate") || text.includes("function") || text.includes("raising") || text.includes("lowering")) return "Operational Checks"

    return "Inspection Setup"
  }
}
