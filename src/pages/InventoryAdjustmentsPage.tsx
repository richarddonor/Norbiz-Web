import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Eye, Search, FileDown, Ban, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
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
import { useLookup, useStock, type LookupOption, type ItemLookupOption } from '@/lib/lookups'
import { StockCell } from '@/components/StockCell'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { PrintButton } from '@/components/PrintButton'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'

type FormMode = 'view' | 'create'

interface CompanyOption {
  id: number
  name: string
}

interface AdjustmentLine {
  id: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  quantity: string
  quantityLoaded: string
}

interface Adjustment {
  id: number
  companyId: number
  companyName: string
  warehouseId: number
  warehouseName: string
  referenceNumber: string
  sheetNumber: string | null
  adjustmentDate: string
  reason: string | null
  createdAt: string | null
  createdBy: string | null
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  loaded: boolean
  lines: AdjustmentLine[]
}

interface LineDraft {
  itemId: number | ''
  quantity: string
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #' },
    { key: 'sheetNumber', label: 'Sheet #' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'date', label: 'Adjustment Date', type: 'date' },
    { key: 'reason', label: 'Reason' },
    { key: 'voided', label: 'Voided', type: 'boolean' },
  )
  return columns
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function adjustmentSearchText(a: Adjustment): string {
  return [a.referenceNumber, a.sheetNumber ?? '', a.warehouseName, a.reason ?? '', a.companyName, formatDate(a.adjustmentDate)].join(' ')
}

export function InventoryAdjustmentsPage() {
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
  const { items: adjustments, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<Adjustment>('/inventory-adjustments', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load inventory adjustments.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: adjustmentSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<Adjustment>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Adjustment>(`/inventory-adjustments/${id}`),
  })
  const [activeAdjustment, setActiveAdjustment] = useState<Adjustment | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [warehouseId, setWarehouseId]         = useState<number | ''>('')
  const [adjustmentDate, setAdjustmentDate]   = useState(todayIso())
  const [reason, setReason]                   = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([{ itemId: '', quantity: '' }])
  const [loading, setLoading]                 = useState(false)
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const formWarehouses = useLookup<LookupOption>('warehouses', lookupCompanyId, { onError: () => toast('Failed to load warehouses.', 'error') })
  const formInventoryItems = useLookup<ItemLookupOption>('items', lookupCompanyId, { enabled: inRecordTab && mode === 'create', params: { tag: 'INVENTORY' }, onError: () => toast('Failed to load items.', 'error') })
  // An adjustment posts to on-hand quantity only, so that's the balance shown as a guide while creating.
  const stock = useStock(lookupCompanyId, warehouseId, lines.map(l => l.itemId), { enabled: inRecordTab && mode === 'create', onError: () => toast('Failed to load stock balances.', 'error') })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('inventory-adjustments')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_INVENTORY_ADJUSTMENT')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_INVENTORY_ADJUSTMENT')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('INVENTORY_ADJUSTMENT', inRecordTab && mode === 'view' ? activeAdjustment?.id : null, activeAdjustment?.referenceNumber, activeAdjustment?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: adjustments,
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

  function openView(adjustment: Adjustment) {
    if (!rec.isRecordTab) return rec.open('view', adjustment)
    setActiveAdjustment(adjustment)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveAdjustment(null)
    const nextCompanyId = activeCompanyId ?? ''
    const nextDate = todayIso()
    const nextLines: LineDraft[] = [{ itemId: '', quantity: '' }]
    setCompanyId(nextCompanyId)
    setWarehouseId('')
    setAdjustmentDate(nextDate)
    setReason('')
    setSheetNumber('')
    setLines(nextLines)
    markClean({ companyId: nextCompanyId, warehouseId: '', adjustmentDate: nextDate, reason: '', sheetNumber: '', lines: nextLines })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, warehouseId, adjustmentDate, reason, sheetNumber, lines }, () => rec.close())
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setWarehouseId('')
    setLines([{ itemId: '', quantity: '' }])
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  function addLine() {
    setLines(prev => [...prev, { itemId: '', quantity: '' }])
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
    if (!warehouseId) {
      toast('Select a warehouse.', 'error')
      return
    }
    const validLines = lines.filter(l => l.itemId !== '' && l.quantity.trim() !== '')
    if (validLines.length === 0) {
      toast('Add at least one line with an item and quantity.', 'error')
      return
    }
    if (!window.confirm('Post this inventory adjustment? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        warehouseId,
        adjustmentDate,
        reason: reason || null,
        sheetNumber: sheetNumber || null,
        lines: validLines.map(l => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
      }
      await apiFetch<Adjustment>('/inventory-adjustments', { method: 'POST', body: JSON.stringify(body) })
      toast('Inventory adjustment posted successfully.', 'success')
      rec.close()
      reload()
    } catch {
      toast('Failed to post inventory adjustment.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<Adjustment>(qs ? `/inventory-adjustments?${qs}` : '/inventory-adjustments', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(a => adjustmentSearchText(a).toLowerCase().includes(term)) : all
    const rows = matching.map(a => ({
      referenceNumber: a.referenceNumber,
      sheetNumber: a.sheetNumber ?? '',
      warehouse: a.warehouseName,
      date: formatDate(a.adjustmentDate),
      reason: a.reason ?? '',
      company: a.companyName,
    }))
    exportToXlsx('inventory-adjustments', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  function printFailed() {
    if (!activeAdjustment) return
    // Template lookup is scoped to the adjustment's own company — a default template
    // configured under a different company (e.g. while a different one was active) won't match.
    toast(
      `No active print template configured for Inventory Adjustments under ${activeAdjustment.companyName}. Create one under Document Templates while ${activeAdjustment.companyName} is your active company.`,
      'error'
    )
  }

  async function handleVoid() {
    if (!activeAdjustment) return
    if (!window.confirm(`Void adjustment "${activeAdjustment.referenceNumber}"? This reverses its stock effect and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<Adjustment>(`/inventory-adjustments/${activeAdjustment.id}/void`, { method: 'POST' })
      setActiveAdjustment(voided)
      toast('Adjustment voided.', 'success')
      reload()
    } catch {
      toast('Failed to void adjustment.', 'error')
    } finally {
      setVoiding(false)
    }
  }

  const recordName = activeAdjustment?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Inventory Adjustment' : recordName || 'Inventory Adjustment'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Inventory Adjustment</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search adjustments… (/)"
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
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-3xl">
          {mode === 'view' && activeAdjustment ? (
            <div className="space-y-4">
              <DocSheet>
                {activeAdjustment.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="adj-company" readOnly name={activeAdjustment.companyName} />}>
                  <DocHeader title="Inventory Adjustment" number={activeAdjustment.referenceNumber}>
                    <DocRow>
                      <DocCell label="Adjustment Date"><DocText>{formatDate(activeAdjustment.adjustmentDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeAdjustment.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Warehouse"><DocText>{activeAdjustment.warehouseName}</DocText></DocCell>
                  <DocCell label="Reason"><DocText>{activeAdjustment.reason}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activeAdjustment.lines)}
                  rowKey={line => line.id}
                  lineNumber={line => line.lineNumber}
                  minRows={5}
                  columns={[
                    { key: 'item', label: 'Item', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity', align: 'right', width: '9rem', render: line => line.quantity },
                  ]}
                />
                <TransactionHistory activity={activity} record={activeAdjustment} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activeAdjustment.voided} />
                {canVoid && !activeAdjustment.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton
                    companyId={activeAdjustment.companyId}
                    documentType="INVENTORY_ADJUSTMENT"
                    data={activeAdjustment as unknown as Record<string, unknown>}
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
                      id="adj-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Inventory Adjustment" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Adjustment Date" htmlFor="adj-date">
                        <Input id="adj-date" type="date" value={adjustmentDate}
                          onChange={e => setAdjustmentDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="adj-sheet">
                        <Input id="adj-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Warehouse" htmlFor="adj-warehouse">
                    <SearchableSelect
                      id="adj-warehouse"
                      value={warehouseId === '' ? '' : String(warehouseId)}
                      onChange={v => setWarehouseId(v ? Number(v) : '')}
                      options={formWarehouses.map(w => ({ value: String(w.id), label: w.name }))}
                      autoFocus={!showCompanyColumn}
                    />
                  </DocCell>
                  <DocCell label="Reason" htmlFor="adj-reason">
                    <Input id="adj-reason" value={reason} onChange={e => setReason(e.target.value)} />
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={lines}
                  columns={[
                    {
                      key: 'item', label: 'Item',
                      render: (line, i) => (
                        <SearchableSelect
                          value={line.itemId === '' ? '' : String(line.itemId)}
                          onChange={v => updateLine(i, { itemId: v ? Number(v) : '' })}
                          options={formInventoryItems.map(item => ({ value: String(item.id), label: `${item.code} — ${item.name}` }))}
                        />
                      ),
                    },
                    {
                      key: 'onHand', label: 'On Hand', align: 'right', width: '7rem',
                      render: line => (
                        <StockCell stock={stock} field="quantity" itemId={line.itemId} warehouseChosen={warehouseId !== ''}
                          short={available => line.quantity.trim() !== '' && available + Number(line.quantity) < 0} />
                      ),
                    },
                    {
                      key: 'quantity', label: 'Quantity', align: 'right', width: '9rem',
                      render: (line, i) => (
                        <Input type="number" step="0.0001" aria-label={`Line ${i + 1} quantity`} value={line.quantity}
                          onChange={e => updateLine(i, { quantity: e.target.value })} className="text-right" />
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
                          No items are tagged Inventory — tag an item on the Items page before posting an adjustment.
                        </span>
                      )}
                    </div>
                  }
                />
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Adjustment</Button>
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
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Adjustment Date</th>}
                {isVisible('reason') && <th className="text-left py-2 px-4 font-medium">Reason</th>}
                {isVisible('voided') && <th className="text-left py-2 px-4 font-medium">Voided</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'warehouse' && key !== 'company' && key !== 'reason' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {adjustments.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No adjustments match your search/filters.' : 'No inventory adjustments to display.'}
                  </td>
                </tr>
              ) : (
                adjustments.map((adjustment, i) => (
                  <tr
                    key={adjustment.id}
                    onClick={() => { setActiveIndex(i); openView(adjustment) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{adjustment.companyName}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{adjustment.referenceNumber}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{adjustment.sheetNumber ?? '—'}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{adjustment.warehouseName}</td>}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(adjustment.adjustmentDate)}</td>}
                    {isVisible('reason') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{adjustment.reason ?? '—'}</td>}
                    {isVisible('voided') && (
                      <td className="py-2 px-4">
                        {adjustment.voided && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                            Voided
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openView(adjustment)}>
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
