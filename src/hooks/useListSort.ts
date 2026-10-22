import { useCallback, useState } from 'react'
import type { ColumnDef } from '@/components/ColumnsMenu'

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

export interface ListSorting {
  sort: SortState | null
  isSortable: (key: string) => boolean
  /** a header click: ascending → descending → back to the default order */
  cycle: (key: string) => void
  /** `filters` plus the `sort` query param, for `usePagedList` and Export */
  apply: (filters: Record<string, string>) => Record<string, string>
}

/** Column sorting for a list page. Unsorted, the backend's default order applies: last updated
 * (transactions: last posted) first. Columns opt in with `sortable: true`; the sort is sent as the
 * `sort=<columnKey>,asc|desc` query param (the backend maps keys to fields), so it orders every
 * page, the search-all/grouped full set and the export alike. */
export function useListSort(columns: readonly ColumnDef[]): ListSorting {
  const [sort, setSort] = useState<SortState | null>(null)
  const active = sort && columns.some(c => c.key === sort.key && c.sortable) ? sort : null

  const isSortable = useCallback((key: string) => columns.some(c => c.key === key && c.sortable), [columns])

  return {
    sort: active,
    isSortable,
    cycle: key => setSort(prev =>
      prev?.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : null),
    apply: filters => (active ? { ...filters, sort: `${active.key},${active.dir}` } : filters),
  }
}
