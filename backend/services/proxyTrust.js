function resolveProxyTrust(value) {
  const setting = String(value ?? '').trim()
  if (!setting || setting === 'false') return false
  if (setting === 'true') return 1
  if (/^\d+$/.test(setting)) return Number(setting)
  return setting
}
module.exports = { resolveProxyTrust }
