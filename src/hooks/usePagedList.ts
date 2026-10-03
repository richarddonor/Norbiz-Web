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
  /** `false` skips fetching — a page rendered in a record tab doesn't need its list. */
  enabled?: boolean
}

const EMPTY_FILTERS: Record<string, string> = {}

// A save in a record tab has to refresh the list in the module tab, which is a
// different instance of the same page — so `reload()` is broadcast to every
// mounted list of that endpoint instead of only bumping its own instance.
const listChanges = new EventTarget()

function endpointBase(endpoint: string) {
  return endpoint.split('?')[0]
}

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

/** Backend hard cap on `size` (`spring.data.web.pageable.max-page-size`) — a larger
 * request is silently clamped, so never rely on one big page holding everything. */
const MAX_PAGE_SIZE = 1000

/** Fetches EVERY page of a paginated endpoint and returns the combined content —
 * used for spreadsheet export (all matching rows, not just the page on screen)
 * and for dropdown option lists. `size` is the per-request page size, capped at
 * the backend maximum. */
export async function fetchAllContent<T>(endpoint: string, size = MAX_PAGE_SIZE): Promise<T[]> {
  const pageSize = Math.min(size, MAX_PAGE_SIZE)
  const sep = endpoint.includes('?') ? '&' : '?'
  const all: T[] = []
  for (let page = 1; ; page++) {
    const res = await apiFetch<PageResponse<T>>(`${endpoint}${sep}page=${page}&size=${pageSize}`)
    all.push(...res.content)
    if (res.last || res.content.length === 0) return all
  }
}

/** Fetches one page at a time from a paginated backend endpoint (1-indexed,
 * default size 50). Call `reload()` after create/update/delete instead of
 * patching the local array — the affected record may now sort onto a
 * different page. `reload()` refreshes every mounted list of the same endpoint
 * (so calling it from a record tab refreshes the list tab too).
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
  const enabled = options?.enabled ?? true
  const base = endpointBase(endpoint)

  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent<string>).detail === base) setReloadToken(t => t + 1)
    }
    listChanges.addEventListener('change', onChange)
    return () => listChanges.removeEventListener('change', onChange)
  }, [base])

  // Reset to page 1 whenever the filters change — adjusted during render
  // (this hook's established pattern) instead of an effect. Search doesn't
  // reset the page: it never touches the backend, so there's nothing to re-fetch.
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey)
  if (filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey)
    if (page !== 1) setPage(1)
  }

  useEffect(() => {
    if (!enabled) return
    Promise.resolve()
      .then(() => setLoading(true))
      .then(() => apiFetch<PageResponse<T>>(buildQuery(endpoint, page, pageSize, filters)))
      .then(setPagedResult)
      .catch(() => options?.onError?.())
      .finally(() => setLoading(false))
  }, [endpoint, page, pageSize, filtersKey, reloadToken, enabled])

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
    reload: () => listChanges.dispatchEvent(new CustomEvent('change', { detail: base })),
  }
}
