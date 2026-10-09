import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Eye, FileDown, Ban } from 'lucide-react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocLines, DocTotals, DocStamp, PendingNumber } from '@/components/ui/doc-form'
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
import { OriginBadge, OriginNotice } from '@/components/TransactionOrigin'
import { ORIGIN_COLUMN, originLabel, type TransactionOrigin } from '@/lib/transactionOrigin'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { ScrollTable } from '@/components/ScrollTable'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, useStock, type LookupOption, type CustomerLookupOption, type TransactionLookupOption } from '@/lib/lookups'
import { StockCell } from '@/components/StockCell'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'

type FormMode = 'view' | 'create'

interface CompanyOption {
  id: number
  name: string
}

interface OutletDeliveryReturnLine {
  id: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  outletDeliveryReceiptLineId: number
  quantity: string
  unitPrice: string
  amount: string
  quantityLoaded: string
}

interface OutletDeliveryReturn {
  id: number
  companyId: number
  companyName: string
  outletDeliveryReceiptId: number
  outletDeliveryReceiptReferenceNumber: string
  customerId: number
  customerName: string
  warehouseId: number
  warehouseName: string
  agentId: number
  agentCode: string
  agentName: string
  referenceNumber: string
  sheetNumber: string | null
  returnDate: string
  remarks: string | null
  totalAmount: string
  createdAt: string | null
  createdBy: string | null
  origin: TransactionOrigin
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  loaded: boolean
  lines: OutletDeliveryReturnLine[]
}

interface LineDraft {
  itemId: number
  itemCode: string
  itemName: string
  sold: string
  outstanding: string
  unitPrice: string
  quantity: string
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #' },
    { key: 'sheetNumber', label: 'Sheet #' },
    { key: 'outlet', label: 'Outlet' },
    { key: 'agent', label: 'Agent' },
    { key: 'source', label: 'Outlet Delivery Receipt' },
    { key: 'date', label: 'Return Date', type: 'date' },
    { key: 'total', label: 'Total Amount' },
    ORIGIN_COLUMN,
    { key: 'voided', label: 'Voided', type: 'boolean' },
  )
  return columns
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function returnSearchText(r: OutletDeliveryReturn): string {
  return [r.referenceNumber, r.sheetNumber ?? '', r.customerName, r.warehouseName, r.agentCode, r.agentName,
    r.outletDeliveryReceiptReferenceNumber, r.remarks ?? '', r.companyName, formatDate(r.returnDate)].join(' ')
}

function lineAmount(line: LineDraft): number {
  const qty = Number(line.quantity)
  const price = Number(line.unitPrice)
  return Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0
}

export function OutletDeliveryReturnsPage() {
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
  const { items: returns, page, setPage, totalPages, totalElements, reload, loading: listLoading, searchAll } = usePagedList<OutletDeliveryReturn>('/outlet-delivery-returns', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load outlet delivery returns.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: returnSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<OutletDeliveryReturn>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<OutletDeliveryReturn>(`/outlet-delivery-returns/${id}`),
  })
  const [activeReturn, setActiveReturn]       = useState<OutletDeliveryReturn | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [customerId, setCustomerId]           = useState<number | ''>('')
  const [sourceId, setSourceId]               = useState<number | ''>('')
  const [returnDate, setReturnDate]           = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([])
  const [loading, setLoading]                 = useState(false)
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const outlets = useLookup<CustomerLookupOption>('customers', lookupCompanyId, { enabled: !inRecordTab || creating, params: { type: 'OUTLET' }, onError: () => toast('Failed to load outlets.', 'error') })
  const agents = useLookup<LookupOption>('employees', lookupCompanyId, { enabled: !inRecordTab, params: { tag: 'AGENT' }, onError: () => toast('Failed to load agents.', 'error') })
  // openOnly (the default) keeps only receipts that are neither voided nor fully returned.
  const openReceipts = useLookup<TransactionLookupOption>('outlet-delivery-receipts', lookupCompanyId, {
    enabled: creating && customerId !== '',
    params: { customerId: String(customerId) },
    onError: () => toast('Failed to load outlet delivery receipts.', 'error'),
  })
  const selectedSource = sourceId ? openReceipts.find(r => r.id === sourceId) : undefined
  // A return puts stock back on hand in the outlet warehouse, so that balance is shown as a guide.
  const stock = useStock(lookupCompanyId, selectedSource?.warehouseId ?? '', lines.map(l => l.itemId), { enabled: creating, onError: () => toast('Failed to load stock balances.', 'error') })
  const draftTotal = lines.reduce((sum, l) => sum + (l.quantity.trim() !== '' ? lineAmount(l) : 0), 0)
  const { isVisible, menu: columnMenu } = useColumnVisibility('outlet-delivery-returns')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_OUTLET_DELIVERY_RETURN')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_OUTLET_DELIVERY_RETURN')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('OUTLET_DELIVERY_RETURN', inRecordTab && mode === 'view' ? activeReturn?.id : null, activeReturn?.referenceNumber, activeReturn?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: returns,
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

  function openView(ret: OutletDeliveryReturn) {
    if (!rec.isRecordTab) return rec.open('view', ret)
    setActiveReturn(ret)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveReturn(null)
    const nextCompanyId = activeCompanyId ?? ''
    const nextDate = todayIso()
    setCompanyId(nextCompanyId)
    setCustomerId('')
    setSourceId('')
    setReturnDate(nextDate)
    setRemarks('')
    setSheetNumber('')
    setLines([])
    markClean({ companyId: nextCompanyId, customerId: '', sourceId: '', returnDate: nextDate, remarks: '', sheetNumber: '', lines: [] })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, customerId, sourceId, returnDate, remarks, sheetNumber, lines }, () => rec.close())
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setCustomerId('')
    setSourceId('')
    setLines([])
  }

  // Picking the outlet narrows which receipts are selectable, so it invalidates the receipt and its lines.
  function handleOutletChange(id: number | '') {
    setCustomerId(id)
    setSourceId('')
    setLines([])
  }

  // Quantities start empty: a return is usually only part of what was sold.
  function outstandingLinesOf(source: TransactionLookupOption): LineDraft[] {
    return byLineNumber(source.lines)
      .map(l => ({
        itemId: l.itemId,
        itemCode: l.itemCode,
        itemName: l.itemName,
        sold: String(l.quantity),
        outstanding: (Number(l.quantity) - Number(l.quantityLoaded)).toFixed(4),
        unitPrice: l.unitPrice != null ? String(l.unitPrice) : '0',
        quantity: '',
      }))
      .filter(l => Number(l.outstanding) > 0)
  }

  function handleSourceChange(id: number | '') {
    setSourceId(id)
    const source = id ? openReceipts.find(r => r.id === id) : undefined
    setLines(source ? outstandingLinesOf(source) : [])
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
    if (!sourceId) {
      toast('Select an outlet delivery receipt to return against.', 'error')
      return
    }
    const validLines = lines.filter(l => l.quantity.trim() !== '' && Number(l.quantity) > 0)
    if (validLines.length === 0) {
      toast('Enter a quantity to return for at least one item.', 'error')
      return
    }
    const overLine = validLines.find(l => Number(l.quantity) > Number(l.outstanding))
    if (overLine) {
      toast(`Quantity to return for ${overLine.itemCode} exceeds the outstanding amount (${overLine.outstanding}).`, 'error')
      return
    }
    if (!window.confirm('Post this outlet delivery return? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        outletDeliveryReceiptId: sourceId,
        returnDate,
        remarks: remarks || null,
        sheetNumber: sheetNumber || null,
        lines: validLines.map(l => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
      }
      await apiFetch<OutletDeliveryReturn>('/outlet-delivery-returns', { method: 'POST', body: JSON.stringify(body) })
      toast('Outlet delivery return posted successfully.', 'success')
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post outlet delivery return.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<OutletDeliveryReturn>(qs ? `/outlet-delivery-returns?${qs}` : '/outlet-delivery-returns', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(r => returnSearchText(r).toLowerCase().includes(term)) : all
    const rows = matching.map(r => ({
      referenceNumber: r.referenceNumber,
      sheetNumber: r.sheetNumber ?? '',
      outlet: r.customerName,
      agent: `${r.agentCode} — ${r.agentName}`,
      source: r.outletDeliveryReceiptReferenceNumber,
      date: formatDate(r.returnDate),
      total: formatCurrency(r.totalAmount),
      voided: r.voided ? 'Yes' : '',
      origin: originLabel(r.origin),
      company: r.companyName,
    }))
    exportToXlsx('outlet-delivery-returns', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  function printFailed() {
    if (!activeReturn) return
    toast(
      `No active print template configured for Outlet Delivery Returns under ${activeReturn.companyName}. Create one under Document Templates while ${activeReturn.companyName} is your active company.`,
      'error'
    )
  }

  async function handleVoid() {
    if (!activeReturn) return
    if (!window.confirm(`Void outlet delivery return "${activeReturn.referenceNumber}"? This takes the stock back out of ${activeReturn.warehouseName}, reopens ${activeReturn.outletDeliveryReceiptReferenceNumber}, and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<OutletDeliveryReturn>(`/outlet-delivery-returns/${activeReturn.id}/void`, { method: 'POST' })
      setActiveReturn(voided)
      toast('Outlet delivery return voided.', 'success')
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void outlet delivery return.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const recordName = activeReturn?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Outlet Delivery Return' : recordName || 'Outlet Delivery Return'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Outlet Delivery Returns</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect
            value={filters.customerId ?? ''}
            onChange={v => setFilters(prev => ({ ...prev, customerId: v }))}
            options={outlets.map(o => ({ value: String(o.id), label: o.name }))}
            placeholder="All outlets"
            className="w-44"
          />
          <SearchableSelect
            value={filters.agentId ?? ''}
            onChange={v => setFilters(prev => ({ ...prev, agentId: v }))}
            options={agents.map(a => ({ value: String(a.id), label: a.code ? `${a.code} — ${a.name}` : a.name }))}
            placeholder="All agents"
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
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-4xl">
          {mode === 'view' && activeReturn ? (
            <div className="space-y-4">
              <OriginNotice origin={activeReturn.origin} />
              <DocSheet>
                {activeReturn.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="odrr-company" readOnly name={activeReturn.companyName} />}>
                  <DocHeader title="Outlet Delivery Return" number={activeReturn.referenceNumber}>
                    <DocRow>
                      <DocCell label="Return Date"><DocText>{formatDate(activeReturn.returnDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeReturn.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Outlet"><DocText>{activeReturn.customerName}</DocText></DocCell>
                  <DocCell label="Returned To (Warehouse)"><DocText>{activeReturn.warehouseName}</DocText></DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Outlet Delivery Receipt No."><DocText>{activeReturn.outletDeliveryReceiptReferenceNumber}</DocText></DocCell>
                  <DocCell label="Agent"><DocText>{`${activeReturn.agentCode} — ${activeReturn.agentName}`}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activeReturn.lines)}
                  rowKey={line => line.id}
                  lineNumber={line => line.lineNumber}
                  minRows={5}
                  columns={[
                    { key: 'item', label: 'Item', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity Returned', align: 'right', width: '9rem', render: line => line.quantity },
                    { key: 'unitPrice', label: 'Unit Price', align: 'right', width: '8rem', render: line => formatCurrency(line.unitPrice) },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: line => formatCurrency(line.amount) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{activeReturn.remarks}</DocText></DocCell>
                  <DocTotals entries={[{ label: 'Total Amount', value: formatCurrency(activeReturn.totalAmount), grand: true }]} />
                </DocRow>
                <TransactionHistory activity={activity} record={activeReturn} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activeReturn.voided} />
                {canVoid && !activeReturn.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton
                    companyId={activeReturn.companyId}
                    documentType="OUTLET_DELIVERY_RETURN"
                    data={activeReturn as unknown as Record<string, unknown>}
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
                      id="odrr-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Outlet Delivery Return" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Return Date" htmlFor="odrr-date" required>
                        <Input id="odrr-date" type="date" value={returnDate}
                          onChange={e => setReturnDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="odrr-sheet">
                        <Input id="odrr-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Outlet" htmlFor="odrr-outlet" required>
                    <SearchableSelect
                      id="odrr-outlet"
                      value={customerId === '' ? '' : String(customerId)}
                      onChange={v => handleOutletChange(v ? Number(v) : '')}
                      options={outlets.map(o => ({ value: String(o.id), label: o.name }))}
                      disabled={!companyId}
                      autoFocus={!showCompanyColumn}
                    />
                  </DocCell>
                  <DocCell label="Returned To (Warehouse)">
                    <DocText className={cn(!selectedSource && 'italic text-[hsl(var(--muted-foreground))]')}>
                      {selectedSource?.warehouseName ?? 'The outlet\'s warehouse, from the receipt'}
                    </DocText>
                  </DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Outlet Delivery Receipt No." htmlFor="odrr-source" required>
                    <SearchableSelect
                      id="odrr-source"
                      value={sourceId === '' ? '' : String(sourceId)}
                      onChange={v => handleSourceChange(v ? Number(v) : '')}
                      options={openReceipts.map(r => ({ value: String(r.id), label: `${r.referenceNumber} — ${formatDate(r.transactionDate)}` }))}
                      placeholder={customerId ? undefined : 'Select an outlet first…'}
                      disabled={!customerId}
                    />
                    {customerId && openReceipts.length === 0 && (
                      <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">
                        No open (not voided, not yet fully returned) outlet delivery receipts found for this outlet.
                      </p>
                    )}
                  </DocCell>
                  <DocCell label="Agent">
                    <DocText className={cn(!selectedSource && 'italic text-[hsl(var(--muted-foreground))]')}>
                      {selectedSource?.agentName ?? 'From the receipt'}
                    </DocText>
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={lines}
                  rowKey={(line, i) => `${line.itemId}-${i}`}
                  columns={[
                    { key: 'item', label: 'Item', readOnly: true, render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'sold', label: 'Sold', align: 'right', width: '6rem', readOnly: true, render: line => line.sold },
                    { key: 'outstanding', label: 'Returnable', align: 'right', width: '7rem', readOnly: true, render: line => line.outstanding },
                    {
                      key: 'onHand', label: 'On Hand', align: 'right', width: '7rem', readOnly: true,
                      render: line => <StockCell stock={stock} field="quantity" itemId={line.itemId} warehouseChosen={!!selectedSource} />,
                    },
                    {
                      key: 'quantity', label: 'Return Now', align: 'right', width: '8rem',
                      render: (line, i) => (
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          max={line.outstanding}
                          aria-label={`${line.itemCode} quantity to return`}
                          value={line.quantity}
                          onChange={e => updateLine(i, { quantity: e.target.value })}
                          className="text-right"
                        />
                      ),
                    },
                    { key: 'unitPrice', label: 'Unit Price', align: 'right', width: '7rem', readOnly: true, render: line => formatCurrency(line.unitPrice) },
                    {
                      key: 'amount', label: 'Amount', align: 'right', width: '8rem', readOnly: true,
                      render: line => <span className="tabular-nums">{line.quantity.trim() !== '' ? formatCurrency(lineAmount(line)) : '—'}</span>,
                    },
                  ]}
                  footer={lines.length === 0 && (
                    <p className="py-1 text-xs text-[hsl(var(--muted-foreground))]">
                      Select an outlet delivery receipt above to load its returnable items.
                    </p>
                  )}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="odrr-remarks">
                    <Input id="odrr-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[{ label: 'Total Amount', value: formatCurrency(draftTotal), grand: true }]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Outlet Delivery Return</Button>
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
                {isVisible('outlet') && <th className="text-left py-2 px-4 font-medium">Outlet</th>}
                {isVisible('agent') && <th className="text-left py-2 px-4 font-medium">Agent</th>}
                {isVisible('source') && <th className="text-left py-2 px-4 font-medium">Outlet Delivery Receipt</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Return Date</th>}
                {isVisible('total') && <th className="text-right py-2 px-4 font-medium">Total Amount</th>}
                {isVisible('origin') && <th className="text-left py-2 px-4 font-medium">Origin</th>}
                {isVisible('voided') && <th className="text-left py-2 px-4 font-medium">Voided</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'outlet' && key !== 'agent' && key !== 'company' && key !== 'source' && key !== 'total' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {returns.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No outlet delivery returns match your search/filters.' : 'No outlet delivery returns to display.'}
                  </td>
                </tr>
              ) : (
                returns.map((ret, i) => (
                  <tr
                    key={ret.id}
                    onClick={() => { setActiveIndex(i); openView(ret) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{ret.companyName}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{ret.referenceNumber}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{ret.sheetNumber ?? '—'}</td>}
                    {isVisible('outlet') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{ret.customerName}</td>}
                    {isVisible('agent') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{ret.agentName}</td>}
                    {isVisible('source') && <td className="py-2 px-4 font-mono text-xs text-[hsl(var(--muted-foreground))]">{ret.outletDeliveryReceiptReferenceNumber}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(ret.returnDate)}</td>}
                    {isVisible('total') && <td className="py-2 px-4 text-right tabular-nums">{formatCurrency(ret.totalAmount)}</td>}
                    {isVisible('origin') && <td className="py-2 px-4"><OriginBadge origin={ret.origin} /></td>}
                    {isVisible('voided') && (
                      <td className="py-2 px-4">
                        {ret.voided && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                            Voided
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openView(ret)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </ScrollTable>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
      </>)}
    </div>
  )
}
