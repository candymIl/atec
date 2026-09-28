// Optional deployment identity; unset for the existing ATEC installation.
const workspaceLabel = String(import.meta.env.VITE_WORKSPACE_LABEL || '').trim()
const workspaceNotice = String(import.meta.env.VITE_WORKSPACE_NOTICE || '').trim()

if (workspaceLabel || workspaceNotice) {
  if (workspaceLabel) document.title = `${workspaceLabel} | ATEC`
  const banner = document.createElement('aside')
  banner.id = 'workspaceNotice'
  banner.setAttribute('aria-label', 'System environment')
  Object.assign(banner.style, {
    background: '#12345a', color: '#ffffff', padding: '12px 24px',
    fontSize: '14px', lineHeight: '1.5', textAlign: 'center'
  })
  const label = document.createElement('strong')
  label.textContent = workspaceLabel
  banner.append(label)
  if (workspaceNotice) banner.append(document.createTextNode(` — ${workspaceNotice}`))
  document.body.prepend(banner)
}
