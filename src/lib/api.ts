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

  if (!response.ok) throw await toApiError(response)

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

  if (!response.ok) throw await toApiError(response)

  return unwrap<T>(await response.text())
}

// Error code the backend sends (409) when a delete is blocked because other records still
// reference the record — details: { entity, entityId, referencedBy }.
export const ENTITY_IN_USE = 'ENTITY_IN_USE'

export interface EntityInUseDetails {
  entity?: string
  entityId?: number | string
  referencedBy?: string
}

// Thrown by apiFetch/apiUpload on any non-2xx. Still an Error, so callers that only read
// err.message (or ignore it and toast a generic message) are unaffected.
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: Record<string, unknown>
  readonly traceId?: string

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>, traceId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.traceId = traceId
  }
}

export function isEntityInUse(err: unknown): err is ApiError & { details?: EntityInUseDetails } {
  return err instanceof ApiError && err.code === ENTITY_IN_USE
}

/**
 * Toast text for a failed delete: the backend's explanation when the record is still in use
 * (or another 4xx with a message, e.g. access denied), otherwise the page's generic fallback —
 * a 5xx message ("An unexpected error occurred") says less than the fallback does.
 */
export function deleteErrorMessage(err: unknown, fallback: string): string {
  if (isEntityInUse(err)) {
    const referencedBy = err.details?.referencedBy
    return err.message || (referencedBy
      ? `It is still used by ${referencedBy} records and can't be deleted.`
      : "It is still used by other records and can't be deleted.")
  }
  if (err instanceof ApiError && err.status < 500 && err.message) return err.message
  return fallback
}

// Error code the backend sends (409) when posting or voiding an inventory transaction would take
// on-hand stock below zero — details: { shortfalls: InsufficientStockShortfall[] }.
export const INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK'

export interface InsufficientStockShortfall {
  itemId: number
  itemCode: string
  itemName: string
  warehouseId: number
  warehouseName: string
  available: number
  required: number
}

export function isInsufficientStock(err: unknown): err is ApiError & { details?: { shortfalls?: InsufficientStockShortfall[] } } {
  return err instanceof ApiError && err.code === INSUFFICIENT_STOCK
}

/**
 * Toast text for a failed post/void: the backend's explanation for any 4xx (validation, insufficient
 * stock, already loaded/voided, access denied), otherwise the page's generic fallback.
 */
export function mutationErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status < 500 && err.message) return err.message
  return fallback
}

// Backend wraps errors as AppErrorResponse { message, traceId?, code?, details? }.
async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed.message === 'string') {
      return new ApiError(parsed.message, response.status, parsed.code, parsed.details, parsed.traceId)
    }
  } catch {
    // Not JSON — fall through to the generic status message below
  }
  return new ApiError(`${response.status} ${response.statusText}`, response.status)
}