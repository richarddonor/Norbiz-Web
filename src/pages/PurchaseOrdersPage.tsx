import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Eye, Search, FileDown, Ban, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocLines, DocStamp, PendingNumber } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { TransactionActionsMenu, TransactionHistory } from '@/components/TransactionActivity'
import { useTransactionActivity } from '@/hooks/useTransactionActivity'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { PrintButton } from '@/components/PrintButton'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, useStock, type LookupOption, type ItemLookupOption } from '@/lib/lookups'
import { StockCell } from '@/components/StockCell'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'

type FormMode = 'view' | 'create'

interface CompanyOption {
  id: number
  name: string
}

interface OrderLine {
  id: number
  lineNumber: number
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

  const inRecordTab = useIsRecordTab()
  const { items: orders, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<PurchaseOrder>('/purchase-orders', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load purchase orders.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: orderSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<PurchaseOrder>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<PurchaseOrder>(`/purchase-orders/${id}`),
  })
  const [activeOrder, setActiveOrder]         = useState<PurchaseOrder | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [warehouseId, setWarehouseId]         = useState<number | ''>('')
  const [supplierId, setSupplierId]           = useState<number | ''>('')
  const [orderDate, setOrderDate]             = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([{ itemId: '', quantity: '', costPrice: '' }])
  const [loading, setLoading]                 = useState(false)
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const formWarehouses = useLookup<LookupOption>('warehouses', lookupCompanyId, { onError: () => toast('Failed to load warehouses.', 'error') })
  const formSuppliers = useLookup<LookupOption>('suppliers', lookupCompanyId, { enabled: inRecordTab && mode === 'create', onError: () => toast('Failed to load suppliers.', 'error') })
  const formInventoryItems = useLookup<ItemLookupOption>('items', lookupCompanyId, { enabled: inRecordTab && mode === 'create', params: { tag: 'INVENTORY' }, onError: () => toast('Failed to load items.', 'error') })
  // A PO posts to transit quantity only, so that's the balance shown as a guide while creating.
  const stock = useStock(lookupCompanyId, warehouseId, lines.map(l => l.itemId), { enabled: inRecordTab && mode === 'create', onError: () => toast('Failed to load stock balances.', 'error') })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('purchase-orders')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_PURCHASE_ORDER')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_PURCHASE_ORDER')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('PURCHASE_ORDER', inRecordTab && mode === 'view' ? activeOrder?.id : null, activeOrder?.referenceNumber, activeOrder?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: orders,
    onView: openView,
    enabled: !inRecordTab && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
    { key: 'r', handler: () => reload() },
  ], !inRecordTab && zone === 'content')

  useEffect(() => {
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function openView(order: PurchaseOrder) {
    if (!rec.isRecordTab) return rec.open('view', order)
    setActiveOrder(order)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
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
  }

  function requestClose() {
    guardedClose({ companyId, warehouseId, supplierId, orderDate, remarks, sheetNumber, lines }, () => rec.close())
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
      const item = formInventoryItems.find(i => i.id === itemId)
      costPrice = item?.costPrice != null ? String(item.costPrice) : ''
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
      rec.close()
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

  function printFailed() {
    if (!activeOrder) return
    toast(
      `No active print template configured for Purchase Orders under ${activeOrder.companyName}. Create one under Document Templates while ${activeOrder.companyName} is your active company.`,
      'error'
    )
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

  const recordName = activeOrder?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Purchase Order' : recordName || 'Purchase Order'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
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
            options={formWarehouses.map(w => ({ value: String(w.id), label: w.name }))}
            placeholder="All warehouses"
            className="w-44"
          />
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} isVisible={isVisible} onToggle={toggleColumn} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          {canCreate && (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              New
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">N</kbd>
            </Button>
          )}
        </div>
      </div>

      </>)}

      {inRecordTab && (
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-4xl">
          {mode === 'view' && activeOrder ? (
            <div className="space-y-4">
              <DocSheet>
                {activeOrder.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="po-company" readOnly name={activeOrder.companyName} />}>
                  <DocHeader title="Purchase Order" number={activeOrder.referenceNumber}>
                    <DocRow>
                      <DocCell label="Order Date"><DocText>{formatDate(activeOrder.orderDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeOrder.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Supplier"><DocText>{activeOrder.supplierName}</DocText></DocCell>
                  <DocCell label="Deliver To (Warehouse)"><DocText>{activeOrder.warehouseName}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activeOrder.lines)}
                  rowKey={line => line.id}
                  lineNumber={line => line.lineNumber}
                  minRows={5}
                  columns={[
                    { key: 'item', label: 'Item', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity', align: 'right', width: '8rem', render: line => line.quantity },
                    canViewCostPrice && { key: 'costPrice', label: 'Unit Cost', align: 'right', width: '9rem', render: line => formatCurrency(line.costPrice) },
                  ]}
                />
                <DocRow>
                  <DocCell label="Remarks"><DocText>{activeOrder.remarks}</DocText></DocCell>
                </DocRow>
                <TransactionHistory activity={activity} record={activeOrder} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activeOrder.voided} />
                {canVoid && !activeOrder.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton
                    companyId={activeOrder.companyId}
                    documentType="PURCHASE_ORDER"
                    data={activeOrder as unknown as Record<string, unknown>}
                    onError={printFailed}
                  />
                )}
                <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addLine() } }}>
              <DocSheet>
                <DocLetterhead company={
                    <CompanyField
                      id="po-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Purchase Order" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Order Date" htmlFor="po-date">
                        <Input id="po-date" type="date" value={orderDate}
                          onChange={e => setOrderDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="po-sheet">
                        <Input id="po-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Supplier" htmlFor="po-supplier">
                    <SearchableSelect
                      id="po-supplier"
                      value={supplierId === '' ? '' : String(supplierId)}
                      onChange={v => setSupplierId(v ? Number(v) : '')}
                      options={formSuppliers.map(s => ({ value: String(s.id), label: s.name }))}
                      autoFocus={!showCompanyColumn}
                    />
                  </DocCell>
                  <DocCell label="Deliver To (Warehouse)" htmlFor="po-warehouse">
                    <SearchableSelect
                      id="po-warehouse"
                      value={warehouseId === '' ? '' : String(warehouseId)}
                      onChange={v => setWarehouseId(v ? Number(v) : '')}
                      options={formWarehouses.map(w => ({ value: String(w.id), label: w.name }))}
                    />
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={lines}
                  columns={[
                    {
                      key: 'item', label: 'Item',
                      render: (line, i) => (
                        <SearchableSelect
                          value={line.itemId === '' ? '' : String(line.itemId)}
                          onChange={v => handleLineItemChange(i, v ? Number(v) : '')}
                          options={formInventoryItems.map(item => ({ value: String(item.id), label: `${item.code} — ${item.name}` }))}
                        />
                      ),
                    },
                    {
                      key: 'inTransit', label: 'In Transit', align: 'right', width: '7rem',
                      render: line => <StockCell stock={stock} field="transitQuantity" itemId={line.itemId} warehouseChosen={warehouseId !== ''} />,
                    },
                    {
                      key: 'quantity', label: 'Quantity', align: 'right', width: '8rem',
                      render: (line, i) => (
                        <Input type="number" step="0.0001" aria-label={`Line ${i + 1} quantity`} value={line.quantity}
                          onChange={e => updateLine(i, { quantity: e.target.value })} className="text-right" />
                      ),
                    },
                    canViewCostPrice && {
                      key: 'costPrice', label: 'Unit Cost', align: 'right', width: '9rem',
                      render: (line, i) => (
                        <Input type="number" step="0.0001" aria-label={`Line ${i + 1} unit cost`} value={line.costPrice}
                          onChange={e => updateLine(i, { costPrice: e.target.value })} className="text-right" />
                      ),
                    },
                    {
                      key: 'remove', label: '', align: 'center', width: '2.75rem',
                      render: (_, i) => (
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove line ${i + 1}`}
                          onClick={() => removeLine(i)} disabled={lines.length === 1}>
                          <X className="w-4 h-4" />
                        </Button>
                      ),
                    },
                  ]}
                  footer={
                    <div className="flex items-center justify-between gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={addLine}>
                        <Plus className="w-3.5 h-3.5" />
                        Add Line
                        <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">Ctrl+Enter</kbd>
                      </Button>
                      {formInventoryItems.length === 0 && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          No items are tagged Inventory — tag an item on the Items page before posting a purchase order.
                        </span>
                      )}
                    </div>
                  }
                />
                <DocRow>
                  <DocCell label="Remarks" htmlFor="po-remarks">
                    <Input id="po-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Purchase Order</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}

      {!inRecordTab && (<>

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
      </>)}
    </div>
  )
}
