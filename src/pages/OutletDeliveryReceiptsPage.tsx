import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Eye, Search, FileDown, Ban, X } from 'lucide-react'
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
import { ReloadButton } from '@/components/ReloadButton'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
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

interface OutletDeliveryLine {
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

interface OutletDeliveryReceipt {
  id: number
  companyId: number
  companyName: string
  customerId: number
  customerName: string
  warehouseId: number
  warehouseName: string
  agentId: number
  agentCode: string
  agentName: string
  referenceNumber: string
  sheetNumber: string | null
  deliveryDate: string
  remarks: string | null
  totalAmount: string
  createdAt: string | null
  createdBy: string | null
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  loaded: boolean
  lines: OutletDeliveryLine[]
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
    { key: 'agent', label: 'Agent' },
    { key: 'status', label: 'Returns' },
    { key: 'date', label: 'Delivery Date', type: 'date' },
    { key: 'total', label: 'Total Amount' },
    { key: 'voided', label: 'Voided', type: 'boolean' },
  )
  return columns
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function returnStatus(r: OutletDeliveryReceipt): string {
  if (r.loaded) return 'Fully returned'
  return r.lines.some(l => Number(l.quantityLoaded) > 0) ? 'Partially returned' : '—'
}

function receiptSearchText(r: OutletDeliveryReceipt): string {
  return [r.referenceNumber, r.sheetNumber ?? '', r.customerName, r.warehouseName, r.agentCode, r.agentName,
    returnStatus(r), r.remarks ?? '', r.companyName, formatDate(r.deliveryDate)].join(' ')
}

function lineAmount(line: LineDraft): number {
  const qty = Number(line.quantity)
  const price = Number(line.unitPrice)
  return Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0
}

function agentLabel(a: LookupOption): string {
  return a.code ? `${a.code} — ${a.name}` : a.name
}

export function OutletDeliveryReceiptsPage() {
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
  const { items: receipts, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<OutletDeliveryReceipt>('/outlet-delivery-receipts', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load outlet delivery receipts.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: receiptSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<OutletDeliveryReceipt>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<OutletDeliveryReceipt>(`/outlet-delivery-receipts/${id}`),
  })
  const [activeReceipt, setActiveReceipt]     = useState<OutletDeliveryReceipt | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [customerId, setCustomerId]           = useState<number | ''>('')
  const [agentId, setAgentId]                 = useState<number | ''>('')
  const [deliveryDate, setDeliveryDate]       = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([EMPTY_LINE])
  const [loading, setLoading]                 = useState(false)
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const outlets = useLookup<CustomerLookupOption>('customers', lookupCompanyId, { enabled: !inRecordTab || creating, params: { type: 'OUTLET' }, onError: () => toast('Failed to load outlets.', 'error') })
  // Only employees tagged AGENT earn sales commission; the backend rejects anyone else.
  const agents = useLookup<LookupOption>('employees', lookupCompanyId, { enabled: !inRecordTab || creating, params: { tag: 'AGENT' }, onError: () => toast('Failed to load agents.', 'error') })
  const formInventoryItems = useLookup<ItemLookupOption>('items', lookupCompanyId, { enabled: creating, params: { tag: 'INVENTORY' }, onError: () => toast('Failed to load items.', 'error') })
  const selectedOutlet = customerId === '' ? undefined : outlets.find(o => o.id === customerId)
  const outletWarehouseId = selectedOutlet?.warehouseId ?? ''
  // A sale deducts on-hand stock from the outlet's own warehouse, so that's the balance shown as a guide.
  const stock = useStock(lookupCompanyId, outletWarehouseId, lines.map(l => l.itemId), { enabled: creating, onError: () => toast('Failed to load stock balances.', 'error') })
  // Items whose quantity across all lines exceeds on-hand — on-hand can't go below zero, so Post is blocked.
  const shortStock = shortItems(lines, stock, l => Number(l.quantity))
  const draftTotal = lines.reduce((sum, l) => sum + (l.itemId !== '' ? lineAmount(l) : 0), 0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, menu: columnMenu } = useColumnVisibility('outlet-delivery-receipts')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_OUTLET_DELIVERY_RECEIPT')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_OUTLET_DELIVERY_RECEIPT')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('OUTLET_DELIVERY_RECEIPT', inRecordTab && mode === 'view' ? activeReceipt?.id : null, activeReceipt?.referenceNumber, activeReceipt?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: receipts,
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

  function openView(receipt: OutletDeliveryReceipt) {
    if (!rec.isRecordTab) return rec.open('view', receipt)
    setActiveReceipt(receipt)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveReceipt(null)
    const nextCompanyId = activeCompanyId ?? ''
    const nextDate = todayIso()
    const nextLines: LineDraft[] = [EMPTY_LINE]
    setCompanyId(nextCompanyId)
    setCustomerId('')
    setAgentId('')
    setDeliveryDate(nextDate)
    setRemarks('')
    setSheetNumber('')
    setLines(nextLines)
    markClean({ companyId: nextCompanyId, customerId: '', agentId: '', deliveryDate: nextDate, remarks: '', sheetNumber: '', lines: nextLines })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, customerId, agentId, deliveryDate, remarks, sheetNumber, lines }, () => rec.close())
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setCustomerId('')
    setAgentId('')
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
      toast(`${selectedOutlet.name} has no warehouse to sell from.`, 'error')
      return
    }
    if (!agentId) {
      toast('Select an agent.', 'error')
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
    if (!window.confirm('Post this outlet delivery receipt? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        customerId,
        agentId,
        deliveryDate,
        remarks: remarks || null,
        sheetNumber: sheetNumber || null,
        lines: validLines.map(l => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice.trim() !== '' ? Number(l.unitPrice) : null,
        })),
      }
      await apiFetch<OutletDeliveryReceipt>('/outlet-delivery-receipts', { method: 'POST', body: JSON.stringify(body) })
      toast('Outlet delivery receipt posted successfully.', 'success')
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post outlet delivery receipt.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<OutletDeliveryReceipt>(qs ? `/outlet-delivery-receipts?${qs}` : '/outlet-delivery-receipts', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(r => receiptSearchText(r).toLowerCase().includes(term)) : all
    const rows = matching.map(r => ({
      referenceNumber: r.referenceNumber,
      sheetNumber: r.sheetNumber ?? '',
      outlet: r.customerName,
      agent: `${r.agentCode} — ${r.agentName}`,
      status: returnStatus(r),
      date: formatDate(r.deliveryDate),
      total: formatCurrency(r.totalAmount),
      voided: r.voided ? 'Yes' : '',
      company: r.companyName,
    }))
    exportToXlsx('outlet-delivery-receipts', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  function printFailed() {
    if (!activeReceipt) return
    toast(
      `No active print template configured for Outlet Delivery Receipts under ${activeReceipt.companyName}. Create one under Document Templates while ${activeReceipt.companyName} is your active company.`,
      'error'
    )
  }

  async function handleVoid() {
    if (!activeReceipt) return
    if (!window.confirm(`Void outlet delivery receipt "${activeReceipt.referenceNumber}"? This returns the stock to ${activeReceipt.warehouseName} and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<OutletDeliveryReceipt>(`/outlet-delivery-receipts/${activeReceipt.id}/void`, { method: 'POST' })
      setActiveReceipt(voided)
      toast('Outlet delivery receipt voided.', 'success')
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void outlet delivery receipt.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const recordName = activeReceipt?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Outlet Delivery Receipt' : recordName || 'Outlet Delivery Receipt'
  // Returned (even partly): the backend blocks voiding until those returns are voided.
  const hasReturns = !!activeReceipt && activeReceipt.lines.some(l => Number(l.quantityLoaded) > 0)

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Outlet Delivery Receipts</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search outlet delivery receipts… (/)"
              className="pl-8 w-64"
            />
          </div>
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
            options={agents.map(a => ({ value: String(a.id), label: agentLabel(a) }))}
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
        </div>
      </div>

      </>)}

      {inRecordTab && (
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-4xl">
          {mode === 'view' && activeReceipt ? (
            <div className="space-y-4">
              <DocSheet>
                {activeReceipt.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="odr-company" readOnly name={activeReceipt.companyName} />}>
                  <DocHeader title="Outlet Delivery Receipt" number={activeReceipt.referenceNumber}>
                    <DocRow>
                      <DocCell label="Delivery Date"><DocText>{formatDate(activeReceipt.deliveryDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeReceipt.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Outlet"><DocText>{activeReceipt.customerName}</DocText></DocCell>
                  <DocCell label="Sold From (Warehouse)"><DocText>{activeReceipt.warehouseName}</DocText></DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Agent"><DocText>{`${activeReceipt.agentCode} — ${activeReceipt.agentName}`}</DocText></DocCell>
                  <DocCell label="Returns"><DocText>{returnStatus(activeReceipt)}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activeReceipt.lines)}
                  rowKey={line => line.id}
                  lineNumber={line => line.lineNumber}
                  minRows={5}
                  columns={[
                    { key: 'item', label: 'Item', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity', align: 'right', width: '7rem', render: line => line.quantity },
                    { key: 'returned', label: 'Returned', align: 'right', width: '7rem', render: line => line.quantityLoaded },
                    { key: 'unitPrice', label: 'Unit Price', align: 'right', width: '8rem', render: line => formatCurrency(line.unitPrice) },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: line => formatCurrency(line.amount) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{activeReceipt.remarks}</DocText></DocCell>
                  <DocTotals entries={[{ label: 'Total Amount', value: formatCurrency(activeReceipt.totalAmount), grand: true }]} />
                </DocRow>
                <TransactionHistory activity={activity} record={activeReceipt} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activeReceipt.voided} />
                {canVoid && !activeReceipt.voided && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleVoid}
                    loading={voiding}
                    disabled={hasReturns}
                    title={hasReturns ? 'Has returns — void its Outlet Delivery Return(s) first.' : undefined}
                  >
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton
                    companyId={activeReceipt.companyId}
                    documentType="OUTLET_DELIVERY_RECEIPT"
                    data={activeReceipt as unknown as Record<string, unknown>}
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
                      id="odr-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Outlet Delivery Receipt" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Delivery Date" htmlFor="odr-date" required>
                        <Input id="odr-date" type="date" value={deliveryDate}
                          onChange={e => setDeliveryDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="odr-sheet">
                        <Input id="odr-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Outlet" htmlFor="odr-outlet" required>
                    <SearchableSelect
                      id="odr-outlet"
                      value={customerId === '' ? '' : String(customerId)}
                      onChange={v => setCustomerId(v ? Number(v) : '')}
                      options={outlets.map(o => ({ value: String(o.id), label: o.name }))}
                      disabled={!companyId}
                      autoFocus={!showCompanyColumn}
                    />
                  </DocCell>
                  <DocCell label="Sold From (Outlet Warehouse)">
                    <DocText className={cn(!selectedOutlet?.warehouseName && 'italic text-[hsl(var(--muted-foreground))]')}>
                      {selectedOutlet?.warehouseName ?? 'The outlet\'s own warehouse'}
                    </DocText>
                  </DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Agent" htmlFor="odr-agent" required>
                    <SearchableSelect
                      id="odr-agent"
                      value={agentId === '' ? '' : String(agentId)}
                      onChange={v => setAgentId(v ? Number(v) : '')}
                      options={agents.map(a => ({ value: String(a.id), label: agentLabel(a) }))}
                      disabled={!companyId}
                    />
                    {companyId && agents.length === 0 && (
                      <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">
                        No active employees are tagged Agent — tag one on the Employees page first.
                      </p>
                    )}
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
                          No items are tagged Inventory — tag an item on the Items page before posting an outlet delivery receipt.
                        </span>
                      )}
                    </div>
                  }
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="odr-remarks">
                    <Input id="odr-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[{ label: 'Total Amount', value: formatCurrency(draftTotal), grand: true }]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Outlet Delivery Receipt</Button>
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
                {isVisible('outlet') && <th className="text-left py-2 px-4 font-medium">Outlet</th>}
                {isVisible('agent') && <th className="text-left py-2 px-4 font-medium">Agent</th>}
                {isVisible('status') && <th className="text-left py-2 px-4 font-medium">Returns</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Delivery Date</th>}
                {isVisible('total') && <th className="text-right py-2 px-4 font-medium">Total Amount</th>}
                {isVisible('voided') && <th className="text-left py-2 px-4 font-medium">Voided</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'outlet' && key !== 'agent' && key !== 'company' && key !== 'status' && key !== 'total' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {receipts.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No outlet delivery receipts match your search/filters.' : 'No outlet delivery receipts to display.'}
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
                    {isVisible('outlet') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receipt.customerName}</td>}
                    {isVisible('agent') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{receipt.agentName}</td>}
                    {isVisible('status') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{returnStatus(receipt)}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(receipt.deliveryDate)}</td>}
                    {isVisible('total') && <td className="py-2 px-4 text-right tabular-nums">{formatCurrency(receipt.totalAmount)}</td>}
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
          </table>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
      </>)}
    </div>
  )
}
