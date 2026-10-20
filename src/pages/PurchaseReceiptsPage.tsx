import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Eye, FileDown, Ban } from 'lucide-react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocLines, DocStamp, PendingNumber, TRANSACTION_MIN_ROWS } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS, CloseButton } from '@/components/RecordTab'
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
import { OriginBadge, OriginNotice } from '@/components/TransactionOrigin'
import { ORIGIN_COLUMN, originLabel, type TransactionOrigin } from '@/lib/transactionOrigin'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { ScrollTable } from '@/components/ScrollTable'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, useStock, type LookupOption, type TransactionLookupOption } from '@/lib/lookups'
import { StockCell } from '@/components/StockCell'
import { formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'
import { defaultDateFilter } from '@/lib/dateRanges'

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

interface PurchaseReceipt {
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
  origin: TransactionOrigin
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
    ORIGIN_COLUMN,
    { key: 'voided', label: 'Voided', type: 'boolean' },
  )
  return columns
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sourceLabel(r: PurchaseReceipt): string {
  if (r.purchaseOrderReferenceNumber) return `PO: ${r.purchaseOrderReferenceNumber}`
  if (r.purchaseInvoiceReferenceNumber) return `Invoice: ${r.purchaseInvoiceReferenceNumber}`
  return '—'
}

function receiveSearchText(r: PurchaseReceipt): string {
  return [r.referenceNumber, r.sheetNumber ?? '', r.warehouseName, r.supplierName, sourceLabel(r), r.remarks ?? '', r.companyName, formatDate(r.receiptDate)].join(' ')
}

export function PurchaseReceiptsPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn, companies } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>(() => defaultDateFilter())
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const inRecordTab = useIsRecordTab()
  const { items: receipts, page, setPage, pageSize, setPageSize, totalPages, totalElements, reload, loading: listLoading, searchAll } = usePagedList<PurchaseReceipt>('/purchase-receipts', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load purchase receipts.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: receiveSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<PurchaseReceipt>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<PurchaseReceipt>(`/purchase-receipts/${id}`),
  })
  const [activeReceipt, setActiveReceipt]     = useState<PurchaseReceipt | null>(null)
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
  // A receipt moves stock from transit into on hand, so both balances are shown as a guide while creating.
  const stock = useStock(lookupCompanyId, warehouseId, lines.map(l => l.itemId), { enabled: creating, onError: () => toast('Failed to load stock balances.', 'error') })
  const { isVisible, menu: columnMenu } = useColumnVisibility('purchase-receipts')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_PURCHASE_RECEIPT')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_PURCHASE_RECEIPT')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('PURCHASE_RECEIPT', inRecordTab && mode === 'view' ? activeReceipt?.id : null, activeReceipt?.referenceNumber, activeReceipt?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: receipts,
    onView: openView,
    enabled: !inRecordTab && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: 'r', handler: () => reload() },
  ], !inRecordTab && zone === 'content')

  useEffect(() => {
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function openView(receipt: PurchaseReceipt) {
    if (!rec.isRecordTab) return rec.open('view', receipt)
    setActiveReceipt(receipt)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveReceipt(null)
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
    if (!window.confirm('Post this purchase receipt? This cannot be edited afterward — only voided.')) return
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
      await apiFetch<PurchaseReceipt>('/purchase-receipts', { method: 'POST', body: JSON.stringify(body) })
      toast('Purchase receipt posted successfully.', 'success')
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post purchase receipt.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<PurchaseReceipt>(qs ? `/purchase-receipts?${qs}` : '/purchase-receipts', 100000)
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
      origin: originLabel(r.origin),
      company: r.companyName,
    }))
    exportToXlsx('purchase-receipts', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  function printFailed() {
    if (!activeReceipt) return
    toast(
      `No active print template configured for Purchase Receipts under ${activeReceipt.companyName}. Create one under Document Templates while ${activeReceipt.companyName} is your active company.`,
      'error'
    )
  }

  async function handleVoid() {
    if (!activeReceipt) return
    if (!window.confirm(`Void purchase receipt "${activeReceipt.referenceNumber}"? This reverses its inventory effects and un-loads the source, and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<PurchaseReceipt>(`/purchase-receipts/${activeReceipt.id}/void`, { method: 'POST' })
      setActiveReceipt(voided)
      toast('Purchase receipt voided.', 'success')
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void purchase receipt.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const recordName = activeReceipt?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Purchase Receipt' : recordName || 'Purchase Receipt'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Purchase Receipts</h1>
        <div className="flex flex-wrap items-center gap-2">
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
          <GlobalSearch value={search} onChange={setSearch} status={searchAll} />
        </div>
      </div>

      </>)}

      {inRecordTab && (
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-none">
          {mode === 'view' && activeReceipt ? (
            <div className="space-y-4">
              <OriginNotice origin={activeReceipt.origin} />
              <DocSheet>
                {activeReceipt.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="prcv-company" readOnly name={activeReceipt.companyName} />}>
                  <DocHeader title="Receiving Report" number={activeReceipt.referenceNumber}>
                    <DocRow>
                      <DocCell label="Receipt Date"><DocText>{formatDate(activeReceipt.receiptDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeReceipt.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Supplier"><DocText>{activeReceipt.supplierName}</DocText></DocCell>
                  <DocCell label="Received At (Warehouse)"><DocText>{activeReceipt.warehouseName}</DocText></DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Received Against"><DocText>{sourceLabel(activeReceipt)}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activeReceipt.lines)}
                  rowKey={line => line.id}
                  lineNumber={line => line.lineNumber}
                  minRows={TRANSACTION_MIN_ROWS}
                  columns={[
                    { key: 'item', label: 'Item', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity Received', align: 'right', width: '10rem', render: line => line.quantity },
                  ]}
                />
                <DocRow>
                  <DocCell label="Remarks"><DocText>{activeReceipt.remarks}</DocText></DocCell>
                </DocRow>
                <TransactionHistory activity={activity} record={activeReceipt} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activeReceipt.voided} />
                {canVoid && !activeReceipt.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton
                    companyId={activeReceipt.companyId}
                    documentType="PURCHASE_RECEIPT"
                    data={activeReceipt as unknown as Record<string, unknown>}
                    onError={printFailed}
                  />
                )}
                <CloseButton onClick={requestClose} />
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
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Post Purchase Receipt</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}

      {!inRecordTab && (<>

      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable activeIndex={activeIndex}>
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {showCompanyColumn && isVisible('company') && <th className="text-left py-2 px-4 font-medium">Company</th>}
                {isVisible('referenceNumber') && <th className="text-left py-2 px-4 font-medium">Reference #</th>}
                {isVisible('sheetNumber') && <th className="text-left py-2 px-4 font-medium">Sheet #</th>}
                {isVisible('warehouse') && <th className="text-left py-2 px-4 font-medium">Warehouse</th>}
                {isVisible('supplier') && <th className="text-left py-2 px-4 font-medium">Supplier</th>}
                {isVisible('source') && <th className="text-left py-2 px-4 font-medium">Source</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Receipt Date</th>}
                {isVisible('origin') && <th className="text-left py-2 px-4 font-medium">Origin</th>}
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
              {receipts.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No purchase receipts match your search/filters.' : 'No purchase receipts to display.'}
                  </td>
                </tr>
              ) : (
                receipts.map((receipt, i) => (
                  <tr
                    key={receipt.id}
                    onClick={() => { setActiveIndex(i); openView(receipt) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receipt.companyName}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{receipt.referenceNumber}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receipt.sheetNumber ?? '—'}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receipt.warehouseName}</td>}
                    {isVisible('supplier') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receipt.supplierName}</td>}
                    {isVisible('source') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{sourceLabel(receipt)}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(receipt.receiptDate)}</td>}
                    {isVisible('origin') && <td className="py-2 px-4"><OriginBadge origin={receipt.origin} /></td>}
                    {isVisible('voided') && (
                      <td className="py-2 px-4">
                        {receipt.voided && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                            Voided
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openView(receipt)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </ScrollTable>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </CardContent>
      </Card>
      </>)}
    </div>
  )
}
