import { useState, type ReactNode } from 'react'
import { Plus, Eye, FileDown } from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/hooks/useContentFocus'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { useRowGrouping, useGroupedRows, useGrandTotals } from '@/hooks/useRowGrouping'
import { GroupByMenu, GrandTotalRow } from '@/components/RowGrouping'
import { groupedRows } from '@/components/groupedRows'
import { useListSort } from '@/hooks/useListSort'
import { SortableTh } from '@/components/SortableTh'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { ScrollTable, PINNED_TH, PINNED_TD } from '@/components/ScrollTable'
import { exportToXlsx } from '@/lib/exportXlsx'
import { defaultDateFilter } from '@/lib/dateRanges'
import { cn } from '@/lib/utils'

/** A list column: its `ColumnDef` plus how a row shows in it. */
export interface ListColumn<T> extends ColumnDef {
  /** The displayed text — also the export cell and what Group by groups on. */
  value: (row: T) => string
  /** Custom cell content (a badge…); defaults to `value`. */
  render?: (row: T) => ReactNode
  align?: 'right'
  mono?: boolean
  muted?: boolean
  /** Its column filter is sent to the backend (the column key is the query param). */
  filterable?: boolean
}

interface Props<T extends { id: number }> {
  title: string
  /** Backend list endpoint, e.g. `/customer-payments`. */
  endpoint: string
  /** Column-visibility / grouping storage key and export file name. */
  listKey: string
  columns: ListColumn<T>[]
  searchText: (row: T) => string
  onOpen: (row: T) => void
  /** Plural noun for the empty-state message ("customer payments"). */
  noun: string
  /** Filter-bar selects, placed before Reload. */
  toolbar?: ReactNode
  /** Query params the toolbar selects contribute (customerId…). */
  extraFilters?: Record<string, string>
  onCreate?: () => void
  /** Date column the list opens filtered to Last 30 Days; null for none. */
  defaultDateKey?: string | null
  /** The endpoint supports `totals=true` (columns with `total` get a Grand total). */
  totals?: boolean
  pinnedKey?: string
  /** Row buttons; defaults to an Eye that opens the row. */
  rowActions?: (row: T) => ReactNode
  /** Rows struck through in red (voided documents). */
  dimmed?: (row: T) => boolean
}

// The list half of an accounting record page (Sales Invoices, payments, memos, deposits…): the same toolbar,
// column filters, sorting, grouping, totals, export and keyboard navigation every list page has (docs/LIST_PAGES.md),
// driven by a column spec instead of hand-written <th>/<td> pairs. Render it only on the list tab.
export function AccountingList<T extends { id: number }>({
  title, endpoint, listKey, columns, searchText, onOpen, noun, toolbar, extraFilters, onCreate, defaultDateKey = 'date',
  totals = false, pinnedKey = 'referenceNumber', rowActions, dimmed,
}: Props<T>) {
  const { toast } = useToast()
  const { zone } = useContentFocus()
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>(() => defaultDateKey ? defaultDateFilter(defaultDateKey) : {})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const combined = { ...debouncedFilters, ...extraFilters }
  const isFiltering = !!debouncedSearch.trim() || Object.values(combined).some(v => v.trim())

  const grouping = useRowGrouping(columns, listKey)
  const sorting = useListSort(columns)
  const { items, page, setPage, pageSize, setPageSize, totalPages, totalElements, reload, loading, searchAll, allRows, allItems, totals: backendTotals } = usePagedList<T>(endpoint, {
    all: grouping.active,
    totals,
    onError: () => toast(`Failed to load ${noun}.`, 'error'),
    search: debouncedSearch,
    filters: sorting.apply(combined),
    searchText,
  })
  const { isVisible, menu: columnMenu } = useColumnVisibility(listKey)
  const visible = columns.filter(c => isVisible(c.key))

  const view = useGroupedRows(grouping, items, listRow)
  const grandTotals = useGrandTotals(columns, allItems, backendTotals, listRow)
  const { activeIndex, setActiveIndex } = useListKeyboardNav({ items, view, onView: onOpen, enabled: zone === 'content' })

  useHotkeys([
    { key: 'n', handler: () => onCreate?.() },
    { key: 'r', handler: () => reload() },
  ], zone === 'content')

  /** One row's displayed value per column key: the export row, and what grouping groups by. */
  function listRow(row: T) {
    return Object.fromEntries(columns.map(c => [c.key, c.value(row)]))
  }

  async function handleExport() {
    const qs = filtersToQueryString(sorting.apply(combined))
    const all = await fetchAllContent<T>(qs ? `${endpoint}?${qs}` : endpoint, 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(r => searchText(r).toLowerCase().includes(term)) : all
    exportToXlsx(listKey, visible, matching.map(listRow), grouping)
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <ReloadButton onReload={reload} loading={loading} />
          <ColumnsMenu columns={columns} {...columnMenu} />
          <GroupByMenu grouping={grouping} view={view} status={allRows} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          {onCreate && (
            <Button onClick={onCreate}>
              <Plus className="w-4 h-4" />
              New
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">N</kbd>
            </Button>
          )}
          <GlobalSearch value={search} onChange={setSearch} status={searchAll} />
        </div>
      </div>

      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable activeIndex={activeIndex}>
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {visible.map(c => (
                  <SortableTh key={c.key} sorting={sorting} column={c.key}
                    className={cn('py-2 px-4 font-medium', c.align === 'right' ? 'text-right' : 'text-left', c.key === pinnedKey && PINNED_TH)}>
                    {c.label}
                  </SortableTh>
                ))}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={columns}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => !!columns.find(c => c.key === key)?.filterable}
                pinnedKey={pinnedKey}
              />
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={visible.length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? `No ${noun} match your search/filters.` : `No ${noun} to display.`}
                  </td>
                </tr>
              ) : (
                groupedRows(view, { isVisible, activeIndex, onActivate: setActiveIndex }, (row, i) => (
                  <tr
                    key={row.id}
                    onClick={() => { setActiveIndex(i); onOpen(row) }}
                    data-active={i === activeIndex || undefined}
                    className={cn(
                      'group border-b border-[hsl(var(--border))] last:border-0 cursor-pointer bg-[hsl(var(--card))] hover:bg-[hsl(var(--secondary))] transition-colors',
                      dimmed?.(row) && 'row-voided',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {visible.map(c => (
                      <td key={c.key} className={cn(
                        'py-2 px-4',
                        c.align === 'right' && 'text-right tabular-nums',
                        c.mono && 'font-mono text-xs',
                        c.muted && 'text-[hsl(var(--muted-foreground))]',
                        c.key === pinnedKey && PINNED_TD,
                      )}>
                        {c.render ? c.render(row) : (c.value(row) || '—')}
                      </td>
                    ))}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      {rowActions ? rowActions(row) : (
                        <Button variant="ghost" size="sm" onClick={() => onOpen(row)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <GrandTotalRow columns={columns} isVisible={isVisible} totals={grandTotals} />
          </ScrollTable>
          <Pagination summary={view.summary} page={page} totalPages={totalPages} totalElements={totalElements} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </CardContent>
      </Card>
    </>
  )
}

/** "Voided" badge cell, as on the other transaction lists. */
export function VoidedBadge({ voided }: { voided: boolean }) {
  if (!voided) return null
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
      Voided
    </span>
  )
}
