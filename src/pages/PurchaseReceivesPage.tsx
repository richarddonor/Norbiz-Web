import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Eye, Search, FileDown, Printer, Ban } from 'lucide-react'
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
type SourceMode = 'PURCHASE_ORDER' | 'PURCHASE_INVOICE'

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

interface SourceLine {
  itemId: number
  itemCode: string
  itemName: string
  quantity: string
  quantityLoaded: string
}

interface PurchaseOrderOption {
  id: number
  companyId: number
  warehouseId: number
  supplierId: number
  referenceNumber: string
  voided: boolean
  loaded: boolean
  lines: SourceLine[]
}

interface PurchaseInvoiceOption {
  id: number
  companyId: number
  warehouseId: number
  supplierId: number
  purchaseOrderId: number | null
  referenceNumber: string
  voided: boolean
  loaded: boolean
  lines: SourceLine[]
}

interface ReceiveLine {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  purchaseOrderLineId: number | null
  purchaseInvoiceLineId: number | null
  quantity: string
  quantityLoaded: string
}

interface PurchaseReceive {
  id: number
  companyId: number
  companyName: string
  warehouseId: number
  warehouseName: string
  supplierId: number
  supplierName: string
  purchaseOrderId: number | null
  purchaseOrderReferenceNumber: string | null
  purchaseInvoiceId: number | null
  purchaseInvoiceReferenceNumber: string | null
  referenceNumber: string
  sheetNumber: string | null
  receiptDate: string
  remarks: string | null
  createdAt: string | null
  createdBy: string | null
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  loaded: boolean
  lines: ReceiveLine[]
}

interface LineDraft {
  itemId: number
  itemCode: string
  itemName: string
  outstanding: string
  quantity: string
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #' },
    { key: 'sheetNumber', label: 'Sheet #' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'source', label: 'Source' },
    { key: 'date', label: 'Receipt Date', type: 'date' },
    { key: 'voided', label: 'Voided', type: 'boolean' },
  )
  return columns
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sourceLabel(r: PurchaseReceive): string {
  if (r.purchaseOrderReferenceNumber) return `PO: ${r.purchaseOrderReferenceNumber}`
  if (r.purchaseInvoiceReferenceNumber) return `Invoice: ${r.purchaseInvoiceReferenceNumber}`
  return '—'
}

function receiveSearchText(r: PurchaseReceive): string {
  return [r.referenceNumber, r.sheetNumber ?? '', r.warehouseName, r.supplierName, sourceLabel(r), r.remarks ?? '', r.companyName, formatDate(r.receiptDate)].join(' ')
}

export function PurchaseReceivesPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn, companies } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const { items: receives, page, setPage, totalPages, totalElements, reload } = usePagedList<PurchaseReceive>('/purchase-receives', {
    onError: () => toast('Failed to load purchase receives.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: receiveSearchText,
  })
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([])
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoiceOption[]>([])
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [open, setOpen]                       = useState(false)
  const [mode, setMode]                       = useState<FormMode>('view')
  const [activeReceive, setActiveReceive]     = useState<PurchaseReceive | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [sourceMode, setSourceMode]           = useState<SourceMode>('PURCHASE_ORDER')
  const [supplierId, setSupplierId]           = useState<number | ''>('')
  const [sourceId, setSourceId]               = useState<number | ''>('')
  const [warehouseId, setWarehouseId]         = useState<number | ''>('')
  const [receiptDate, setReceiptDate]         = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([])
  const [loading, setLoading]                 = useState(false)
  const formSuppliers = companyId ? suppliers.filter(s => s.companyId === companyId) : suppliers
  const supplierPurchaseOrders = purchaseOrders.filter(po => po.companyId === companyId && !po.voided && !po.loaded)
  const supplierPurchaseInvoices = purchaseInvoices.filter(inv => inv.companyId === companyId && inv.purchaseOrderId === null && !inv.voided && !inv.loaded)
  const eligiblePurchaseOrders = supplierId ? supplierPurchaseOrders.filter(po => po.supplierId === supplierId) : []
  const eligiblePurchaseInvoices = supplierId ? supplierPurchaseInvoices.filter(inv => inv.supplierId === supplierId) : []
  const warehouseName = warehouseId ? warehouses.find(w => w.id === warehouseId)?.name ?? '' : ''
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('purchase-receives')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()
  const { print, printPortal } = useDocumentPrint()
  const [printing, setPrinting] = useState(false)

  const canCreate = hasPermission('CREATE_PURCHASE_RECEIVE')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_PURCHASE_RECEIVE')
  const [voiding, setVoiding] = useState(false)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: receives,
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
    fetchAllContent<PurchaseOrderOption>('/purchase-orders')
      .then(setPurchaseOrders)
      .catch(() => toast('Failed to load purchase orders.', 'error'))
    fetchAllContent<PurchaseInvoiceOption>('/purchase-invoices')
      .then(setPurchaseInvoices)
      .catch(() => toast('Failed to load purchase invoices.', 'error'))
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function openView(receive: PurchaseReceive) {
    setActiveReceive(receive)
    setMode('view')
    setOpen(true)
  }

  function openCreate() {
    setActiveReceive(null)
    const nextCompanyId = activeCompanyId ?? ''
    const nextDate = todayIso()
    setCompanyId(nextCompanyId)
    setSourceMode('PURCHASE_ORDER')
    setSupplierId('')
    setSourceId('')
    setWarehouseId('')
    setReceiptDate(nextDate)
    setRemarks('')
    setSheetNumber('')
    setLines([])
    markClean({
      companyId: nextCompanyId, sourceMode: 'PURCHASE_ORDER', supplierId: '', sourceId: '', warehouseId: '',
      receiptDate: nextDate, remarks: '', sheetNumber: '', lines: [],
    })
    setMode('create')
    setOpen(true)
  }

  function requestClose() {
    guardedClose(
      { companyId, sourceMode, supplierId, sourceId, warehouseId, receiptDate, remarks, sheetNumber, lines },
      () => setOpen(false)
    )
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setSourceMode('PURCHASE_ORDER')
    setSupplierId('')
    setSourceId('')
    setWarehouseId('')
    setLines([])
  }

  function handleSourceModeChange(value: SourceMode) {
    setSourceMode(value)
    setSupplierId('')
    setSourceId('')
    setWarehouseId('')
    setLines([])
  }

  // Picking the Supplier narrows which Purchase Orders/Direct Invoices are selectable,
  // so changing it invalidates whatever source/warehouse/lines were already derived.
  function handleSupplierChange(id: number | '') {
    setSupplierId(id)
    setSourceId('')
    setWarehouseId('')
    setLines([])
  }

  function outstandingLinesOf(source: PurchaseOrderOption | PurchaseInvoiceOption): LineDraft[] {
    return source.lines
      .map(l => {
        const outstanding = (Number(l.quantity) - Number(l.quantityLoaded)).toFixed(4)
        return { itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, outstanding, quantity: outstanding }
      })
      .filter(l => Number(l.outstanding) > 0)
  }

  function handleSourceChange(id: number | '') {
    setSourceId(id)
    if (!id) {
      setWarehouseId('')
      setLines([])
      return
    }
    const source = sourceMode === 'PURCHASE_ORDER'
      ? eligiblePurchaseOrders.find(po => po.id === id)
      : eligiblePurchaseInvoices.find(inv => inv.id === id)
    if (!source) {
      setWarehouseId('')
      setLines([])
      return
    }
    setWarehouseId(source.warehouseId)
    setLines(outstandingLinesOf(source))
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (!supplierId) {
      toast('Select a supplier.', 'error')
      return
    }
    if (!sourceId) {
      toast(`Select a ${sourceMode === 'PURCHASE_ORDER' ? 'purchase order' : 'purchase invoice'} to receive against.`, 'error')
      return
    }
    const validLines = lines.filter(l => l.quantity.trim() !== '' && Number(l.quantity) > 0)
    if (validLines.length === 0) {
      toast('Enter a quantity to receive for at least one item.', 'error')
      return
    }
    const overLine = validLines.find(l => Number(l.quantity) > Number(l.outstanding))
    if (overLine) {
      toast(`Quantity to receive for ${overLine.itemCode} exceeds the outstanding amount (${overLine.outstanding}).`, 'error')
      return
    }
    if (!window.confirm('Post this purchase receive? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        warehouseId,
        supplierId,
        purchaseOrderId: sourceMode === 'PURCHASE_ORDER' ? sourceId : undefined,
        purchaseInvoiceId: sourceMode === 'PURCHASE_INVOICE' ? sourceId : undefined,
        receiptDate,
        remarks: remarks || null,
        sheetNumber: sheetNumber || null,
        lines: validLines.map(l => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
      }
      await apiFetch<PurchaseReceive>('/purchase-receives', { method: 'POST', body: JSON.stringify(body) })
      toast('Purchase receive posted successfully.', 'success')
      setOpen(false)
      reload()
    } catch {
      toast('Failed to post purchase receive.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<PurchaseReceive>(qs ? `/purchase-receives?${qs}` : '/purchase-receives', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(r => receiveSearchText(r).toLowerCase().includes(term)) : all
    const rows = matching.map(r => ({
      referenceNumber: r.referenceNumber,
      sheetNumber: r.sheetNumber ?? '',
      warehouse: r.warehouseName,
      supplier: r.supplierName,
      source: sourceLabel(r),
      date: formatDate(r.receiptDate),
      voided: r.voided ? 'Yes' : '',
      company: r.companyName,
    }))
    exportToXlsx('purchase-receives', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  async function handlePrint() {
    if (!activeReceive) return
    setPrinting(true)
    try {
      await print(activeReceive.companyId, 'PURCHASE_RECEIVE', activeReceive as unknown as Record<string, unknown>)
    } catch {
      toast(
        `No default print template configured for Purchase Receives under ${activeReceive.companyName}. Create one under Document Templates while ${activeReceive.companyName} is your active company.`,
        'error'
      )
    } finally {
      setPrinting(false)
    }
  }

  async function handleVoid() {
    if (!activeReceive) return
    if (!window.confirm(`Void purchase receive "${activeReceive.referenceNumber}"? This reverses its inventory effects and un-loads the source, and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<PurchaseReceive>(`/purchase-receives/${activeReceive.id}/void`, { method: 'POST' })
      setActiveReceive(voided)
      toast('Purchase receive voided.', 'success')
      reload()
    } catch {
      toast('Failed to void purchase receive.', 'error')
    } finally {
      setVoiding(false)
    }
  }

  const dialogTitle = mode === 'view' ? 'Purchase Receive Details' : 'New Purchase Receive'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Purchase Receives</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search purchase receives… (/)"
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
              New Purchase Receive
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

          {mode === 'view' && activeReceive ? (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Reference #</Label>
                  <div className="font-mono flex items-center gap-2">
                    {activeReceive.referenceNumber}
                    {activeReceive.voided && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                        Voided
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Sheet #</Label>
                  <div>{activeReceive.sheetNumber ?? '—'}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Warehouse</Label>
                  <div>{activeReceive.warehouseName}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Supplier</Label>
                  <div>{activeReceive.supplierName}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Receipt Date</Label>
                  <div>{formatDate(activeReceive.receiptDate)}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Source</Label>
                  <div>{sourceLabel(activeReceive)}</div>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Remarks</Label>
                  <div>{activeReceive.remarks ?? '—'}</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Lines</Label>
                <div className="rounded-md border border-[hsl(var(--border))] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/40">
                        <th className="text-left py-1.5 px-3 font-medium">Item</th>
                        <th className="text-right py-1.5 px-3 font-medium">Quantity Received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeReceive.lines.map(line => (
                        <tr key={line.id} className="border-b border-[hsl(var(--border))] last:border-0">
                          <td className="py-1.5 px-3">{line.itemCode} — {line.itemName}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums">{line.quantity}</td>
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
                    <span className="text-[hsl(var(--foreground))]">{activeReceive.companyName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Posted by</span>
                  <span className="text-[hsl(var(--foreground))]">{resolveDisplayName(activeReceive.createdBy)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Posted at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeReceive.createdAt)}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {canVoid && !activeReceive.voided && (
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
            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              {showCompanyColumn && (
                <div className="space-y-1.5">
                  <Label htmlFor="prcv-company">Company</Label>
                  <SearchableSelect
                    id="prcv-company"
                    value={companyId === '' ? '' : String(companyId)}
                    onChange={v => handleCompanyChange(v ? Number(v) : '')}
                    options={companyOptions.map(c => ({ value: String(c.id), label: c.name }))}
                    placeholder="Select a company…"
                    autoFocus
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="prcv-mode">Receive Against</Label>
                <SearchableSelect
                  id="prcv-mode"
                  value={sourceMode}
                  onChange={v => handleSourceModeChange((v || 'PURCHASE_ORDER') as SourceMode)}
                  options={[
                    { value: 'PURCHASE_ORDER', label: 'Purchase Order' },
                    { value: 'PURCHASE_INVOICE', label: 'Purchase Invoice (Direct)' },
                  ]}
                  disabled={!companyId}
                  autoFocus={!showCompanyColumn}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prcv-supplier">Supplier</Label>
                <SearchableSelect
                  id="prcv-supplier"
                  value={supplierId === '' ? '' : String(supplierId)}
                  onChange={v => handleSupplierChange(v ? Number(v) : '')}
                  options={formSuppliers.map(s => ({ value: String(s.id), label: s.name }))}
                  placeholder="Select a supplier…"
                  disabled={!companyId}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prcv-source">{sourceMode === 'PURCHASE_ORDER' ? 'Purchase Order' : 'Purchase Invoice'}</Label>
                <SearchableSelect
                  id="prcv-source"
                  value={sourceId === '' ? '' : String(sourceId)}
                  onChange={v => handleSourceChange(v ? Number(v) : '')}
                  options={(sourceMode === 'PURCHASE_ORDER' ? eligiblePurchaseOrders : eligiblePurchaseInvoices)
                    .map(s => ({ value: String(s.id), label: s.referenceNumber }))}
                  placeholder={supplierId ? 'Select a reference…' : 'Select a supplier first…'}
                  disabled={!supplierId}
                />
                {supplierId && (sourceMode === 'PURCHASE_ORDER' ? eligiblePurchaseOrders : eligiblePurchaseInvoices).length === 0 && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    No open (not voided, not yet fully processed) {sourceMode === 'PURCHASE_ORDER' ? 'purchase orders' : 'Direct purchase invoices'} found for this supplier.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prcv-warehouse">Warehouse</Label>
                <Input id="prcv-warehouse" value={warehouseName} readOnly placeholder="Derived from the selected source" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="prcv-date">Receipt Date</Label>
                  <Input id="prcv-date" type="date" value={receiptDate}
                    onChange={e => setReceiptDate(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prcv-sheet">Sheet #</Label>
                  <Input id="prcv-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} placeholder="Optional control number" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prcv-remarks">Remarks</Label>
                <Input id="prcv-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
              </div>

              <div className="space-y-1.5">
                <Label>Lines</Label>
                {lines.length === 0 ? (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    Select a source above to load its outstanding (not yet received) items.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] px-1">
                      <span className="flex-1">Item</span>
                      <span className="w-24 text-right">Outstanding</span>
                      <span className="w-28 text-right">Receive Now</span>
                    </div>
                    <div className="space-y-2">
                      {lines.map((line, i) => (
                        <div key={line.itemId} className="flex items-center gap-2">
                          <Input readOnly value={`${line.itemCode} — ${line.itemName}`} className="flex-1" />
                          <Input readOnly value={line.outstanding} className="w-24 text-right" />
                          <Input
                            type="number"
                            step="0.0001"
                            min="0"
                            max={line.outstanding}
                            value={line.quantity}
                            onChange={e => updateLine(i, { quantity: e.target.value })}
                            className="w-28"
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Purchase Receive</Button>
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
                {isVisible('source') && <th className="text-left py-2 px-4 font-medium">Source</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Receipt Date</th>}
                {isVisible('voided') && <th className="text-left py-2 px-4 font-medium">Voided</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'warehouse' && key !== 'supplier' && key !== 'company' && key !== 'source' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {receives.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No purchase receives match your search/filters.' : 'No purchase receives to display.'}
                  </td>
                </tr>
              ) : (
                receives.map((receive, i) => (
                  <tr
                    key={receive.id}
                    onClick={() => { setActiveIndex(i); openView(receive) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receive.companyName}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{receive.referenceNumber}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receive.sheetNumber ?? '—'}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receive.warehouseName}</td>}
                    {isVisible('supplier') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receive.supplierName}</td>}
                    {isVisible('source') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{sourceLabel(receive)}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(receive.receiptDate)}</td>}
                    {isVisible('voided') && (
                      <td className="py-2 px-4">
                        {receive.voided && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                            Voided
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openView(receive)}>
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
