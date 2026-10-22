import { useMemo, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePageSize, MAX_VIEW_PAGE_SIZE } from '@/hooks/usePageSize'

export interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  last: boolean
}

interface Options<T> {
  /** fixed rows per page; omit to use the user's rows-per-page preference for this list (`usePageSize`) */
  pageSize?: number
  /** identifies the list for its rows-per-page preference; defaults to the endpoint path
   * (`/reports/detailed/x` → `reports.detailed.x`). Set it when two pages share an endpoint. */
  pageSizeKey?: string
  /** Global Filter ("Search all") term. When non-empty the hook fetches EVERY row
   * matching the column `filters` (up to `SEARCH_ALL_LIMIT`), narrows them
   * client-side via `searchText`, and re-paginates the result — so pages and
   * totals reflect search + column filters together. Changing only the term
   * never refetches. */
  search?: string
  /** Load every row matching the column `filters` (and `search`) onto one page — the same
   * full-set fetch as "search all", refused above `SEARCH_ALL_LIMIT`. Row grouping
   * (`useRowGrouping`) turns it on, since groups have to span every page. */
  all?: boolean
  /** Fetch the grand totals of the amount/quantity columns over every row matching the filters
   * (`totals=true`, once per filter set — see the backend's docs/LIST_FILTERING.md → Totals).
   * Only for endpoints that support it. While the full set is loaded (`all`/search) the hook
   * doesn't fetch them: the page sums `allItems` itself, so the totals follow the search term. */
  totals?: boolean
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

/** Grand totals keyed by column key, or `'too-many'` when more rows match than the backend will
 * total in Java (its `ListTotals.LIMIT`, 50000) — the footer then asks to narrow the filters. */
export type ListTotals = Record<string, number> | 'too-many'

/** State of the `all` option's full-set fetch, for `GroupByMenu` to report. */
export interface AllRowsStatus {
  active: boolean
  /** rows matching the column filters when that exceeds `SEARCH_ALL_LIMIT` (nothing was loaded), else null */
  tooMany: number | null
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

/** `/reports/detailed/x` → `reports.detailed.x` — a valid user-preference key segment. */
function listKeyFor(endpoint: string) {
  return endpointBase(endpoint).replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9._-]+/g, '.')
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
 * size = the user's rows-per-page preference for this list, default 50, capped at
 * `MAX_VIEW_PAGE_SIZE`; `setPageSize` changes and saves it). Call `reload()` after create/update/delete instead of
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
  const [preferredPageSize, setPageSize] = usePageSize(options?.pageSizeKey ?? listKeyFor(endpoint))
  const pageSize = Math.min(options?.pageSize ?? preferredPageSize, MAX_VIEW_PAGE_SIZE)
  const search = options?.search ?? ''
  const filters = options?.filters ?? EMPTY_FILTERS
  const filtersKey = JSON.stringify(filters)
  const term = search.trim().toLowerCase()
  const searching = term !== ''
  const all = options?.all ?? false
  // Search-all and all-rows modes share one full-set fetch.
  const fullMode = searching || all

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

  // When the page size changes, move to the page that still shows the first row
  // that was on screen — adjusted during render, like the filter reset below.
  const [prevPageSize, setPrevPageSize] = useState(pageSize)
  if (pageSize !== prevPageSize) {
    setPrevPageSize(pageSize)
    setPage(Math.floor(((page - 1) * prevPageSize) / pageSize) + 1)
  }

  // Reset to page 1 whenever the filters or the search term change — adjusted
  // during render (this hook's established pattern) instead of an effect.
  const [prevKey, setPrevKey] = useState(filtersKey + '\u0000' + term)
  if (filtersKey + '\u0000' + term !== prevKey) {
    setPrevKey(filtersKey + '\u0000' + term)
    if (page !== 1) setPage(1)
  }

  // Normal mode: one backend page.
  useEffect(() => {
    if (!enabled || fullMode) return
    Promise.resolve()
      .then(() => setLoading(true))
      .then(() => apiFetch<PageResponse<T>>(buildQuery(endpoint, page, pageSize, filters)))
      .then(setPagedResult)
      .catch(() => options?.onError?.())
      .finally(() => setLoading(false))
  }, [endpoint, page, pageSize, filtersKey, reloadToken, enabled, fullMode])

  // Grand totals: one tiny request per filter set (the sort doesn't change them), only when the
  // page isn't holding the full set itself.
  const [serverTotals, setServerTotals] = useState<ListTotals | null>(null)
  const wantTotals = enabled && (options?.totals ?? false) && !fullMode
  const totalsFilters = Object.fromEntries(Object.entries(filters).filter(([key]) => key !== 'sort'))
  const totalsKey = JSON.stringify(totalsFilters)
  useEffect(() => {
    if (!wantTotals) return
    let cancelled = false
    Promise.resolve()
      .then(() => setServerTotals(null))
      .then(() => apiFetch<PageResponse<T> & { totals?: Record<string, number>; totalsTooMany?: boolean }>(`${buildQuery(endpoint, 1, 1, totalsFilters)}&totals=true`))
      .then(res => { if (!cancelled) setServerTotals(res.totalsTooMany ? 'too-many' : res.totals ?? {}) })
      .catch(() => { if (!cancelled) options?.onError?.() })
    return () => { cancelled = true }
  }, [endpoint, totalsKey, reloadToken, wantTotals])

  // Search-all / all-rows mode: every row matching the column filters, fetched once
  // per filter set / reload — typing a different term reuses it.
  useEffect(() => {
    if (!enabled || !fullMode) return
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
  }, [endpoint, filtersKey, reloadToken, enabled, fullMode])

  const searchTextFn = options?.searchText

  const matches = useMemo(() => {
    if (!fullMode || !fullSet || fullSet.tooMany !== null) return null
    if (!searching) return fullSet.rows
    return fullSet.rows.filter(item => (searchTextFn?.(item) ?? '').toLowerCase().includes(term))
  }, [fullMode, searching, fullSet, term, searchTextFn])

  const items = useMemo(() => {
    if (!fullMode) return pagedResult?.content ?? []
    if (!matches) return []
    if (all) return matches
    return matches.slice((page - 1) * pageSize, page * pageSize)
  }, [fullMode, all, pagedResult, matches, page, pageSize])

  const searchAll: SearchAllStatus = {
    active: searching,
    scanned: fullSet ? (fullSet.tooMany ?? fullSet.rows.length) : 0,
    tooMany: searching && fullSet?.tooMany != null,
    loading: searching && loading,
  }

  const allRows: AllRowsStatus = {
    active: all,
    tooMany: all && fullSet?.tooMany != null ? fullSet.tooMany : null,
    loading: all && loading,
  }

  return {
    items,
    page: all ? 1 : page,
    setPage,
    pageSize,
    setPageSize,
    totalPages: all ? 1 : searching ? Math.max(1, Math.ceil((matches?.length ?? 0) / pageSize)) : pagedResult?.totalPages ?? 1,
    totalElements: fullMode ? matches?.length ?? 0 : pagedResult?.totalElements ?? 0,
    loading,
    searchAll,
    allRows,
    /** every row matching the filters and search term while the full set is loaded, else null */
    allItems: matches,
    /** server grand totals keyed by column key (`totals` option, not while the full set is loaded) */
    totals: wantTotals ? serverTotals : null,
    reload: () => listChanges.dispatchEvent(new CustomEvent('change', { detail: base })),
  }
}
