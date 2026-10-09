import { useState, useMemo } from 'react'
import { FileDown } from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useContentFocus } from '@/components/AppLayout'
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
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { ScrollTable, PINNED_TH, PINNED_TD } from '@/components/ScrollTable'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

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
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'itemCode', label: 'Item Code' },
    { key: 'itemName', label: 'Item Name' },
    { key: 'sourceType', label: 'Source Type' },
    { key: 'referenceNumber', label: 'Reference #' },
    { key: 'sheetNumber', label: 'Sheet #' },
    { key: 'quantityDelta', label: 'Quantity Δ' },
    { key: 'transitQuantityDelta', label: 'Transit Quantity Δ' },
    { key: 'date', label: 'Posting Date', type: 'date' },
    { key: 'createdBy', label: 'Posted By' },
    { key: 'notes', label: 'Notes' },
  )
  return columns
}

function movementSearchText(m: Movement): string {
  return [m.itemCode, m.itemName, m.warehouseName, m.companyName, m.sourceType, m.referenceNumber ?? '', m.sheetNumber ?? '', m.notes ?? '', m.createdBy ?? '', formatDate(m.movementDate)].join(' ')
}

/** Filters a drill-down hands over in the URL (`?warehouseId=&itemId=&dateFrom=&dateTo=`),
 * e.g. from an Inventory Balance row. Only read on mount; a drill-down tab keeps them locked. */
function initialFilters(search: string) {
  const params = new URLSearchParams(search)
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

  const { items: movements, page, setPage, totalPages, totalElements, loading: listLoading, reload, searchAll } = usePagedList<Movement>('/inventory-movements', {
    onError: () => toast('Failed to load inventory ledger.', 'error'),
    search: debouncedSearch,
    filters: combinedFilters,
    searchText: movementSearchText,
  })
  // Filter-bar options for the session's active company.
  const warehouses = useLookup<LookupOption>('warehouses', activeCompanyId, { onError: () => toast('Failed to load warehouses.', 'error') })
  const { isVisible, menu: columnMenu } = useColumnVisibility('inventory-ledger')
  const resolveDisplayName = useUserDisplayNames()
  const drillDown = useTransactionDrillDown()
  const openSource = (m: Movement) => drillDown.open(sourceTransactionType(m.sourceType), m.sourceId)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: movements,
    onView: openSource,
    enabled: zone === 'content',
  })

  useHotkeys([
    { key: 'r', handler: () => reload() },
  ], zone === 'content')

  async function handleExport() {
    const qs = filtersToQueryString(combinedFilters)
    const all = await fetchAllContent<Movement>(qs ? `/inventory-movements?${qs}` : '/inventory-movements', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(m => movementSearchText(m).toLowerCase().includes(term)) : all
    const rows = matching.map(m => ({
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
    }))
    exportToXlsx('inventory-ledger', COLUMNS.filter(c => isVisible(c.key)), rows)
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
                {showCompanyColumn && isVisible('company') && <th className="text-left py-2 px-4 font-medium">Company</th>}
                {isVisible('warehouse') && <th className="text-left py-2 px-4 font-medium">Warehouse</th>}
                {isVisible('itemCode') && <th className="text-left py-2 px-4 font-medium">Item Code</th>}
                {isVisible('itemName') && <th className={cn('text-left py-2 px-4 font-medium', PINNED_TH)}>Item Name</th>}
                {isVisible('sourceType') && <th className="text-left py-2 px-4 font-medium">Source Type</th>}
                {isVisible('referenceNumber') && <th className="text-left py-2 px-4 font-medium">Reference #</th>}
                {isVisible('sheetNumber') && <th className="text-left py-2 px-4 font-medium">Sheet #</th>}
                {isVisible('quantityDelta') && <th className="text-right py-2 px-4 font-medium">Quantity Δ</th>}
                {isVisible('transitQuantityDelta') && <th className="text-right py-2 px-4 font-medium">Transit Quantity Δ</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Posting Date</th>}
                {isVisible('createdBy') && <th className="text-left py-2 px-4 font-medium">Posted By</th>}
                {isVisible('notes') && <th className="text-left py-2 px-4 font-medium">Notes</th>}
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
                movements.map((movement, i) => (
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
          </ScrollTable>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  )
}
