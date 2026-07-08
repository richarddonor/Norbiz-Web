import { useMemo, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

export interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

interface Options<T> {
  pageSize?: number
  /** free-text search term — matched client-side, against only the rows already
   * loaded on the current page. Never triggers a request of its own. */
  search?: string
  /** per-column filter values, keyed by the backend's filter query param name — sent to the server on every fetch */
  filters?: Record<string, string>
  /** lowercase blob of every searchable field on the item, including columns the user has hidden */
  searchText?: (item: T) => string
  onError?: () => void
}

const EMPTY_FILTERS: Record<string, string> = {}

/** Serializes non-empty column filters into a query string — reused by
 * Export handlers so they fetch the same filtered set that's on screen. */
export function filtersToQueryString(filters: Record<string, string>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim()) params.set(key, value.trim())
  }
  return params.toString()
}

/** Builds the `page`/`size` + non-empty filter query params for a paginated endpoint. */
function buildQuery(endpoint: string, page: number, size: number, filters: Record<string, string>): string {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('size', String(size))
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim()) params.set(key, value.trim())
  }
  const sep = endpoint.includes('?') ? '&' : '?'
  return `${endpoint}${sep}${params.toString()}`
}

/** For reference/lookup lists (e.g. populating a dropdown) rather than a
 * paginated table — fetches one large page and returns just the content. */
export async function fetchAllContent<T>(endpoint: string, size = 500): Promise<T[]> {
  const sep = endpoint.includes('?') ? '&' : '?'
  const res = await apiFetch<PageResponse<T>>(`${endpoint}${sep}page=1&size=${size}`)
  return res.content
}

/** Fetches one page at a time from a paginated backend endpoint (1-indexed,
 * default size 50). Call `reload()` after create/update/delete instead of
 * patching the local array — the affected record may now sort onto a
 * different page.
 *
 * Column `filters` are sent to the backend as query params, composed with
 * real server-side pagination — changing a filter refetches. `search` never
 * refetches: it only narrows the rows already loaded on the current page
 * (client-side, via `searchText`), so pagination totals reflect the
 * filter-scoped result set, not the search-narrowed one. */
export function usePagedList<T>(endpoint: string, options?: Options<T>) {
  const pageSize = options?.pageSize ?? 50
  const search = options?.search ?? ''
  const filters = options?.filters ?? EMPTY_FILTERS
  const filtersKey = JSON.stringify(filters)

  const [page, setPage] = useState(1)
  const [pagedResult, setPagedResult] = useState<PageResponse<T> | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  // Reset to page 1 whenever the filters change — adjusted during render
  // (this hook's established pattern) instead of an effect. Search doesn't
  // reset the page: it never touches the backend, so there's nothing to re-fetch.
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey)
  if (filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey)
    if (page !== 1) setPage(1)
  }

  useEffect(() => {
    Promise.resolve()
      .then(() => setLoading(true))
      .then(() => apiFetch<PageResponse<T>>(buildQuery(endpoint, page, pageSize, filters)))
      .then(setPagedResult)
      .catch(() => options?.onError?.())
      .finally(() => setLoading(false))
  }, [endpoint, page, pageSize, filtersKey, reloadToken])

  const searchTextFn = options?.searchText
  const term = search.trim().toLowerCase()

  const items = useMemo(() => {
    const content = pagedResult?.content ?? []
    if (!term) return content
    return content.filter(item => (searchTextFn?.(item) ?? '').toLowerCase().includes(term))
  }, [pagedResult, term, searchTextFn])

  return {
    items,
    page,
    setPage,
    totalPages: pagedResult?.totalPages ?? 1,
    totalElements: pagedResult?.totalElements ?? 0,
    loading,
    reload: () => setReloadToken(t => t + 1),
  }
}
