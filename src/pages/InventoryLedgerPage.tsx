import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, FileDown } from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useContentFocus } from '@/components/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

interface WarehouseOption {
  id: number
  name: string
  active: boolean
}

interface ItemOption {
  id: number
  itemCode: string
  name: string
  active: boolean
}

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

export function InventoryLedgerPage() {
  const { toast } = useToast()
  const { showCompanyColumn } = useAuth()
  const { zone } = useContentFocus()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [itemId, setItemId] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || !!warehouseId || !!itemId || Object.values(debouncedFilters).some(v => v.trim())

  const combinedFilters = { ...debouncedFilters, warehouseId, itemId }

  const { items: movements, page, setPage, totalPages, totalElements } = usePagedList<Movement>('/inventory-movements', {
    onError: () => toast('Failed to load inventory ledger.', 'error'),
    search: debouncedSearch,
    filters: combinedFilters,
    searchText: movementSearchText,
  })
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [items, setItems] = useState<ItemOption[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('inventory-ledger')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: movements,
    onView: () => {},
    enabled: zone === 'content',
  })

  useHotkeys([
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], zone === 'content')

  useEffect(() => {
    fetchAllContent<WarehouseOption>('/warehouses')
      .then(data => setWarehouses(data.filter(w => w.active)))
      .catch(() => toast('Failed to load warehouses.', 'error'))
    fetchAllContent<ItemOption>('/items')
      .then(data => setItems(data.filter(i => i.active)))
      .catch(() => toast('Failed to load items.', 'error'))
  }, [])

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
      createdBy: m.createdBy ?? '',
      notes: m.notes ?? '',
    }))
    exportToXlsx('inventory-ledger', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Inventory Ledger</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search ledger… (/)"
              className="pl-8 w-56"
            />
          </div>
          <select
            value={warehouseId}
            onChange={e => setWarehouseId(e.target.value)}
            className="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            <option value="">All warehouses</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <select
            value={itemId}
            onChange={e => setItemId(e.target.value)}
            className="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            <option value="">All items</option>
            {items.map(i => (
              <option key={i.id} value={i.id}>{i.itemCode} — {i.name}</option>
            ))}
          </select>
          <ColumnsMenu columns={COLUMNS} isVisible={isVisible} onToggle={toggleColumn} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {showCompanyColumn && isVisible('company') && <th className="text-left py-2 px-4 font-medium">Company</th>}
                {isVisible('warehouse') && <th className="text-left py-2 px-4 font-medium">Warehouse</th>}
                {isVisible('itemCode') && <th className="text-left py-2 px-4 font-medium">Item Code</th>}
                {isVisible('itemName') && <th className="text-left py-2 px-4 font-medium">Item Name</th>}
                {isVisible('sourceType') && <th className="text-left py-2 px-4 font-medium">Source Type</th>}
                {isVisible('referenceNumber') && <th className="text-left py-2 px-4 font-medium">Reference #</th>}
                {isVisible('sheetNumber') && <th className="text-left py-2 px-4 font-medium">Sheet #</th>}
                {isVisible('quantityDelta') && <th className="text-left py-2 px-4 font-medium">Quantity Δ</th>}
                {isVisible('transitQuantityDelta') && <th className="text-left py-2 px-4 font-medium">Transit Quantity Δ</th>}
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
                    onClick={() => setActiveIndex(i)}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.companyName}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.warehouseName}</td>}
                    {isVisible('itemCode') && <td className="py-2 px-4 font-mono text-xs">{movement.itemCode}</td>}
                    {isVisible('itemName') && <td className="py-2 px-4">{movement.itemName}</td>}
                    {isVisible('sourceType') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.sourceType}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{movement.referenceNumber ?? '—'}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.sheetNumber ?? '—'}</td>}
                    {isVisible('quantityDelta') && <td className="py-2 px-4 tabular-nums">{movement.quantityDelta}</td>}
                    {isVisible('transitQuantityDelta') && <td className="py-2 px-4 tabular-nums">{movement.transitQuantityDelta}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(movement.movementDate)}</td>}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.createdBy ?? '—'}</td>}
                    {isVisible('notes') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{movement.notes ?? '—'}</td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  )
}
