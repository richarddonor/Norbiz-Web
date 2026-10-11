import { useEffect, useState } from 'react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { PageResponse } from '@/hooks/usePagedList'
import { apiFetch } from '@/lib/api'

const PAGE_SIZE = 50

// Options resolved by id (`/lookups/<path>/<id>`) or seen in search results, keyed `path/id`.
// Only used to label a selected value; `onChange` always hands over the fresh search row.
const byIdCache = new Map<string, unknown>()
const byIdInFlight = new Map<string, Promise<unknown>>()

function fetchById<T>(path: string, id: string): Promise<T> {
  const key = `${path}/${id}`
  if (byIdCache.has(key)) return Promise.resolve(byIdCache.get(key) as T)
  let pending = byIdInFlight.get(key)
  if (!pending) {
    pending = apiFetch<T>(`/lookups/${key}`)
      .then(row => { byIdCache.set(key, row); return row })
      .finally(() => byIdInFlight.delete(key))
    byIdInFlight.set(key, pending)
  }
  return pending as Promise<T>
}

export interface LookupSelectProps<T extends { id: number }> {
  /** `/lookups/<path>`, e.g. `items` */
  path: string
  companyId: number | '' | null | undefined
  /** extra lookup params, e.g. `{ tag: 'INVENTORY' }` */
  params?: Record<string, string>
  value: string
  /** `option` is the picked row (null when cleared), so forms can prefill from it (e.g. cost price). */
  onChange: (value: string, option: T | null) => void
  getLabel: (option: T) => string
  id?: string
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  autoFocus?: boolean
  onError?: () => void
}

/**
 * Type-ahead dropdown for lookups too large to load whole (items run past 100k per company).
 * Unlike `useLookup`, it fetches nothing until opened, then asks the backend for the first
 * page of matches (`/lookups/<path>?q=`, contains over code/name) as the user types. The
 * selected value is kept as an option even when it isn't in the current results, and is
 * resolved by id (`/lookups/<path>/<id>`) when it arrives preselected (prefilled lines,
 * drill-down URLs).
 */
export function LookupSelect<T extends { id: number }>({
  path, companyId, params, value, onChange, getLabel, id, placeholder, searchPlaceholder, className, disabled, autoFocus, onError,
}: LookupSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query.trim(), 250)
  const [results, setResults] = useState<{ key: string; rows: T[] } | null>(null)
  const [selected, setSelected] = useState<T | null>(null)
  const paramsKey = JSON.stringify(params ?? {})
  const searchKey = companyId ? `${path}|${companyId}|${paramsKey}|${debouncedQuery}` : null

  // Refetches on every open too, so records created in another tab show up.
  useEffect(() => {
    if (!open || !searchKey) return
    const qs = new URLSearchParams({ ...params, companyId: String(companyId), page: '1', size: String(PAGE_SIZE) })
    if (debouncedQuery) qs.set('q', debouncedQuery)
    let cancelled = false
    apiFetch<PageResponse<T>>(`/lookups/${path}?${qs}`)
      .then(res => {
        if (cancelled) return
        for (const row of res.content) byIdCache.set(`${path}/${row.id}`, row)
        setResults({ key: searchKey, rows: res.content })
      })
      .catch(() => { if (!cancelled) onError?.() })
    return () => { cancelled = true }
    // params is compared by value (searchKey); onError is an inline lambda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchKey])

  // Resolve a preselected id that isn't among the loaded options.
  useEffect(() => {
    if (!value) { setSelected(null); return }
    if (selected && String(selected.id) === value) return
    let cancelled = false
    fetchById<T>(path, value)
      .then(row => { if (!cancelled) setSelected(row) })
      .catch(() => { if (!cancelled) onError?.() })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, path])

  // Previous results stay visible (filtered client-side) while the next query loads.
  const rows = companyId && results ? results.rows : []
  const loading = open && results?.key !== searchKey
  const shown = selected && String(selected.id) === value && !rows.some(r => r.id === selected.id) ? [selected, ...rows] : rows

  return (
    <SearchableSelect
      id={id}
      value={value}
      onChange={v => {
        const option = shown.find(r => String(r.id) === v) ?? null
        setSelected(option)
        onChange(v, option)
      }}
      options={shown.map(r => ({ value: String(r.id), label: getLabel(r) }))}
      onQueryChange={setQuery}
      onOpenChange={setOpen}
      loading={loading}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      className={className}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  )
}
