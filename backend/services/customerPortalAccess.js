// Person links are administrator-maintained IDs, never inferred from editable email addresses.
async function loadCustomerPortalScope(db, user) {
  const denied = () => Object.assign(new Error('Customer portal access is not configured or is inactive.'), { statusCode: 403 })
  const result = await db.query(`
    SELECT u.clientid, u.siteid, u.sectionid, u.portal_personid,
           p.personid, p.clientid AS person_clientid, p.archived AS person_archived,
           c.archived AS client_archived
    FROM atec.tblusers u
    JOIN atec.tblclients c ON c.clientid = u.clientid
    LEFT JOIN atec.tblpeople p ON p.personid = u.portal_personid
    WHERE u.userid = $1 AND u.role = 'CUSTOMER' AND COALESCE(u.is_active, true)
  `, [user.user_id])
  const row = result.rows[0]
  if (!row || row.client_archived || String(row.clientid) !== String(user.clientid)) throw denied()
  if (row.portal_personid && (!row.personid || row.person_archived || String(row.person_clientid) !== String(row.clientid))) throw denied()
  const scope = {
    clientid: row.clientid,
    responsibleid: row.portal_personid || null,
    siteid: row.portal_personid ? null : row.siteid || null,
    sectionid: row.portal_personid ? null : row.sectionid || null
  }
  if (scope.responsibleid) {
    const sections = await db.query(`
      SELECT sec.sectionid FROM atec.tblsection sec
      JOIN atec.tblsites s ON s.siteid = sec.siteid AND s.clientid = sec.clientid
      WHERE sec.clientid = $1 AND sec.responsibleid = $2
        AND NOT COALESCE(sec.archived, false) AND NOT COALESCE(s.archived, false)
    `, [scope.clientid, scope.responsibleid])
    scope.sectionIds = sections.rows.map(section => String(section.sectionid))
  }
  return scope
}

function portalScopeSql(user, values, alias = 'a') {
  if (user?.role !== 'CUSTOMER') return ''
  const scope = user.portal_scope
  if (!scope) return ' AND false'
  values.push(scope.clientid)
  let sql = ` AND ${alias}.clientid = $${values.length}`
  if (scope.responsibleid) {
    values.push(scope.sectionIds || [])
    sql += ` AND ${alias}.sectionid = ANY($${values.length}::bigint[])`
  } else {
    for (const field of ['siteid', 'sectionid']) {
      if (scope[field]) {
        values.push(scope[field])
        sql += ` AND ${alias}.${field} = $${values.length}`
      }
    }
  }
  return sql
}

function portalCanReadRecord(user, record) {
  if (!user || !record) return false
  if (user.role !== 'CUSTOMER') return true
  const scope = user.portal_scope
  if (!scope || String(record.clientid || '') !== String(scope.clientid || '')) return false
  if (scope.responsibleid) return (scope.sectionIds || []).includes(String(record.sectionid || ''))
  return ['siteid', 'sectionid'].every(field => !scope[field] || String(scope[field]) === String(record[field] || ''))
}

module.exports = { loadCustomerPortalScope, portalScopeSql, portalCanReadRecord }
