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
import { useRowGrouping, useGroupedRows } from '@/hooks/useRowGrouping'
import { GroupByMenu } from '@/components/RowGrouping'
import { groupedRows } from '@/components/groupedRows'
import { useListSort } from '@/hooks/useListSort'
import { SortableTh } from '@/components/SortableTh'
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

interface CompanyOption {
  id: number
  name: string
}

interface OutletReceiptLine {
  id: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  deliveryReceiptLineId: number
  quantity: string
  quantityLoaded: string
}

interface OutletReceipt {
  id: number
  companyId: number
  companyName: string
  deliveryReceiptId: number
  deliveryReceiptReferenceNumber: string
  customerId: number
  customerName: string
  warehouseId: number
  warehouseName: string
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
  lines: OutletReceiptLine[]
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
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #', sortable: true },
    { key: 'sheetNumber', label: 'Sheet #', sortable: true },
    { key: 'outlet', label: 'Outlet', sortable: true },
    { key: 'warehouse', label: 'Warehouse', sortable: true },
    { key: 'source', label: 'Delivery Receipt', sortable: true },
    { key: 'date', label: 'Receipt Date', sortable: true, type: 'date' },
    ORIGIN_COLUMN,
    { key: 'voided', label: 'Voided', sortable: true, type: 'boolean' },
  )
  return columns
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function receiveSearchText(r: OutletReceipt): string {
  return [r.referenceNumber, r.sheetNumber ?? '', r.customerName, r.warehouseName, r.deliveryReceiptReferenceNumber,
    r.remarks ?? '', r.companyName, formatDate(r.receiptDate)].join(' ')
}

export function OutletReceiptsPage() {
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
  const grouping = useRowGrouping(COLUMNS, 'outlet-receipts')
  const sorting = useListSort(COLUMNS)
  const { items: receipts, page, setPage, pageSize, setPageSize, totalPages, totalElements, reload, loading: listLoading, searchAll, allRows } = usePagedList<OutletReceipt>('/outlet-receipts', {
    all: grouping.active,
    enabled: !inRecordTab,
    onError: () => toast('Failed to load outlet receipts.', 'error'),
    search: debouncedSearch,
    filters: sorting.apply(debouncedFilters),
    searchText: receiveSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<OutletReceipt>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<OutletReceipt>(`/outlet-receipts/${id}`),
  })
  const [activeReceipt, setActiveReceipt]     = useState<OutletReceipt | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [customerId, setCustomerId]           = useState<number | ''>('')
  const [deliveryReceiptId, setDeliveryReceiptId] = useState<number | ''>('')
  const [warehouseId, setWarehouseId]         = useState<number | ''>('')
  const [receiptDate, setReceiptDate]         = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([])
  const [loading, setLoading]                 = useState(false)
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const outlets = useLookup<LookupOption>('customers', lookupCompanyId, { enabled: !inRecordTab || creating, params: { type: 'OUTLET' }, onError: () => toast('Failed to load outlets.', 'error') })
  // openOnly (the default) keeps only outlet DRs that are neither voided nor fully received.
  const openDeliveryReceipts = useLookup<TransactionLookupOption>('delivery-receipts', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load delivery receipts.', 'error') })
  const eligibleDeliveryReceipts = customerId ? openDeliveryReceipts.filter(dr => dr.customerId === customerId) : []
  const selectedDeliveryReceipt = deliveryReceiptId ? eligibleDeliveryReceipts.find(dr => dr.id === deliveryReceiptId) : undefined
  const warehouseName = warehouseId ? selectedDeliveryReceipt?.warehouseName ?? '' : ''
  // A receipt moves stock from in transit to on hand in the outlet warehouse, so both balances are shown.
  const stock = useStock(lookupCompanyId, warehouseId, lines.map(l => l.itemId), { enabled: creating, onError: () => toast('Failed to load stock balances.', 'error') })
  const { isVisible, menu: columnMenu } = useColumnVisibility('outlet-receipts')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_OUTLET_RECEIPT')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_OUTLET_RECEIPT')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('OUTLET_RECEIPT', inRecordTab && mode === 'view' ? activeReceipt?.id : null, activeReceipt?.referenceNumber, activeReceipt?.voided)

  const view = useGroupedRows(grouping, receipts, listRow)
  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: receipts,
    view,
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

  function openView(receipt: OutletReceipt) {
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
    setCustomerId('')
    setDeliveryReceiptId('')
    setWarehouseId('')
    setReceiptDate(nextDate)
    setRemarks('')
    setSheetNumber('')
    setLines([])
    markClean({
      companyId: nextCompanyId, customerId: '', deliveryReceiptId: '', warehouseId: '',
      receiptDate: nextDate, remarks: '', sheetNumber: '', lines: [],
    })
    setMode('create')
  }

  function requestClose() {
    guardedClose(
      { companyId, customerId, deliveryReceiptId, warehouseId, receiptDate, remarks, sheetNumber, lines },
      () => rec.close()
    )
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setCustomerId('')
    setDeliveryReceiptId('')
    setWarehouseId('')
    setLines([])
  }

  // Picking the outlet narrows which Delivery Receipts are selectable,
  // so changing it invalidates whatever delivery receipt/warehouse/lines were already derived.
  function handleOutletChange(id: number | '') {
    setCustomerId(id)
    setDeliveryReceiptId('')
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

  function handleDeliveryReceiptChange(id: number | '') {
    setDeliveryReceiptId(id)
    const source = id ? eligibleDeliveryReceipts.find(dr => dr.id === id) : undefined
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
    if (!customerId) {
      toast('Select an outlet.', 'error')
      return
    }
    if (!deliveryReceiptId) {
      toast('Select a delivery receipt to receive.', 'error')
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
    if (!window.confirm('Post this outlet receipt? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        deliveryReceiptId,
        receiptDate,
        remarks: remarks || null,
        sheetNumber: sheetNumber || null,
        lines: validLines.map(l => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
      }
      await apiFetch<OutletReceipt>('/outlet-receipts', { method: 'POST', body: JSON.stringify(body) })
      toast('Outlet receipt posted successfully.', 'success')
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post outlet receipt.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  /** One row's displayed value per column key: the export row, and what grouping groups by. */
  function listRow(r: OutletReceipt) {
    return {
      referenceNumber: r.referenceNumber,
      sheetNumber: r.sheetNumber ?? '',
      outlet: r.customerName,
      warehouse: r.warehouseName,
      source: r.deliveryReceiptReferenceNumber,
      date: formatDate(r.receiptDate),
      voided: r.voided ? 'Yes' : '',
      origin: originLabel(r.origin),
      company: r.companyName,
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(sorting.apply(debouncedFilters))
    const all = await fetchAllContent<OutletReceipt>(qs ? `/outlet-receipts?${qs}` : '/outlet-receipts', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(r => receiveSearchText(r).toLowerCase().includes(term)) : all
    const rows = matching.map(listRow)
    exportToXlsx('outlet-receipts', COLUMNS.filter(c => isVisible(c.key)), rows, grouping)
  }

  function printFailed() {
    if (!activeReceipt) return
    toast(
      `No active print template configured for Outlet Receipts under ${activeReceipt.companyName}. Create one under Document Templates while ${activeReceipt.companyName} is your active company.`,
      'error'
    )
  }

  async function handleVoid() {
    if (!activeReceipt) return
    if (!window.confirm(`Void outlet receipt "${activeReceipt.referenceNumber}"? This puts the quantities back in transit, reopens ${activeReceipt.deliveryReceiptReferenceNumber}, and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<OutletReceipt>(`/outlet-receipts/${activeReceipt.id}/void`, { method: 'POST' })
      setActiveReceipt(voided)
      toast('Outlet receipt voided.', 'success')
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void outlet receipt.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const recordName = activeReceipt?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Outlet Receipt' : recordName || 'Outlet Receipt'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Outlet Receipts</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect
            value={filters.customerId ?? ''}
            onChange={v => setFilters(prev => ({ ...prev, customerId: v }))}
            options={outlets.map(o => ({ value: String(o.id), label: o.name }))}
            placeholder="All outlets"
            className="w-44"
          />
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} {...columnMenu} />
          <GroupByMenu grouping={grouping} view={view} status={allRows} />
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
                <DocLetterhead company={<CompanyField id="orcv-company" readOnly name={activeReceipt.companyName} />}>
                  <DocHeader title="Outlet Receiving Report" number={activeReceipt.referenceNumber}>
                    <DocRow>
                      <DocCell label="Receipt Date"><DocText>{formatDate(activeReceipt.receiptDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeReceipt.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Outlet"><DocText>{activeReceipt.customerName}</DocText></DocCell>
                  <DocCell label="Received At (Warehouse)"><DocText>{activeReceipt.warehouseName}</DocText></DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Delivery Receipt No."><DocText>{activeReceipt.deliveryReceiptReferenceNumber}</DocText></DocCell>
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
                    documentType="OUTLET_RECEIPT"
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
                      id="orcv-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Outlet Receiving Report" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Receipt Date" htmlFor="orcv-date" required>
                        <Input id="orcv-date" type="date" value={receiptDate}
                          onChange={e => setReceiptDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="orcv-sheet">
                        <Input id="orcv-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Outlet" htmlFor="orcv-outlet" required>
                    <SearchableSelect
                      id="orcv-outlet"
                      value={customerId === '' ? '' : String(customerId)}
                      onChange={v => handleOutletChange(v ? Number(v) : '')}
                      options={outlets.map(o => ({ value: String(o.id), label: o.name }))}
                      disabled={!companyId}
                      autoFocus={!showCompanyColumn}
                    />
                  </DocCell>
                  <DocCell label="Received At (Warehouse)">
                    <DocText className={cn(!warehouseName && 'italic text-[hsl(var(--muted-foreground))]')}>
                      {warehouseName || 'The outlet\'s warehouse, from the delivery receipt'}
                    </DocText>
                  </DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Delivery Receipt No." htmlFor="orcv-source" required>
                    <SearchableSelect
                      id="orcv-source"
                      value={deliveryReceiptId === '' ? '' : String(deliveryReceiptId)}
                      onChange={v => handleDeliveryReceiptChange(v ? Number(v) : '')}
                      options={eligibleDeliveryReceipts.map(dr => ({ value: String(dr.id), label: `${dr.referenceNumber} — ${formatDate(dr.transactionDate)}` }))}
                      placeholder={customerId ? undefined : 'Select an outlet first…'}
                      disabled={!customerId}
                    />
                    {customerId && eligibleDeliveryReceipts.length === 0 && (
                      <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">
                        No open (not voided, not yet fully received) delivery receipts found for this outlet.
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
                      Select a delivery receipt above to load its outstanding (not yet received) items.
                    </p>
                  )}
                />
                <DocRow>
                  <DocCell label="Remarks" htmlFor="orcv-remarks">
                    <Input id="orcv-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Post Outlet Receipt</Button>
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
                {showCompanyColumn && isVisible('company') && <SortableTh sorting={sorting} column="company" className="text-left py-2 px-4 font-medium">Company</SortableTh>}
                {isVisible('referenceNumber') && <SortableTh sorting={sorting} column="referenceNumber" className="text-left py-2 px-4 font-medium">Reference #</SortableTh>}
                {isVisible('sheetNumber') && <SortableTh sorting={sorting} column="sheetNumber" className="text-left py-2 px-4 font-medium">Sheet #</SortableTh>}
                {isVisible('outlet') && <SortableTh sorting={sorting} column="outlet" className="text-left py-2 px-4 font-medium">Outlet</SortableTh>}
                {isVisible('warehouse') && <SortableTh sorting={sorting} column="warehouse" className="text-left py-2 px-4 font-medium">Warehouse</SortableTh>}
                {isVisible('source') && <SortableTh sorting={sorting} column="source" className="text-left py-2 px-4 font-medium">Delivery Receipt</SortableTh>}
                {isVisible('date') && <SortableTh sorting={sorting} column="date" className="text-left py-2 px-4 font-medium">Receipt Date</SortableTh>}
                {isVisible('origin') && <SortableTh sorting={sorting} column="origin" className="text-left py-2 px-4 font-medium">Origin</SortableTh>}
                {isVisible('voided') && <SortableTh sorting={sorting} column="voided" className="text-left py-2 px-4 font-medium">Voided</SortableTh>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'outlet' && key !== 'warehouse' && key !== 'company' && key !== 'source' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {receipts.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No outlet receipts match your search/filters.' : 'No outlet receipts to display.'}
                  </td>
                </tr>
              ) : (
                groupedRows(view, { isVisible, activeIndex, onActivate: setActiveIndex }, (receipt, i) => (
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
                    {isVisible('outlet') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receipt.customerName}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receipt.warehouseName}</td>}
                    {isVisible('source') && <td className="py-2 px-4 font-mono text-xs text-[hsl(var(--muted-foreground))]">{receipt.deliveryReceiptReferenceNumber}</td>}
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
          <Pagination summary={view.summary} page={page} totalPages={totalPages} totalElements={totalElements} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </CardContent>
      </Card>
      </>)}
    </div>
  )
}
