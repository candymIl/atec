const assert = require("assert")
const fs = require("fs")
const path = require("path")

const {
  reportHash,
  suggestedClassification,
  validateReadyForSignature
} = require("../../backend/routes/mpi")
const {
  buildCustomerReportPdf,
  buildPracticalExamPdf,
  reportOutputNumber
} = require("../../backend/services/mpiReportRenderer")

const projectRoot = path.resolve(__dirname, "..", "..")
const migration = fs.readFileSync(
  path.join(projectRoot, "database", "2026-07-29-magnetic-particle-inspection-module.sql"),
  "utf8"
)
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "deployment", "production-migrations.json"), "utf8")
)
const routeSource = fs.readFileSync(
  path.join(projectRoot, "backend", "routes", "mpi.js"),
  "utf8"
)
const pageSource = fs.readFileSync(
  path.join(projectRoot, "frontend", "src", "pages", "MpiReports.js"),
  "utf8"
)
const rendererSource = fs.readFileSync(
  path.join(projectRoot, "backend", "services", "mpiReportRenderer.js"),
  "utf8"
)

assert(
  manifest.migrations.includes("2026-07-29-magnetic-particle-inspection-module.sql"),
  "MPI migration must be registered"
)
assert(migration.includes("CREATE OR REPLACE FUNCTION atec.next_mpi_report_number"))
assert(migration.includes("'MPI-' || selected_year::text"))
assert(migration.includes("subject_type IN ('ASSET', 'EXTERNAL')"))
assert(migration.includes("qualification_level IN (1, 2, 3)"))
assert(migration.includes("level2_certification_required boolean NOT NULL DEFAULT false"))
assert(migration.includes("CREATE TABLE IF NOT EXISTS atec.tblndtindication"))
assert(migration.includes("diagram_x BETWEEN 0 AND 1"))
assert(migration.includes("CREATE TABLE IF NOT EXISTS atec.tblndtsignatureevent"))
assert(routeSource.includes("performing_qualification_id=$1::integer"))
assert(routeSource.includes("level2_certification_required=$3::boolean"))
assert(routeSource.includes("ON CONFLICT (userid, ndt_method, certificate_number)"))
assert(routeSource.includes("qualification_scheme=EXCLUDED.qualification_scheme"))
assert(!routeSource.includes("const [detail, equipment, consumables, checks, indications, attachments, signatures, deliveries] = await Promise.all"))
assert(pageSource.includes("function dateOnlyValue(value)"))
assert(pageSource.includes("dateOnlyValue(row.test_date)"))
assert(rendererSource.includes("doc.heightOfString(header"))
assert(rendererSource.includes("[92, 110, 123, 148, 54]"))
assert(!rendererSource.includes("{ width: contentWidth, height: 58 }"))

assert.equal(suggestedClassification({ length_mm: 4, width_mm: 1 }), "LINEAR")
assert.equal(suggestedClassification({ length_mm: 3, width_mm: 1 }), "ROUNDED")
assert.equal(suggestedClassification({ length_mm: "", width_mm: 1 }), null)

const record = {
  report: {
    ndtreportid: 1,
    report_number: "MPI-2026-000001",
    report_revision: 0,
    status: "CERTIFIED",
    client_name_snapshot: "Example Customer",
    address_snapshot: "Johannesburg",
    site_name_snapshot: "Main Works",
    section_name_snapshot: "Fabrication",
    item_description: "Test weld",
    item_size: "300 mm",
    serial_number: "WELD-001",
    material_specification: "Carbon steel",
    customer_reference: "PO-123",
    drawing_weld_reference: "DWG-1 / W1",
    test_date: "2026-07-29",
    procedure_used: "Approved MPI procedure",
    acceptance_standard: "Customer-approved acceptance standard",
    area_tested: "Weld and 25 mm either side",
    surface_condition: "Clean and dry",
    examination_scope: "Full accessible weld length",
    primary_outcome: "ACCEPTABLE",
    indication_summary: "NO_RELEVANT_INDICATIONS",
    limitations: "",
    notes: "No relevant indications recorded.",
    performing_user_id: 5,
    performing_snapshot: {
      user_id: 5,
      full_name: "Level Two Technician",
      ndt_method: "MT",
      qualification_level: 2,
      qualification_scheme: "Written practice",
      certificate_number: "MT-L2-001"
    },
    level2_certification_required: false,
    certifying_snapshot: {
      user_id: 5,
      full_name: "Level Two Technician",
      ndt_method: "MT",
      qualification_level: 2,
      qualification_scheme: "Written practice",
      certificate_number: "MT-L2-001"
    },
    technician_signed_at: "2026-07-29T08:00:00Z",
    certified_at: "2026-07-29T08:00:00Z"
  },
  mpi_detail: {
    current_type: "AC",
    particle_medium: "WET_INK",
    viewing_method: "VISIBLE_CONTRAST",
    magnetising_method: "CONTINUOUS",
    precleaning_method: "Wire brush and solvent wipe",
    white_background_application: "AEROSOL",
    post_cleaning_required: true,
    post_cleaning_method: "Solvent flush and wipe",
    surface_temperature_c: 24,
    visible_light_lux: 1100,
    uva_intensity_uw_cm2: null,
    demagnetisation_gauss: 2,
    flux_indicator_type: "A",
    flux_indicator_result: "Three lines visible"
  },
  equipment: [{
    equipment_type: "AC yoke",
    manufacturer_snapshot: "Example",
    serial_number_snapshot: "YOKE-1",
    calibration_due_snapshot: "2027-01-01",
    certificate_number_snapshot: "CAL-1",
    reading_value: 4.5,
    reading_unit: "kg",
    verification_result: "Lift test passed",
    compliant_at_test: true
  }],
  consumables: [{
    consumable_type: "MAGNETIC_INK",
    manufacturer: "Example",
    product_code: "INK-1",
    batch_number: "B1",
    expires_on: "2027-01-01",
    compliant_at_test: true
  }],
  checks: [{
    check_code: "LIFT_TEST",
    check_label_snapshot: "Lift test",
    limit_snapshot: "4.5 kg for AC",
    result: "YES",
    result_note: ""
  }],
  indications: [],
  attachments: [],
  signatures: []
}

validateReadyForSignature(record)
assert.equal(reportOutputNumber(record.report, "PRACTICAL_EXAM"), "MPI-2026-000001-PE")
assert.equal(reportOutputNumber(record.report, "CUSTOMER_REPORT"), "MPI-2026-000001-CR")
assert.equal(reportHash(record), reportHash(JSON.parse(JSON.stringify(record))))

const pdfOptions = process.env.MPI_PDF_OUTPUT_DIR
  ? { brandRoot: path.join(projectRoot, "frontend", "public") }
  : {}

;(async () => {
  const practical = await buildPracticalExamPdf(record, pdfOptions)
  const customer = await buildCustomerReportPdf(record, pdfOptions)
  assert(practical.subarray(0, 4).toString() === "%PDF")
  assert(customer.subarray(0, 4).toString() === "%PDF")
  assert(practical.length > 3000)
  assert(customer.length > 2500)
  if (process.env.MPI_PDF_OUTPUT_DIR) {
    fs.mkdirSync(process.env.MPI_PDF_OUTPUT_DIR, { recursive: true })
    fs.writeFileSync(path.join(process.env.MPI_PDF_OUTPUT_DIR, "mpi-practical-exam-sample.pdf"), practical)
    fs.writeFileSync(path.join(process.env.MPI_PDF_OUTPUT_DIR, "mpi-customer-report-sample.pdf"), customer)
  }
  console.log("MPI module regression checks passed.")
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
