import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Eye, FileDown, Ban, X, ListRestart } from 'lucide-react'
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
import { OriginBadge, OriginNotice } from '@/components/TransactionOrigin'
import { ORIGIN_COLUMN, originLabel, type TransactionOrigin } from '@/lib/transactionOrigin'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { ScrollTable } from '@/components/ScrollTable'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, useStock, type LookupOption, type ItemLookupOption, type BillOfMaterialLookupOption } from '@/lib/lookups'
import { StockCell } from '@/components/StockCell'
import { shortItems } from '@/lib/stock'
import { formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'

// Assembly: builds finished items from raw materials in the main warehouse — outputs add on-hand
// stock, raw materials deduct it. Backend: /assemblies, see ../Norbiz/docs/TRANSACTIONS.md "Assembly".

type FormMode = 'view' | 'create'

interface CompanyOption {
  id: number
  name: string
}

interface AssemblyLine {
  id: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  quantity: string
  /** outputs only */
  billOfMaterialId: number | null
  billOfMaterialCode: string | null
}

interface Assembly {
  id: number
  companyId: number
  companyName: string
  warehouseId: number
  warehouseName: string
  referenceNumber: string
  sheetNumber: string | null
  assemblyDate: string
  remarks: string | null
  createdAt: string | null
  createdBy: string | null
  origin: TransactionOrigin
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  loaded: boolean
  outputs: AssemblyLine[]
  materials: AssemblyLine[]
}

interface OutputDraft {
  itemId: number | ''
  billOfMaterialId: number | ''
  quantity: string
}

interface MaterialDraft {
  itemId: number | ''
  quantity: string
}

const EMPTY_OUTPUT: OutputDraft = { itemId: '', billOfMaterialId: '', quantity: '' }
const EMPTY_MATERIAL: MaterialDraft = { itemId: '', quantity: '' }

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #' },
    { key: 'sheetNumber', label: 'Sheet #' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'outputs', label: 'Outputs' },
    { key: 'date', label: 'Assembly Date', type: 'date' },
    ORIGIN_COLUMN,
    { key: 'voided', label: 'Voided', type: 'boolean' },
  )
  return columns
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function outputsSummary(a: Assembly): string {
  return byLineNumber(a.outputs).map(l => `${l.itemCode} × ${Number(l.quantity)}`).join(', ')
}

function assemblySearchText(a: Assembly): string {
  return [a.referenceNumber, a.sheetNumber ?? '', a.warehouseName, outputsSummary(a),
    ...a.materials.map(l => l.itemCode), a.remarks ?? '', a.companyName, formatDate(a.assemblyDate)].join(' ')
}

/** Raw materials the outputs need: each output's BOM components × quantity assembled, summed per item. */
function materialsFromBoms(outputs: OutputDraft[], boms: BillOfMaterialLookupOption[]): MaterialDraft[] {
  const totals = new Map<number, number>()
  for (const output of outputs) {
    const qty = Number(output.quantity)
    const bom = output.billOfMaterialId === '' ? undefined : boms.find(b => b.id === output.billOfMaterialId)
    if (!bom || !Number.isFinite(qty) || qty <= 0) continue
    for (const c of bom.components) totals.set(c.itemId, (totals.get(c.itemId) ?? 0) + c.quantity * qty)
  }
  return [...totals].map(([itemId, qty]) => ({ itemId, quantity: String(Number(qty.toFixed(4))) }))
}

export function AssembliesPage() {
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
  const { items: assemblies, page, setPage, totalPages, totalElements, reload, loading: listLoading, searchAll } = usePagedList<Assembly>('/assemblies', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load assemblies.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: assemblySearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [mode, setMode]                       = useState<FormMode>('view')
  const rec = useRecordTab<Assembly>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Assembly>(`/assemblies/${id}`),
  })
  const [activeAssembly, setActiveAssembly]   = useState<Assembly | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [assemblyDate, setAssemblyDate]       = useState(todayIso())
  const [remarks, setRemarks]                 = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [outputs, setOutputs]                 = useState<OutputDraft[]>([EMPTY_OUTPUT])
  const [materials, setMaterials]             = useState<MaterialDraft[]>([EMPTY_MATERIAL])
  // While true, raw materials follow the outputs' bills of materials; editing a material line takes over.
  const [materialsFromBom, setMaterialsFromBom] = useState(true)
  const [loading, setLoading]                 = useState(false)
  // Dropdowns are scoped to the form's company (the active company on the list tab).
  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  // Assemblies are always built in the company's main warehouse — there's no warehouse picker.
  const mainWarehouses = useLookup<LookupOption>('warehouses', lookupCompanyId, { enabled: creating, params: { mainOnly: 'true' }, onError: () => toast('Failed to load the main warehouse.', 'error') })
  const mainWarehouse = mainWarehouses[0]
  const formInventoryItems = useLookup<ItemLookupOption>('items', lookupCompanyId, { enabled: creating, params: { tag: 'INVENTORY' }, onError: () => toast('Failed to load items.', 'error') })
  const boms = useLookup<BillOfMaterialLookupOption>('bills-of-materials', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load bills of materials.', 'error') })
  const itemOptions = formInventoryItems.map(item => ({ value: String(item.id), label: `${item.code} — ${item.name}` }))
  const stock = useStock(lookupCompanyId, mainWarehouse?.id ?? '', [...outputs, ...materials].map(l => l.itemId), { enabled: creating, onError: () => toast('Failed to load stock balances.', 'error') })
  // Raw materials whose total exceeds on-hand — on-hand can't go below zero, so Post is blocked.
  const shortStock = shortItems(materials, stock, l => Number(l.quantity))
  const { isVisible, menu: columnMenu } = useColumnVisibility('assemblies')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_ASSEMBLY')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canVoid = hasPermission('VOID_ASSEMBLY')
  const [voiding, setVoiding] = useState(false)
  const activity = useTransactionActivity('ASSEMBLY', inRecordTab && mode === 'view' ? activeAssembly?.id : null, activeAssembly?.referenceNumber, activeAssembly?.voided)

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: assemblies,
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

  // Keep raw materials in step with the outputs' BOMs until the user edits a material line.
  useEffect(() => {
    if (!creating || !materialsFromBom) return
    const computed = materialsFromBoms(outputs, boms)
    setMaterials(computed.length > 0 ? computed : [EMPTY_MATERIAL])
  }, [creating, materialsFromBom, outputs, boms])

  function openView(assembly: Assembly) {
    if (!rec.isRecordTab) return rec.open('view', assembly)
    setActiveAssembly(assembly)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveAssembly(null)
    const nextCompanyId = activeCompanyId ?? ''
    const nextDate = todayIso()
    setCompanyId(nextCompanyId)
    setAssemblyDate(nextDate)
    setRemarks('')
    setSheetNumber('')
    setOutputs([EMPTY_OUTPUT])
    setMaterials([EMPTY_MATERIAL])
    setMaterialsFromBom(true)
    markClean({ companyId: nextCompanyId, assemblyDate: nextDate, remarks: '', sheetNumber: '', outputs: [EMPTY_OUTPUT], materials: [EMPTY_MATERIAL] })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, assemblyDate, remarks, sheetNumber, outputs, materials }, () => rec.close())
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setOutputs([EMPTY_OUTPUT])
    setMaterials([EMPTY_MATERIAL])
    setMaterialsFromBom(true)
  }

  function updateOutput(index: number, patch: Partial<OutputDraft>) {
    setOutputs(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  // A BOM produces one item, so picking a different item preselects its only BOM (if exactly one) or clears it.
  function handleOutputItemChange(index: number, itemId: number | '') {
    const candidates = itemId === '' ? [] : boms.filter(b => b.itemId === itemId)
    updateOutput(index, { itemId, billOfMaterialId: candidates.length === 1 ? candidates[0].id : '' })
  }

  function updateMaterial(index: number, patch: Partial<MaterialDraft>) {
    setMaterialsFromBom(false)
    setMaterials(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  function addOutput() {
    setOutputs(prev => [...prev, EMPTY_OUTPUT])
  }

  function addMaterial() {
    setMaterialsFromBom(false)
    setMaterials(prev => [...prev, EMPTY_MATERIAL])
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
    const validOutputs = outputs.filter(l => l.itemId !== '' && l.quantity.trim() !== '')
    const validMaterials = materials.filter(l => l.itemId !== '' && l.quantity.trim() !== '')
    if (validOutputs.length === 0) {
      toast('Add at least one output with an item and quantity.', 'error')
      return
    }
    if (validMaterials.length === 0) {
      toast('Add at least one raw material with an item and quantity.', 'error')
      return
    }
    if ([...validOutputs, ...validMaterials].some(l => Number(l.quantity) <= 0)) {
      toast('Quantities must be greater than zero.', 'error')
      return
    }
    if (shortStock.size > 0) {
      toast('Not enough raw material on hand for the highlighted line(s) — stock cannot go below zero.', 'error')
      return
    }
    if (!window.confirm('Post this assembly? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      const body = {
        companyId,
        assemblyDate,
        remarks: remarks || null,
        sheetNumber: sheetNumber || null,
        outputs: validOutputs.map(l => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          billOfMaterialId: l.billOfMaterialId === '' ? null : l.billOfMaterialId,
        })),
        materials: validMaterials.map(l => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
      }
      await apiFetch<Assembly>('/assemblies', { method: 'POST', body: JSON.stringify(body) })
      toast('Assembly posted successfully.', 'success')
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post assembly.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<Assembly>(qs ? `/assemblies?${qs}` : '/assemblies', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(a => assemblySearchText(a).toLowerCase().includes(term)) : all
    const rows = matching.map(a => ({
      referenceNumber: a.referenceNumber,
      sheetNumber: a.sheetNumber ?? '',
      warehouse: a.warehouseName,
      outputs: outputsSummary(a),
      date: formatDate(a.assemblyDate),
      origin: originLabel(a.origin),
      voided: a.voided ? 'Yes' : '',
      company: a.companyName,
    }))
    exportToXlsx('assemblies', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  function printFailed() {
    if (!activeAssembly) return
    toast(
      `No active print template configured for Assemblies under ${activeAssembly.companyName}. Create one under Document Templates while ${activeAssembly.companyName} is your active company.`,
      'error'
    )
  }

  async function handleVoid() {
    if (!activeAssembly) return
    if (!window.confirm(`Void assembly "${activeAssembly.referenceNumber}"? This takes the outputs back out of ${activeAssembly.warehouseName}, returns the raw materials, and cannot be undone.`)) return
    setVoiding(true)
    try {
      const voided = await apiFetch<Assembly>(`/assemblies/${activeAssembly.id}/void`, { method: 'POST' })
      setActiveAssembly(voided)
      toast('Assembly voided.', 'success')
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void assembly.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const recordName = activeAssembly?.referenceNumber ?? ''
  const tabTitle = mode === 'create' ? 'New Assembly' : recordName || 'Assembly'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Assemblies</h1>
        <div className="flex flex-wrap items-center gap-2">
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
          {mode === 'view' && activeAssembly ? (
            <div className="space-y-4">
              <OriginNotice origin={activeAssembly.origin} />
              <DocSheet>
                {activeAssembly.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="asm-company" readOnly name={activeAssembly.companyName} />}>
                  <DocHeader title="Assembly" number={activeAssembly.referenceNumber}>
                    <DocRow>
                      <DocCell label="Assembly Date"><DocText>{formatDate(activeAssembly.assemblyDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{activeAssembly.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Warehouse"><DocText>{activeAssembly.warehouseName}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(activeAssembly.outputs)}
                  rowKey={line => line.id}
                  minRows={2}
                  columns={[
                    { key: 'item', label: 'Output', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'bom', label: 'Bill of Materials', width: '10rem', render: line => line.billOfMaterialCode ?? '—' },
                    { key: 'quantity', label: 'Quantity Built', align: 'right', width: '9rem', render: line => line.quantity },
                  ]}
                />
                <DocLines
                  rows={byLineNumber(activeAssembly.materials)}
                  rowKey={line => line.id}
                  minRows={3}
                  columns={[
                    { key: 'item', label: 'Raw Material', render: line => `${line.itemCode} — ${line.itemName}` },
                    { key: 'quantity', label: 'Quantity Used', align: 'right', width: '9rem', render: line => line.quantity },
                  ]}
                />
                <DocRow>
                  <DocCell label="Remarks"><DocText>{activeAssembly.remarks}</DocText></DocCell>
                </DocRow>
                <TransactionHistory activity={activity} record={activeAssembly} />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={activeAssembly.voided} />
                {canVoid && !activeAssembly.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton
                    companyId={activeAssembly.companyId}
                    documentType="ASSEMBLY"
                    data={activeAssembly as unknown as Record<string, unknown>}
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
                      id="asm-company"
                      readOnly={!showCompanyColumn}
                      name={companyOptions.find(c => c.id === companyId)?.name}
                      companies={companyOptions}
                      value={companyId}
                      onChange={handleCompanyChange}
                      autoFocus={showCompanyColumn}
                    />
                }>
                  <DocHeader title="Assembly" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Assembly Date" htmlFor="asm-date" required>
                        <Input id="asm-date" type="date" value={assemblyDate}
                          onChange={e => setAssemblyDate(e.target.value)} autoFocus={!showCompanyColumn} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="asm-sheet">
                        <Input id="asm-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Warehouse (Main)">
                    <DocText className={cn(!mainWarehouse && 'italic text-[hsl(var(--destructive))]')}>
                      {mainWarehouse?.name ?? (lookupCompanyId ? 'No main warehouse set — mark one on the Warehouses page' : '')}
                    </DocText>
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={outputs}
                  columns={[
                    {
                      key: 'item', label: 'Output', required: true,
                      render: (line, i) => (
                        <SearchableSelect
                          value={line.itemId === '' ? '' : String(line.itemId)}
                          onChange={v => handleOutputItemChange(i, v ? Number(v) : '')}
                          options={itemOptions}
                        />
                      ),
                    },
                    {
                      key: 'bom', label: 'Bill of Materials', width: '11rem',
                      render: (line, i) => (
                        <SearchableSelect
                          value={line.billOfMaterialId === '' ? '' : String(line.billOfMaterialId)}
                          onChange={v => updateOutput(i, { billOfMaterialId: v ? Number(v) : '' })}
                          options={boms.filter(b => b.itemId === line.itemId).map(b => ({ value: String(b.id), label: b.code }))}
                          disabled={line.itemId === ''}
                        />
                      ),
                    },
                    {
                      key: 'onHand', label: 'On Hand', align: 'right', width: '7rem', readOnly: true,
                      render: line => <StockCell stock={stock} field="quantity" itemId={line.itemId} warehouseChosen={!!mainWarehouse} />,
                    },
                    {
                      key: 'quantity', label: 'Quantity Built', align: 'right', width: '8rem', required: true,
                      render: (line, i) => (
                        <Input type="number" step="0.0001" min="0" aria-label={`Output ${i + 1} quantity`} value={line.quantity}
                          onChange={e => updateOutput(i, { quantity: e.target.value })} className="text-right" />
                      ),
                    },
                    {
                      key: 'remove', label: '', align: 'center', width: '2.75rem',
                      render: (_, i) => (
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove output ${i + 1}`}
                          onClick={() => setOutputs(prev => prev.filter((_, j) => j !== i))} disabled={outputs.length === 1}>
                          <X className="w-4 h-4" />
                        </Button>
                      ),
                    },
                  ]}
                  footer={
                    <Button type="button" variant="ghost" size="sm" onClick={addOutput}>
                      <Plus className="w-3.5 h-3.5" />
                      Add Output
                    </Button>
                  }
                />
                <DocLines
                  rows={materials}
                  columns={[
                    {
                      key: 'item', label: 'Raw Material', required: true,
                      render: (line, i) => (
                        <SearchableSelect
                          value={line.itemId === '' ? '' : String(line.itemId)}
                          onChange={v => updateMaterial(i, { itemId: v ? Number(v) : '' })}
                          options={itemOptions}
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
                      key: 'quantity', label: 'Quantity Used', align: 'right', width: '8rem', required: true,
                      render: (line, i) => (
                        <Input type="number" step="0.0001" min="0" aria-label={`Raw material ${i + 1} quantity`} value={line.quantity}
                          onChange={e => updateMaterial(i, { quantity: e.target.value })} className="text-right" />
                      ),
                    },
                    {
                      key: 'remove', label: '', align: 'center', width: '2.75rem',
                      render: (_, i) => (
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove raw material ${i + 1}`}
                          onClick={() => { setMaterialsFromBom(false); setMaterials(prev => prev.filter((_, j) => j !== i)) }}
                          disabled={materials.length === 1}>
                          <X className="w-4 h-4" />
                        </Button>
                      ),
                    },
                  ]}
                  footer={
                    <div className="flex items-center justify-between gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={addMaterial}>
                        <Plus className="w-3.5 h-3.5" />
                        Add Raw Material
                      </Button>
                      {materialsFromBom ? (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">Filled from the outputs' bills of materials.</span>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setMaterialsFromBom(true)}>
                          <ListRestart className="w-3.5 h-3.5" />
                          Refill from Bills of Materials
                        </Button>
                      )}
                    </div>
                  }
                />
                <DocRow>
                  <DocCell label="Remarks" htmlFor="asm-remarks">
                    <Input id="asm-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>

              <div className={RECORD_ACTIONS}>
                <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Assembly</Button>
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
                {isVisible('outputs') && <th className="text-left py-2 px-4 font-medium">Outputs</th>}
                {isVisible('date') && <th className="text-left py-2 px-4 font-medium">Assembly Date</th>}
                {isVisible('origin') && <th className="text-left py-2 px-4 font-medium">Origin</th>}
                {isVisible('voided') && <th className="text-left py-2 px-4 font-medium">Voided</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'warehouse' && key !== 'company' && key !== 'outputs' && key !== 'voided'}
              />
            </thead>
            <tbody>
              {assemblies.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No assemblies match your search/filters.' : 'No assemblies to display.'}
                  </td>
                </tr>
              ) : (
                assemblies.map((assembly, i) => (
                  <tr
                    key={assembly.id}
                    onClick={() => { setActiveIndex(i); openView(assembly) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{assembly.companyName}</td>}
                    {isVisible('referenceNumber') && <td className="py-2 px-4 font-mono text-xs">{assembly.referenceNumber}</td>}
                    {isVisible('sheetNumber') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{assembly.sheetNumber ?? '—'}</td>}
                    {isVisible('warehouse') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{assembly.warehouseName}</td>}
                    {isVisible('outputs') && (
                      <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                        <div className="max-w-xs truncate" title={outputsSummary(assembly)}>{outputsSummary(assembly)}</div>
                      </td>
                    )}
                    {isVisible('date') && <td className="py-2 px-4">{formatDate(assembly.assemblyDate)}</td>}
                    {isVisible('origin') && <td className="py-2 px-4"><OriginBadge origin={assembly.origin} /></td>}
                    {isVisible('voided') && (
                      <td className="py-2 px-4">
                        {assembly.voided && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
                            Voided
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openView(assembly)}>
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
