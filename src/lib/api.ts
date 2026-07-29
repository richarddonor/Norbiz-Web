const API_BASE = import.meta.env.VITE_API_BASE as string

const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Backend wraps every JSON body in an envelope: { data: T }.
function unwrap<T>(text: string): T {
  if (!text) return undefined as T
  const parsed = JSON.parse(text)
  return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
}

function getToken() {
  return localStorage.getItem('auth_token')
}

function getActiveCompanyId() {
  return localStorage.getItem('active_company_id')
}

function getCsrfToken() {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('XSRF-TOKEN='))
    ?.split('=')[1]
}

function companyHeader(): Record<string, string> {
  const id = getActiveCompanyId()
  return id ? { 'X-Company-Id': id } : {}
}

export async function apiUpload<T>(url: string, file: File, fieldName = 'file'): Promise<T> {
  const token = getToken()
  const csrfToken = getCsrfToken()
  const form = new FormData()
  form.append(fieldName, file)

  const response = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    body: form,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { 'X-XSRF-TOKEN': csrfToken } : {}),
      ...companyHeader(),
      // No Content-Type — browser sets it with the multipart boundary
    },
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  return unwrap<T>(await response.text())
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
      ...companyHeader(),
      ...(options.headers ?? {}),
    },
  })

  if (!response.ok) {
    // Backend wraps errors as { message: string } (AppErrorResponse) — surface it when present,
    // existing callers that ignore err.message and just show a generic toast are unaffected.
    const text = await response.text()
    let parsedMessage: string | undefined
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed.message === 'string') parsedMessage = parsed.message
    } catch {
      // Not JSON — fall through to the generic status message below
    }
    throw new Error(parsedMessage ?? `${response.status} ${response.statusText}`)
  }

  return unwrap<T>(await response.text())
}