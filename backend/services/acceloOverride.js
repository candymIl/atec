function acceloOverride(user, body, readiness) {
  if (body?.force !== true) return null
  const fail = (message, statusCode) => { throw Object.assign(new Error(message), {statusCode}) }
  if (user?.role !== 'ADMIN') fail('Only an Admin can force-send a package.', 403)
  if (!['APPROVED','INVOICED'].includes(readiness.card.status) || !readiness.recipient) {
    fail('Approve the job card and enter a valid Accelo job number before sending.', 409)
  }
  const reason = String(body.reason || '').trim()
  if (reason.length < 5 || reason.length > 1000) fail('Enter an override reason between 5 and 1000 characters.', 400)
  return {reason, issues:readiness.issues, actor_user_id:user.user_id}
}
module.exports = {acceloOverride}
