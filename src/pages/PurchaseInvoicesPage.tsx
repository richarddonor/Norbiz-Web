import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Eye, Search, FileDown, Printer, Ban, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocLines, DocSection, DocTotals, DocStamp, PendingNumber } from '@/components/ui/doc-form'
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
import { useDocumentPrint } from '@/hooks/useDocumentPrint'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, type LookupOption, type ItemLookupOption, type TransactionLookupOption } from '@/lib/lookups'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'

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

interface InvoiceLine {
  id: number
  lineNumber: number
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

  const inRecordTab = useIsRecordTab()
  const { items: invoices, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<PurchaseInvoice>('/purchase-invoices', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load purchase invoices.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: invoiceSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<PurchaseInvoice>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<PurchaseInvoice>(`/purchase-invoices/${id}`),
  })
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
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const formWarehouses = useLookup<LookupOption>('warehouses', lookupCompanyId, { onError: () => toast('Failed to load warehouses.', 'error') })
  const formSuppliers = useLookup<LookupOption>('suppliers', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load suppliers.', 'error') })
  const formInventoryItems = useLookup<ItemLookupOption>('items', lookupCompanyId, { enabled: creating, params: { tag: 'INVENTORY' }, onError: () => toast('Failed to load items.', 'error') })
  // Open (not voided, not fully loaded) POs only — the backend lookup's default.
  const openPurchaseOrders = useLookup<TransactionLookupOption>('purchase-orders', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load purchase orders.', 'error') })
  const eligiblePurchaseOrders = supplierId ? openPurchaseOrders.filter(po => po.supplierId === supplierId) : []
  const selectedPurchaseOrder = purchaseOrderId ? eligiblePurchaseOrders.find(po => po.id === purchaseOrderId) ?? null : null
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('purchase-invoices')
  const { markClean, guardedClose } = useDirtyGuard()
  const { print, printPortal } = useDocumentPrint()
  const [printing, setPrinting] = useState(false)

  const canCreate = hasPermission('CREATE_PURCHASE_INVOICE')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_PURCHASE_INVOICE')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('PURCHASE_INVOICE', inRecordTab && mode === 'view' ? activeInvoice?.id : null, activeInvoice?.referenceNumber, activeInvoice?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: invoices,
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

  function openView(invoice: PurchaseInvoice) {
    if (!rec.isRecordTab) return rec.open('view', invoice)
    setActiveInvoice(invoice)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
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
  }

  function requestClose() {
    guardedClose(
      { companyId, invoiceMode, purchaseOrderId, warehouseId, supplierId, invoiceDate, remarks, sheetNumber, discountPercentage, lines, fees },
      () => rec.close()
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
      setLines(byLineNumber(po.lines).map(l => ({ itemId: l.itemId, quantity: String(l.quantity), costPrice: l.costPrice != null ? String(l.costPrice) : '', discountPercentage: '' })))
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
      const item = formInventoryItems.find(i => i.id === itemId)
      costPrice = item?.costPrice != null ? String(item.costPrice) : ''
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
      rec.close()
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

  const recordName = activeInvoice?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Purchase Invoice' : recordName || 'Purchase Invoice'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
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
          {mode === 'view' && activeInvoice ? (
            <div className="space-y-4">
              <DocSheet>
                {activeInvoice.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="pinv-company" readOnly name={activeInvoice.companyName} />}>
                  <DocHeader title="Purchase Invoice" number={activeInvoice.referenceNumber}>
                    <DocRow>
                      <DocCell label="Invoice Date"><DocText>{formatDate(activeInvoice.invoiceDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeInvoice.sheetNumber}</DocText></DocCell>
                    </DocRow>
                    <DocRow>
                      <DocCell label="Payment Status"><DocText>{PAYMENT_STATUS_LABELS[activeInvoice.paymentStatus]}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Supplier"><DocText>{activeInvoice.supplierName}</DocText></DocCell>
                  <DocCell label="Deliver To (Warehouse)"><DocText>{activeInvoice.warehouseName}</DocText></DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Purchase Order No.">
                    <DocText>{activeInvoice.purchaseOrderReferenceNumber ?? 'Direct (no backing PO)'}</DocText>
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activeInvoice.lines)}
                  rowKey={line => line.id}
                  lineNumber={line => line.lineNumber}
                  minRows={5}
                  columns={[
                    { key: 'item', label: 'Item', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity', align: 'right', width: '7rem', render: line => line.quantity },
                    canViewCostPrice && { key: 'costPrice', label: 'Unit Cost', align: 'right', width: '8rem', render: line => formatCurrency(line.costPrice) },
                    { key: 'discount', label: 'Disc %', align: 'right', width: '5.5rem', render: line => line.discountPercentage },
                    canViewCostPrice && { key: 'lineNet', label: 'Amount', align: 'right', width: '9rem', render: line => formatCurrency(line.lineNet) },
                  ]}
                />
                {activeInvoice.fees.length > 0 && (
                  <>
                    <DocSection title="Additional Fees" />
                    <DocLines
                      rows={activeInvoice.fees}
                      rowKey={fee => fee.id}
                      columns={[
                        { key: 'description', label: 'Description', render: fee => fee.description },
                        { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: fee => formatCurrency(fee.amount) },
                      ]}
                    />
                  </>
                )}
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{activeInvoice.remarks}</DocText></DocCell>
                  <DocTotals entries={[
                    ...(canViewCostPrice ? [{ label: 'Items Subtotal', value: formatCurrency(activeInvoice.itemsSubtotal) }] : []),
                    {
                      label: `Less: Discount (${activeInvoice.discountPercentage}%)`,
                      value: canViewCostPrice ? formatCurrency(activeInvoice.discountAmount) : '',
                    },
                    { label: 'Add: Fees', value: formatCurrency(activeInvoice.feesTotal) },
                    ...(canViewCostPrice ? [{ label: 'Net Payable', value: formatCurrency(activeInvoice.netPayable), grand: true }] : []),
                  ]} />
                </DocRow>
                <TransactionHistory activity={activity} record={activeInvoice} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activeInvoice.voided} />
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
            <form onSubmit={handleSubmit} className="space-y-4" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && invoiceMode === 'DIRECT') { e.preventDefault(); addLine() } }}>
              <DocSheet>
                <DocLetterhead company={
                    <CompanyField
                      id="pinv-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Purchase Invoice" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Invoice Date" htmlFor="pinv-date">
                        <Input id="pinv-date" type="date" value={invoiceDate}
                          onChange={e => setInvoiceDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="pinv-sheet">
                        <Input id="pinv-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                    <DocRow>
                      <DocCell label="Invoice Type" htmlFor="pinv-mode">
                        <SearchableSelect
                          id="pinv-mode"
                          value={invoiceMode}
                          onChange={v => handleInvoiceModeChange((v || 'DIRECT') as InvoiceMode)}
                          options={[
                            { value: 'DIRECT', label: 'Direct (no backing Purchase Order)' },
                            { value: 'PO_BASED', label: 'Against a Purchase Order' },
                          ]}
                          disabled={!companyId}
                        />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Supplier" htmlFor="pinv-supplier">
                    <SearchableSelect
                      id="pinv-supplier"
                      value={supplierId === '' ? '' : String(supplierId)}
                      onChange={v => invoiceMode === 'PO_BASED'
                        ? handlePoSupplierChange(v ? Number(v) : '')
                        : setSupplierId(v ? Number(v) : '')}
                      options={formSuppliers.map(s => ({ value: String(s.id), label: s.name }))}
                      disabled={!companyId}
                      autoFocus={!showCompanyColumn}
                    />
                  </DocCell>
                  <DocCell label="Deliver To (Warehouse)" htmlFor={invoiceMode === 'DIRECT' ? 'pinv-warehouse' : undefined}>
                    {invoiceMode === 'DIRECT' ? (
                      <SearchableSelect
                        id="pinv-warehouse"
                        value={warehouseId === '' ? '' : String(warehouseId)}
                        onChange={v => setWarehouseId(v ? Number(v) : '')}
                        options={formWarehouses.map(w => ({ value: String(w.id), label: w.name }))}
                      />
                    ) : (
                      <DocText className={cn(!selectedPurchaseOrder && 'italic text-[hsl(var(--muted-foreground))]')}>
                        {selectedPurchaseOrder
                          ? selectedPurchaseOrder.warehouseName
                          : 'Derived from the selected purchase order'}
                      </DocText>
                    )}
                  </DocCell>
                </DocRow>
                {invoiceMode === 'PO_BASED' && (
                  <DocRow>
                    <DocCell label="Purchase Order No." htmlFor="pinv-po">
                      <SearchableSelect
                        id="pinv-po"
                        value={purchaseOrderId === '' ? '' : String(purchaseOrderId)}
                        onChange={v => handlePurchaseOrderChange(v ? Number(v) : '')}
                        options={eligiblePurchaseOrders.map(po => ({ value: String(po.id), label: po.referenceNumber }))}
                        placeholder={supplierId ? undefined : 'Select a supplier first…'}
                        disabled={!supplierId}
                      />
                      {supplierId && eligiblePurchaseOrders.length === 0 && (
                        <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">
                          No open (not voided, not yet invoiced) purchase orders found for this supplier.
                        </p>
                      )}
                    </DocCell>
                  </DocRow>
                )}
                <DocLines
                  rows={lines}
                  columns={[
                    {
                      key: 'item', label: 'Item',
                      render: (line, i) => {
                        if (invoiceMode === 'PO_BASED') {
                          const poLine = selectedPurchaseOrder?.lines.find(l => l.itemId === line.itemId)
                          return <DocText>{poLine ? `${poLine.itemCode} — ${poLine.itemName}` : ''}</DocText>
                        }
                        return (
                          <SearchableSelect
                            value={line.itemId === '' ? '' : String(line.itemId)}
                            onChange={v => handleLineItemChange(i, v ? Number(v) : '')}
                            options={formInventoryItems.map(opt => ({ value: String(opt.id), label: `${opt.code} — ${opt.name}` }))}
                          />
                        )
                      },
                    },
                    {
                      key: 'quantity', label: 'Quantity', align: 'right', width: '7rem',
                      render: (line, i) => invoiceMode === 'PO_BASED' ? line.quantity : (
                        <Input type="number" step="0.0001" aria-label={`Line ${i + 1} quantity`} value={line.quantity}
                          onChange={e => updateLine(i, { quantity: e.target.value })} className="text-right" />
                      ),
                    },
                    canViewCostPrice && {
                      key: 'costPrice', label: 'Unit Cost', align: 'right', width: '8rem',
                      render: (line, i) => invoiceMode === 'PO_BASED' ? formatCurrency(line.costPrice) : (
                        <Input type="number" step="0.0001" aria-label={`Line ${i + 1} unit cost`} value={line.costPrice}
                          onChange={e => updateLine(i, { costPrice: e.target.value })} className="text-right" />
                      ),
                    },
                    {
                      key: 'discount', label: 'Disc %', align: 'right', width: '5.5rem',
                      render: (line, i) => (
                        <Input type="number" step="0.01" min="0" max="100" aria-label={`Line ${i + 1} discount percent`}
                          value={line.discountPercentage} onChange={e => updateLine(i, { discountPercentage: e.target.value })}
                          className="text-right" />
                      ),
                    },
                    invoiceMode === 'DIRECT' && {
                      key: 'remove', label: '', align: 'center', width: '2.75rem',
                      render: (_, i) => (
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove line ${i + 1}`}
                          onClick={() => removeLine(i)} disabled={lines.length === 1}>
                          <X className="w-4 h-4" />
                        </Button>
                      ),
                    },
                  ]}
                  footer={invoiceMode === 'DIRECT' && (
                    <div className="flex items-center justify-between gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={addLine}>
                        <Plus className="w-3.5 h-3.5" />
                        Add Line
                        <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">Ctrl+Enter</kbd>
                      </Button>
                      {formInventoryItems.length === 0 && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          No items are tagged Inventory — tag an item on the Items page before posting a purchase invoice.
                        </span>
                      )}
                    </div>
                  )}
                />
                <DocSection
                  title="Additional Fees"
                  action={
                    <Button type="button" variant="ghost" size="sm" className="h-6" onClick={addFee}>
                      <Plus className="w-3.5 h-3.5" />
                      Add Fee
                    </Button>
                  }
                />
                {fees.length > 0 && (
                  <DocLines
                    rows={fees}
                    columns={[
                      {
                        key: 'description', label: 'Description',
                        render: (fee, i) => (
                          <Input aria-label={`Fee ${i + 1} description`} value={fee.description}
                            onChange={e => updateFee(i, { description: e.target.value })} />
                        ),
                      },
                      {
                        key: 'amount', label: 'Amount', align: 'right', width: '9rem',
                        render: (fee, i) => (
                          <Input type="number" step="0.01" aria-label={`Fee ${i + 1} amount`} value={fee.amount}
                            onChange={e => updateFee(i, { amount: e.target.value })} className="text-right" />
                        ),
                      },
                      {
                        key: 'remove', label: '', align: 'center', width: '2.75rem',
                        render: (_, i) => (
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove fee ${i + 1}`}
                            onClick={() => removeFee(i)}>
                            <X className="w-4 h-4" />
                          </Button>
                        ),
                      },
                    ]}
                  />
                )}
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="pinv-remarks">
                    <Input id="pinv-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocCell label="Less: Invoice Discount %" htmlFor="pinv-discount" align="right">
                    <Input id="pinv-discount" type="number" step="0.01" min="0" max="100" value={discountPercentage}
                      onChange={e => setDiscountPercentage(e.target.value)} className="text-right" />
                  </DocCell>
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Purchase Invoice</Button>
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
      </>)}
      {printPortal}
    </div>
  )
}
