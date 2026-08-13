const crypto = require("crypto")
const express = require("express")
const {
  buildCustomerReportPdf,
  buildPracticalExamPdf,
  reportOutputNumber
} = require("../services/mpiReportRenderer")

const REPORT_STATUSES = new Set([
  "DRAFT",
  "READY_FOR_SIGNING",
  "AWAITING_LEVEL_2",
  "RETURNED_FOR_CORRECTION",
  "CERTIFIED",
  "ISSUED",
  "SUPERSEDED",
  "VOID"
])
const PRIMARY_OUTCOMES = new Set(["ACCEPTABLE", "REJECTED", "INCONCLUSIVE"])
const INDICATION_SUMMARIES = new Set([
  "NO_RELEVANT_INDICATIONS",
  "RELEVANT_INDICATIONS_ACCEPTABLE",
  "RELEVANT_INDICATIONS_REJECTABLE",
  "EXAMINATION_LIMITED"
])
const EDITABLE_STATUSES = new Set(["DRAFT", "READY_FOR_SIGNING", "RETURNED_FOR_CORRECTION"])
const INTERNAL_ROLES = new Set(["ADMIN", "MANAGER", "INSPECTOR", "VIEWER"])

function badRequest(message, code = "MPI_VALIDATION_ERROR") {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  return error
}

function forbidden(message = "Access denied") {
  const error = new Error(message)
  error.statusCode = 403
  return error
}

function notFound(message = "MPI report not found") {
  const error = new Error(message)
  error.statusCode = 404
  return error
}

function cleanText(value, max = 10000) {
  return String(value ?? "").trim().slice(0, max)
}

function displayCodeForEmail(value) {
  return cleanText(value, 200).replaceAll("_", " ") || "-"
}

function nullableDate(value) {
  const text = cleanText(value, 20)
  return text || null
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function booleanValue(value, fallback = false) {
  if (value === true || value === "true") return true
  if (value === false || value === "false") return false
  return fallback
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject)
  if (!value || typeof value !== "object") return value
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableObject(value[key])
    return result
  }, {})
}

function reportHash(report) {
  const hashable = {
    report: report.report,
    mpi_detail: report.mpi_detail,
    equipment: report.equipment,
    consumables: report.consumables,
    checks: report.checks,
    indications: report.indications,
    attachments: report.attachments
  }
  return crypto.createHash("sha256").update(JSON.stringify(stableObject(hashable))).digest("hex")
}

function reportScopeSql(user, alias = "report") {
  if (user.role === "CUSTOMER") {
    if (!user.clientid) return { sql: " AND 1 = 0", values: [] }
    return { sql: ` AND ${alias}.clientid = $SCOPE`, values: [user.clientid] }
  }
  return { sql: "", values: [] }
}

function applyScope(sql, baseValues, scope) {
  if (!scope.values.length) return { sql: sql.replace("$SCOPE", "NULL"), values: baseValues }
  const values = [...baseValues, ...scope.values]
  return {
    sql: sql.replace("$SCOPE", `$${values.length}`),
    values
  }
}

async function loadQualification(client, qualificationId, userId, minimumLevel = 1) {
  const result = await client.query(
    `
    SELECT
      qualification.qualificationid,
      qualification.userid,
      qualification.qualification_scheme,
      qualification.ndt_method,
      qualification.qualification_level,
      qualification.certificate_number,
      qualification.qualified_on,
      qualification.expires_on,
      qualification.status,
      COALESCE(NULLIF(users.fullname, ''), users.username) AS full_name,
      users.usersignature AS signature_image
    FROM atec.tbluserndtqualification qualification
    INNER JOIN atec.tblusers users
      ON users.userid = qualification.userid
    WHERE qualification.qualificationid = $1
      AND qualification.userid = $2
      AND qualification.ndt_method = 'MT'
      AND qualification.qualification_level >= $3
      AND qualification.status = 'ACTIVE'
      AND users.is_active = true
      AND (qualification.expires_on IS NULL OR qualification.expires_on >= CURRENT_DATE)
    `,
    [qualificationId, userId, minimumLevel]
  )
  return result.rows[0] || null
}

function qualificationSnapshot(row) {
  return {
    user_id: row.userid,
    full_name: row.full_name,
    ndt_method: row.ndt_method,
    qualification_level: Number(row.qualification_level),
    qualification_scheme: row.qualification_scheme,
    certificate_number: row.certificate_number,
    qualified_on: row.qualified_on || null,
    expires_on: row.expires_on || null,
    signature_image: row.signature_image || ""
  }
}

async function loadMpiReport(client, reportId, user) {
  const scope = reportScopeSql(user)
  const scoped = applyScope(
    `
    SELECT
      report.*,
      customer.clientname,
      site.sitename,
      section.sectionname,
      asset.assettagno,
      asset.description AS asset_description,
      asset.serialno AS asset_serial_number
    FROM atec.tblndtreport report
    INNER JOIN atec.tblclients customer ON customer.clientid = report.clientid
    LEFT JOIN atec.tblsites site ON site.siteid = report.siteid
    LEFT JOIN atec.tblsection section ON section.sectionid = report.sectionid
    LEFT JOIN atec.tblasset asset ON asset.assetid = report.assetid
    WHERE report.ndtreportid = $1
      ${scope.sql}
    `,
    [reportId],
    scope
  )
  const result = await client.query(scoped.sql, scoped.values)
  const report = result.rows[0]
  if (!report) return null

  const detail = await client.query("SELECT * FROM atec.tblndtmpdetail WHERE ndtreportid = $1", [reportId])
  const equipment = await client.query("SELECT * FROM atec.tblndtreportequipment WHERE ndtreportid = $1 ORDER BY sort_order, reportequipmentid", [reportId])
  const consumables = await client.query("SELECT * FROM atec.tblndtreportconsumable WHERE ndtreportid = $1 ORDER BY sort_order, reportconsumableid", [reportId])
  const checks = await client.query("SELECT * FROM atec.tblndtreportcheck WHERE ndtreportid = $1 ORDER BY sort_order, reportcheckid", [reportId])
  const indications = await client.query("SELECT * FROM atec.tblndtindication WHERE ndtreportid = $1 ORDER BY sequence_number", [reportId])
  const attachments = await client.query("SELECT * FROM atec.tblndtreportattachment WHERE ndtreportid = $1 ORDER BY attachmentid", [reportId])
  const signatures = await client.query("SELECT * FROM atec.tblndtsignatureevent WHERE ndtreportid = $1 ORDER BY signed_at, signatureeventid", [reportId])
  const deliveries = await client.query("SELECT * FROM atec.tblndtreportdelivery WHERE ndtreportid = $1 ORDER BY created_at DESC, reportdeliveryid DESC", [reportId])

  return {
    report,
    mpi_detail: detail.rows[0] || null,
    equipment: equipment.rows,
    consumables: consumables.rows,
    checks: checks.rows,
    indications: indications.rows,
    attachments: attachments.rows,
    signatures: signatures.rows,
    deliveries: deliveries.rows
  }
}

function canEditReport(user, report) {
  if (["ADMIN", "MANAGER"].includes(user.role)) return true
  if (user.role !== "INSPECTOR") return false
  return String(report.performing_user_id || report.created_by_user_id) === String(user.user_id)
}

function validateReportBody(body) {
  const subjectType = cleanText(body.subject_type, 20).toUpperCase()
  if (!["ASSET", "EXTERNAL"].includes(subjectType)) throw badRequest("Select an ATEC asset or an external item.")
  if (!positiveInteger(body.clientid)) throw badRequest("Customer is required.")
  if (subjectType === "ASSET" && !positiveInteger(body.assetid)) throw badRequest("Select an ATEC asset.")
  if (!cleanText(body.item_description, 1000)) throw badRequest("Item description is required.")
  if (!nullableDate(body.test_date)) throw badRequest("Test date is required.")
  return subjectType
}

async function loadSubjectSnapshot(client, body, subjectType) {
  const values = [positiveInteger(body.clientid), positiveInteger(body.siteid), positiveInteger(body.sectionid)]
  const customerResult = await client.query(
    `
    SELECT
      customer.clientid,
      customer.clientname,
      site.siteid,
      site.sitename,
      section.sectionid,
      section.sectionname
    FROM atec.tblclients customer
    LEFT JOIN atec.tblsites site
      ON site.siteid = $2
      AND site.clientid = customer.clientid
    LEFT JOIN atec.tblsection section
      ON section.sectionid = $3
      AND section.clientid = customer.clientid
    WHERE customer.clientid = $1
      AND COALESCE(customer.archived, false) = false
    `,
    values
  )
  const customer = customerResult.rows[0]
  if (!customer) throw badRequest("Customer, site or section selection is invalid.")
  if (values[1] && !customer.siteid) throw badRequest("The selected site does not belong to the customer.")
  if (values[2] && !customer.sectionid) throw badRequest("The selected section does not belong to the customer.")

  let asset = null
  if (subjectType === "ASSET") {
    const assetResult = await client.query(
      `
      SELECT
        asset.assetid,
        asset.clientid,
        asset.siteid,
        asset.sectionid,
        asset.description,
        asset.serialno,
        asset.assettagno,
        site.sitename,
        section.sectionname
      FROM atec.tblasset asset
      LEFT JOIN atec.tblsites site ON site.siteid = asset.siteid
      LEFT JOIN atec.tblsection section ON section.sectionid = asset.sectionid
      WHERE asset.assetid = $1
        AND asset.clientid = $2
        AND COALESCE(asset.archived, false) = false
      `,
      [positiveInteger(body.assetid), customer.clientid]
    )
    asset = assetResult.rows[0]
    if (!asset) throw badRequest("The selected asset is not active or does not belong to the customer.")
  }

  return { customer, asset }
}

function normalizeHeader(body, subjectType, snapshot) {
  const asset = snapshot.asset
  return {
    subject_type: subjectType,
    clientid: snapshot.customer.clientid,
    siteid: positiveInteger(body.siteid) || asset?.siteid || null,
    sectionid: positiveInteger(body.sectionid) || asset?.sectionid || null,
    assetid: subjectType === "ASSET" ? asset.assetid : null,
    client_name_snapshot: snapshot.customer.clientname,
    address_snapshot: cleanText(body.address_snapshot, 2000),
    site_name_snapshot: snapshot.customer.sitename || asset?.sitename || "",
    section_name_snapshot: snapshot.customer.sectionname || asset?.sectionname || "",
    item_description: cleanText(body.item_description || asset?.description, 2000),
    item_size: cleanText(body.item_size, 500),
    serial_number: cleanText(body.serial_number || asset?.serialno, 500),
    material_specification: cleanText(body.material_specification, 1000),
    customer_reference: cleanText(body.customer_reference, 500),
    drawing_weld_reference: cleanText(body.drawing_weld_reference, 500),
    test_date: nullableDate(body.test_date),
    procedure_used: cleanText(body.procedure_used, 1000),
    acceptance_standard: cleanText(body.acceptance_standard, 1000),
    area_tested: cleanText(body.area_tested, 2000),
    surface_condition: cleanText(body.surface_condition, 2000),
    examination_scope: cleanText(body.examination_scope, 4000),
    primary_outcome: PRIMARY_OUTCOMES.has(cleanText(body.primary_outcome, 50).toUpperCase())
      ? cleanText(body.primary_outcome, 50).toUpperCase()
      : null,
    indication_summary: INDICATION_SUMMARIES.has(cleanText(body.indication_summary, 100).toUpperCase())
      ? cleanText(body.indication_summary, 100).toUpperCase()
      : null,
    limitations: cleanText(body.limitations, 10000),
    notes: cleanText(body.notes, 10000),
    performing_user_id: positiveInteger(body.performing_user_id)
  }
}

async function replaceMpiDetail(client, reportId, detail = {}) {
  const currentType = cleanText(detail.current_type, 10).toUpperCase()
  const medium = cleanText(detail.particle_medium, 30).toUpperCase()
  const viewing = cleanText(detail.viewing_method, 30).toUpperCase()
  if (!currentType && !medium && !viewing) {
    await client.query("DELETE FROM atec.tblndtmpdetail WHERE ndtreportid = $1", [reportId])
    return
  }
  if (!["AC", "DC"].includes(currentType)) throw badRequest("MPI current type must be AC or DC.")
  if (!["WET_INK", "DRY_POWDER"].includes(medium)) throw badRequest("Select the MPI particle medium.")
  if (!["VISIBLE_CONTRAST", "FLUORESCENT"].includes(viewing)) throw badRequest("Select the MPI viewing method.")

  await client.query(
    `
    INSERT INTO atec.tblndtmpdetail (
      ndtreportid, current_type, particle_medium, viewing_method, magnetising_method,
      precleaning_method, white_background_application, post_cleaning_required,
      post_cleaning_method, surface_temperature_c, visible_light_lux,
      uva_intensity_uw_cm2, demagnetisation_gauss, flux_indicator_type,
      flux_indicator_result, technique_notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (ndtreportid)
    DO UPDATE SET
      current_type = EXCLUDED.current_type,
      particle_medium = EXCLUDED.particle_medium,
      viewing_method = EXCLUDED.viewing_method,
      magnetising_method = EXCLUDED.magnetising_method,
      precleaning_method = EXCLUDED.precleaning_method,
      white_background_application = EXCLUDED.white_background_application,
      post_cleaning_required = EXCLUDED.post_cleaning_required,
      post_cleaning_method = EXCLUDED.post_cleaning_method,
      surface_temperature_c = EXCLUDED.surface_temperature_c,
      visible_light_lux = EXCLUDED.visible_light_lux,
      uva_intensity_uw_cm2 = EXCLUDED.uva_intensity_uw_cm2,
      demagnetisation_gauss = EXCLUDED.demagnetisation_gauss,
      flux_indicator_type = EXCLUDED.flux_indicator_type,
      flux_indicator_result = EXCLUDED.flux_indicator_result,
      technique_notes = EXCLUDED.technique_notes,
      updated_at = now()
    `,
    [
      reportId,
      currentType,
      medium,
      viewing,
      cleanText(detail.magnetising_method || "CONTINUOUS", 30).toUpperCase(),
      cleanText(detail.precleaning_method, 2000),
      cleanText(detail.white_background_application, 30).toUpperCase(),
      booleanValue(detail.post_cleaning_required),
      cleanText(detail.post_cleaning_method, 2000),
      nullableNumber(detail.surface_temperature_c),
      nullableNumber(detail.visible_light_lux),
      nullableNumber(detail.uva_intensity_uw_cm2),
      nullableNumber(detail.demagnetisation_gauss),
      cleanText(detail.flux_indicator_type || "NOT_APPLICABLE", 30).toUpperCase(),
      cleanText(detail.flux_indicator_result, 1000),
      cleanText(detail.technique_notes, 4000)
    ]
  )
}

async function replaceEquipment(client, reportId, rows = []) {
  await client.query("DELETE FROM atec.tblndtreportequipment WHERE ndtreportid = $1", [reportId])
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {}
    if (!cleanText(row.equipment_type, 200)) continue
    await client.query(
      `
      INSERT INTO atec.tblndtreportequipment (
        ndtreportid, equipmentid, equipment_type, manufacturer_snapshot,
        model_snapshot, serial_number_snapshot, calibration_type_snapshot,
        calibrated_on_snapshot, calibration_due_snapshot, certificate_number_snapshot,
        reading_value, reading_unit, verification_result, compliant_at_test,
        notes, sort_order
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      `,
      [
        reportId,
        positiveInteger(row.equipmentid),
        cleanText(row.equipment_type, 200),
        cleanText(row.manufacturer_snapshot, 500),
        cleanText(row.model_snapshot, 500),
        cleanText(row.serial_number_snapshot, 500),
        cleanText(row.calibration_type_snapshot, 100),
        nullableDate(row.calibrated_on_snapshot),
        nullableDate(row.calibration_due_snapshot),
        cleanText(row.certificate_number_snapshot, 500),
        nullableNumber(row.reading_value),
        cleanText(row.reading_unit, 50),
        cleanText(row.verification_result, 1000),
        booleanValue(row.compliant_at_test),
        cleanText(row.notes, 2000),
        index
      ]
    )
  }
}

async function replaceConsumables(client, reportId, rows = []) {
  await client.query("DELETE FROM atec.tblndtreportconsumable WHERE ndtreportid = $1", [reportId])
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {}
    const type = cleanText(row.consumable_type, 50).toUpperCase()
    if (!type) continue
    await client.query(
      `
      INSERT INTO atec.tblndtreportconsumable (
        ndtreportid, consumable_type, manufacturer, product_code, batch_number,
        expires_on, compliant_at_test, notes, sort_order
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        reportId,
        type,
        cleanText(row.manufacturer, 500),
        cleanText(row.product_code, 500),
        cleanText(row.batch_number, 500),
        nullableDate(row.expires_on),
        booleanValue(row.compliant_at_test),
        cleanText(row.notes, 2000),
        index
      ]
    )
  }
}

async function replaceChecks(client, reportId, rows = []) {
  await client.query("DELETE FROM atec.tblndtreportcheck WHERE ndtreportid = $1", [reportId])
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {}
    if (!cleanText(row.check_code, 100)) continue
    await client.query(
      `
      INSERT INTO atec.tblndtreportcheck (
        ndtreportid, check_code, check_label_snapshot, limit_snapshot,
        result, result_note, sort_order
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        reportId,
        cleanText(row.check_code, 100).toUpperCase(),
        cleanText(row.check_label_snapshot, 1000),
        cleanText(row.limit_snapshot, 1000),
        cleanText(row.result, 30).toUpperCase(),
        cleanText(row.result_note, 2000),
        index
      ]
    )
  }
}

function suggestedClassification(row) {
  const length = nullableNumber(row.length_mm)
  const width = nullableNumber(row.width_mm)
  if (length === null || width === null || width <= 0) return null
  return length > (width * 3) ? "LINEAR" : "ROUNDED"
}

async function replaceIndications(client, reportId, rows = []) {
  const attachmentCount = await client.query(
    "SELECT count(*)::int AS count FROM atec.tblndtreportattachment WHERE ndtreportid = $1 AND indicationid IS NOT NULL",
    [reportId]
  )
  if (attachmentCount.rows[0]?.count > 0) {
    throw badRequest("Indications with attached evidence cannot be replaced. Remove or reassign the evidence first.")
  }
  await client.query("DELETE FROM atec.tblndtindication WHERE ndtreportid = $1", [reportId])
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {}
    const confirmed = cleanText(row.confirmed_classification, 30).toUpperCase()
    if (!confirmed && !cleanText(row.description, 1000)) continue
    await client.query(
      `
      INSERT INTO atec.tblndtindication (
        ndtreportid, sequence_number, examined_area, datum_description,
        distance_from_datum_mm, datum_direction, distance_from_centreline_mm,
        centreline_side, length_mm, width_mm, suggested_classification,
        confirmed_classification, relevance, code_disposition, description,
        diagram_number, diagram_x, diagram_y
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `,
      [
        reportId,
        index + 1,
        cleanText(row.examined_area, 1000),
        cleanText(row.datum_description, 1000),
        nullableNumber(row.distance_from_datum_mm),
        cleanText(row.datum_direction, 100),
        nullableNumber(row.distance_from_centreline_mm),
        cleanText(row.centreline_side, 100),
        nullableNumber(row.length_mm),
        nullableNumber(row.width_mm),
        suggestedClassification(row),
        confirmed,
        cleanText(row.relevance, 30).toUpperCase(),
        cleanText(row.code_disposition, 30).toUpperCase(),
        cleanText(row.description, 4000),
        positiveInteger(row.diagram_number),
        nullableNumber(row.diagram_x),
        nullableNumber(row.diagram_y)
      ]
    )
  }
}

function validateReadyForSignature(record) {
  const report = record.report
  const detail = record.mpi_detail
  if (!report.procedure_used) throw badRequest("Procedure used is required before signing.")
  if (!report.acceptance_standard) throw badRequest("Acceptance standard is required before signing.")
  if (!report.area_tested) throw badRequest("Area tested is required before signing.")
  if (!report.surface_condition) throw badRequest("Surface condition is required before signing.")
  if (!report.primary_outcome || !report.indication_summary) throw badRequest("Select the examination outcome before signing.")
  if (!detail) throw badRequest("MPI technique details are required before signing.")
  if (!record.equipment.length) throw badRequest("At least one test-equipment record is required before signing.")
  if (record.equipment.some(row => !row.compliant_at_test)) throw badRequest("All required test equipment must be compliant before signing.")
  if (record.consumables.some(row => !row.compliant_at_test)) throw badRequest("Expired or noncompliant consumables prevent signing.")
  if (record.checks.some(row => row.result === "NO") && report.primary_outcome !== "INCONCLUSIVE") {
    throw badRequest("A failed pre-use check requires an inconclusive outcome.")
  }
  if (report.indication_summary === "NO_RELEVANT_INDICATIONS" && record.indications.some(row => row.relevance === "RELEVANT")) {
    throw badRequest("Relevant indications conflict with the selected indication summary.")
  }
  if (report.indication_summary === "RELEVANT_INDICATIONS_REJECTABLE" && !record.indications.some(row => row.code_disposition === "REJECTABLE")) {
    throw badRequest("Record at least one rejectable indication.")
  }
  if (report.indication_summary === "EXAMINATION_LIMITED" && !report.limitations) {
    throw badRequest("Limitations are required for a limited examination.")
  }
}

async function addAudit(client, reportId, userId, eventType, fromStatus, toStatus, eventData = {}) {
  await client.query(
    `
    INSERT INTO atec.tblndtauditevent (
      ndtreportid, actor_user_id, event_type, from_status, to_status, event_data
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    `,
    [reportId, userId, eventType, fromStatus || null, toStatus || null, eventData]
  )
}

function registerMpiRoutes(app, dependencies) {
  const {
    pool,
    asyncRoute,
    pdfLimiter,
    runQueuedPdfJob,
    upload,
    uploadLimiter,
    validateUploadedImages,
    compressUploadedPhotos,
    emailLimiter,
    sendApplicationEmail,
    getMailConfigIssues,
    isValidEmailAddress,
    getMailErrorMessage,
    customerReportCc,
    uploadRoot,
    brandRoot
  } = dependencies
  const router = express.Router()

  router.get("/users", asyncRoute(async (req, res) => {
    if (!["ADMIN", "MANAGER"].includes(req.user.role)) throw forbidden()
    const result = await pool.query(
      `
      SELECT
        userid AS user_id,
        COALESCE(NULLIF(fullname, ''), username) AS full_name,
        role,
        is_active
      FROM atec.tblusers
      WHERE is_active = true
        AND COALESCE(role, '') IN ('ADMIN', 'MANAGER', 'INSPECTOR')
      ORDER BY COALESCE(NULLIF(fullname, ''), username)
      `
    )
    res.json(result.rows)
  }))

  router.get("/qualifications", asyncRoute(async (req, res) => {
    if (!INTERNAL_ROLES.has(req.user.role)) throw forbidden()
    const values = []
    let where = "WHERE qualification.ndt_method = 'MT'"
    if (req.query.userid) {
      values.push(positiveInteger(req.query.userid))
      where += ` AND qualification.userid = $${values.length}`
    }
    if (req.query.active === "true") {
      where += " AND qualification.status = 'ACTIVE' AND (qualification.expires_on IS NULL OR qualification.expires_on >= CURRENT_DATE)"
    }
    const result = await pool.query(
      `
      SELECT qualification.*, COALESCE(NULLIF(users.fullname, ''), users.username) AS full_name
      FROM atec.tbluserndtqualification qualification
      INNER JOIN atec.tblusers users ON users.userid = qualification.userid
      ${where}
      ORDER BY full_name, qualification.qualification_level DESC, qualification.expires_on DESC NULLS LAST
      `,
      values
    )
    res.json(result.rows)
  }))

  router.post("/qualifications", asyncRoute(async (req, res) => {
    if (!["ADMIN", "MANAGER"].includes(req.user.role)) throw forbidden()
    const body = req.body || {}
    if (!positiveInteger(body.userid)) throw badRequest("User is required.")
    if (![1, 2, 3].includes(Number(body.qualification_level))) throw badRequest("Qualification level must be 1, 2 or 3.")
    if (!cleanText(body.qualification_scheme, 500)) throw badRequest("Qualification scheme is required.")
    if (!cleanText(body.certificate_number, 500)) throw badRequest("Certificate number is required.")
    const result = await pool.query(
      `
      INSERT INTO atec.tbluserndtqualification (
        userid, qualification_scheme, ndt_method, qualification_level,
        certificate_number, qualified_on, expires_on, evidence_path, status,
        notes, created_by_user_id
      )
      VALUES ($1,$2,'MT',$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (userid, ndt_method, certificate_number)
        WHERE status = 'ACTIVE'
      DO UPDATE SET
        qualification_scheme=EXCLUDED.qualification_scheme,
        qualification_level=EXCLUDED.qualification_level,
        qualified_on=EXCLUDED.qualified_on,
        expires_on=EXCLUDED.expires_on,
        evidence_path=EXCLUDED.evidence_path,
        notes=EXCLUDED.notes,
        updated_at=now()
      RETURNING *
      `,
      [
        positiveInteger(body.userid),
        cleanText(body.qualification_scheme, 500),
        Number(body.qualification_level),
        cleanText(body.certificate_number, 500),
        nullableDate(body.qualified_on),
        nullableDate(body.expires_on),
        cleanText(body.evidence_path, 1000) || null,
        cleanText(body.status || "ACTIVE", 30).toUpperCase(),
        cleanText(body.notes, 4000),
        req.user.user_id
      ]
    )
    await req.logAudit("CREATE", "ndt_qualifications", result.rows[0].qualificationid, { method: "MT" })
    res.status(201).json(result.rows[0])
  }))

  router.get("/equipment", asyncRoute(async (req, res) => {
    if (!INTERNAL_ROLES.has(req.user.role)) throw forbidden()
    const result = await pool.query(
      `
      SELECT
        equipment.*,
        calibration.calibrationid,
        calibration.calibration_type,
        calibration.certificate_number,
        calibration.calibrated_on,
        calibration.due_on,
        calibration.result AS calibration_result
      FROM atec.tblndttestequipment equipment
      LEFT JOIN LATERAL (
        SELECT *
        FROM atec.tblndtequipmentcalibration current_calibration
        WHERE current_calibration.equipmentid = equipment.equipmentid
        ORDER BY current_calibration.calibrated_on DESC, current_calibration.calibrationid DESC
        LIMIT 1
      ) calibration ON true
      ORDER BY equipment.equipment_type, equipment.serial_number
      `
    )
    res.json(result.rows)
  }))

  router.post("/equipment", asyncRoute(async (req, res) => {
    if (!["ADMIN", "MANAGER"].includes(req.user.role)) throw forbidden()
    const body = req.body || {}
    if (!cleanText(body.equipment_type, 200)) throw badRequest("Equipment type is required.")
    if (!cleanText(body.serial_number, 500)) throw badRequest("Equipment serial number is required.")
    const result = await pool.query(
      `
      INSERT INTO atec.tblndttestequipment (
        equipment_type, manufacturer, model, serial_number, asset_reference,
        status, notes, created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        cleanText(body.equipment_type, 200),
        cleanText(body.manufacturer, 500),
        cleanText(body.model, 500),
        cleanText(body.serial_number, 500),
        cleanText(body.asset_reference, 500),
        cleanText(body.status || "ACTIVE", 30).toUpperCase(),
        cleanText(body.notes, 4000),
        req.user.user_id
      ]
    )
    await req.logAudit("CREATE", "ndt_test_equipment", result.rows[0].equipmentid, {})
    res.status(201).json(result.rows[0])
  }))

  router.post("/equipment/:id/calibrations", asyncRoute(async (req, res) => {
    if (!["ADMIN", "MANAGER"].includes(req.user.role)) throw forbidden()
    const body = req.body || {}
    if (!nullableDate(body.calibrated_on)) throw badRequest("Calibration date is required.")
    if (!cleanText(body.certificate_number, 500)) throw badRequest("Calibration certificate number is required.")
    const result = await pool.query(
      `
      INSERT INTO atec.tblndtequipmentcalibration (
        equipmentid, calibration_type, certificate_number, calibrated_on,
        due_on, provider, evidence_path, result, notes, created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        positiveInteger(req.params.id),
        cleanText(body.calibration_type || "CALIBRATION", 50).toUpperCase(),
        cleanText(body.certificate_number, 500),
        nullableDate(body.calibrated_on),
        nullableDate(body.due_on),
        cleanText(body.provider, 500),
        cleanText(body.evidence_path, 1000) || null,
        cleanText(body.result || "PASS", 30).toUpperCase(),
        cleanText(body.notes, 4000),
        req.user.user_id
      ]
    )
    await req.logAudit("CREATE", "ndt_equipment_calibrations", result.rows[0].calibrationid, { equipmentid: positiveInteger(req.params.id) })
    res.status(201).json(result.rows[0])
  }))

  router.get("/mpi/reports", asyncRoute(async (req, res) => {
    const values = []
    let where = "WHERE 1 = 1"
    if (req.user.role === "CUSTOMER") {
      if (!req.user.clientid) return res.json([])
      values.push(req.user.clientid)
      where += ` AND report.clientid = $${values.length} AND report.status = 'ISSUED'`
    }
    if (req.query.status && REPORT_STATUSES.has(cleanText(req.query.status, 50).toUpperCase())) {
      values.push(cleanText(req.query.status, 50).toUpperCase())
      where += ` AND report.status = $${values.length}`
    }
    if (req.query.clientid && req.user.role !== "CUSTOMER") {
      values.push(positiveInteger(req.query.clientid))
      where += ` AND report.clientid = $${values.length}`
    }
    if (req.query.search) {
      values.push(`%${cleanText(req.query.search, 500)}%`)
      where += ` AND (
        report.report_number ILIKE $${values.length}
        OR report.item_description ILIKE $${values.length}
        OR report.serial_number ILIKE $${values.length}
        OR report.client_name_snapshot ILIKE $${values.length}
      )`
    }
    const result = await pool.query(
      `
      SELECT
        report.ndtreportid,
        report.report_number,
        report.report_revision,
        report.status,
        report.subject_type,
        report.clientid,
        report.client_name_snapshot,
        report.item_description,
        report.serial_number,
        report.test_date,
        report.primary_outcome,
        report.indication_summary,
        report.level2_certification_required,
        report.created_at,
        report.updated_at
      FROM atec.tblndtreport report
      ${where}
      ORDER BY report.test_date DESC, report.ndtreportid DESC
      LIMIT 500
      `,
      values
    )
    res.json(result.rows)
  }))

  router.get("/mpi/reports/:id", asyncRoute(async (req, res) => {
    const client = await pool.connect()
    try {
      const record = await loadMpiReport(client, positiveInteger(req.params.id), req.user)
      if (!record) throw notFound()
      if (req.user.role === "CUSTOMER" && record.report.status !== "ISSUED") throw notFound()
      res.json(record)
    } finally {
      client.release()
    }
  }))

  router.post("/mpi/reports", asyncRoute(async (req, res) => {
    if (!["ADMIN", "MANAGER", "INSPECTOR"].includes(req.user.role)) throw forbidden()
    const body = req.body || {}
    const subjectType = validateReportBody(body)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const snapshot = await loadSubjectSnapshot(client, body, subjectType)
      const header = normalizeHeader(body, subjectType, snapshot)
      const numberResult = await client.query("SELECT atec.next_mpi_report_number($1::date) AS report_number", [header.test_date])
      const reportNumber = numberResult.rows[0].report_number
      const performingUserId = header.performing_user_id || req.user.user_id
      const result = await client.query(
        `
        INSERT INTO atec.tblndtreport (
          report_number, subject_type, clientid, siteid, sectionid, assetid,
          client_name_snapshot, address_snapshot, site_name_snapshot, section_name_snapshot,
          item_description, item_size, serial_number, material_specification,
          customer_reference, drawing_weld_reference, test_date, procedure_used,
          acceptance_standard, area_tested, surface_condition, examination_scope,
          primary_outcome, indication_summary, limitations, notes, performing_user_id,
          created_by_user_id, updated_by_user_id
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$28
        )
        RETURNING ndtreportid
        `,
        [
          reportNumber,
          header.subject_type,
          header.clientid,
          header.siteid,
          header.sectionid,
          header.assetid,
          header.client_name_snapshot,
          header.address_snapshot,
          header.site_name_snapshot,
          header.section_name_snapshot,
          header.item_description,
          header.item_size,
          header.serial_number,
          header.material_specification,
          header.customer_reference,
          header.drawing_weld_reference,
          header.test_date,
          header.procedure_used,
          header.acceptance_standard,
          header.area_tested,
          header.surface_condition,
          header.examination_scope,
          header.primary_outcome,
          header.indication_summary,
          header.limitations,
          header.notes,
          performingUserId,
          req.user.user_id
        ]
      )
      const reportId = result.rows[0].ndtreportid
      await replaceMpiDetail(client, reportId, body.mpi_detail || {})
      await replaceEquipment(client, reportId, Array.isArray(body.equipment) ? body.equipment : [])
      await replaceConsumables(client, reportId, Array.isArray(body.consumables) ? body.consumables : [])
      await replaceChecks(client, reportId, Array.isArray(body.checks) ? body.checks : [])
      await replaceIndications(client, reportId, Array.isArray(body.indications) ? body.indications : [])
      await addAudit(client, reportId, req.user.user_id, "CREATED", null, "DRAFT", { report_number: reportNumber })
      await client.query("COMMIT")
      const saved = await loadMpiReport(client, reportId, req.user)
      await req.logAudit("CREATE", "ndt_mpi_reports", reportId, { report_number: reportNumber })
      res.status(201).json(saved)
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }))

  router.put("/mpi/reports/:id", asyncRoute(async (req, res) => {
    const reportId = positiveInteger(req.params.id)
    const body = req.body || {}
    const subjectType = validateReportBody(body)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const existing = await loadMpiReport(client, reportId, req.user)
      if (!existing) throw notFound()
      if (!canEditReport(req.user, existing.report)) throw forbidden("You cannot edit this MPI report.")
      if (!EDITABLE_STATUSES.has(existing.report.status)) throw badRequest("Certified or issued MPI reports cannot be edited.", "MPI_REPORT_LOCKED")
      const snapshot = await loadSubjectSnapshot(client, body, subjectType)
      const header = normalizeHeader(body, subjectType, snapshot)
      await client.query(
        `
        UPDATE atec.tblndtreport
        SET
          subject_type=$1, clientid=$2, siteid=$3, sectionid=$4, assetid=$5,
          client_name_snapshot=$6, address_snapshot=$7, site_name_snapshot=$8,
          section_name_snapshot=$9, item_description=$10, item_size=$11,
          serial_number=$12, material_specification=$13, customer_reference=$14,
          drawing_weld_reference=$15, test_date=$16, procedure_used=$17,
          acceptance_standard=$18, area_tested=$19, surface_condition=$20,
          examination_scope=$21, primary_outcome=$22, indication_summary=$23,
          limitations=$24, notes=$25, performing_user_id=$26,
          performing_qualification_id=NULL, performing_snapshot='{}'::jsonb,
          level2_certification_required=false, certifying_user_id=NULL,
          certifying_qualification_id=NULL, certifying_snapshot='{}'::jsonb,
          technician_signed_at=NULL, certified_at=NULL,
          status='DRAFT', updated_by_user_id=$27, updated_at=now()
        WHERE ndtreportid=$28
        `,
        [
          header.subject_type,
          header.clientid,
          header.siteid,
          header.sectionid,
          header.assetid,
          header.client_name_snapshot,
          header.address_snapshot,
          header.site_name_snapshot,
          header.section_name_snapshot,
          header.item_description,
          header.item_size,
          header.serial_number,
          header.material_specification,
          header.customer_reference,
          header.drawing_weld_reference,
          header.test_date,
          header.procedure_used,
          header.acceptance_standard,
          header.area_tested,
          header.surface_condition,
          header.examination_scope,
          header.primary_outcome,
          header.indication_summary,
          header.limitations,
          header.notes,
          header.performing_user_id || existing.report.performing_user_id || req.user.user_id,
          req.user.user_id,
          reportId
        ]
      )
      await replaceMpiDetail(client, reportId, body.mpi_detail || {})
      await replaceEquipment(client, reportId, Array.isArray(body.equipment) ? body.equipment : [])
      await replaceConsumables(client, reportId, Array.isArray(body.consumables) ? body.consumables : [])
      await replaceChecks(client, reportId, Array.isArray(body.checks) ? body.checks : [])
      await replaceIndications(client, reportId, Array.isArray(body.indications) ? body.indications : [])
      await addAudit(client, reportId, req.user.user_id, "UPDATED", existing.report.status, "DRAFT")
      await client.query("COMMIT")
      const saved = await loadMpiReport(client, reportId, req.user)
      await req.logAudit("UPDATE", "ndt_mpi_reports", reportId, { status: "DRAFT" })
      res.json(saved)
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }))

  router.post("/mpi/reports/:id/sign", asyncRoute(async (req, res) => {
    const reportId = positiveInteger(req.params.id)
    const qualificationId = positiveInteger(req.body?.qualificationid)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const record = await loadMpiReport(client, reportId, req.user)
      if (!record) throw notFound()
      if (String(record.report.performing_user_id) !== String(req.user.user_id)) {
        throw forbidden("Only the selected performing technician may sign this examination.")
      }
      if (!EDITABLE_STATUSES.has(record.report.status)) throw badRequest("This MPI report is not available for technician signing.")
      validateReadyForSignature(record)
      const qualification = await loadQualification(client, qualificationId, req.user.user_id, 1)
      if (!qualification) throw badRequest("Select an active, unexpired MT qualification.")
      const snapshot = qualificationSnapshot(qualification)
      const requiresLevel2 = Number(qualification.qualification_level) === 1
      const nextStatus = requiresLevel2 ? "AWAITING_LEVEL_2" : "CERTIFIED"
      const hash = reportHash(record)
      await client.query(
        `
        INSERT INTO atec.tblndtsignatureevent (
          ndtreportid, report_revision, signature_role, userid, qualificationid,
          signer_snapshot, record_hash, decision
        )
        VALUES ($1,$2,'PERFORMING_TECHNICIAN',$3,$4,$5,$6,$7)
        `,
        [
          reportId,
          record.report.report_revision,
          req.user.user_id,
          qualification.qualificationid,
          snapshot,
          hash,
          requiresLevel2 ? "SIGNED" : "CERTIFIED"
        ]
      )
      await client.query(
        `
        UPDATE atec.tblndtreport
        SET
          performing_qualification_id=$1::integer,
          performing_snapshot=$2::jsonb,
          level2_certification_required=$3::boolean,
          technician_signed_at=now(),
          certified_at=CASE WHEN $3::boolean THEN NULL ELSE now() END,
          certifying_user_id=CASE WHEN $3::boolean THEN NULL ELSE $4::integer END,
          certifying_qualification_id=CASE WHEN $3::boolean THEN NULL ELSE $1::integer END,
          certifying_snapshot=CASE WHEN $3::boolean THEN '{}'::jsonb ELSE $2::jsonb END,
          status=$5::text,
          updated_by_user_id=$4::integer,
          updated_at=now()
        WHERE ndtreportid=$6::integer
        `,
        [qualification.qualificationid, snapshot, requiresLevel2, req.user.user_id, nextStatus, reportId]
      )
      await addAudit(client, reportId, req.user.user_id, "TECHNICIAN_SIGNED", record.report.status, nextStatus, {
        qualification_level: qualification.qualification_level,
        record_hash: hash
      })
      await client.query("COMMIT")
      await req.logAudit("MPI_TECHNICIAN_SIGNED", "ndt_mpi_reports", reportId, { status: nextStatus })
      res.json(await loadMpiReport(client, reportId, req.user))
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }))

  router.post("/mpi/reports/:id/certify", asyncRoute(async (req, res) => {
    const reportId = positiveInteger(req.params.id)
    const qualificationId = positiveInteger(req.body?.qualificationid)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const record = await loadMpiReport(client, reportId, req.user)
      if (!record) throw notFound()
      if (record.report.status !== "AWAITING_LEVEL_2" || !record.report.level2_certification_required) {
        throw badRequest("This MPI report is not awaiting Level 2 certification.")
      }
      const qualification = await loadQualification(client, qualificationId, req.user.user_id, 2)
      if (!qualification) throw badRequest("An active, unexpired MT Level 2 or Level 3 qualification is required.")
      const snapshot = qualificationSnapshot(qualification)
      const hash = reportHash(record)
      await client.query(
        `
        INSERT INTO atec.tblndtsignatureevent (
          ndtreportid, report_revision, signature_role, userid, qualificationid,
          signer_snapshot, record_hash, decision, comments
        )
        VALUES ($1,$2,'LEVEL_2_CERTIFIER',$3,$4,$5,$6,'CERTIFIED',$7)
        `,
        [
          reportId,
          record.report.report_revision,
          req.user.user_id,
          qualification.qualificationid,
          snapshot,
          hash,
          cleanText(req.body?.comments, 4000)
        ]
      )
      await client.query(
        `
        UPDATE atec.tblndtreport
        SET
          certifying_user_id=$1,
          certifying_qualification_id=$2,
          certifying_snapshot=$3,
          certified_at=now(),
          status='CERTIFIED',
          updated_by_user_id=$1,
          updated_at=now()
        WHERE ndtreportid=$4
        `,
        [req.user.user_id, qualification.qualificationid, snapshot, reportId]
      )
      await addAudit(client, reportId, req.user.user_id, "LEVEL_2_CERTIFIED", "AWAITING_LEVEL_2", "CERTIFIED", { record_hash: hash })
      await client.query("COMMIT")
      await req.logAudit("MPI_LEVEL_2_CERTIFIED", "ndt_mpi_reports", reportId, {})
      res.json(await loadMpiReport(client, reportId, req.user))
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }))

  router.post("/mpi/reports/:id/return", asyncRoute(async (req, res) => {
    const reportId = positiveInteger(req.params.id)
    const comments = cleanText(req.body?.comments, 4000)
    if (!comments) throw badRequest("Enter the reason for returning the report.")
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const record = await loadMpiReport(client, reportId, req.user)
      if (!record) throw notFound()
      if (record.report.status !== "AWAITING_LEVEL_2") throw badRequest("This report is not awaiting Level 2 review.")
      const qualification = await loadQualification(client, positiveInteger(req.body?.qualificationid), req.user.user_id, 2)
      if (!qualification) throw badRequest("An active MT Level 2 or Level 3 qualification is required.")
      await client.query(
        `
        INSERT INTO atec.tblndtsignatureevent (
          ndtreportid, report_revision, signature_role, userid, qualificationid,
          signer_snapshot, record_hash, decision, comments
        )
        VALUES ($1,$2,'LEVEL_2_CERTIFIER',$3,$4,$5,$6,'RETURNED',$7)
        `,
        [
          reportId,
          record.report.report_revision,
          req.user.user_id,
          qualification.qualificationid,
          qualificationSnapshot(qualification),
          reportHash(record),
          comments
        ]
      )
      await client.query(
        `
        UPDATE atec.tblndtreport
        SET status='RETURNED_FOR_CORRECTION', updated_by_user_id=$1, updated_at=now()
        WHERE ndtreportid=$2
        `,
        [req.user.user_id, reportId]
      )
      await addAudit(client, reportId, req.user.user_id, "RETURNED_FOR_CORRECTION", "AWAITING_LEVEL_2", "RETURNED_FOR_CORRECTION", { comments })
      await client.query("COMMIT")
      await req.logAudit("MPI_RETURNED", "ndt_mpi_reports", reportId, {})
      res.json(await loadMpiReport(client, reportId, req.user))
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }))

  router.post("/mpi/reports/:id/issue", asyncRoute(async (req, res) => {
    if (!["ADMIN", "MANAGER"].includes(req.user.role)) throw forbidden()
    const reportId = positiveInteger(req.params.id)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const record = await loadMpiReport(client, reportId, req.user)
      if (!record) throw notFound()
      if (record.report.status !== "CERTIFIED") throw badRequest("Only a certified MPI report may be issued.")
      const hash = reportHash(record)
      await client.query(
        `
        INSERT INTO atec.tblndtreportrevision (
          ndtreportid, report_revision, revision_snapshot, record_hash,
          revision_reason, created_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (ndtreportid, report_revision) DO NOTHING
        `,
        [
          reportId,
          record.report.report_revision,
          record,
          hash,
          cleanText(req.body?.revision_reason, 4000),
          req.user.user_id
        ]
      )
      await client.query(
        `
        UPDATE atec.tblndtreport
        SET status='ISSUED', issued_at=now(), updated_by_user_id=$1, updated_at=now()
        WHERE ndtreportid=$2
        `,
        [req.user.user_id, reportId]
      )
      if (record.report.supersedes_report_id) {
        await client.query(
          `
          UPDATE atec.tblndtreport
          SET status='SUPERSEDED', superseded_at=now(), updated_by_user_id=$1, updated_at=now()
          WHERE ndtreportid=$2
            AND status='ISSUED'
          `,
          [req.user.user_id, record.report.supersedes_report_id]
        )
        await addAudit(
          client,
          record.report.supersedes_report_id,
          req.user.user_id,
          "SUPERSEDED",
          "ISSUED",
          "SUPERSEDED",
          { superseded_by_report_id: reportId, revision: record.report.report_revision }
        )
      }
      await addAudit(client, reportId, req.user.user_id, "ISSUED", "CERTIFIED", "ISSUED", { record_hash: hash })
      await client.query("COMMIT")
      await req.logAudit("MPI_ISSUED", "ndt_mpi_reports", reportId, {})
      res.json(await loadMpiReport(client, reportId, req.user))
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }))

  router.post("/mpi/reports/:id/revise", asyncRoute(async (req, res) => {
    if (!["ADMIN", "MANAGER"].includes(req.user.role)) throw forbidden()
    const reportId = positiveInteger(req.params.id)
    const revisionReason = cleanText(req.body?.revision_reason, 4000)
    if (!revisionReason) throw badRequest("Enter the reason for creating a revised report.")
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const source = await loadMpiReport(client, reportId, req.user)
      if (!source) throw notFound()
      if (source.report.status !== "ISSUED") throw badRequest("Only an issued MPI report may be revised.")
      const existingDraft = await client.query(
        `
        SELECT ndtreportid
        FROM atec.tblndtreport
        WHERE report_number=$1
          AND report_revision=$2
        LIMIT 1
        `,
        [source.report.report_number, Number(source.report.report_revision) + 1]
      )
      if (existingDraft.rows[0]) throw badRequest("The next revision already exists.")
      const inserted = await client.query(
        `
        INSERT INTO atec.tblndtreport (
          report_number, template_number, template_revision, report_revision,
          ndt_method, report_purpose, status, subject_type, clientid, siteid,
          sectionid, assetid, client_name_snapshot, address_snapshot,
          site_name_snapshot, section_name_snapshot, item_description, item_size,
          serial_number, material_specification, customer_reference,
          drawing_weld_reference, test_date, procedure_used, acceptance_standard,
          area_tested, surface_condition, examination_scope, primary_outcome,
          indication_summary, limitations, notes, performing_user_id,
          supersedes_report_id, created_by_user_id, updated_by_user_id
        )
        SELECT
          report_number, template_number, template_revision, report_revision + 1,
          ndt_method, report_purpose, 'DRAFT', subject_type, clientid, siteid,
          sectionid, assetid, client_name_snapshot, address_snapshot,
          site_name_snapshot, section_name_snapshot, item_description, item_size,
          serial_number, material_specification, customer_reference,
          drawing_weld_reference, test_date, procedure_used, acceptance_standard,
          area_tested, surface_condition, examination_scope, primary_outcome,
          indication_summary, limitations, notes, performing_user_id,
          ndtreportid, $2, $2
        FROM atec.tblndtreport
        WHERE ndtreportid=$1
        RETURNING ndtreportid
        `,
        [reportId, req.user.user_id]
      )
      const revisedId = inserted.rows[0].ndtreportid
      await replaceMpiDetail(client, revisedId, source.mpi_detail || {})
      await replaceEquipment(client, revisedId, source.equipment)
      await replaceConsumables(client, revisedId, source.consumables)
      await replaceChecks(client, revisedId, source.checks)
      await replaceIndications(client, revisedId, source.indications)
      const revisedIndications = await client.query(
        "SELECT indicationid, sequence_number FROM atec.tblndtindication WHERE ndtreportid=$1",
        [revisedId]
      )
      const newBySequence = new Map(revisedIndications.rows.map(row => [Number(row.sequence_number), row.indicationid]))
      const sourceById = new Map(source.indications.map(row => [Number(row.indicationid), Number(row.sequence_number)]))
      for (const attachment of source.attachments) {
        const sourceSequence = attachment.indicationid ? sourceById.get(Number(attachment.indicationid)) : null
        await client.query(
          `
          INSERT INTO atec.tblndtreportattachment (
            ndtreportid, indicationid, attachment_type, file_path,
            original_filename, caption, uploaded_by_user_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          `,
          [
            revisedId,
            sourceSequence ? newBySequence.get(sourceSequence) || null : null,
            attachment.attachment_type,
            attachment.file_path,
            attachment.original_filename,
            attachment.caption,
            req.user.user_id
          ]
        )
      }
      await addAudit(client, revisedId, req.user.user_id, "REVISION_CREATED", null, "DRAFT", {
        source_report_id: reportId,
        source_revision: source.report.report_revision,
        revision_reason: revisionReason
      })
      await client.query("COMMIT")
      await req.logAudit("MPI_REVISION_CREATED", "ndt_mpi_reports", revisedId, {
        source_report_id: reportId,
        revision: Number(source.report.report_revision) + 1
      })
      res.status(201).json(await loadMpiReport(client, revisedId, req.user))
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }))

  router.post("/mpi/reports/:id/email", emailLimiter, asyncRoute(async (req, res) => {
    const reportId = positiveInteger(req.params.id)
    const recipient = cleanText(req.body?.to, 500)
    if (!isValidEmailAddress(recipient)) throw badRequest("Enter a valid recipient email address.")
    if (
      req.user.role === "CUSTOMER" &&
      recipient.toLowerCase() !== cleanText(req.user.email, 500).toLowerCase()
    ) {
      throw forbidden("Customer users may only email the report to their registered email address.")
    }
    const issues = getMailConfigIssues()
    if (issues.length) {
      throw badRequest(`Email is not configured yet. Missing: ${issues.join(", ")}.`)
    }
    const client = await pool.connect()
    let record
    let subject
    let message
    try {
      record = await loadMpiReport(client, reportId, req.user)
      if (!record || record.report.status !== "ISSUED") throw notFound("Issued MPI customer report not found")
      subject = cleanText(req.body?.subject, 1000) || `ATEC MPI Report ${record.report.report_number}-CR`
      message = cleanText(req.body?.message, 10000) || [
        "Good day,",
        "",
        `Please find attached MPI customer outcome report ${record.report.report_number}-CR.`,
        "",
        `Customer: ${record.report.client_name_snapshot}`,
        `Item: ${record.report.item_description}`,
        `Serial / Identification: ${record.report.serial_number || "-"}`,
        `Test date: ${String(record.report.test_date || "").slice(0, 10)}`,
        `Outcome: ${displayCodeForEmail(record.report.primary_outcome)}`,
        "",
        "Regards,",
        "ATEC Inspection Platform"
      ].join("\n")
      const pdf = await runQueuedPdfJob(() => buildCustomerReportPdf(record, { uploadRoot, brandRoot }))
      await sendApplicationEmail({
        from: process.env.MAIL_FROM,
        to: recipient,
        cc: customerReportCc,
        subject,
        text: message,
        attachments: [{
          filename: `${reportOutputNumber(record.report, "CUSTOMER_REPORT")}-Rev-${record.report.report_revision}.pdf`,
          content: pdf,
          contentType: "application/pdf"
        }]
      })
      const delivered = await client.query(
        `
        INSERT INTO atec.tblndtreportdelivery (
          ndtreportid, report_revision, recipient_email, email_subject,
          email_message, delivery_status, sent_by_user_id, sent_at
        )
        VALUES ($1,$2,$3,$4,$5,'SENT',$6,now())
        RETURNING *
        `,
        [reportId, record.report.report_revision, recipient, subject, message, req.user.user_id]
      )
      await addAudit(client, reportId, req.user.user_id, "CUSTOMER_REPORT_EMAILED", "ISSUED", "ISSUED", { to: recipient })
      await req.logAudit("MPI_CUSTOMER_REPORT_EMAIL", "ndt_mpi_reports", reportId, { to: recipient })
      res.json({ success: true, delivery: delivered.rows[0] })
    } catch (error) {
      if (record) {
        await client.query(
          `
          INSERT INTO atec.tblndtreportdelivery (
            ndtreportid, report_revision, recipient_email, email_subject,
            email_message, delivery_status, error_message, sent_by_user_id
          )
          VALUES ($1,$2,$3,$4,$5,'FAILED',$6,$7)
          `,
          [
            reportId,
            record.report.report_revision,
            recipient,
            subject || cleanText(req.body?.subject, 1000),
            message || cleanText(req.body?.message, 10000),
            getMailErrorMessage(error),
            req.user.user_id
          ]
        )
      }
      throw error
    } finally {
      client.release()
    }
  }))

  router.post(
    "/mpi/reports/:id/attachments",
    uploadLimiter,
    upload.array("mpiPhotos", 20),
    validateUploadedImages,
    compressUploadedPhotos,
    asyncRoute(async (req, res) => {
      const reportId = positiveInteger(req.params.id)
      const client = await pool.connect()
      try {
        const record = await loadMpiReport(client, reportId, req.user)
        if (!record) throw notFound()
        if (!canEditReport(req.user, record.report)) throw forbidden("You cannot add evidence to this MPI report.")
        if (!EDITABLE_STATUSES.has(record.report.status)) throw badRequest("Evidence cannot be changed after certification.")
        const files = req.files || []
        const captions = Array.isArray(req.body.photoCaptions) ? req.body.photoCaptions : [req.body.photoCaptions || ""]
        const types = Array.isArray(req.body.photoTypes) ? req.body.photoTypes : [req.body.photoTypes || "GENERAL"]
        const indicationIds = Array.isArray(req.body.indicationIds) ? req.body.indicationIds : [req.body.indicationIds || null]
        const rows = []
        for (let index = 0; index < files.length; index += 1) {
          const type = cleanText(types[index] || "GENERAL", 50).toUpperCase()
          const indicationId = positiveInteger(indicationIds[index])
          if (indicationId && !record.indications.some(row => Number(row.indicationid) === indicationId)) {
            throw badRequest("Selected indication does not belong to this MPI report.")
          }
          const inserted = await client.query(
            `
            INSERT INTO atec.tblndtreportattachment (
              ndtreportid, indicationid, attachment_type, file_path,
              original_filename, caption, uploaded_by_user_id
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
            `,
            [
              reportId,
              indicationId,
              type,
              `/uploads/mpi/${files[index].filename}`,
              files[index].originalname || "",
              cleanText(captions[index], 2000),
              req.user.user_id
            ]
          )
          rows.push(inserted.rows[0])
        }
        await addAudit(client, reportId, req.user.user_id, "EVIDENCE_UPLOADED", record.report.status, record.report.status, { count: rows.length })
        await req.logAudit("UPLOAD", "ndt_mpi_attachments", reportId, { count: rows.length })
        res.status(201).json(rows)
      } finally {
        client.release()
      }
    })
  )

  router.delete("/mpi/reports/:id/attachments/:attachmentId", asyncRoute(async (req, res) => {
    const reportId = positiveInteger(req.params.id)
    const client = await pool.connect()
    try {
      const record = await loadMpiReport(client, reportId, req.user)
      if (!record) throw notFound()
      if (!canEditReport(req.user, record.report)) throw forbidden("You cannot remove evidence from this MPI report.")
      if (!EDITABLE_STATUSES.has(record.report.status)) throw badRequest("Evidence cannot be changed after certification.")
      const removed = await client.query(
        `
        DELETE FROM atec.tblndtreportattachment
        WHERE attachmentid=$1 AND ndtreportid=$2
        RETURNING attachmentid, file_path
        `,
        [positiveInteger(req.params.attachmentId), reportId]
      )
      if (!removed.rows[0]) throw notFound("MPI evidence attachment not found")
      await addAudit(client, reportId, req.user.user_id, "EVIDENCE_REMOVED", record.report.status, record.report.status, {
        attachmentid: removed.rows[0].attachmentid,
        file_path: removed.rows[0].file_path
      })
      await req.logAudit("DELETE", "ndt_mpi_attachments", removed.rows[0].attachmentid, { ndtreportid: reportId })
      res.json({ removed: true })
    } finally {
      client.release()
    }
  }))

  router.get("/mpi/reports/:id/practical-exam.pdf", pdfLimiter, asyncRoute(async (req, res) => {
    if (req.user.role === "CUSTOMER") throw forbidden()
    const client = await pool.connect()
    try {
      const record = await loadMpiReport(client, positiveInteger(req.params.id), req.user)
      if (!record) throw notFound()
      const buffer = await runQueuedPdfJob(() => buildPracticalExamPdf(record, { uploadRoot, brandRoot }))
      const filename = `${reportOutputNumber(record.report, "PRACTICAL_EXAM")}-Rev-${record.report.report_revision}.pdf`
      res.type("application/pdf")
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`)
      res.send(buffer)
    } finally {
      client.release()
    }
  }))

  router.get("/mpi/reports/:id/customer-report.pdf", pdfLimiter, asyncRoute(async (req, res) => {
    const client = await pool.connect()
    try {
      const record = await loadMpiReport(client, positiveInteger(req.params.id), req.user)
      if (!record) throw notFound()
      if (req.user.role === "CUSTOMER" && record.report.status !== "ISSUED") throw notFound()
      if (req.user.role !== "CUSTOMER" && !["CERTIFIED", "ISSUED", "SUPERSEDED"].includes(record.report.status)) {
        throw badRequest("The customer report is available after certification.")
      }
      const buffer = await runQueuedPdfJob(() => buildCustomerReportPdf(record, { uploadRoot, brandRoot }))
      const filename = `${reportOutputNumber(record.report, "CUSTOMER_REPORT")}-Rev-${record.report.report_revision}.pdf`
      res.type("application/pdf")
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`)
      res.send(buffer)
    } finally {
      client.release()
    }
  }))

  app.use("/ndt", router)
}

module.exports = {
  registerMpiRoutes,
  reportHash,
  suggestedClassification,
  validateReadyForSignature
}
