import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Eye, FileDown, Ban, X } from 'lucide-react'
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
import { useLookup, useStock, type LookupOption, type CustomerLookupOption, type ItemLookupOption } from '@/lib/lookups'
import { StockCell } from '@/components/StockCell'
import { shortItems } from '@/lib/stock'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'

type FormMode = 'view' | 'create'

interface CompanyOption {
  id: number
  name: string
}

interface PullOutLine {
  id: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  quantity: string
  unitPrice: string
  amount: string
  quantityLoaded: string
}

interface OutletPullOut {
  id: number
  companyId: number
  companyName: string
  customerId: number
  customerName: string
  /** source: the outlet's own warehouse */
  warehouseId: number
  warehouseName: string
  /** destination: the main warehouse holding the pull out in transit */
  destinationWarehouseId: number
  destinationWarehouseName: string
  /** null only on migrated legacy pull outs that had none */
  pullOutReasonId: number | null
  pullOutReasonName: string | null
  referenceNumber: string
  sheetNumber: string | null
  pullOutDate: string
  remarks: string | null
  totalAmount: string
  createdAt: string | null
  createdBy: string | null
  origin: TransactionOrigin
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  loaded: boolean
  lines: PullOutLine[]
}

interface LineDraft {
  itemId: number | ''
  quantity: string
  unitPrice: string
}

const EMPTY_LINE: LineDraft = { itemId: '', quantity: '', unitPrice: '' }

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #' },
    { key: 'sheetNumber', label: 'Sheet #' },
    { key: 'outlet', label: 'Outlet' },
    { key: 'reason', label: 'Reason' },
    { key: 'status', label: 'Receiving' },
    { key: 'date', label: 'Pull Out Date', type: 'date' },
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

// A pull out sits in transit at the main warehouse until Pull Out Receive(s) take it in.
function receivingStatus(r: OutletPullOut): string {
  if (r.loaded) return 'Received'
  return r.lines.some(l => Number(l.quantityLoaded) > 0) ? 'Partially received' : 'In transit'
}

function pullOutSearchText(r: OutletPullOut): string {
  return [r.referenceNumber, r.sheetNumber ?? '', r.customerName, r.warehouseName, r.pullOutReasonName ?? '',
    receivingStatus(r), r.remarks ?? '', r.companyName, formatDate(r.pullOutDate)].join(' ')
}

function lineAmount(line: LineDraft): number {
  const qty = Number(line.quantity)
  const price = Number(line.unitPrice)
  return Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0
}

export function OutletPullOutsPage() {
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
  const { items: pullOuts, page, setPage, totalPages, totalElements, reload, loading: listLoading, searchAll } = usePagedList<OutletPullOut>('/outlet-pull-outs', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load outlet pull outs.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: pullOutSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<OutletPullOut>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<OutletPullOut>(`/outlet-pull-outs/${id}`),
  })
  const [activePullOut, setActivePullOut]     = useState<OutletPullOut | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [customerId, setCustomerId]           = useState<number | ''>('')
  const [reasonId, setReasonId]               = useState<number | ''>('')
  const [pullOutDate, setPullOutDate]         = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([EMPTY_LINE])
  const [loading, setLoading]                 = useState(false)
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const outlets = useLookup<CustomerLookupOption>('customers', lookupCompanyId, { enabled: !inRecordTab || creating, params: { type: 'OUTLET' }, onError: () => toast('Failed to load outlets.', 'error') })
  const reasons = useLookup<LookupOption>('pull-out-reasons', lookupCompanyId, { enabled: !inRecordTab || creating, onError: () => toast('Failed to load pull out reasons.', 'error') })
  const formInventoryItems = useLookup<ItemLookupOption>('items', lookupCompanyId, { enabled: creating, params: { tag: 'INVENTORY' }, onError: () => toast('Failed to load items.', 'error') })
  const selectedOutlet = customerId === '' ? undefined : outlets.find(o => o.id === customerId)
  const outletWarehouseId = selectedOutlet?.warehouseId ?? ''
  // A pull out deducts on-hand stock from the outlet's own warehouse, so that's the balance shown as a guide.
  const stock = useStock(lookupCompanyId, outletWarehouseId, lines.map(l => l.itemId), { enabled: creating, onError: () => toast('Failed to load stock balances.', 'error') })
  // Items whose quantity across all lines exceeds on-hand — on-hand can't go below zero, so Post is blocked.
  const shortStock = shortItems(lines, stock, l => Number(l.quantity))
  const draftTotal = lines.reduce((sum, l) => sum + (l.itemId !== '' ? lineAmount(l) : 0), 0)
  const { isVisible, menu: columnMenu } = useColumnVisibility('outlet-pull-outs')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_OUTLET_PULL_OUT')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_OUTLET_PULL_OUT')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('OUTLET_PULL_OUT', inRecordTab && mode === 'view' ? activePullOut?.id : null, activePullOut?.referenceNumber, activePullOut?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: pullOuts,
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

  function openView(pullOut: OutletPullOut) {
    if (!rec.isRecordTab) return rec.open('view', pullOut)
    setActivePullOut(pullOut)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActivePullOut(null)
    const nextCompanyId = activeCompanyId ?? ''
    const nextDate = todayIso()
    const nextLines: LineDraft[] = [EMPTY_LINE]
    setCompanyId(nextCompanyId)
    setCustomerId('')
    setReasonId('')
    setPullOutDate(nextDate)
    setRemarks('')
    setSheetNumber('')
    setLines(nextLines)
    markClean({ companyId: nextCompanyId, customerId: '', reasonId: '', pullOutDate: nextDate, remarks: '', sheetNumber: '', lines: nextLines })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, customerId, reasonId, pullOutDate, remarks, sheetNumber, lines }, () => rec.close())
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setCustomerId('')
    setReasonId('')
    setLines([EMPTY_LINE])
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  // Preloads the item's selling price; the user can still override it per line.
  function handleLineItemChange(index: number, itemId: number | '') {
    const item = itemId === '' ? undefined : formInventoryItems.find(i => i.id === itemId)
    updateLine(index, { itemId, unitPrice: item?.unitPrice != null ? String(item.unitPrice) : '' })
  }

  function addLine() {
    setLines(prev => [...prev, EMPTY_LINE])
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
    if (!customerId) {
      toast('Select an outlet.', 'error')
      return
    }
    if (selectedOutlet && selectedOutlet.warehouseId == null) {
      toast(`${selectedOutlet.name} has no warehouse to pull out from.`, 'error')
      return
    }
    if (!reasonId) {
      toast('Select a pull out reason.', 'error')
      return
    }
    const validLines = lines.filter(l => l.itemId !== '' && l.quantity.trim() !== '')
    if (validLines.length === 0) {
      toast('Add at least one line with an item and quantity.', 'error')
      return
    }
    if (validLines.some(l => Number(l.quantity) <= 0)) {
      toast('Line quantities must be greater than zero.', 'error')
      return
    }
    if (validLines.some(l => l.unitPrice.trim() !== '' && Number(l.unitPrice) < 0)) {
      toast('Unit prices cannot be negative.', 'error')
      return
    }
    if (shortStock.size > 0) {
      toast('Not enough stock on hand for the highlighted line(s) — stock cannot go below zero. Reduce the quantity or restock first.', 'error')
      return
    }
    if (!window.confirm('Post this outlet pull out? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        customerId,
        pullOutReasonId: reasonId,
        pullOutDate,
        remarks: remarks || null,
        sheetNumber: sheetNumber || null,
        lines: validLines.map(l => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice.trim() !== '' ? Number(l.unitPrice) : null,
        })),
      }
      await apiFetch<OutletPullOut>('/outlet-pull-outs', { method: 'POST', body: JSON.stringify(body) })
      toast('Outlet pull out posted successfully.', 'success')
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post outlet pull out.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<OutletPullOut>(qs ? `/outlet-pull-outs?${qs}` : '/outlet-pull-outs', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(r => pullOutSearchText(r).toLowerCase().includes(term)) : all
    const rows = matching.map(r => ({
      referenceNumber: r.referenceNumber,
      sheetNumber: r.sheetNumber ?? '',
      outlet: r.customerName,
      reason: r.pullOutReasonName ?? '',
      status: receivingStatus(r),
      date: formatDate(r.pullOutDate),
      total: formatCurrency(r.totalAmount),
      voided: r.voided ? 'Yes' : '',
      origin: originLabel(r.origin),
      company: r.companyName,
    }))
    exportToXlsx('outlet-pull-outs', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  function printFailed() {
    if (!activePullOut) return
    toast(
      `No active print template configured for Outlet Pull Outs under ${activePullOut.companyName}. Create one under Document Templates while ${activePullOut.companyName} is your active company.`,
      'error'
    )
  }

  async function handleVoid() {
    if (!activePullOut) return
    if (!window.confirm(`Void outlet pull out "${activePullOut.referenceNumber}"? This returns the stock to ${activePullOut.warehouseName} and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<OutletPullOut>(`/outlet-pull-outs/${activePullOut.id}/void`, { method: 'POST' })
      setActivePullOut(voided)
      toast('Outlet pull out voided.', 'success')
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void outlet pull out.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const recordName = activePullOut?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Outlet Pull Out' : recordName || 'Outlet Pull Out'
  // Received (even partly) at the main warehouse: the backend blocks voiding until those receives are voided.
  const hasReceipts = !!activePullOut && activePullOut.lines.some(l => Number(l.quantityLoaded) > 0)

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Outlet Pull Outs</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect
            value={filters.customerId ?? ''}
            onChange={v => setFilters(prev => ({ ...prev, customerId: v }))}
            options={outlets.map(o => ({ value: String(o.id), label: o.name }))}
            placeholder="All outlets"
            className="w-44"
          />
          <SearchableSelect
            value={filters.pullOutReasonId ?? ''}
            onChange={v => setFilters(prev => ({ ...prev, pullOutReasonId: v }))}
            options={reasons.map(r => ({ value: String(r.id), label: r.name }))}
            placeholder="All reasons"
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
          {mode === 'view' && activePullOut ? (
            <div className="space-y-4">
              <OriginNotice origin={activePullOut.origin} />
              <DocSheet>
                {activePullOut.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="opo-company" readOnly name={activePullOut.companyName} />}>
                  <DocHeader title="Outlet Pull Out" number={activePullOut.referenceNumber}>
                    <DocRow>
                      <DocCell label="Pull Out Date"><DocText>{formatDate(activePullOut.pullOutDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activePullOut.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Outlet"><DocText>{activePullOut.customerName}</DocText></DocCell>
                  <DocCell label="Reason"><DocText>{activePullOut.pullOutReasonName}</DocText></DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="From (Outlet Warehouse)"><DocText>{activePullOut.warehouseName}</DocText></DocCell>
                  <DocCell label="To (In Transit)"><DocText>{activePullOut.destinationWarehouseName}</DocText></DocCell>
                  <DocCell label="Receiving"><DocText>{receivingStatus(activePullOut)}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activePullOut.lines)}
                  rowKey={line => line.id}
                  lineNumber={line => line.lineNumber}
                  minRows={5}
                  columns={[
                    { key: 'item', label: 'Item', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity', align: 'right', width: '7rem', render: line => line.quantity },
                    { key: 'received', label: 'Received', align: 'right', width: '7rem', render: line => line.quantityLoaded },
                    { key: 'unitPrice', label: 'Unit Price', align: 'right', width: '8rem', render: line => formatCurrency(line.unitPrice) },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: line => formatCurrency(line.amount) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{activePullOut.remarks}</DocText></DocCell>
                  <DocTotals entries={[{ label: 'Total Amount', value: formatCurrency(activePullOut.totalAmount), grand: true }]} />
                </DocRow>
                <TransactionHistory activity={activity} record={activePullOut} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activePullOut.voided} />
                {canVoid && !activePullOut.voided && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleVoid}
                    loading={voiding}
                    disabled={hasReceipts}
                    title={hasReceipts ? 'Received at the main warehouse — void its Pull Out Receive(s) first.' : undefined}
                  >
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton
                    companyId={activePullOut.companyId}
                    documentType="OUTLET_PULL_OUT"
                    data={activePullOut as unknown as Record<string, unknown>}
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
                      id="opo-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Outlet Pull Out" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Pull Out Date" htmlFor="opo-date" required>
                        <Input id="opo-date" type="date" value={pullOutDate}
                          onChange={e => setPullOutDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="opo-sheet">
                        <Input id="opo-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Outlet" htmlFor="opo-outlet" required>
                    <SearchableSelect
                      id="opo-outlet"
                      value={customerId === '' ? '' : String(customerId)}
                      onChange={v => setCustomerId(v ? Number(v) : '')}
                      options={outlets.map(o => ({ value: String(o.id), label: o.name }))}
                      disabled={!companyId}
                      autoFocus={!showCompanyColumn}
                    />
                  </DocCell>
                  <DocCell label="From (Outlet Warehouse)">
                    <DocText className={cn(!selectedOutlet?.warehouseName && 'italic text-[hsl(var(--muted-foreground))]')}>
                      {selectedOutlet?.warehouseName ?? 'The outlet\'s own warehouse'}
                    </DocText>
                  </DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Reason" htmlFor="opo-reason" required>
                    <SearchableSelect
                      id="opo-reason"
                      value={reasonId === '' ? '' : String(reasonId)}
                      onChange={v => setReasonId(v ? Number(v) : '')}
                      options={reasons.map(r => ({ value: String(r.id), label: r.name }))}
                      disabled={!companyId}
                    />
                    {companyId && reasons.length === 0 && (
                      <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">
                        No active pull out reasons — add one on the Pull Out Reasons page first.
                      </p>
                    )}
                  </DocCell>
                  <DocCell label="To (In Transit)">
                    <DocText className="italic text-[hsl(var(--muted-foreground))]">The company's main warehouse</DocText>
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={lines}
                  columns={[
                    {
                      key: 'item', label: 'Item', required: true,
                      render: (line, i) => (
                        <SearchableSelect
                          value={line.itemId === '' ? '' : String(line.itemId)}
                          onChange={v => handleLineItemChange(i, v ? Number(v) : '')}
                          options={formInventoryItems.map(item => ({ value: String(item.id), label: `${item.code} — ${item.name}` }))}
                        />
                      ),
                    },
                    {
                      key: 'onHand', label: 'On Hand', align: 'right', width: '7rem', readOnly: true,
                      render: line => (
                        <StockCell stock={stock} field="quantity" itemId={line.itemId} warehouseChosen={outletWarehouseId !== ''}
                          short={() => line.itemId !== '' && shortStock.has(line.itemId)} />
                      ),
                    },
                    {
                      key: 'quantity', label: 'Quantity', align: 'right', width: '7rem', required: true,
                      render: (line, i) => (
                        <Input type="number" step="0.0001" min="0" aria-label={`Line ${i + 1} quantity`} value={line.quantity}
                          onChange={e => updateLine(i, { quantity: e.target.value })} className="text-right" />
                      ),
                    },
                    {
                      key: 'unitPrice', label: 'Unit Price', align: 'right', width: '8rem',
                      render: (line, i) => (
                        <Input type="number" step="0.01" min="0" aria-label={`Line ${i + 1} unit price`} value={line.unitPrice}
                          onChange={e => updateLine(i, { unitPrice: e.target.value })} className="text-right" />
                      ),
                    },
                    {
                      key: 'amount', label: 'Amount', align: 'right', width: '8rem', readOnly: true,
                      render: line => (
                        <span className="tabular-nums">{line.itemId !== '' && line.quantity.trim() !== '' ? formatCurrency(lineAmount(line)) : '—'}</span>
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
                          No items are tagged Inventory — tag an item on the Items page before posting an outlet pull out.
                        </span>
                      )}
                    </div>
                  }
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="opo-remarks">
                    <Input id="opo-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[{ label: 'Total Amount', value: formatCurrency(draftTotal), grand: true }]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Outlet Pull Out</Button>
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
                {isVisible('reason') && <th className="text-left py-2 px-4 font-medium">Reason</th>}
                {isVisible('status') && <th className="text-left py-2 px-4 font-medium">Receiving</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Pull Out Date</th>}
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
                filterable={key => key !== 'outlet' && key !== 'reason' && key !== 'company' && key !== 'status' && key !== 'total' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {pullOuts.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No outlet pull outs match your search/filters.' : 'No outlet pull outs to display.'}
                  </td>
                </tr>
              ) : (
                pullOuts.map((pullOut, i) => (
                  <tr
                    key={pullOut.id}
                    onClick={() => { setActiveIndex(i); openView(pullOut) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{pullOut.companyName}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{pullOut.referenceNumber}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{pullOut.sheetNumber ?? '—'}</td>}
                    {isVisible('outlet') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{pullOut.customerName}</td>}
                    {isVisible('reason') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{pullOut.pullOutReasonName ?? '—'}</td>}
                    {isVisible('status') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receivingStatus(pullOut)}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(pullOut.pullOutDate)}</td>}
                    {isVisible('total') && <td className="py-2 px-4 text-right tabular-nums">{formatCurrency(pullOut.totalAmount)}</td>}
                    {isVisible('origin') && <td className="py-2 px-4"><OriginBadge origin={pullOut.origin} /></td>}
                    {isVisible('voided') && (
                      <td className="py-2 px-4">
                        {pullOut.voided && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                            Voided
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openView(pullOut)}>
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
