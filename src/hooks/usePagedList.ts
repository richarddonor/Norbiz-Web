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
  /** Global Filter ("Search all") term. When non-empty the hook fetches EVERY row
   * matching the column `filters` (up to `SEARCH_ALL_LIMIT`), narrows them
   * client-side via `searchText`, and re-paginates the result — so pages and
   * totals reflect search + column filters together. Changing only the term
   * never refetches. */
  search?: string
  /** per-column filter values, keyed by the backend's filter query param name — sent to the server on every fetch */
  filters?: Record<string, string>
  /** lowercase blob of every searchable field on the item, including columns the user has hidden */
  searchText?: (item: T) => string
  onError?: () => void
  /** `false` skips fetching — a page rendered in a record tab doesn't need its list. */
  enabled?: boolean
}

/** Most rows "Search all" will pull into the browser. Above this it refuses and
 * asks the user to narrow the column filters first. */
export const SEARCH_ALL_LIMIT = 50000

/** State of the Global Filter's full-set fetch, for `GlobalSearch` to report. */
export interface SearchAllStatus {
  /** a search term is applied */
  active: boolean
  /** rows matching the column filters that were searched (or would be, when `tooMany`) */
  scanned: number
  /** the column-filtered set exceeds `SEARCH_ALL_LIMIT`; the search wasn't run */
  tooMany: boolean
  loading: boolean
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
 * real server-side pagination — changing a filter refetches. A non-empty
 * `search` switches to "search all" mode: every row matching the column filters
 * is fetched once (refused above `SEARCH_ALL_LIMIT`), narrowed client-side via
 * `searchText`, and paginated client-side, so `items`/`totalPages`/
 * `totalElements` describe the searched set. */
export function usePagedList<T>(endpoint: string, options?: Options<T>) {
  const pageSize = options?.pageSize ?? 50
  const search = options?.search ?? ''
  const filters = options?.filters ?? EMPTY_FILTERS
  const filtersKey = JSON.stringify(filters)
  const term = search.trim().toLowerCase()
  const searching = term !== ''

  const [page, setPage] = useState(1)
  const [pagedResult, setPagedResult] = useState<PageResponse<T> | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  // Full column-filtered set for "search all"; `tooMany` holds the count when refused.
  const [fullSet, setFullSet] = useState<{ rows: T[]; tooMany: number | null } | null>(null)
  const enabled = options?.enabled ?? true
  const base = endpointBase(endpoint)

  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent<string>).detail === base) setReloadToken(t => t + 1)
    }
    listChanges.addEventListener('change', onChange)
    return () => listChanges.removeEventListener('change', onChange)
  }, [base])

  // Reset to page 1 whenever the filters or the search term change — adjusted
  // during render (this hook's established pattern) instead of an effect.
  const [prevKey, setPrevKey] = useState(filtersKey + '\u0000' + term)
  if (filtersKey + '\u0000' + term !== prevKey) {
    setPrevKey(filtersKey + '\u0000' + term)
    if (page !== 1) setPage(1)
  }

  // Normal mode: one backend page.
  useEffect(() => {
    if (!enabled || searching) return
    Promise.resolve()
      .then(() => setLoading(true))
      .then(() => apiFetch<PageResponse<T>>(buildQuery(endpoint, page, pageSize, filters)))
      .then(setPagedResult)
      .catch(() => options?.onError?.())
      .finally(() => setLoading(false))
  }, [endpoint, page, pageSize, filtersKey, reloadToken, enabled, searching])

  // Search-all mode: every row matching the column filters, fetched once per
  // filter set / reload — typing a different term reuses it.
  useEffect(() => {
    if (!enabled || !searching) return
    let cancelled = false
    const qs = filtersToQueryString(filters)
    const url = qs ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}${qs}` : endpoint
    Promise.resolve()
      .then(() => { setLoading(true); setFullSet(null) })
      .then(async () => {
        const first = await apiFetch<PageResponse<T>>(buildQuery(url, 1, MAX_PAGE_SIZE, EMPTY_FILTERS))
        if (first.totalElements > SEARCH_ALL_LIMIT) return { rows: [], tooMany: first.totalElements }
        const rows = [...first.content]
        for (let p = 2; p <= first.totalPages; p++) {
          const next = await apiFetch<PageResponse<T>>(buildQuery(url, p, MAX_PAGE_SIZE, EMPTY_FILTERS))
          rows.push(...next.content)
          if (next.last || next.content.length === 0) break
        }
        return { rows, tooMany: null }
      })
      .then(result => { if (!cancelled) setFullSet(result) })
      .catch(() => { if (!cancelled) options?.onError?.() })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [endpoint, filtersKey, reloadToken, enabled, searching])

  const searchTextFn = options?.searchText

  const matches = useMemo(() => {
    if (!searching || !fullSet || fullSet.tooMany !== null) return null
    return fullSet.rows.filter(item => (searchTextFn?.(item) ?? '').toLowerCase().includes(term))
  }, [searching, fullSet, term, searchTextFn])

  const items = useMemo(() => {
    if (!searching) return pagedResult?.content ?? []
    if (!matches) return []
    return matches.slice((page - 1) * pageSize, page * pageSize)
  }, [searching, pagedResult, matches, page, pageSize])

  const searchAll: SearchAllStatus = {
    active: searching,
    scanned: fullSet ? (fullSet.tooMany ?? fullSet.rows.length) : 0,
    tooMany: searching && fullSet?.tooMany != null,
    loading: searching && loading,
  }

  return {
    items,
    page,
    setPage,
    totalPages: searching ? Math.max(1, Math.ceil((matches?.length ?? 0) / pageSize)) : pagedResult?.totalPages ?? 1,
    totalElements: searching ? matches?.length ?? 0 : pagedResult?.totalElements ?? 0,
    loading,
    searchAll,
    reload: () => listChanges.dispatchEvent(new CustomEvent('change', { detail: base })),
  }
}
