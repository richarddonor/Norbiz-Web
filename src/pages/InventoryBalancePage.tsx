import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, FileDown } from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

type BalanceMode = 'current' | 'asOf' | 'period'

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

interface Balance {
  companyId: number
  companyName: string
  itemId: number
  itemCode: string
  itemName: string
  warehouseId: number
  warehouseName: string
  quantity: string | null
  transitQuantity: string | null
  beginningQuantity: string | null
  beginningTransitQuantity: string | null
  endingQuantity: string | null
  endingTransitQuantity: string | null
  netQuantityChange: string | null
  netTransitQuantityChange: string | null
  costPrice: string | null
  value: string | null
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function balanceSearchText(b: Balance): string {
  return [b.itemCode, b.itemName, b.warehouseName, b.companyName].join(' ')
}

function buildColumns(mode: BalanceMode, showCompanyColumn: boolean, canViewCostPrice: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'itemCode', label: 'Item Code' },
    { key: 'itemName', label: 'Item Name' },
  )
  if (mode === 'period') {
    columns.push(
      { key: 'beginningQuantity', label: 'Beginning Quantity' },
      { key: 'beginningTransitQuantity', label: 'Beginning Transit Quantity' },
      { key: 'endingQuantity', label: 'Ending Quantity' },
      { key: 'endingTransitQuantity', label: 'Ending Transit Quantity' },
      { key: 'netQuantityChange', label: 'Net Quantity Change' },
      { key: 'netTransitQuantityChange', label: 'Net Transit Quantity Change' },
    )
  } else {
    columns.push(
      { key: 'quantity', label: 'Quantity' },
      { key: 'transitQuantity', label: 'Transit Quantity' },
    )
  }
  if (canViewCostPrice) {
    columns.push({ key: 'costPrice', label: 'Cost Price' }, { key: 'value', label: 'Value' })
  }
  return columns
}

export function InventoryBalancePage() {
  const { toast } = useToast()
  const { hasPermission, showCompanyColumn } = useAuth()
  const { zone } = useContentFocus()
  const canViewCostPrice = hasPermission('VIEW_COST_PRICE')

  const [search, setSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [itemId, setItemId] = useState('')
  const [mode, setMode] = useState<BalanceMode>('current')
  const [asOfDate, setAsOfDate] = useState(todayIso())
  const [startDate, setStartDate] = useState(todayIso())
  const [endDate, setEndDate] = useState(todayIso())
  const debouncedSearch = useDebouncedValue(search)
  const isFiltering = !!debouncedSearch.trim() || !!warehouseId || !!itemId || mode !== 'current'

  const COLUMNS = useMemo(() => buildColumns(mode, showCompanyColumn, canViewCostPrice), [mode, showCompanyColumn, canViewCostPrice])

  const filters = useMemo(() => {
    const base: Record<string, string> = { warehouseId, itemId }
    if (mode === 'asOf') base.asOfDate = asOfDate
    if (mode === 'period') {
      base.startDate = startDate
      base.endDate = endDate
    }
    return base
  }, [warehouseId, itemId, mode, asOfDate, startDate, endDate])

  const { items: balances, page, setPage, totalPages, totalElements } = usePagedList<Balance>('/inventory-balances', {
    onError: () => toast('Failed to load inventory balances.', 'error'),
    search: debouncedSearch,
    filters,
    searchText: balanceSearchText,
  })
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [items, setItems] = useState<ItemOption[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('inventory-balances')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: balances,
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
    const qs = filtersToQueryString(filters)
    const all = await fetchAllContent<Balance>(qs ? `/inventory-balances?${qs}` : '/inventory-balances', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(b => balanceSearchText(b).toLowerCase().includes(term)) : all
    const rows = matching.map(b => ({
      company: b.companyName,
      warehouse: b.warehouseName,
      itemCode: b.itemCode,
      itemName: b.itemName,
      quantity: b.quantity ?? '',
      transitQuantity: b.transitQuantity ?? '',
      beginningQuantity: b.beginningQuantity ?? '',
      beginningTransitQuantity: b.beginningTransitQuantity ?? '',
      endingQuantity: b.endingQuantity ?? '',
      endingTransitQuantity: b.endingTransitQuantity ?? '',
      netQuantityChange: b.netQuantityChange ?? '',
      netTransitQuantityChange: b.netTransitQuantityChange ?? '',
      ...(canViewCostPrice ? { costPrice: formatCurrency(b.costPrice), value: formatCurrency(b.value) } : {}),
    }))
    exportToXlsx('inventory-balance', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Inventory Balance</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search balances… (/)"
              className="pl-8 w-56"
            />
          </div>
          <SearchableSelect
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map(w => ({ value: String(w.id), label: w.name }))}
            placeholder="All warehouses"
            className="w-44"
          />
          <SearchableSelect
            value={itemId}
            onChange={setItemId}
            options={items.map(i => ({ value: String(i.id), label: `${i.itemCode} — ${i.name}` }))}
            placeholder="All items"
            className="w-52"
          />
          <SearchableSelect
            value={mode}
            onChange={v => setMode((v || 'current') as BalanceMode)}
            options={[
              { value: 'current', label: 'Current' },
              { value: 'asOf', label: 'As of Date' },
              { value: 'period', label: 'Period' },
            ]}
            placeholder="Current"
            className="w-40"
          />
          {mode === 'asOf' && (
            <Input
              type="date"
              value={asOfDate}
              onChange={e => setAsOfDate(e.target.value)}
              className="w-40"
            />
          )}
          {mode === 'period' && (
            <>
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-40"
              />
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-40"
              />
            </>
          )}
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
                {mode === 'period' ? (
                  <>
                    {isVisible('beginningQuantity') && <th className="text-left py-2 px-4 font-medium">Beginning Quantity</th>}
                    {isVisible('beginningTransitQuantity') && <th className="text-left py-2 px-4 font-medium">Beginning Transit Quantity</th>}
                    {isVisible('endingQuantity') && <th className="text-left py-2 px-4 font-medium">Ending Quantity</th>}
                    {isVisible('endingTransitQuantity') && <th className="text-left py-2 px-4 font-medium">Ending Transit Quantity</th>}
                    {isVisible('netQuantityChange') && <th className="text-left py-2 px-4 font-medium">Net Quantity Change</th>}
                    {isVisible('netTransitQuantityChange') && <th className="text-left py-2 px-4 font-medium">Net Transit Quantity Change</th>}
                  </>
                ) : (
                  <>
                    {isVisible('quantity') && <th className="text-left py-2 px-4 font-medium">Quantity</th>}
                    {isVisible('transitQuantity') && <th className="text-left py-2 px-4 font-medium">Transit Quantity</th>}
                  </>
                )}
                {canViewCostPrice && isVisible('costPrice') && <th className="text-left py-2 px-4 font-medium">Cost Price</th>}
                {canViewCostPrice && isVisible('value') && <th className="text-left py-2 px-4 font-medium">Value</th>}
              </tr>
            </thead>
            <tbody>
              {balances.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No balances match your search/filters.' : 'No inventory balances to display.'}
                  </td>
                </tr>
              ) : (
                balances.map((balance, i) => (
                  <tr
                    key={`${balance.itemId}-${balance.warehouseId}`}
                    onClick={() => setActiveIndex(i)}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{balance.companyName}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{balance.warehouseName}</td>}
                    {isVisible('itemCode') && <td className="py-2 px-4 font-mono text-xs">{balance.itemCode}</td>}
                    {isVisible('itemName') && <td className="py-2 px-4">{balance.itemName}</td>}
                    {mode === 'period' ? (
                      <>
                        {isVisible('beginningQuantity') && <td className="py-2 px-4 tabular-nums">{balance.beginningQuantity}</td>}
                        {isVisible('beginningTransitQuantity') && <td className="py-2 px-4 tabular-nums">{balance.beginningTransitQuantity}</td>}
                        {isVisible('endingQuantity') && <td className="py-2 px-4 tabular-nums">{balance.endingQuantity}</td>}
                        {isVisible('endingTransitQuantity') && <td className="py-2 px-4 tabular-nums">{balance.endingTransitQuantity}</td>}
                        {isVisible('netQuantityChange') && <td className="py-2 px-4 tabular-nums">{balance.netQuantityChange}</td>}
                        {isVisible('netTransitQuantityChange') && <td className="py-2 px-4 tabular-nums">{balance.netTransitQuantityChange}</td>}
                      </>
                    ) : (
                      <>
                        {isVisible('quantity') && <td className="py-2 px-4 tabular-nums">{balance.quantity}</td>}
                        {isVisible('transitQuantity') && <td className="py-2 px-4 tabular-nums">{balance.transitQuantity}</td>}
                      </>
                    )}
                    {canViewCostPrice && isVisible('costPrice') && <td className="py-2 px-4 tabular-nums">{formatCurrency(balance.costPrice)}</td>}
                    {canViewCostPrice && isVisible('value') && <td className="py-2 px-4 tabular-nums">{formatCurrency(balance.value)}</td>}
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
