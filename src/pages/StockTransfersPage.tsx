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
import { useLookup, useStock, type LookupOption, type ItemLookupOption } from '@/lib/lookups'
import { StockCell } from '@/components/StockCell'
import { shortItems } from '@/lib/stock'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'

type FormMode = 'view' | 'create'
type CustomerType = 'CUSTOMER' | 'OUTLET'

interface CompanyOption {
  id: number
  name: string
}

interface TransferLine {
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

interface StockTransfer {
  id: number
  companyId: number
  companyName: string
  customerId: number
  customerName: string
  customerType: CustomerType
  /** the main warehouse the stock is held in */
  warehouseId: number
  warehouseName: string
  /** the (non-voided) Delivery Receipt that delivered this transfer, if any */
  deliveryReceiptId: number | null
  deliveryReceiptReferenceNumber: string | null
  referenceNumber: string
  sheetNumber: string | null
  transferDate: string
  remarks: string | null
  totalAmount: string
  createdAt: string | null
  createdBy: string | null
  origin: TransactionOrigin
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  loaded: boolean
  lines: TransferLine[]
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
    { key: 'customer', label: 'Customer' },
    { key: 'warehouse', label: 'Held In' },
    { key: 'status', label: 'Delivery' },
    { key: 'date', label: 'Transfer Date', type: 'date' },
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

// A transfer holds its stock in the main warehouse until a Delivery Receipt delivers it (in full).
function deliveryStatus(t: StockTransfer): string {
  if (!t.loaded) return 'Open'
  return t.deliveryReceiptReferenceNumber ? `Delivered (${t.deliveryReceiptReferenceNumber})` : 'Delivered'
}

function transferSearchText(t: StockTransfer): string {
  return [t.referenceNumber, t.sheetNumber ?? '', t.customerName, t.warehouseName, deliveryStatus(t),
    t.remarks ?? '', t.companyName, formatDate(t.transferDate)].join(' ')
}

function lineAmount(line: LineDraft): number {
  const qty = Number(line.quantity)
  const price = Number(line.unitPrice)
  return Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0
}

export function StockTransfersPage() {
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
  const { items: transfers, page, setPage, totalPages, totalElements, reload, loading: listLoading, searchAll } = usePagedList<StockTransfer>('/stock-transfers', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load stock transfers.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: transferSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<StockTransfer>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<StockTransfer>(`/stock-transfers/${id}`),
  })
  const [activeTransfer, setActiveTransfer]   = useState<StockTransfer | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [customerId, setCustomerId]           = useState<number | ''>('')
  const [transferDate, setTransferDate]       = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([EMPTY_LINE])
  const [loading, setLoading]                 = useState(false)
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const customers = useLookup<LookupOption>('customers', lookupCompanyId, { enabled: !inRecordTab || creating, onError: () => toast('Failed to load customers.', 'error') })
  // Stock is always held in the company's main warehouse — there's no warehouse picker.
  const mainWarehouses = useLookup<LookupOption>('warehouses', lookupCompanyId, { enabled: creating, params: { mainOnly: 'true' }, onError: () => toast('Failed to load the main warehouse.', 'error') })
  const mainWarehouse = mainWarehouses[0]
  const formInventoryItems = useLookup<ItemLookupOption>('items', lookupCompanyId, { enabled: creating, params: { tag: 'INVENTORY' }, onError: () => toast('Failed to load items.', 'error') })
  // Only stock on hand in the main warehouse can be set aside, so that's the balance shown as a guide.
  const stock = useStock(lookupCompanyId, mainWarehouse?.id ?? '', lines.map(l => l.itemId), { enabled: creating, onError: () => toast('Failed to load stock balances.', 'error') })
  // Items whose quantity across all lines exceeds on-hand — on-hand can't go below zero, so Post is blocked.
  const shortStock = shortItems(lines, stock, l => Number(l.quantity))
  const draftTotal = lines.reduce((sum, l) => sum + (l.itemId !== '' ? lineAmount(l) : 0), 0)
  const { isVisible, menu: columnMenu } = useColumnVisibility('stock-transfers')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_STOCK_TRANSFER')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_STOCK_TRANSFER')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('STOCK_TRANSFER', inRecordTab && mode === 'view' ? activeTransfer?.id : null, activeTransfer?.referenceNumber, activeTransfer?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: transfers,
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

  function openView(transfer: StockTransfer) {
    if (!rec.isRecordTab) return rec.open('view', transfer)
    setActiveTransfer(transfer)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveTransfer(null)
    const nextCompanyId = activeCompanyId ?? ''
    const nextDate = todayIso()
    const nextLines: LineDraft[] = [EMPTY_LINE]
    setCompanyId(nextCompanyId)
    setCustomerId('')
    setTransferDate(nextDate)
    setRemarks('')
    setSheetNumber('')
    setLines(nextLines)
    markClean({ companyId: nextCompanyId, customerId: '', transferDate: nextDate, remarks: '', sheetNumber: '', lines: nextLines })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, customerId, transferDate, remarks, sheetNumber, lines }, () => rec.close())
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setCustomerId('')
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
    if (!mainWarehouse) {
      toast('No main warehouse is set for this company. Mark one as Main on the Warehouses page first.', 'error')
      return
    }
    if (!customerId) {
      toast('Select a customer.', 'error')
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
    if (!window.confirm('Post this stock transfer? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        customerId,
        transferDate,
        remarks: remarks || null,
        sheetNumber: sheetNumber || null,
        lines: validLines.map(l => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice.trim() !== '' ? Number(l.unitPrice) : null,
        })),
      }
      await apiFetch<StockTransfer>('/stock-transfers', { method: 'POST', body: JSON.stringify(body) })
      toast('Stock transfer posted successfully.', 'success')
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post stock transfer.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<StockTransfer>(qs ? `/stock-transfers?${qs}` : '/stock-transfers', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(r => transferSearchText(r).toLowerCase().includes(term)) : all
    const rows = matching.map(r => ({
      referenceNumber: r.referenceNumber,
      sheetNumber: r.sheetNumber ?? '',
      customer: r.customerName,
      warehouse: r.warehouseName,
      status: deliveryStatus(r),
      date: formatDate(r.transferDate),
      total: formatCurrency(r.totalAmount),
      voided: r.voided ? 'Yes' : '',
      origin: originLabel(r.origin),
      company: r.companyName,
    }))
    exportToXlsx('stock-transfers', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  function printFailed() {
    if (!activeTransfer) return
    toast(
      `No active print template configured for Stock Transfers under ${activeTransfer.companyName}. Create one under Document Templates while ${activeTransfer.companyName} is your active company.`,
      'error'
    )
  }

  async function handleVoid() {
    if (!activeTransfer) return
    if (!window.confirm(`Void stock transfer "${activeTransfer.referenceNumber}"? This releases the stock held in ${activeTransfer.warehouseName} and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<StockTransfer>(`/stock-transfers/${activeTransfer.id}/void`, { method: 'POST' })
      setActiveTransfer(voided)
      toast('Stock transfer voided.', 'success')
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void stock transfer.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const recordName = activeTransfer?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Stock Transfer' : recordName || 'Stock Transfer'
  // Delivered: the backend blocks voiding until that Delivery Receipt is voided.

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Stock Transfers</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect
            value={filters.customerId ?? ''}
            onChange={v => setFilters(prev => ({ ...prev, customerId: v }))}
            options={customers.map(c => ({ value: String(c.id), label: c.name }))}
            placeholder="All customers"
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
          {mode === 'view' && activeTransfer ? (
            <div className="space-y-4">
              <OriginNotice origin={activeTransfer.origin} />
              <DocSheet>
                {activeTransfer.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="stf-company" readOnly name={activeTransfer.companyName} />}>
                  <DocHeader title="Stock Transfer" number={activeTransfer.referenceNumber}>
                    <DocRow>
                      <DocCell label="Transfer Date"><DocText>{formatDate(activeTransfer.transferDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeTransfer.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label={activeTransfer.customerType === 'OUTLET' ? 'Transfer To (Outlet)' : 'Transfer To (Customer)'}>
                    <DocText>{activeTransfer.customerName}</DocText>
                  </DocCell>
                  <DocCell label="Held In (Main Warehouse)"><DocText>{activeTransfer.warehouseName}</DocText></DocCell>
                  <DocCell label="Delivery"><DocText>{deliveryStatus(activeTransfer)}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activeTransfer.lines)}
                  rowKey={line => line.id}
                  lineNumber={line => line.lineNumber}
                  minRows={5}
                  columns={[
                    { key: 'item', label: 'Item', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity', align: 'right', width: '7rem', render: line => line.quantity },
                    { key: 'unitPrice', label: 'Unit Price', align: 'right', width: '8rem', render: line => formatCurrency(line.unitPrice) },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: line => formatCurrency(line.amount) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{activeTransfer.remarks}</DocText></DocCell>
                  <DocTotals entries={[{ label: 'Total Amount', value: formatCurrency(activeTransfer.totalAmount), grand: true }]} />
                </DocRow>
                <TransactionHistory activity={activity} record={activeTransfer} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activeTransfer.voided} />
                {canVoid && !activeTransfer.voided && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleVoid}
                    loading={voiding}
                    disabled={activeTransfer.loaded}
                    title={activeTransfer.loaded ? 'Already delivered — void its Delivery Receipt first.' : undefined}
                  >
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton
                    companyId={activeTransfer.companyId}
                    documentType="STOCK_TRANSFER"
                    data={activeTransfer as unknown as Record<string, unknown>}
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
                      id="stf-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Stock Transfer" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Transfer Date" htmlFor="stf-date" required>
                        <Input id="stf-date" type="date" value={transferDate}
                          onChange={e => setTransferDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="stf-sheet">
                        <Input id="stf-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Transfer To (Customer)" htmlFor="stf-customer" required>
                    <SearchableSelect
                      id="stf-customer"
                      value={customerId === '' ? '' : String(customerId)}
                      onChange={v => setCustomerId(v ? Number(v) : '')}
                      options={customers.map(c => ({ value: String(c.id), label: c.name }))}
                      disabled={!companyId}
                      autoFocus={!showCompanyColumn}
                    />
                    <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">
                      Holds the stock in the main warehouse until a Delivery Receipt delivers this transfer.
                    </p>
                  </DocCell>
                  <DocCell label="Held In (Main Warehouse)">
                    <DocText className={cn(!mainWarehouse && 'italic text-[hsl(var(--destructive))]')}>
                      {mainWarehouse?.name ?? (lookupCompanyId ? 'No main warehouse set — mark one on the Warehouses page' : '')}
                    </DocText>
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
                        <StockCell stock={stock} field="quantity" itemId={line.itemId} warehouseChosen={!!mainWarehouse}
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
                          No items are tagged Inventory — tag an item on the Items page before posting a stock transfer.
                        </span>
                      )}
                    </div>
                  }
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="stf-remarks">
                    <Input id="stf-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[{ label: 'Total Amount', value: formatCurrency(draftTotal), grand: true }]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Stock Transfer</Button>
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
                {isVisible('customer') && <th className="text-left py-2 px-4 font-medium">Customer</th>}
                {isVisible('warehouse') && <th className="text-left py-2 px-4 font-medium">Held In</th>}
                {isVisible('status') && <th className="text-left py-2 px-4 font-medium">Delivery</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Transfer Date</th>}
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
                filterable={key => key !== 'customer' && key !== 'warehouse' && key !== 'company' && key !== 'status' && key !== 'total' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No stock transfers match your search/filters.' : 'No stock transfers to display.'}
                  </td>
                </tr>
              ) : (
                transfers.map((transfer, i) => (
                  <tr
                    key={transfer.id}
                    onClick={() => { setActiveIndex(i); openView(transfer) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{transfer.companyName}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{transfer.referenceNumber}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{transfer.sheetNumber ?? '—'}</td>}
                    {isVisible('customer') && (
                      <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                        {transfer.customerName}
                        {transfer.customerType === 'OUTLET' && <span className="ml-1.5 text-xs">(Outlet)</span>}
                      </td>
                    )}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{transfer.warehouseName}</td>}
                    {isVisible('status') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{deliveryStatus(transfer)}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(transfer.transferDate)}</td>}
                    {isVisible('total') && <td className="py-2 px-4 text-right tabular-nums">{formatCurrency(transfer.totalAmount)}</td>}
                    {isVisible('origin') && <td className="py-2 px-4"><OriginBadge origin={transfer.origin} /></td>}
                    {isVisible('voided') && (
                      <td className="py-2 px-4">
                        {transfer.voided && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                            Voided
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openView(transfer)}>
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
