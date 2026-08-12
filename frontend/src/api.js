export const APP_BASE = import.meta.env.BASE_URL || '/'

function defaultApiBase() {
  if (import.meta.env.PROD) {
    return `${window.location.origin}/api`
  }

  return 'http://localhost:5000'
}

export const API_BASE = (import.meta.env.VITE_API_URL || defaultApiBase()).replace(/\/$/, '')

export function apiUrl(path = '') {
  if (!path) return API_BASE

  if (/^https?:\/\//i.test(path)) {
    return path.replace(/^http:\/\/localhost:5000/i, API_BASE)
  }

  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

export function assetUrl(path = '') {
  const cleanPath = String(path || '').replace(/^\/+/, '')
  return `${APP_BASE}${cleanPath}`
}

export function uploadUrl(path = '') {
  if (!path) return ''

  let cleanPath = String(path).trim()

  if (/^https?:\/\//i.test(cleanPath)) {
    return apiUrl(cleanPath)
  }

  if (!cleanPath.startsWith('/')) {
    cleanPath = cleanPath.startsWith('uploads/')
      ? `/${cleanPath}`
      : cleanPath.startsWith('assets/')
        ? `/uploads/${cleanPath}`
        : `/uploads/assets/${cleanPath}`
  }

  const encodedPath = encodeURI(cleanPath)

  return apiUrl(encodedPath)
}
