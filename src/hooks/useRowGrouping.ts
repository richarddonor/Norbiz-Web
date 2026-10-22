import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import type { ColumnDef } from '@/components/ColumnsMenu'
import type { ListTotals } from '@/hooks/usePagedList'

// Row grouping ("group by column") for list/report pages. The user picks one or more
// columns; rows nest into a group per distinct value of the first, then of the second
// within each of those, and so on — every level collapsible on its own.
//
//   const grouping = useRowGrouping(COLUMNS, 'brands')               // before usePagedList
//   usePagedList(…, { all: grouping.active })                        // groups span every row
//   const view = useGroupedRows(grouping, items, toRow)              // toRow = the export row
//
// `view.rows` is the flat list the table renders (`groupedRows`) and the arrow keys walk
// (`useListKeyboardNav({ …, view })`).
//
// The grouped columns are the user's preference for that list (`/me/preferences/list.groupBy:<key>`,
// a JSON array of column keys, outermost first), saved on every change like rows-per-page, with a
// per-user localStorage copy so the page opens grouped before the request answers. Which groups
// are expanded isn't saved.

export interface GroupDisplayRow {
  type: 'group'
  /** unique path of this group: its ancestors' values plus its own */
  key: string
  /** the enclosing group's key, null at the top level */
  parentKey: string | null
  /** nesting level, 0 = outermost */
  depth: number
  columnKey: string
  columnLabel: string
  /** the grouped value as shown, '' for blank */
  value: string
  /** rows in this group, across every nested level */
  count: number
  /** subtotal of each `total` column, keyed by column key */
  sums: Record<string, number>
  expanded: boolean
}

export interface ItemDisplayRow<T> {
  type: 'item'
  item: T
  parentKey: string | null
  depth: number
}

export type DisplayRow<T> = GroupDisplayRow | ItemDisplayRow<T>

export interface RowGrouping {
  columns: readonly ColumnDef[]
  /** grouped column keys, outermost first */
  groupBy: string[]
  /** at least one grouped column */
  active: boolean
  /** adds a column as the innermost level, or removes it */
  toggleColumn: (key: string) => void
  clear: () => void
  expanded: Set<string>
  setExpanded: (next: Set<string>) => void
}

interface UserPreference {
  key: string
  value: string
}

function preferencePath(listKey: string) {
  return `/me/preferences/${encodeURIComponent(`list.groupBy:${listKey}`)}`
}

function cacheKey(username: string | null, listKey: string) {
  return `list.groupBy:${listKey}:${username ?? ''}`
}

function parseKeys(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

function readCache(key: string): string[] {
  try {
    return parseKeys(localStorage.getItem(key))
  } catch {
    return []
  }
}

function writeCache(key: string, keys: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(keys))
  } catch { /* not cached */ }
}

/** Group-by state for a list page, saved as the user's preference for `listKey` (the page's
 * `useColumnVisibility` key). Call it before `usePagedList` and pass `all: grouping.active`. */
export function useRowGrouping(columns: readonly ColumnDef[], listKey: string): RowGrouping {
  const { username } = useAuth()
  const { toast } = useToast()
  const storeKey = cacheKey(username, listKey)
  const [selected, setSelected] = useState<string[]>(() => readCache(storeKey))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // Set once the user changes the grouping, so a slow preference fetch doesn't overwrite it.
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch<UserPreference | null>(preferencePath(listKey))
      .then(pref => {
        if (cancelled || !pref) return
        const keys = parseKeys(pref.value)
        writeCache(storeKey, keys)
        if (!touched) setSelected(keys)
      })
      .catch(() => { /* the cached copy stands */ })
    return () => { cancelled = true }
    // `touched` is only read to skip a stale answer; re-running on it would refetch after every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey, listKey])

  function save(next: string[]) {
    setSelected(next)
    setExpanded(new Set())
    setTouched(true)
    writeCache(storeKey, next)
    apiFetch<UserPreference>(preferencePath(listKey), {
      method: 'PUT',
      body: JSON.stringify({ value: JSON.stringify(next) }),
    }).catch(() => toast('Failed to save your grouping.', 'error'))
  }

  // A column can disappear (e.g. Company when the user switches company) — drop it.
  const groupBy = useMemo(
    () => selected.filter(key => columns.some(c => c.key === key && c.groupable !== false)),
    [selected, columns],
  )

  return {
    columns,
    groupBy,
    active: groupBy.length > 0,
    // Toggles act on the saved list, so a column hidden here (e.g. Company for a
    // one-company user) keeps its place for when it's back.
    toggleColumn: key => save(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]),
    clear: () => save([]),
    expanded,
    setExpanded,
  }
}

export interface GroupNode<T> {
  key: string
  columnKey: string
  value: string
  count: number
  sums: Record<string, number>
  children: GroupNode<T>[] | null
  items: T[]
}

const BLANK_VALUES = new Set(['', '—'])

function groupValue(col: ColumnDef, raw: unknown): string {
  if (raw == null) return ''
  const text = String(raw).trim()
  if (BLANK_VALUES.has(text)) return ''
  // Date-time columns group by day, not by minute.
  return col.type === 'date' ? text.slice(0, 10) : text
}

const NUMERIC = /^-?[\d,]+(\.\d+)?$/

/** A displayed amount/quantity (`listRow` value: a number, or text like `1,234.50`) as a number;
 * blank, `—` or anything non-numeric → null. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  return NUMERIC.test(text) ? Number(text.replace(/,/g, '')) : null
}

/** Sums each `total` column's displayed values over `rows` (`listRow` outputs). */
export function sumColumns(rows: Record<string, unknown>[], columns: readonly ColumnDef[]): Record<string, number> {
  const sums: Record<string, number> = {}
  for (const col of columns) {
    if (!col.total) continue
    let total: number | null = null
    for (const row of rows) {
      const n = toNumber(row[col.key])
      if (n !== null) total = (total ?? 0) + n
    }
    if (total !== null) sums[col.key] = total
  }
  return sums
}

/** Blanks last; numbers (including `#,##0.00`) by value; everything else naturally. */
function compareValues(a: string, b: string) {
  if (a === b) return 0
  if (a === '') return 1
  if (b === '') return -1
  if (NUMERIC.test(a) && NUMERIC.test(b)) return Number(a.replace(/,/g, '')) - Number(b.replace(/,/g, ''))
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function buildTree<T>(items: T[], values: Record<string, unknown>[], cols: ColumnDef[], level: number, parentKey: string, all: readonly ColumnDef[]): GroupNode<T>[] {
  const col = cols[level]
  const buckets = new Map<string, number[]>()
  values.forEach((row, i) => {
    const v = groupValue(col, row[col.key])
    const bucket = buckets.get(v)
    if (bucket) bucket.push(i)
    else buckets.set(v, [i])
  })
  return Array.from(buckets.keys()).sort(compareValues).map(value => {
    const idx = buckets.get(value)!
    const key = `${parentKey}\u0001${col.key}=${value}`
    const groupItems = idx.map(i => items[i])
    return {
      key,
      columnKey: col.key,
      value,
      count: idx.length,
      sums: sumColumns(idx.map(i => values[i]), all),
      items: groupItems,
      children: level + 1 < cols.length
        ? buildTree(groupItems, idx.map(i => values[i]), cols, level + 1, key, all)
        : null,
    }
  })
}

/** The group tree of `items` under `groupBy` (outermost first), groups ordered as on screen and
 * items keeping their order within each group. `values[i]` is `items[i]`'s displayed row. */
export function groupTree<T>(items: T[], values: Record<string, unknown>[], columns: readonly ColumnDef[], groupBy: readonly string[]): GroupNode<T>[] {
  const cols = groupBy.map(key => columns.find(c => c.key === key)!)
  return buildTree(items, values, cols, 0, '', columns)
}

function collectKeys<T>(nodes: GroupNode<T>[], into: string[]) {
  for (const n of nodes) {
    into.push(n.key)
    if (n.children) collectKeys(n.children, into)
  }
  return into
}

export interface GroupedView<T> {
  /** the page's columns (`useRowGrouping`'s) */
  columns: readonly ColumnDef[]
  rows: DisplayRow<T>[]
  /** grouping is on */
  grouped: boolean
  /** footer text for `Pagination`'s `summary` while grouped, else undefined */
  summary: string | undefined
  /** expands/collapses one group; `recursive` applies the same to every group nested in it */
  toggle: (key: string, recursive?: boolean) => void
  expandAll: () => void
  collapseAll: () => void
}

/** Lays `items` out under `grouping`'s groups. `toRow` maps an item to its displayed value per
 * column key — the page's export row — so a group's value reads exactly like the cell. */
export function useGroupedRows<T>(grouping: RowGrouping, items: T[], toRow: (item: T) => Record<string, unknown>): GroupedView<T> {
  const { columns, groupBy, expanded, setExpanded } = grouping

  const tree = useMemo(() => {
    if (groupBy.length === 0) return null
    return groupTree(items, items.map(toRow), columns, groupBy)
    // `toRow` is usually an inline closure; the rows only change with the items or the grouping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, groupBy, columns])

  const descendants = useMemo(() => {
    const map = new Map<string, string[]>()
    const walk = (nodes: GroupNode<T>[]) => {
      for (const n of nodes) {
        map.set(n.key, n.children ? collectKeys(n.children, []) : [])
        if (n.children) walk(n.children)
      }
    }
    if (tree) walk(tree)
    return map
  }, [tree])

  const rows = useMemo<DisplayRow<T>[]>(() => {
    if (!tree) return items.map(item => ({ type: 'item', item, parentKey: null, depth: 0 }))
    const out: DisplayRow<T>[] = []
    const label = (key: string) => columns.find(c => c.key === key)?.label ?? key
    const walk = (nodes: GroupNode<T>[], depth: number, parentKey: string | null) => {
      for (const n of nodes) {
        const open = expanded.has(n.key)
        out.push({ type: 'group', key: n.key, parentKey, depth, columnKey: n.columnKey, columnLabel: label(n.columnKey), value: n.value, count: n.count, sums: n.sums, expanded: open })
        if (!open) continue
        if (n.children) walk(n.children, depth + 1, n.key)
        else for (const item of n.items) out.push({ type: 'item', item, parentKey: n.key, depth: depth + 1 })
      }
    }
    walk(tree, 0, null)
    return out
  }, [tree, items, expanded, columns])

  function toggle(key: string, recursive = false) {
    const next = new Set(expanded)
    const keys = recursive ? [key, ...(descendants.get(key) ?? [])] : [key]
    if (expanded.has(key)) keys.forEach(k => next.delete(k))
    else keys.forEach(k => next.add(k))
    setExpanded(next)
  }

  const topGroups = tree?.length ?? 0
  return {
    columns,
    rows,
    grouped: tree !== null,
    summary: tree
      ? `${items.length.toLocaleString()} ${items.length === 1 ? 'row' : 'rows'} in ${topGroups.toLocaleString()} ${topGroups === 1 ? 'group' : 'groups'}`
      : undefined,
    toggle,
    expandAll: () => setExpanded(new Set(descendants.keys())),
    collapseAll: () => setExpanded(new Set()),
  }
}

/** The list's grand totals: summed from every loaded row while the full set is on the page
 * (grouped or searching — so they follow the search term), else the backend's (`usePagedList`'s
 * `totals` option). Null while loading. Pass `usePagedList`'s `allItems` and `totals`. */
export function useGrandTotals<T>(
  columns: readonly ColumnDef[],
  allItems: T[] | null,
  serverTotals: ListTotals | null,
  toRow: (item: T) => Record<string, unknown>,
): ListTotals | null {
  const clientTotals = useMemo(
    () => (allItems ? sumColumns(allItems.map(toRow), columns) : null),
    // `toRow` is usually an inline closure; the totals only change with the rows or the columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allItems, columns],
  )
  return clientTotals ?? serverTotals
}
