const { isFailedInspectionResult } = require("./inspectionIntegrity")

async function attachCustomerReportReasons(pool, assets) {
  const ids = [...new Set(assets.flatMap(row => [
    row.visualstatus === "NOT SAFE" ? row.visualtestid : null,
    row.loadstatus === "NOT SAFE" ? row.loadtestid : null
  ]).filter(id => id != null))]
  const findings = new Map()
  if (ids.length) {
    const result = await pool.query(`
      SELECT i.testid, i.comments, r.result, r.measuredvalue, r.remarks,
        COALESCE(c.criteriadescription, c.criterianame, 'Inspection criterion') AS criterion
      FROM atec.tblinspection i
      LEFT JOIN atec.tblinspectionresult r ON r.testid = i.testid
      LEFT JOIN atec.tblequiptypecriteria c ON c.criteriaid = r.criteriaid
      WHERE i.testid = ANY($1::int[])
      ORDER BY i.testid, c.sortorder NULLS LAST, r.resultid
    `, [ids])
    for (const row of result.rows) {
      const key = String(row.testid)
      if (!findings.has(key)) findings.set(key, { failures: [], comments: String(row.comments || "").trim() })
      if (isFailedInspectionResult(row)) {
        const remark = String(row.remarks || "").trim()
        const measured = String(row.measuredvalue || "").trim()
        const result = String(row.result || "").trim()
        const outcome = [result, measured && measured !== result ? `Measured: ${measured}` : ""].filter(Boolean).join("; ")
        findings.get(key).failures.push(`${row.criterion}: ${outcome}${remark ? ` — ${remark}` : ""}`)
      }
    }
  }
  for (const asset of assets) {
    asset.notsafereason = [ ["visual", "Visual inspection"], ["load", "Load test"] ]
      .filter(([prefix]) => asset[`${prefix}status`] === "NOT SAFE")
      .map(([prefix, label]) => {
        const id = asset[`${prefix}testid`]
        const finding = findings.get(String(id))
        const details = [...(finding?.failures || [])]
        if (finding?.comments) details.push(`Inspector comments: ${finding.comments}`)
        return `${label} ${id || "(ID missing)"}: ${details.join("; ") || "No reason recorded"}`
      }).join("\n")
  }
}

module.exports = { attachCustomerReportReasons }
