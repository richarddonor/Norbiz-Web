import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Eye, Search, FileDown, Printer, Ban, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { useDocumentPrint } from '@/hooks/useDocumentPrint'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create'

interface CompanyOption {
  id: number
  name: string
}

interface WarehouseOption {
  id: number
  companyId: number
  name: string
  active: boolean
}

interface SupplierOption {
  id: number
  companyId: number
  name: string
  active: boolean
}

interface PriceEntry {
  priceType: 'UNIT_PRICE' | 'COST_PRICE' | 'FOCAL_PRICE' | 'MARKDOWN_PRICE'
  amount: number
}

interface ItemOption {
  id: number
  companyId: number
  itemCode: string
  name: string
  tags: string[]
  active: boolean
  prices: PriceEntry[]
}

interface OrderLine {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  quantity: string
  costPrice: string | null
  quantityLoaded: string
}

interface PurchaseOrder {
  id: number
  companyId: number
  companyName: string
  warehouseId: number
  warehouseName: string
  supplierId: number
  supplierName: string
  referenceNumber: string
  sheetNumber: string | null
  orderDate: string
  remarks: string | null
  createdAt: string | null
  createdBy: string | null
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  loaded: boolean
  lines: OrderLine[]
}

interface LineDraft {
  itemId: number | ''
  quantity: string
  costPrice: string
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #' },
    { key: 'sheetNumber', label: 'Sheet #' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'date', label: 'Order Date', type: 'date' },
    { key: 'voided', label: 'Voided', type: 'boolean' },
  )
  return columns
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function orderSearchText(o: PurchaseOrder): string {
  return [o.referenceNumber, o.sheetNumber ?? '', o.warehouseName, o.supplierName, o.remarks ?? '', o.companyName, formatDate(o.orderDate)].join(' ')
}

export function PurchaseOrdersPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn, companies } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const canViewCostPrice = hasPermission('VIEW_COST_PRICE')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const { items: orders, page, setPage, totalPages, totalElements, reload } = usePagedList<PurchaseOrder>('/purchase-orders', {
    onError: () => toast('Failed to load purchase orders.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: orderSearchText,
  })
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [items, setItems] = useState<ItemOption[]>([])
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [open, setOpen]                       = useState(false)
  const [mode, setMode]                       = useState<FormMode>('view')
  const [activeOrder, setActiveOrder]         = useState<PurchaseOrder | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [warehouseId, setWarehouseId]         = useState<number | ''>('')
  const [supplierId, setSupplierId]           = useState<number | ''>('')
  const [orderDate, setOrderDate]             = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([{ itemId: '', quantity: '', costPrice: '' }])
  const [loading, setLoading]                 = useState(false)
  const formWarehouses = companyId ? warehouses.filter(w => w.companyId === companyId) : warehouses
  const formSuppliers = companyId ? suppliers.filter(s => s.companyId === companyId) : suppliers
  const formInventoryItems = (companyId ? items.filter(i => i.companyId === companyId) : items).filter(i => i.tags.includes('INVENTORY'))
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('purchase-orders')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()
  const { print, printPortal } = useDocumentPrint()
  const [printing, setPrinting] = useState(false)

  const canCreate = hasPermission('CREATE_PURCHASE_ORDER')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_PURCHASE_ORDER')
  const [voiding, setVoiding] = useState(false)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: orders,
    onView: openView,
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  useEffect(() => {
    fetchAllContent<WarehouseOption>('/warehouses')
      .then(data => setWarehouses(data.filter(w => w.active)))
      .catch(() => toast('Failed to load warehouses.', 'error'))
    fetchAllContent<SupplierOption>('/suppliers')
      .then(data => setSuppliers(data.filter(s => s.active)))
      .catch(() => toast('Failed to load suppliers.', 'error'))
    fetchAllContent<ItemOption>('/items')
      .then(data => setItems(data.filter(i => i.active)))
      .catch(() => toast('Failed to load items.', 'error'))
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function openView(order: PurchaseOrder) {
    setActiveOrder(order)
    setMode('view')
    setOpen(true)
  }

  function openCreate() {
    setActiveOrder(null)
    const nextCompanyId = activeCompanyId ?? ''
    const nextOrderDate = todayIso()
    const nextLines: LineDraft[] = [{ itemId: '', quantity: '', costPrice: '' }]
    setCompanyId(nextCompanyId)
    setWarehouseId('')
    setSupplierId('')
    setOrderDate(nextOrderDate)
    setRemarks('')
    setSheetNumber('')
    setLines(nextLines)
    markClean({ companyId: nextCompanyId, warehouseId: '', supplierId: '', orderDate: nextOrderDate, remarks: '', sheetNumber: '', lines: nextLines })
    setMode('create')
    setOpen(true)
  }

  function requestClose() {
    guardedClose({ companyId, warehouseId, supplierId, orderDate, remarks, sheetNumber, lines }, () => setOpen(false))
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setWarehouseId('')
    setSupplierId('')
    setLines([{ itemId: '', quantity: '', costPrice: '' }])
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  function handleLineItemChange(index: number, itemId: number | '') {
    let costPrice = ''
    if (itemId !== '' && canViewCostPrice) {
      const item = items.find(i => i.id === itemId)
      const costEntry = item?.prices.find(p => p.priceType === 'COST_PRICE')
      costPrice = costEntry ? String(costEntry.amount) : ''
    }
    updateLine(index, { itemId, costPrice })
  }

  function addLine() {
    setLines(prev => [...prev, { itemId: '', quantity: '', costPrice: '' }])
  }

  function removeLine(index: number) {
    setLines(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (!warehouseId) {
      toast('Select a warehouse.', 'error')
      return
    }
    if (!supplierId) {
      toast('Select a supplier.', 'error')
      return
    }
    const validLines = lines.filter(l => l.itemId !== '' && l.quantity.trim() !== '')
    if (validLines.length === 0) {
      toast('Add at least one line with an item and quantity.', 'error')
      return
    }
    if (!window.confirm('Post this purchase order? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        warehouseId,
        supplierId,
        orderDate,
        remarks: remarks || null,
        sheetNumber: sheetNumber || null,
        lines: validLines.map(l => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          costPrice: canViewCostPrice && l.costPrice.trim() !== '' ? Number(l.costPrice) : null,
        })),
      }
      await apiFetch<PurchaseOrder>('/purchase-orders', { method: 'POST', body: JSON.stringify(body) })
      toast('Purchase order posted successfully.', 'success')
      setOpen(false)
      reload()
    } catch {
      toast('Failed to post purchase order.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<PurchaseOrder>(qs ? `/purchase-orders?${qs}` : '/purchase-orders', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(o => orderSearchText(o).toLowerCase().includes(term)) : all
    const rows = matching.map(o => ({
      referenceNumber: o.referenceNumber,
      sheetNumber: o.sheetNumber ?? '',
      warehouse: o.warehouseName,
      supplier: o.supplierName,
      date: formatDate(o.orderDate),
      voided: o.voided ? 'Yes' : '',
      company: o.companyName,
    }))
    exportToXlsx('purchase-orders', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  async function handlePrint() {
    if (!activeOrder) return
    setPrinting(true)
    try {
      await print(activeOrder.companyId, 'PURCHASE_ORDER', activeOrder as unknown as Record<string, unknown>)
    } catch {
      toast(
        `No default print template configured for Purchase Orders under ${activeOrder.companyName}. Create one under Document Templates while ${activeOrder.companyName} is your active company.`,
        'error'
      )
    } finally {
      setPrinting(false)
    }
  }

  async function handleVoid() {
    if (!activeOrder) return
    if (!window.confirm(`Void purchase order "${activeOrder.referenceNumber}"? This reverses its transit quantity and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<PurchaseOrder>(`/purchase-orders/${activeOrder.id}/void`, { method: 'POST' })
      setActiveOrder(voided)
      toast('Purchase order voided.', 'success')
      reload()
    } catch {
      toast('Failed to void purchase order.', 'error')
    } finally {
      setVoiding(false)
    }
  }

  const dialogTitle = mode === 'view' ? 'Purchase Order Details' : 'New Purchase Order'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search purchase orders… (/)"
              className="pl-8 w-56"
            />
          </div>
          <SearchableSelect
            value={filters.warehouseId ?? ''}
            onChange={v => setFilters(prev => ({ ...prev, warehouseId: v }))}
            options={warehouses.map(w => ({ value: String(w.id), label: w.name }))}
            placeholder="All warehouses"
            className="w-44"
          />
          <ColumnsMenu columns={COLUMNS} isVisible={isVisible} onToggle={toggleColumn} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          {canCreate && (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              New Purchase Order
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">N</kbd>
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={v => (v ? setOpen(true) : requestClose())}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" onFocusOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>

          {mode === 'view' && activeOrder ? (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Reference #</Label>
                  <div className="font-mono flex items-center gap-2">
                    {activeOrder.referenceNumber}
                    {activeOrder.voided && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                        Voided
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Sheet #</Label>
                  <div>{activeOrder.sheetNumber ?? '—'}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Warehouse</Label>
                  <div>{activeOrder.warehouseName}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Supplier</Label>
                  <div>{activeOrder.supplierName}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Order Date</Label>
                  <div>{formatDate(activeOrder.orderDate)}</div>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Remarks</Label>
                  <div>{activeOrder.remarks ?? '—'}</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Lines</Label>
                <div className="rounded-md border border-[hsl(var(--border))] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/40">
                        <th className="text-left py-1.5 px-3 font-medium">Item</th>
                        <th className="text-right py-1.5 px-3 font-medium">Quantity</th>
                        {canViewCostPrice && <th className="text-right py-1.5 px-3 font-medium">Cost Price</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {activeOrder.lines.map(line => (
                        <tr key={line.id} className="border-b border-[hsl(var(--border))] last:border-0">
                          <td className="py-1.5 px-3">{line.itemCode} — {line.itemName}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums">{line.quantity}</td>
                          {canViewCostPrice && <td className="py-1.5 px-3 text-right tabular-nums">{line.costPrice ?? '—'}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                {showCompanyColumn && (
                  <div className="flex justify-between">
                    <span>Company</span>
                    <span className="text-[hsl(var(--foreground))]">{activeOrder.companyName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Posted by</span>
                  <span className="text-[hsl(var(--foreground))]">{resolveDisplayName(activeOrder.createdBy)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Posted at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeOrder.createdAt)}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {canVoid && !activeOrder.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <Button type="button" variant="outline" onClick={handlePrint} loading={printing}>
                    <Printer className="w-4 h-4" />
                    Print
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 mt-2" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addLine() } }}>
              {showCompanyColumn && (
                <div className="space-y-1.5">
                  <Label htmlFor="po-company">Company</Label>
                  <SearchableSelect
                    id="po-company"
                    value={companyId === '' ? '' : String(companyId)}
                    onChange={v => handleCompanyChange(v ? Number(v) : '')}
                    options={companyOptions.map(c => ({ value: String(c.id), label: c.name }))}
                    placeholder="Select a company…"
                    autoFocus
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="po-warehouse">Warehouse</Label>
                  <SearchableSelect
                    id="po-warehouse"
                    value={warehouseId === '' ? '' : String(warehouseId)}
                    onChange={v => setWarehouseId(v ? Number(v) : '')}
                    options={formWarehouses.map(w => ({ value: String(w.id), label: w.name }))}
                    placeholder="Select a warehouse…"
                    autoFocus={!showCompanyColumn}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="po-supplier">Supplier</Label>
                  <SearchableSelect
                    id="po-supplier"
                    value={supplierId === '' ? '' : String(supplierId)}
                    onChange={v => setSupplierId(v ? Number(v) : '')}
                    options={formSuppliers.map(s => ({ value: String(s.id), label: s.name }))}
                    placeholder="Select a supplier…"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-date">Order Date</Label>
                <Input id="po-date" type="date" value={orderDate}
                  onChange={e => setOrderDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-sheet">Sheet #</Label>
                <Input id="po-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} placeholder="Optional control number" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-remarks">Remarks</Label>
                <Input id="po-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Lines</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    <Plus className="w-3.5 h-3.5" />
                    Add Line
                    <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">Ctrl+Enter</kbd>
                  </Button>
                </div>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex-1">
                        <SearchableSelect
                          value={line.itemId === '' ? '' : String(line.itemId)}
                          onChange={v => handleLineItemChange(i, v ? Number(v) : '')}
                          options={formInventoryItems.map(item => ({ value: String(item.id), label: `${item.itemCode} — ${item.name}` }))}
                          placeholder="Select an item…"
                        />
                      </div>
                      <Input
                        type="number"
                        step="0.0001"
                        placeholder="Quantity"
                        value={line.quantity}
                        onChange={e => updateLine(i, { quantity: e.target.value })}
                        className="w-28"
                      />
                      {canViewCostPrice && (
                        <Input
                          type="number"
                          step="0.0001"
                          placeholder="Cost Price"
                          value={line.costPrice}
                          onChange={e => updateLine(i, { costPrice: e.target.value })}
                          className="w-28"
                        />
                      )}
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)} disabled={lines.length === 1}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                {formInventoryItems.length === 0 && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    No items are tagged Inventory — tag an item on the Items page before posting a purchase order.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Purchase Order</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="pt-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {showCompanyColumn && isVisible('company') && <th className="text-left py-2 px-4 font-medium">Company</th>}
                {isVisible('referenceNumber') && <th className="text-left py-2 px-4 font-medium">Reference #</th>}
                {isVisible('sheetNumber') && <th className="text-left py-2 px-4 font-medium">Sheet #</th>}
                {isVisible('warehouse') && <th className="text-left py-2 px-4 font-medium">Warehouse</th>}
                {isVisible('supplier') && <th className="text-left py-2 px-4 font-medium">Supplier</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Order Date</th>}
                {isVisible('voided') && <th className="text-left py-2 px-4 font-medium">Voided</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'warehouse' && key !== 'supplier' && key !== 'company' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No purchase orders match your search/filters.' : 'No purchase orders to display.'}
                  </td>
                </tr>
              ) : (
                orders.map((order, i) => (
                  <tr
                    key={order.id}
                    onClick={() => { setActiveIndex(i); openView(order) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{order.companyName}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{order.referenceNumber}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{order.sheetNumber ?? '—'}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{order.warehouseName}</td>}
                    {isVisible('supplier') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{order.supplierName}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(order.orderDate)}</td>}
                    {isVisible('voided') && (
                      <td className="py-2 px-4">
                        {order.voided && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                            Voided
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openView(order)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
      {printPortal}
    </div>
  )
}
