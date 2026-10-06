import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Eye, Search, FileDown, Ban } from 'lucide-react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
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
import { useLookup, useStock, type LookupOption, type TransactionLookupOption } from '@/lib/lookups'
import { StockCell } from '@/components/StockCell'
import { formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'

type FormMode = 'view' | 'create'
type SourceMode = 'PURCHASE_ORDER' | 'PURCHASE_INVOICE'

interface CompanyOption {
  id: number
  name: string
}

interface ReceiveLine {
  id: number
  lineNumber: number
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

  const inRecordTab = useIsRecordTab()
  const { items: receives, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<PurchaseReceive>('/purchase-receives', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load purchase receives.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: receiveSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<PurchaseReceive>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<PurchaseReceive>(`/purchase-receives/${id}`),
  })
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
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const warehouses = useLookup<LookupOption>('warehouses', lookupCompanyId, { enabled: !inRecordTab, onError: () => toast('Failed to load warehouses.', 'error') })
  const formSuppliers = useLookup<LookupOption>('suppliers', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load suppliers.', 'error') })
  // The lookups' openOnly default already drops voided/fully-loaded sources, and for invoices
  // keeps only Direct-mode ones (a PO-based invoice is received against its PO instead).
  const openPurchaseOrders = useLookup<TransactionLookupOption>('purchase-orders', lookupCompanyId, { enabled: creating && sourceMode === 'PURCHASE_ORDER', onError: () => toast('Failed to load purchase orders.', 'error') })
  const openPurchaseInvoices = useLookup<TransactionLookupOption>('purchase-invoices', lookupCompanyId, { enabled: creating && sourceMode !== 'PURCHASE_ORDER', onError: () => toast('Failed to load purchase invoices.', 'error') })
  const eligiblePurchaseOrders = supplierId ? openPurchaseOrders.filter(po => po.supplierId === supplierId) : []
  const eligiblePurchaseInvoices = supplierId ? openPurchaseInvoices.filter(inv => inv.supplierId === supplierId) : []
  const selectedSource = sourceId
    ? (sourceMode === 'PURCHASE_ORDER' ? eligiblePurchaseOrders : eligiblePurchaseInvoices).find(src => src.id === sourceId)
    : undefined
  const warehouseName = warehouseId ? selectedSource?.warehouseName ?? '' : ''
  // A receive moves stock from transit into on hand, so both balances are shown as a guide while creating.
  const stock = useStock(lookupCompanyId, warehouseId, lines.map(l => l.itemId), { enabled: creating, onError: () => toast('Failed to load stock balances.', 'error') })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, menu: columnMenu } = useColumnVisibility('purchase-receives')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_PURCHASE_RECEIVE')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_PURCHASE_RECEIVE')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('PURCHASE_RECEIVE', inRecordTab && mode === 'view' ? activeReceive?.id : null, activeReceive?.referenceNumber, activeReceive?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: receives,
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

  function openView(receive: PurchaseReceive) {
    if (!rec.isRecordTab) return rec.open('view', receive)
    setActiveReceive(receive)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
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
  }

  function requestClose() {
    guardedClose(
      { companyId, sourceMode, supplierId, sourceId, warehouseId, receiptDate, remarks, sheetNumber, lines },
      () => rec.close()
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

  function outstandingLinesOf(source: TransactionLookupOption): LineDraft[] {
    return byLineNumber(source.lines)
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
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post purchase receive.'), 'error')
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

  function printFailed() {
    if (!activeReceive) return
    toast(
      `No active print template configured for Purchase Receives under ${activeReceive.companyName}. Create one under Document Templates while ${activeReceive.companyName} is your active company.`,
      'error'
    )
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
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void purchase receive.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const recordName = activeReceive?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Purchase Receive' : recordName || 'Purchase Receive'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
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
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} {...columnMenu} />
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
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-3xl">
          {mode === 'view' && activeReceive ? (
            <div className="space-y-4">
              <DocSheet>
                {activeReceive.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="prcv-company" readOnly name={activeReceive.companyName} />}>
                  <DocHeader title="Receiving Report" number={activeReceive.referenceNumber}>
                    <DocRow>
                      <DocCell label="Receipt Date"><DocText>{formatDate(activeReceive.receiptDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeReceive.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Supplier"><DocText>{activeReceive.supplierName}</DocText></DocCell>
                  <DocCell label="Received At (Warehouse)"><DocText>{activeReceive.warehouseName}</DocText></DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Received Against"><DocText>{sourceLabel(activeReceive)}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activeReceive.lines)}
                  rowKey={line => line.id}
                  lineNumber={line => line.lineNumber}
                  minRows={5}
                  columns={[
                    { key: 'item', label: 'Item', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity Received', align: 'right', width: '10rem', render: line => line.quantity },
                  ]}
                />
                <DocRow>
                  <DocCell label="Remarks"><DocText>{activeReceive.remarks}</DocText></DocCell>
                </DocRow>
                <TransactionHistory activity={activity} record={activeReceive} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activeReceive.voided} />
                {canVoid && !activeReceive.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton
                    companyId={activeReceive.companyId}
                    documentType="PURCHASE_RECEIVE"
                    data={activeReceive as unknown as Record<string, unknown>}
                    onError={printFailed}
                  />
                )}
                <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <DocSheet>
                <DocLetterhead company={
                    <CompanyField
                      id="prcv-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Receiving Report" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Receipt Date" htmlFor="prcv-date" required>
                        <Input id="prcv-date" type="date" value={receiptDate}
                          onChange={e => setReceiptDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="prcv-sheet">
                        <Input id="prcv-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Supplier" htmlFor="prcv-supplier" required>
                    <SearchableSelect
                      id="prcv-supplier"
                      value={supplierId === '' ? '' : String(supplierId)}
                      onChange={v => handleSupplierChange(v ? Number(v) : '')}
                      options={formSuppliers.map(s => ({ value: String(s.id), label: s.name }))}
                      disabled={!companyId}
                      autoFocus={!showCompanyColumn}
                    />
                  </DocCell>
                  <DocCell label="Received At (Warehouse)">
                    <DocText className={cn(!warehouseName && 'italic text-[hsl(var(--muted-foreground))]')}>
                      {warehouseName || 'Derived from the selected source'}
                    </DocText>
                  </DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Receive Against" htmlFor="prcv-mode" required>
                    <SearchableSelect
                      id="prcv-mode"
                      value={sourceMode}
                      onChange={v => handleSourceModeChange((v || 'PURCHASE_ORDER') as SourceMode)}
                      options={[
                        { value: 'PURCHASE_ORDER', label: 'Purchase Order' },
                        { value: 'PURCHASE_INVOICE', label: 'Purchase Invoice (Direct)' },
                      ]}
                      disabled={!companyId}
                    />
                  </DocCell>
                  <DocCell label={sourceMode === 'PURCHASE_ORDER' ? 'Purchase Order No.' : 'Purchase Invoice No.'} htmlFor="prcv-source" required>
                    <SearchableSelect
                      id="prcv-source"
                      value={sourceId === '' ? '' : String(sourceId)}
                      onChange={v => handleSourceChange(v ? Number(v) : '')}
                      options={(sourceMode === 'PURCHASE_ORDER' ? eligiblePurchaseOrders : eligiblePurchaseInvoices)
                        .map(s => ({ value: String(s.id), label: s.referenceNumber }))}
                      placeholder={supplierId ? undefined : 'Select a supplier first…'}
                      disabled={!supplierId}
                    />
                    {supplierId && (sourceMode === 'PURCHASE_ORDER' ? eligiblePurchaseOrders : eligiblePurchaseInvoices).length === 0 && (
                      <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">
                        No open (not voided, not yet fully processed) {sourceMode === 'PURCHASE_ORDER' ? 'purchase orders' : 'Direct purchase invoices'} found for this supplier.
                      </p>
                    )}
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={lines}
                  rowKey={line => line.itemId}
                  columns={[
                    { key: 'item', label: 'Item', readOnly: true, render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'outstanding', label: 'Outstanding', align: 'right', width: '8rem', readOnly: true, render: line => line.outstanding },
                    {
                      key: 'onHand', label: 'On Hand', align: 'right', width: '7rem', readOnly: true,
                      render: line => <StockCell stock={stock} field="quantity" itemId={line.itemId} warehouseChosen={warehouseId !== ''} />,
                    },
                    {
                      key: 'inTransit', label: 'In Transit', align: 'right', width: '7rem', readOnly: true,
                      render: line => (
                        <StockCell stock={stock} field="transitQuantity" itemId={line.itemId} warehouseChosen={warehouseId !== ''}
                          short={available => line.quantity.trim() !== '' && Number(line.quantity) > available} />
                      ),
                    },
                    {
                      key: 'quantity', label: 'Receive Now', align: 'right', width: '9rem',
                      render: (line, i) => (
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          max={line.outstanding}
                          aria-label={`${line.itemCode} quantity to receive`}
                          value={line.quantity}
                          onChange={e => updateLine(i, { quantity: e.target.value })}
                          className="text-right"
                        />
                      ),
                    },
                  ]}
                  footer={lines.length === 0 && (
                    <p className="py-1 text-xs text-[hsl(var(--muted-foreground))]">
                      Select a source above to load its outstanding (not yet received) items.
                    </p>
                  )}
                />
                <DocRow>
                  <DocCell label="Remarks" htmlFor="prcv-remarks">
                    <Input id="prcv-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Purchase Receive</Button>
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
      </>)}
    </div>
  )
}
