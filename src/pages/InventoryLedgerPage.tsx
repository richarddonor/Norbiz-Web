import { useState, useMemo } from 'react'
import { FileDown } from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useContentFocus } from '@/hooks/useContentFocus'
import { useTabInstance, useIsDrillDown } from '@/context/WorkspaceContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ItemFilterSelect } from '@/components/ItemFilterSelect'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useTransactionDrillDown, sourceTransactionType } from '@/hooks/useTransactionDrillDown'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useLookup, type LookupOption } from '@/lib/lookups'
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
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { defaultDateFilter } from '@/lib/dateRanges'

interface Movement {
  id: number
  companyId: number
  companyName: string
  itemId: number
  itemCode: string
  itemName: string
  warehouseId: number
  warehouseName: string
  quantityDelta: string
  transitQuantityDelta: string
  movementDate: string
  sourceType: string
  sourceId: number
  referenceNumber: string | null
  sheetNumber: string | null
  notes: string | null
  createdAt: string | null
  createdBy: string | null
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true })
  columns.push(
    { key: 'warehouse', label: 'Warehouse', sortable: true },
    { key: 'itemCode', label: 'Item Code', sortable: true },
    { key: 'itemName', label: 'Item Name', sortable: true },
    { key: 'sourceType', label: 'Source Type', sortable: true },
    { key: 'referenceNumber', label: 'Reference #', sortable: true },
    { key: 'sheetNumber', label: 'Sheet #', sortable: true },
    { key: 'quantityDelta', label: 'Quantity Δ', sortable: true, total: 'quantity' },
    { key: 'transitQuantityDelta', label: 'Transit Quantity Δ', sortable: true, total: 'quantity' },
    { key: 'date', label: 'Posting Date', sortable: true, type: 'date' },
    { key: 'createdBy', label: 'Posted By', sortable: true },
    { key: 'notes', label: 'Notes', sortable: true },
  )
  return columns
}

function movementSearchText(m: Movement): string {
  return [m.itemCode, m.itemName, m.warehouseName, m.companyName, m.sourceType, m.referenceNumber ?? '', m.sheetNumber ?? '', m.notes ?? '', m.createdBy ?? '', formatDate(m.movementDate)].join(' ')
}

/** Filters a drill-down hands over in the URL (`?warehouseId=&itemId=&dateFrom=&dateTo=`),
 * e.g. from an Inventory Balance row. Only read on mount; a drill-down tab keeps them locked.
 * Without any, the ledger opens limited to Last 30 Days. */
function initialFilters(search: string) {
  const params = new URLSearchParams(search)
  if (params.size === 0) return { warehouseId: '', itemId: '', date: defaultDateFilter() }
  const date: Record<string, string> = {}
  for (const key of ['dateFrom', 'dateTo']) {
    const value = params.get(key)
    if (value) date[key] = value
  }
  return { warehouseId: params.get('warehouseId') ?? '', itemId: params.get('itemId') ?? '', date }
}

export function InventoryLedgerPage() {
  const { toast } = useToast()
  const { showCompanyColumn, activeCompanyId } = useAuth()
  const { zone } = useContentFocus()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const { location } = useTabInstance()
  const [initial] = useState(() => initialFilters(location.search))
  const drilledDown = useIsDrillDown()

  const [search, setSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId)
  const [itemId, setItemId] = useState(initial.itemId)
  const [filters, setFilters] = useState<Record<string, string>>(initial.date)
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || !!warehouseId || !!itemId || Object.values(debouncedFilters).some(v => v.trim())

  const combinedFilters = { ...debouncedFilters, warehouseId, itemId }
  const grouping = useRowGrouping(COLUMNS, 'inventory-ledger')
  const sorting = useListSort(COLUMNS)
  const { items: movements, page, setPage, pageSize, setPageSize, totalPages, totalElements, loading: listLoading, reload, searchAll, allRows, allItems, totals } = usePagedList<Movement>('/inventory-movements', {
    all: grouping.active,
    totals: true,
    onError: () => toast('Failed to load inventory ledger.', 'error'),
    search: debouncedSearch,
    filters: sorting.apply(combinedFilters),
    searchText: movementSearchText,
  })
  // Filter-bar options for the session's active company.
  const warehouses = useLookup<LookupOption>('warehouses', activeCompanyId, { onError: () => toast('Failed to load warehouses.', 'error') })
  const { isVisible, menu: columnMenu } = useColumnVisibility('inventory-ledger')
  const resolveDisplayName = useUserDisplayNames()
  const drillDown = useTransactionDrillDown()
  const openSource = (m: Movement) => drillDown.open(sourceTransactionType(m.sourceType), m.sourceId)

  const view = useGroupedRows(grouping, movements, listRow)
  const grandTotals = useGrandTotals(COLUMNS, allItems, totals, listRow)
  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: movements,
    view,
    onView: openSource,
    enabled: zone === 'content',
  })

  useHotkeys([
    { key: 'r', handler: () => reload() },
  ], zone === 'content')

  /** One row's displayed value per column key: the export row, and what grouping groups by. */
  function listRow(m: Movement) {
    return {
      company: m.companyName,
      warehouse: m.warehouseName,
      itemCode: m.itemCode,
      itemName: m.itemName,
      sourceType: m.sourceType,
      referenceNumber: m.referenceNumber ?? '',
      sheetNumber: m.sheetNumber ?? '',
      quantityDelta: m.quantityDelta,
      transitQuantityDelta: m.transitQuantityDelta,
      date: formatDate(m.movementDate),
      createdBy: resolveDisplayName(m.createdBy),
      notes: m.notes ?? '',
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(sorting.apply(combinedFilters))
    const all = await fetchAllContent<Movement>(qs ? `/inventory-movements?${qs}` : '/inventory-movements', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(m => movementSearchText(m).toLowerCase().includes(term)) : all
    const rows = matching.map(listRow)
    exportToXlsx('inventory-ledger', COLUMNS.filter(c => isVisible(c.key)), rows, grouping)
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Inventory Ledger</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map(w => ({ value: String(w.id), label: w.name }))}
            placeholder="All warehouses"
            disabled={drilledDown}
            className="w-44"
          />
          <ItemFilterSelect
            value={itemId}
            onChange={setItemId}
            companyId={activeCompanyId}
            onError={() => toast('Failed to load items.', 'error')}
            placeholder="All items"
            disabled={drilledDown}
            className="w-52"
          />
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} {...columnMenu} />
          <GroupByMenu grouping={grouping} view={view} status={allRows} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          <GlobalSearch value={search} onChange={setSearch} status={searchAll} />
        </div>
      </div>

      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable activeIndex={activeIndex}>
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {showCompanyColumn && isVisible('company') && <SortableTh sorting={sorting} column="company" className="text-left py-2 px-4 font-medium">Company</SortableTh>}
                {isVisible('warehouse') && <SortableTh sorting={sorting} column="warehouse" className="text-left py-2 px-4 font-medium">Warehouse</SortableTh>}
                {isVisible('itemCode') && <SortableTh sorting={sorting} column="itemCode" className="text-left py-2 px-4 font-medium">Item Code</SortableTh>}
                {isVisible('itemName') && <SortableTh sorting={sorting} column="itemName" className={cn('text-left py-2 px-4 font-medium', PINNED_TH)}>Item Name</SortableTh>}
                {isVisible('sourceType') && <SortableTh sorting={sorting} column="sourceType" className="text-left py-2 px-4 font-medium">Source Type</SortableTh>}
                {isVisible('referenceNumber') && <SortableTh sorting={sorting} column="referenceNumber" className="text-left py-2 px-4 font-medium">Reference #</SortableTh>}
                {isVisible('sheetNumber') && <SortableTh sorting={sorting} column="sheetNumber" className="text-left py-2 px-4 font-medium">Sheet #</SortableTh>}
                {isVisible('quantityDelta') && <SortableTh sorting={sorting} column="quantityDelta" className="text-right py-2 px-4 font-medium">Quantity Δ</SortableTh>}
                {isVisible('transitQuantityDelta') && <SortableTh sorting={sorting} column="transitQuantityDelta" className="text-right py-2 px-4 font-medium">Transit Quantity Δ</SortableTh>}
                {isVisible('date') && <SortableTh sorting={sorting} column="date" className="text-left py-2 px-4 font-medium">Posting Date</SortableTh>}
                {isVisible('createdBy') && <SortableTh sorting={sorting} column="createdBy" className="text-left py-2 px-4 font-medium">Posted By</SortableTh>}
                {isVisible('notes') && <SortableTh sorting={sorting} column="notes" className="text-left py-2 px-4 font-medium">Notes</SortableTh>}
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key === 'date'}
                disabled={drilledDown}
                pinnedKey="itemName"
                actions={false}
              />
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No ledger entries match your search/filters.' : 'No inventory movements to display.'}
                  </td>
                </tr>
              ) : (
                groupedRows(view, { isVisible, activeIndex, onActivate: setActiveIndex }, (movement, i) => (
                  <tr
                    key={movement.id}
                    onClick={() => { setActiveIndex(i); openSource(movement) }}
                    data-active={i === activeIndex || undefined}
                    title={drillDown.canOpen(sourceTransactionType(movement.sourceType)) && movement.referenceNumber ? `Open ${movement.referenceNumber}` : undefined}
                    className={cn(
                      'group border-b border-[hsl(var(--border))] last:border-0 cursor-pointer bg-[hsl(var(--card))] hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.companyName}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.warehouseName}</td>}
                    {isVisible('itemCode') && <td className="py-2 px-4 font-mono text-xs">{movement.itemCode}</td>}
                    {isVisible('itemName') && <td className={cn('py-2 px-4', PINNED_TD)}>{movement.itemName}</td>}
                    {isVisible('sourceType') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.sourceType}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{movement.referenceNumber ?? '—'}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.sheetNumber ?? '—'}</td>}
                    {isVisible('quantityDelta') && <td className="py-2 px-4 text-right tabular-nums">{movement.quantityDelta}</td>}
                    {isVisible('transitQuantityDelta') && <td className="py-2 px-4 text-right tabular-nums">{movement.transitQuantityDelta}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(movement.movementDate)}</td>}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(movement.createdBy)}</td>}
                    {isVisible('notes') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]"><div className="max-w-xs truncate" title={movement.notes ?? undefined}>{movement.notes ?? '—'}</div></td>}
                  </tr>
                ))
              )}
            </tbody>
            <GrandTotalRow columns={COLUMNS} isVisible={isVisible} totals={grandTotals} />
          </ScrollTable>
          <Pagination summary={view.summary} page={page} totalPages={totalPages} totalElements={totalElements} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </CardContent>
      </Card>
    </div>
  )
}
