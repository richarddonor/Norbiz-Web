const API_BASE = import.meta.env.VITE_API_BASE as string

const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function getToken() {
  return localStorage.getItem('auth_token')
}

function getCsrfToken() {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('XSRF-TOKEN='))
    ?.split('=')[1]
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const method = (options.method ?? 'GET').toUpperCase()
  const csrfToken = CSRF_METHODS.has(method) ? getCsrfToken() : undefined

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { 'X-XSRF-TOKEN': csrfToken } : {}),
      ...(options.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  return text ? (JSON.parse(text) as T) : (undefined as T)
}
