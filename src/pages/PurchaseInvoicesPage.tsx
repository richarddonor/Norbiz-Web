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
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create'
type InvoiceMode = 'DIRECT' | 'PO_BASED'
type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
}

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

interface PurchaseOrderLine {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  quantity: string
  costPrice: string | null
}

interface PurchaseOrderOption {
  id: number
  companyId: number
  warehouseId: number
  supplierId: number
  referenceNumber: string
  voided: boolean
  loaded: boolean
  lines: PurchaseOrderLine[]
}

interface InvoiceLine {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  purchaseOrderLineId: number | null
  quantity: string
  costPrice: string | null
  discountPercentage: string
  lineNet: string | null
  quantityLoaded: string
}

interface InvoiceFee {
  id: number
  description: string
  amount: string
}

interface PurchaseInvoice {
  id: number
  companyId: number
  companyName: string
  warehouseId: number
  warehouseName: string
  supplierId: number
  supplierName: string
  purchaseOrderId: number | null
  purchaseOrderReferenceNumber: string | null
  referenceNumber: string
  sheetNumber: string | null
  invoiceDate: string
  remarks: string | null
  discountPercentage: string
  itemsSubtotal: string | null
  discountAmount: string | null
  feesTotal: string
  netPayable: string | null
  paymentStatus: PaymentStatus
  createdAt: string | null
  createdBy: string | null
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  loaded: boolean
  lines: InvoiceLine[]
  fees: InvoiceFee[]
}

interface LineDraft {
  itemId: number | ''
  quantity: string
  costPrice: string
  discountPercentage: string
}

interface FeeDraft {
  description: string
  amount: string
}

function buildColumns(showCompanyColumn: boolean, canViewCostPrice: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #' },
    { key: 'sheetNumber', label: 'Sheet #' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'purchaseOrder', label: 'Purchase Order' },
    { key: 'date', label: 'Invoice Date', type: 'date' },
    { key: 'paymentStatus', label: 'Payment Status' },
  )
  if (canViewCostPrice) columns.push({ key: 'netPayable', label: 'Net Payable' })
  columns.push({ key: 'voided', label: 'Voided', type: 'boolean' })
  return columns
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function invoiceSearchText(i: PurchaseInvoice): string {
  return [i.referenceNumber, i.sheetNumber ?? '', i.warehouseName, i.supplierName, i.purchaseOrderReferenceNumber ?? '', i.remarks ?? '', i.companyName, formatDate(i.invoiceDate)].join(' ')
}

export function PurchaseInvoicesPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn, companies } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const canViewCostPrice = hasPermission('VIEW_COST_PRICE')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn, canViewCostPrice), [showCompanyColumn, canViewCostPrice])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const { items: invoices, page, setPage, totalPages, totalElements, reload } = usePagedList<PurchaseInvoice>('/purchase-invoices', {
    onError: () => toast('Failed to load purchase invoices.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: invoiceSearchText,
  })
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [items, setItems] = useState<ItemOption[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([])
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [open, setOpen]                       = useState(false)
  const [mode, setMode]                       = useState<FormMode>('view')
  const [activeInvoice, setActiveInvoice]     = useState<PurchaseInvoice | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [invoiceMode, setInvoiceMode]         = useState<InvoiceMode>('DIRECT')
  const [purchaseOrderId, setPurchaseOrderId] = useState<number | ''>('')
  const [warehouseId, setWarehouseId]         = useState<number | ''>('')
  const [supplierId, setSupplierId]           = useState<number | ''>('')
  const [invoiceDate, setInvoiceDate]         = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [discountPercentage, setDiscountPercentage] = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([{ itemId: '', quantity: '', costPrice: '', discountPercentage: '' }])
  const [fees, setFees]                       = useState<FeeDraft[]>([])
  const [loading, setLoading]                 = useState(false)
  const formWarehouses = companyId ? warehouses.filter(w => w.companyId === companyId) : warehouses
  const formSuppliers = companyId ? suppliers.filter(s => s.companyId === companyId) : suppliers
  const formInventoryItems = (companyId ? items.filter(i => i.companyId === companyId) : items).filter(i => i.tags.includes('INVENTORY'))
  const supplierPurchaseOrders = purchaseOrders.filter(po => po.companyId === companyId && !po.voided && !po.loaded)
  const eligiblePurchaseOrders = supplierId ? supplierPurchaseOrders.filter(po => po.supplierId === supplierId) : []
  const selectedPurchaseOrder = purchaseOrderId ? eligiblePurchaseOrders.find(po => po.id === purchaseOrderId) ?? null : null
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('purchase-invoices')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()
  const { print, printPortal } = useDocumentPrint()
  const [printing, setPrinting] = useState(false)

  const canCreate = hasPermission('CREATE_PURCHASE_INVOICE')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_PURCHASE_INVOICE')
  const [voiding, setVoiding] = useState(false)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: invoices,
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
    fetchAllContent<PurchaseOrderOption>('/purchase-orders')
      .then(setPurchaseOrders)
      .catch(() => toast('Failed to load purchase orders.', 'error'))
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function openView(invoice: PurchaseInvoice) {
    setActiveInvoice(invoice)
    setMode('view')
    setOpen(true)
  }

  function openCreate() {
    setActiveInvoice(null)
    const nextCompanyId = activeCompanyId ?? ''
    const nextDate = todayIso()
    const nextLines: LineDraft[] = [{ itemId: '', quantity: '', costPrice: '', discountPercentage: '' }]
    setCompanyId(nextCompanyId)
    setInvoiceMode('DIRECT')
    setPurchaseOrderId('')
    setWarehouseId('')
    setSupplierId('')
    setInvoiceDate(nextDate)
    setRemarks('')
    setSheetNumber('')
    setDiscountPercentage('')
    setLines(nextLines)
    setFees([])
    markClean({
      companyId: nextCompanyId, invoiceMode: 'DIRECT', purchaseOrderId: '', warehouseId: '', supplierId: '',
      invoiceDate: nextDate, remarks: '', sheetNumber: '', discountPercentage: '', lines: nextLines, fees: [],
    })
    setMode('create')
    setOpen(true)
  }

  function requestClose() {
    guardedClose(
      { companyId, invoiceMode, purchaseOrderId, warehouseId, supplierId, invoiceDate, remarks, sheetNumber, discountPercentage, lines, fees },
      () => setOpen(false)
    )
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setInvoiceMode('DIRECT')
    setPurchaseOrderId('')
    setWarehouseId('')
    setSupplierId('')
    setLines([{ itemId: '', quantity: '', costPrice: '', discountPercentage: '' }])
  }

  function handleInvoiceModeChange(value: InvoiceMode) {
    setInvoiceMode(value)
    setPurchaseOrderId('')
    setWarehouseId('')
    setSupplierId('')
    setLines([{ itemId: '', quantity: '', costPrice: '', discountPercentage: '' }])
  }

  // PO-based mode: picking the Supplier narrows which Purchase Orders are selectable,
  // so changing it invalidates whatever PO/warehouse/lines were already derived.
  function handlePoSupplierChange(id: number | '') {
    setSupplierId(id)
    setPurchaseOrderId('')
    setWarehouseId('')
    setLines([{ itemId: '', quantity: '', costPrice: '', discountPercentage: '' }])
  }

  function handlePurchaseOrderChange(id: number | '') {
    setPurchaseOrderId(id)
    const po = id ? eligiblePurchaseOrders.find(p => p.id === id) ?? null : null
    if (po) {
      setWarehouseId(po.warehouseId)
      setLines(po.lines.map(l => ({ itemId: l.itemId, quantity: l.quantity, costPrice: l.costPrice ?? '', discountPercentage: '' })))
    } else {
      setWarehouseId('')
      setLines([{ itemId: '', quantity: '', costPrice: '', discountPercentage: '' }])
    }
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
    setLines(prev => [...prev, { itemId: '', quantity: '', costPrice: '', discountPercentage: '' }])
  }

  function removeLine(index: number) {
    setLines(prev => prev.filter((_, i) => i !== index))
  }

  function updateFee(index: number, patch: Partial<FeeDraft>) {
    setFees(prev => prev.map((fee, i) => i === index ? { ...fee, ...patch } : fee))
  }

  function addFee() {
    setFees(prev => [...prev, { description: '', amount: '' }])
  }

  function removeFee(index: number) {
    setFees(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (invoiceMode === 'PO_BASED' && !supplierId) {
      toast('Select a supplier.', 'error')
      return
    }
    if (invoiceMode === 'PO_BASED' && !purchaseOrderId) {
      toast('Select a purchase order to invoice against.', 'error')
      return
    }
    if (invoiceMode === 'DIRECT' && !warehouseId) {
      toast('Select a warehouse.', 'error')
      return
    }
    if (invoiceMode === 'DIRECT' && !supplierId) {
      toast('Select a supplier.', 'error')
      return
    }
    const validLines = lines.filter(l => l.itemId !== '' && (invoiceMode === 'PO_BASED' || l.quantity.trim() !== ''))
    if (invoiceMode === 'DIRECT' && validLines.length === 0) {
      toast('Add at least one line with an item and quantity.', 'error')
      return
    }
    const validFees = fees.filter(f => f.description.trim() !== '' && f.amount.trim() !== '')
    if (!window.confirm('Post this purchase invoice? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        warehouseId,
        supplierId,
        purchaseOrderId: invoiceMode === 'PO_BASED' ? purchaseOrderId : undefined,
        invoiceDate,
        remarks: remarks || null,
        sheetNumber: sheetNumber || null,
        discountPercentage: discountPercentage.trim() !== '' ? Number(discountPercentage) : undefined,
        fees: validFees.map(f => ({ description: f.description, amount: Number(f.amount) })),
        lines: validLines.map(l => ({
          itemId: l.itemId,
          quantity: invoiceMode === 'DIRECT' && l.quantity.trim() !== '' ? Number(l.quantity) : undefined,
          costPrice: invoiceMode === 'DIRECT' && canViewCostPrice && l.costPrice.trim() !== '' ? Number(l.costPrice) : undefined,
          discountPercentage: l.discountPercentage.trim() !== '' ? Number(l.discountPercentage) : undefined,
        })),
      }
      await apiFetch<PurchaseInvoice>('/purchase-invoices', { method: 'POST', body: JSON.stringify(body) })
      toast('Purchase invoice posted successfully.', 'success')
      setOpen(false)
      reload()
    } catch {
      toast('Failed to post purchase invoice.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<PurchaseInvoice>(qs ? `/purchase-invoices?${qs}` : '/purchase-invoices', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(i => invoiceSearchText(i).toLowerCase().includes(term)) : all
    const rows = matching.map(i => ({
      referenceNumber: i.referenceNumber,
      sheetNumber: i.sheetNumber ?? '',
      warehouse: i.warehouseName,
      supplier: i.supplierName,
      purchaseOrder: i.purchaseOrderReferenceNumber ?? 'Direct',
      date: formatDate(i.invoiceDate),
      paymentStatus: PAYMENT_STATUS_LABELS[i.paymentStatus],
      netPayable: i.netPayable !== null ? formatCurrency(i.netPayable) : '',
      voided: i.voided ? 'Yes' : '',
      company: i.companyName,
    }))
    exportToXlsx('purchase-invoices', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  async function handlePrint() {
    if (!activeInvoice) return
    setPrinting(true)
    try {
      await print(activeInvoice.companyId, 'PURCHASE_INVOICE', activeInvoice as unknown as Record<string, unknown>)
    } catch {
      toast(
        `No default print template configured for Purchase Invoices under ${activeInvoice.companyName}. Create one under Document Templates while ${activeInvoice.companyName} is your active company.`,
        'error'
      )
    } finally {
      setPrinting(false)
    }
  }

  async function handleVoid() {
    if (!activeInvoice) return
    if (!window.confirm(`Void purchase invoice "${activeInvoice.referenceNumber}"? This reverses its inventory/loading effects and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<PurchaseInvoice>(`/purchase-invoices/${activeInvoice.id}/void`, { method: 'POST' })
      setActiveInvoice(voided)
      toast('Purchase invoice voided.', 'success')
      reload()
    } catch {
      toast('Failed to void purchase invoice.', 'error')
    } finally {
      setVoiding(false)
    }
  }

  const dialogTitle = mode === 'view' ? 'Purchase Invoice Details' : 'New Purchase Invoice'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Purchase Invoices</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search purchase invoices… (/)"
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
              New Purchase Invoice
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

          {mode === 'view' && activeInvoice ? (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Reference #</Label>
                  <div className="font-mono flex items-center gap-2">
                    {activeInvoice.referenceNumber}
                    {activeInvoice.voided && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                        Voided
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Sheet #</Label>
                  <div>{activeInvoice.sheetNumber ?? '—'}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Warehouse</Label>
                  <div>{activeInvoice.warehouseName}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Supplier</Label>
                  <div>{activeInvoice.supplierName}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Invoice Date</Label>
                  <div>{formatDate(activeInvoice.invoiceDate)}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Payment Status</Label>
                  <div>{PAYMENT_STATUS_LABELS[activeInvoice.paymentStatus]}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Purchase Order</Label>
                  <div>{activeInvoice.purchaseOrderReferenceNumber ?? 'Direct (no backing PO)'}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Discount %</Label>
                  <div>{activeInvoice.discountPercentage}</div>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Remarks</Label>
                  <div>{activeInvoice.remarks ?? '—'}</div>
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
                        <th className="text-right py-1.5 px-3 font-medium">Discount %</th>
                        {canViewCostPrice && <th className="text-right py-1.5 px-3 font-medium">Line Net</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {activeInvoice.lines.map(line => (
                        <tr key={line.id} className="border-b border-[hsl(var(--border))] last:border-0">
                          <td className="py-1.5 px-3">{line.itemCode} — {line.itemName}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums">{line.quantity}</td>
                          {canViewCostPrice && <td className="py-1.5 px-3 text-right tabular-nums">{line.costPrice ?? '—'}</td>}
                          <td className="py-1.5 px-3 text-right tabular-nums">{line.discountPercentage}</td>
                          {canViewCostPrice && <td className="py-1.5 px-3 text-right tabular-nums">{line.lineNet !== null ? formatCurrency(line.lineNet) : '—'}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {activeInvoice.fees.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Additional Fees</Label>
                  <div className="rounded-md border border-[hsl(var(--border))] overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/40">
                          <th className="text-left py-1.5 px-3 font-medium">Description</th>
                          <th className="text-right py-1.5 px-3 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeInvoice.fees.map(fee => (
                          <tr key={fee.id} className="border-b border-[hsl(var(--border))] last:border-0">
                            <td className="py-1.5 px-3">{fee.description}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums">{formatCurrency(fee.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                {showCompanyColumn && (
                  <div className="flex justify-between">
                    <span>Company</span>
                    <span className="text-[hsl(var(--foreground))]">{activeInvoice.companyName}</span>
                  </div>
                )}
                {canViewCostPrice && (
                  <>
                    <div className="flex justify-between">
                      <span>Items Subtotal</span>
                      <span className="text-[hsl(var(--foreground))]">{formatCurrency(activeInvoice.itemsSubtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Discount Amount</span>
                      <span className="text-[hsl(var(--foreground))]">{formatCurrency(activeInvoice.discountAmount)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span>Fees Total</span>
                  <span className="text-[hsl(var(--foreground))]">{formatCurrency(activeInvoice.feesTotal)}</span>
                </div>
                {canViewCostPrice && (
                  <div className="flex justify-between font-medium">
                    <span>Net Payable</span>
                    <span className="text-[hsl(var(--foreground))]">{formatCurrency(activeInvoice.netPayable)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Posted by</span>
                  <span className="text-[hsl(var(--foreground))]">{resolveDisplayName(activeInvoice.createdBy)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Posted at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeInvoice.createdAt)}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {canVoid && !activeInvoice.voided && (
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
            <form onSubmit={handleSubmit} className="space-y-4 mt-2" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && invoiceMode === 'DIRECT') { e.preventDefault(); addLine() } }}>
              {showCompanyColumn && (
                <div className="space-y-1.5">
                  <Label htmlFor="pinv-company">Company</Label>
                  <SearchableSelect
                    id="pinv-company"
                    value={companyId === '' ? '' : String(companyId)}
                    onChange={v => handleCompanyChange(v ? Number(v) : '')}
                    options={companyOptions.map(c => ({ value: String(c.id), label: c.name }))}
                    placeholder="Select a company…"
                    autoFocus
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="pinv-mode">Invoice Mode</Label>
                <SearchableSelect
                  id="pinv-mode"
                  value={invoiceMode}
                  onChange={v => handleInvoiceModeChange((v || 'DIRECT') as InvoiceMode)}
                  options={[
                    { value: 'DIRECT', label: 'Direct (no backing Purchase Order)' },
                    { value: 'PO_BASED', label: 'Against a Purchase Order' },
                  ]}
                  disabled={!companyId}
                  autoFocus={!showCompanyColumn}
                />
              </div>

              {invoiceMode === 'PO_BASED' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="pinv-po-supplier">Supplier</Label>
                    <SearchableSelect
                      id="pinv-po-supplier"
                      value={supplierId === '' ? '' : String(supplierId)}
                      onChange={v => handlePoSupplierChange(v ? Number(v) : '')}
                      options={formSuppliers.map(s => ({ value: String(s.id), label: s.name }))}
                      placeholder="Select a supplier…"
                      disabled={!companyId}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pinv-po">Purchase Order</Label>
                    <SearchableSelect
                      id="pinv-po"
                      value={purchaseOrderId === '' ? '' : String(purchaseOrderId)}
                      onChange={v => handlePurchaseOrderChange(v ? Number(v) : '')}
                      options={eligiblePurchaseOrders.map(po => ({ value: String(po.id), label: po.referenceNumber }))}
                      placeholder={supplierId ? 'Select a purchase order…' : 'Select a supplier first…'}
                      disabled={!supplierId}
                    />
                    {supplierId && eligiblePurchaseOrders.length === 0 && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        No open (not voided, not yet invoiced) purchase orders found for this supplier.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pinv-warehouse">Warehouse</Label>
                    <Input id="pinv-warehouse" value={selectedPurchaseOrder ? formWarehouses.find(w => w.id === warehouseId)?.name ?? '' : ''} readOnly placeholder="Derived from the selected purchase order" />
                  </div>
                </>
              )}

              {invoiceMode === 'DIRECT' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pinv-warehouse">Warehouse</Label>
                    <SearchableSelect
                      id="pinv-warehouse"
                      value={warehouseId === '' ? '' : String(warehouseId)}
                      onChange={v => setWarehouseId(v ? Number(v) : '')}
                      options={formWarehouses.map(w => ({ value: String(w.id), label: w.name }))}
                      placeholder="Select a warehouse…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pinv-supplier">Supplier</Label>
                    <SearchableSelect
                      id="pinv-supplier"
                      value={supplierId === '' ? '' : String(supplierId)}
                      onChange={v => setSupplierId(v ? Number(v) : '')}
                      options={formSuppliers.map(s => ({ value: String(s.id), label: s.name }))}
                      placeholder="Select a supplier…"
                    />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pinv-date">Invoice Date</Label>
                  <Input id="pinv-date" type="date" value={invoiceDate}
                    onChange={e => setInvoiceDate(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pinv-discount">Discount % (header)</Label>
                  <Input id="pinv-discount" type="number" step="0.01" min="0" max="100" value={discountPercentage}
                    onChange={e => setDiscountPercentage(e.target.value)} placeholder="0" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pinv-sheet">Sheet #</Label>
                <Input id="pinv-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} placeholder="Optional control number" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pinv-remarks">Remarks</Label>
                <Input id="pinv-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Lines</Label>
                  {invoiceMode === 'DIRECT' && (
                    <Button type="button" variant="outline" size="sm" onClick={addLine}>
                      <Plus className="w-3.5 h-3.5" />
                      Add Line
                      <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">Ctrl+Enter</kbd>
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {lines.map((line, i) => {
                    const item = items.find(it => it.id === line.itemId)
                    return (
                      <div key={i} className="flex items-center gap-2">
                        {invoiceMode === 'PO_BASED' ? (
                          <Input readOnly value={item ? `${item.itemCode} — ${item.name}` : ''} className="flex-1" />
                        ) : (
                          <div className="flex-1">
                            <SearchableSelect
                              value={line.itemId === '' ? '' : String(line.itemId)}
                              onChange={v => handleLineItemChange(i, v ? Number(v) : '')}
                              options={formInventoryItems.map(opt => ({ value: String(opt.id), label: `${opt.itemCode} — ${opt.name}` }))}
                              placeholder="Select an item…"
                            />
                          </div>
                        )}
                        <Input
                          type="number"
                          step="0.0001"
                          placeholder="Quantity"
                          value={line.quantity}
                          onChange={e => updateLine(i, { quantity: e.target.value })}
                          readOnly={invoiceMode === 'PO_BASED'}
                          className="w-24"
                        />
                        {canViewCostPrice && (
                          <Input
                            type="number"
                            step="0.0001"
                            placeholder="Cost Price"
                            value={line.costPrice}
                            onChange={e => updateLine(i, { costPrice: e.target.value })}
                            readOnly={invoiceMode === 'PO_BASED'}
                            className="w-24"
                          />
                        )}
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          placeholder="Disc %"
                          value={line.discountPercentage}
                          onChange={e => updateLine(i, { discountPercentage: e.target.value })}
                          className="w-20"
                        />
                        {invoiceMode === 'DIRECT' && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)} disabled={lines.length === 1}>
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
                {invoiceMode === 'DIRECT' && formInventoryItems.length === 0 && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    No items are tagged Inventory — tag an item on the Items page before posting a purchase invoice.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Additional Fees</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addFee}>
                    <Plus className="w-3.5 h-3.5" />
                    Add Fee
                  </Button>
                </div>
                <div className="space-y-2">
                  {fees.map((fee, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder="Description"
                        value={fee.description}
                        onChange={e => updateFee(i, { description: e.target.value })}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Amount"
                        value={fee.amount}
                        onChange={e => updateFee(i, { amount: e.target.value })}
                        className="w-28"
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeFee(i)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Purchase Invoice</Button>
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
                {isVisible('purchaseOrder') && <th className="text-left py-2 px-4 font-medium">Purchase Order</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Invoice Date</th>}
                {isVisible('paymentStatus') && <th className="text-left py-2 px-4 font-medium">Payment Status</th>}
                {canViewCostPrice && isVisible('netPayable') && <th className="text-right py-2 px-4 font-medium">Net Payable</th>}
                {isVisible('voided') && <th className="text-left py-2 px-4 font-medium">Voided</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'warehouse' && key !== 'supplier' && key !== 'company' && key !== 'purchaseOrder' && key !== 'paymentStatus' && key !== 'netPayable' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No purchase invoices match your search/filters.' : 'No purchase invoices to display.'}
                  </td>
                </tr>
              ) : (
                invoices.map((invoice, i) => (
                  <tr
                    key={invoice.id}
                    onClick={() => { setActiveIndex(i); openView(invoice) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{invoice.companyName}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{invoice.referenceNumber}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{invoice.sheetNumber ?? '—'}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{invoice.warehouseName}</td>}
                    {isVisible('supplier') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{invoice.supplierName}</td>}
                    {isVisible('purchaseOrder') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{invoice.purchaseOrderReferenceNumber ?? 'Direct'}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(invoice.invoiceDate)}</td>}
                    {isVisible('paymentStatus') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{PAYMENT_STATUS_LABELS[invoice.paymentStatus]}</td>}
                    {canViewCostPrice && isVisible('netPayable') && <td className="py-2 px-4 text-right tabular-nums">{formatCurrency(invoice.netPayable)}</td>}
                    {isVisible('voided') && (
                      <td className="py-2 px-4">
                        {invoice.voided && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                            Voided
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openView(invoice)}>
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
