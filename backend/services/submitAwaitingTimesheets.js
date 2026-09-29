function failure(message, statusCode) {
  return Object.assign(new Error(message), { statusCode })
}

async function submitAwaitingTimesheets(pool, user, rawIds, rawReason) {
  if (user?.role !== 'ADMIN') throw failure('Only an Admin can submit for all employees.', 403)
  const reason = String(rawReason || '').trim()
  if (reason.length < 5 || reason.length > 1000) throw failure('Enter a reason between 5 and 1000 characters.', 400)
  if (!Array.isArray(rawIds) || !rawIds.length || rawIds.length > 5000 || rawIds.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    throw failure('Select between 1 and 5000 valid timesheets.', 400)
  }
  const ids = [...new Set(rawIds.map(Number))].sort((a,b) => a-b)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT timesheetid,status FROM atec.tbldailytimesheet
      WHERE timesheetid=ANY($1::int[]) ORDER BY timesheetid FOR UPDATE`, [ids])
    if (rows.length !== ids.length || rows.some(row => row.status !== 'AWAITING_EMPLOYEE')) {
      throw failure('Some timesheets have changed stage. Refresh the queue and review them again. Nothing was submitted.', 409)
    }
    const empty = await client.query(`SELECT t.timesheetid FROM atec.tbldailytimesheet t
      WHERE t.timesheetid=ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM atec.tbltimeentry e
        WHERE e.user_id=t.user_id AND e.activity_date=t.timesheet_date)`, [ids])
    if (empty.rows.length) throw failure('Some selected timesheets have no entries. Review or close those records first. Nothing was submitted.', 409)
    await client.query(`UPDATE atec.tbldailytimesheet SET status='EMPLOYEE_SUBMITTED',
      employee_submitted_at=now(),returned_reason='',updated_at=now() WHERE timesheetid=ANY($1::int[])`, [ids])
    await client.query(`INSERT INTO atec.tbltimesheetaudit(timesheetid,actor_user_id,action,details)
      SELECT id,$2,'SUBMIT_EMPLOYEE',$3::jsonb FROM unnest($1::int[]) AS id`,
    [ids,user.user_id,JSON.stringify({reason,bulk:true,previous_status:'AWAITING_EMPLOYEE',batch_size:ids.length})])
    await client.query('COMMIT')
    return { submitted:ids.length }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
}

module.exports = { submitAwaitingTimesheets }
