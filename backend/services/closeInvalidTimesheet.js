function failure(message, statusCode) {
  return Object.assign(new Error(message), { statusCode })
}

async function closeInvalidTimesheet(pool, user, id, rawReason) {
  if (user?.role !== 'ADMIN') throw failure('Only an Admin can close a timesheet as invalid.', 403)
  const reason = String(rawReason || '').trim()
  if (reason.length < 5 || reason.length > 1000) throw failure('Enter a reason between 5 and 1000 characters.', 400)
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw failure('Invalid timesheet ID.', 400)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('SELECT * FROM atec.tbldailytimesheet WHERE timesheetid=$1 FOR UPDATE', [id])
    const sheet = rows[0]
    if (!sheet) throw failure('Timesheet not found.', 404)
    if (!['DRAFT','AWAITING_EMPLOYEE','EMPLOYEE_SUBMITTED','MANAGER_APPROVED','RETURNED'].includes(sheet.status)) {
      throw failure('Only outstanding timesheets can be closed. HR-accepted, exported and already closed records remain locked.', 409)
    }
    const result = await client.query(`UPDATE atec.tbldailytimesheet SET status='CLOSED_INVALID',
      closed_reason=$2,closed_at=now(),closed_by_user_id=$3,updated_at=now()
      WHERE timesheetid=$1 RETURNING *`, [id, reason, user.user_id])
    await client.query(`INSERT INTO atec.tbltimesheetaudit(timesheetid,actor_user_id,action,details)
      VALUES($1,$2,'CLOSE_INVALID',$3::jsonb)`, [id, user.user_id, JSON.stringify({ reason, previous_status:sheet.status, before:sheet })])
    await client.query('COMMIT')
    return result.rows[0]
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
}

module.exports = { closeInvalidTimesheet }
