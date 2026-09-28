const DAY = 86400000

function ruleConfig(env = process.env) {
  return {
    enabled: env.COMPLIANCE_EXPIRY_REMINDERS_ENABLED === 'true',
    recipient: 'chene@fbcranes.co.za',
    reminderDays: [60, 30, 14, 7],
    time: '07:00',
    timezone: 'Africa/Johannesburg'
  }
}

function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now)
}

function reminderMessage(document, today) {
  const days = Math.round((Date.parse(document.expiry_date) - Date.parse(today)) / DAY)
  const status = days < 0 ? `expired ${-days} day(s) ago` : days === 0 ? 'expires today' : `expires in ${days} day(s)`
  return {
    subject: `ATEC company certificate ${days < 0 ? 'expired' : 'expiry reminder'}: ${document.title}`,
    text: `Hi Chene,\n\n${document.title} ${status}.\nValid until: ${document.expiry_date}\nReference: ${document.reference_number || '-'}\nIssuer: ${document.issuing_authority || '-'}\n\nPlease arrange renewal and update the company Compliance Documents library in ATEC. Archive the superseded document when its replacement is published.\n\nReminders are scheduled at 60, 30, 14 and 7 days before expiry, with one further alert after expiry.\n\nATEC Inspection Platform`
  }
}

async function dueDocuments(db, config, today) {
  const result = await db.query(`
    SELECT d.compliancedocumentid, d.title, d.reference_number, d.issuing_authority,
      to_char(d.expiry_date, 'YYYY-MM-DD') AS expiry_date,
      CASE WHEN d.expiry_date < $1::date THEN 'EXPIRED'
        ELSE 'DAYS_' || (d.expiry_date - $1::date)::text END AS phase
    FROM atec.tblcompliancedocument d
    WHERE d.status = 'PUBLISHED' AND d.expiry_date IS NOT NULL
      AND (d.expiry_date < $1::date OR (d.expiry_date - $1::date) = ANY($2::integer[]))
      AND NOT EXISTS (
        SELECT 1 FROM atec.tblcomplianceexpiryreminder r
        WHERE r.compliancedocumentid = d.compliancedocumentid
          AND r.expiry_date = d.expiry_date AND r.recipient = $3
          AND (r.status = 'PENDING' OR r.phase = CASE WHEN d.expiry_date < $1::date THEN 'EXPIRED'
            ELSE 'DAYS_' || (d.expiry_date - $1::date)::text END)
      )
    ORDER BY d.expiry_date, d.compliancedocumentid`,
  [today, config.reminderDays, config.recipient])
  return result.rows
}

async function preview(pool, env = process.env, now = new Date()) {
  const config = ruleConfig(env)
  const today = localDate(now)
  const documents = await dueDocuments(pool, config, today)
  return { ...config, documents: documents.map(doc => ({ ...doc, ...reminderMessage(doc, today) })) }
}

async function runReminders({ pool, sendEmail, env = process.env, now = new Date() }) {
  const config = ruleConfig(env)
  if (!config.enabled) return { skipped: 'disabled' }
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23'
  }).format(now))
  if (hour < 7) return { skipped: 'before 07:00 SAST' }
  const db = await pool.connect()
  let locked = false
  let releaseError
  try {
    locked = (await db.query('SELECT pg_try_advisory_lock(9282026, 1) AS locked')).rows[0].locked
    if (!locked) return { skipped: 'another worker is running' }
    const today = localDate(now)
    const documents = await dueDocuments(db, config, today)
    let sent = 0
    for (const document of documents) {
      // Autocommit this reservation BEFORE external delivery. Ambiguous attempts
      // remain PENDING for manual reconciliation rather than risking duplicate mail.
      const attempt = await db.query(`
        INSERT INTO atec.tblcomplianceexpiryreminder
          (compliancedocumentid, expiry_date, recipient, phase)
        SELECT compliancedocumentid, expiry_date, $3, $4
        FROM atec.tblcompliancedocument
        WHERE compliancedocumentid = $1 AND expiry_date = $2::date AND status = 'PUBLISHED'
        RETURNING reminderid`,
      [document.compliancedocumentid, document.expiry_date, config.recipient, document.phase])
      if (!attempt.rows.length) continue
      await sendEmail({ from: env.MAIL_FROM || env.GRAPH_SENDER, to: config.recipient, ...reminderMessage(document, today) })
      await db.query("UPDATE atec.tblcomplianceexpiryreminder SET status = 'SENT', sent_at = now() WHERE reminderid = $1", [attempt.rows[0].reminderid])
      sent++
    }
    return { sent }
  } finally {
    try {
      if (locked) await db.query('SELECT pg_advisory_unlock(9282026, 1)')
    } catch (error) {
      releaseError = error
      throw error
    } finally {
      db.release(releaseError)
    }
  }
}

function startReminders(options) {
  if (!ruleConfig(options.env).enabled) return
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runReminders(options)
    } catch (error) {
      options.onError(error)
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, 5 * 60 * 1000)
  timer.unref()
  return timer
}

module.exports = { ruleConfig, localDate, reminderMessage, dueDocuments, preview, runReminders, startReminders }
