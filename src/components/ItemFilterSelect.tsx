import { useEffect, useState } from 'react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { PageResponse } from '@/hooks/usePagedList'
import { apiFetch } from '@/lib/api'
import type { ItemLookupOption } from '@/lib/lookups'

const PAGE_SIZE = 50

interface Props {
  value: string
  onChange: (value: string) => void
  companyId: number | '' | null | undefined
  /** extra `/lookups/items` params, e.g. `{ activeOnly: 'false' }` */
  params?: Record<string, string>
  placeholder?: string
  className?: string
  disabled?: boolean
  onError?: () => void
}

/**
 * Item dropdown for list/report filter bars. A company can hold well over 100k items, so
 * unlike `useLookup` this never loads them all: it shows the first page and asks the
 * backend (`/lookups/items?q=`, matching code or name) for matches as the user types.
 * The selected item is kept as an option even when it isn't in the current results
 * (and fetched by id when it arrives preselected, e.g. from a drill-down URL).
 */
export function ItemFilterSelect({ value, onChange, companyId, params, placeholder = 'All items', className, disabled, onError }: Props) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query.trim(), 300)
  const [results, setResults] = useState<ItemLookupOption[]>([])
  const [selected, setSelected] = useState<ItemLookupOption | null>(null)
  const paramsKey = JSON.stringify(params ?? {})

  useEffect(() => {
    if (!companyId) { setResults([]); return }
    const qs = new URLSearchParams({ ...params, companyId: String(companyId), page: '1', size: String(PAGE_SIZE) })
    if (debouncedQuery) qs.set('q', debouncedQuery)
    let cancelled = false
    apiFetch<PageResponse<ItemLookupOption>>(`/lookups/items?${qs}`)
      .then(res => { if (!cancelled) setResults(res.content) })
      .catch(() => { if (!cancelled) onError?.() })
    return () => { cancelled = true }
    // params is compared by value (paramsKey); onError is an inline lambda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, debouncedQuery, paramsKey])

  // Resolve a preselected id that isn't among the loaded options.
  useEffect(() => {
    if (!value) { setSelected(null); return }
    if (selected && String(selected.id) === value) return
    const match = results.find(i => String(i.id) === value)
    if (match) { setSelected(match); return }
    let cancelled = false
    apiFetch<ItemLookupOption>(`/lookups/items/${value}`)
      .then(item => { if (!cancelled) setSelected(item) })
      .catch(() => { if (!cancelled) onError?.() })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const shown = selected && !results.some(i => i.id === selected.id) ? [selected, ...results] : results

  return (
    <SearchableSelect
      value={value}
      onChange={v => {
        setSelected(shown.find(i => String(i.id) === v) ?? null)
        onChange(v)
      }}
      options={shown.map(i => ({ value: String(i.id), label: `${i.code} — ${i.name}` }))}
      onQueryChange={setQuery}
      searchPlaceholder="Type item code or name…"
      placeholder={placeholder}
      className={className}
      disabled={disabled}
    />
  )
}
