function positiveIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(Number).filter(id => Number.isInteger(id) && id > 0))]
}

function validWorkDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

async function inspectedAssetIdsForJob(client, body) {
  if (!positiveIds([body.clientid]).length || !positiveIds([body.siteid]).length || !validWorkDate(body.inspection_work_date)) {
    const error = new Error("Select a customer, site and valid inspection work date")
    error.status = 400
    throw error
  }
  const jobNumber = String(body.customer_reference || "").trim()
  if (jobNumber && !/^[0-9]+$/.test(jobNumber)) {
    const error = new Error("Accelo Job Number may contain numeric digits only")
    error.status = 400
    throw error
  }
  const inspectors = positiveIds([body.assigned_to_user_id, ...(Array.isArray(body.crew) ? body.crew.map(row => row.user_id) : [])])
  if (!inspectors.length) return []
  const result = await client.query(`
    SELECT DISTINCT i.assetid
    FROM atec.tblinspection i
    JOIN atec.tblasset a ON a.assetid=i.assetid
    WHERE a.clientid=$1 AND a.siteid=$2
      AND ($3::int IS NULL OR a.sectionid=$3)
      AND i.inspector_user_id=ANY($4::int[])
      AND i.testdate::date=$5::date
      AND ($6::text='' OR BTRIM(i.job_number)=$6)
      AND COALESCE(i.record_status,'ACTIVE')='ACTIVE'
      AND COALESCE(a.archived,false)=false
    ORDER BY i.assetid`, [body.clientid, body.siteid, body.sectionid || null, inspectors, body.inspection_work_date, jobNumber])
  return positiveIds(result.rows.map(row => row.assetid))
}

module.exports = { inspectedAssetIdsForJob, positiveIds, validWorkDate }
