// Emails are contact/delivery addresses and may be shared. Never use row order
// or matching passwords to choose between employees.
function selectLoginUser(rows, identifier) {
  const key = String(identifier || '').trim().toLowerCase()
  const usernames = rows.filter(user => String(user.username || '').toLowerCase() === key)
  if (usernames.length) return usernames.length === 1 ? usernames[0] : null
  const emails = rows.filter(user => user.is_active === true && String(user.email || '').toLowerCase() === key)
  return emails.length === 1 ? emails[0] : null
}
module.exports = { selectLoginUser }
