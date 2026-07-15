import { inspectionCriteriaText, normalizeCriteriaName } from "../wizardCriteria.js"

export const slingWizardConfig = {
  id: "SLING",
  displayName: "Sling",
  supportedEquipmentTypes: ["201"],
  supportedEquipmentGroups: ["200"],
  supportedInspectionTypes: ["VISUAL", "LOADTEST"],
  requireCriteriaForExplicitType: true,
  requireFamilyMatchForExplicitType: false,
  genericFallback: true,
  photoPrompts: [
    "General sling view",
    "Identification tag",
    "Entire sling body",
    "End eye",
    "Master link",
    "Hook",
    "Safety latch",
    "Chain links",
    "Wire rope",
    "Ferrule or splice",
    "Textile damage",
    "Defect",
    "Load-test setup"
  ],
  declarations: ["inspectorDeclaration", "submitConfirmation"],
  setupQuestions: [
    {
      id: "slingCleanAvailable",
      label: "Sling clean and available for complete examination"
    },
    {
      id: "slingIdentificationLegible",
      label: "Identification / WLL marking legible"
    },
    {
      id: "slingHistoryAvailable",
      label: "Sling history available"
    },
    {
      id: "slingKnownOverload",
      label: "Known overload or shock loading"
    },
    {
      id: "slingInspectionIncompleteReason",
      label: "Reason if inspection could not be completed",
      type: "text"
    }
  ],
  sections: {
    VISUAL: [
      "Identification and Traceability",
      "Sling Body / Material Inspection",
      "Wire Rope Condition",
      "Chain Links and Components",
      "Webbing / Round Sling Body",
      "End Fittings and Connectors",
      "Wear, Deformation and Damage",
      "Heat, Chemical and Environmental Exposure",
      "Load History and Misuse",
      "Measurements",
      "Defects and Rejection Decision",
      "Final Safe For Service"
    ],
    LOADTEST: [
      "Load-Test Setup",
      "Rated Capacity and Test Load",
      "Post-Test Examination",
      "Defects and Rejection Decision",
      "Final Safe For Service"
    ]
  },
  getCriteriaSection(row, inspectiontype = "VISUAL") {
    const text = normalizeCriteriaName(inspectionCriteriaText(row))

    if (text.includes("safe for service") || text.includes("safe for continued") || text.includes("confirm whether the equipment is safe")) return "Final Safe For Service"

    if (inspectiontype === "LOADTEST") {
      if (text.includes("load") || text.includes("proof") || text.includes("test")) return "Rated Capacity and Test Load"
      if (text.includes("post") || text.includes("after")) return "Post-Test Examination"
      if (text.includes("defect") || text.includes("reject")) return "Defects and Rejection Decision"
      return "Load-Test Setup"
    }

    if (String(row?.fieldtype || "").toUpperCase() === "NUMBER" || String(row?.resulttype || "").toUpperCase() === "MEASURED") return "Measurements"
    if (text.includes("identification") || text.includes("serial") || text.includes("trace") || text.includes("tag") || text.includes("label") || text.includes("wll") || text.includes("swl") || text.includes("mark")) return "Identification and Traceability"
    if (text.includes("wire") || text.includes("rope") || text.includes("strand") || text.includes("birdcage") || text.includes("birdcaging") || text.includes("kink") || text.includes("crush")) return "Wire Rope Condition"
    if (text.includes("chain") || text.includes("link") || text.includes("grade") || text.includes("elongation") || text.includes("shortening")) return "Chain Links and Components"
    if (text.includes("webbing") || text.includes("round sling") || text.includes("textile") || text.includes("cover") || text.includes("core fibre") || text.includes("stitch") || text.includes("cut") || text.includes("tear")) return "Webbing / Round Sling Body"
    if (text.includes("hook") || text.includes("latch") || text.includes("master link") || text.includes("coupling") || text.includes("fitting") || text.includes("eye") || text.includes("ferrule") || text.includes("splice")) return "End Fittings and Connectors"
    if (text.includes("wear") || text.includes("deformation") || text.includes("crack") || text.includes("broken") || text.includes("stretch") || text.includes("distortion")) return "Wear, Deformation and Damage"
    if (text.includes("heat") || text.includes("chemical") || text.includes("corrosion") || text.includes("environment") || text.includes("burn")) return "Heat, Chemical and Environmental Exposure"
    if (text.includes("overload") || text.includes("shock") || text.includes("misuse") || text.includes("history")) return "Load History and Misuse"
    if (text.includes("defect") || text.includes("reject") || text.includes("repair") || text.includes("alteration")) return "Defects and Rejection Decision"

    return "Sling Body / Material Inspection"
  }
}
