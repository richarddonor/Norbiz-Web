import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Eye, Search, FileDown, Printer, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { useDocumentPrint } from '@/hooks/useDocumentPrint'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create'

interface CompanyOption {
  id: number
  name: string
}

interface WarehouseOption {
  id: number
  companyId: number
  name: string
  active: boolean
}

interface ItemOption {
  id: number
  companyId: number
  itemCode: string
  name: string
  tags: string[]
  active: boolean
}

interface AdjustmentLine {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  quantity: string
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

  const { items: adjustments, page, setPage, totalPages, totalElements, reload } = usePagedList<Adjustment>('/inventory-adjustments', {
    onError: () => toast('Failed to load inventory adjustments.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: adjustmentSearchText,
  })
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [items, setItems] = useState<ItemOption[]>([])
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [open, setOpen]                       = useState(false)
  const [mode, setMode]                       = useState<FormMode>('view')
  const [activeAdjustment, setActiveAdjustment] = useState<Adjustment | null>(null)
  const [companyId, setCompanyId]             = useState<number | ''>('')
  const [warehouseId, setWarehouseId]         = useState<number | ''>('')
  const [adjustmentDate, setAdjustmentDate]   = useState(todayIso())
  const [reason, setReason]                   = useState('')
  const [sheetNumber, setSheetNumber]         = useState('')
  const [lines, setLines]                     = useState<LineDraft[]>([{ itemId: '', quantity: '' }])
  const [loading, setLoading]                 = useState(false)
  const formWarehouses = companyId ? warehouses.filter(w => w.companyId === companyId) : warehouses
  const formInventoryItems = (companyId ? items.filter(i => i.companyId === companyId) : items).filter(i => i.tags.includes('INVENTORY'))
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('inventory-adjustments')
  const { print, printPortal } = useDocumentPrint()
  const [printing, setPrinting] = useState(false)

  const canCreate = hasPermission('CREATE_INVENTORY_ADJUSTMENT')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: adjustments,
    onView: openView,
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  useEffect(() => {
    fetchAllContent<WarehouseOption>('/warehouses')
      .then(data => setWarehouses(data.filter(w => w.active)))
      .catch(() => toast('Failed to load warehouses.', 'error'))
    fetchAllContent<ItemOption>('/items')
      .then(data => setItems(data.filter(i => i.active)))
      .catch(() => toast('Failed to load items.', 'error'))
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function openView(adjustment: Adjustment) {
    setActiveAdjustment(adjustment)
    setMode('view')
    setOpen(true)
  }

  function openCreate() {
    setActiveAdjustment(null)
    setCompanyId(activeCompanyId ?? '')
    setWarehouseId('')
    setAdjustmentDate(todayIso())
    setReason('')
    setSheetNumber('')
    setLines([{ itemId: '', quantity: '' }])
    setMode('create')
    setOpen(true)
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
    const validLines = lines.filter(l => l.itemId !== '' && l.quantity.trim() !== '')
    if (validLines.length === 0) {
      toast('Add at least one line with an item and quantity.', 'error')
      return
    }
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
      setOpen(false)
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

  async function handlePrint() {
    if (!activeAdjustment) return
    setPrinting(true)
    try {
      await print(activeAdjustment.companyId, 'INVENTORY_ADJUSTMENT', activeAdjustment as unknown as Record<string, unknown>)
    } catch {
      // Template lookup is scoped to the adjustment's own company — a default template
      // configured under a different company (e.g. while a different one was active) won't match.
      toast(
        `No default print template configured for Inventory Adjustments under ${activeAdjustment.companyName}. Create one under Document Templates while ${activeAdjustment.companyName} is your active company.`,
        'error'
      )
    } finally {
      setPrinting(false)
    }
  }

  const dialogTitle = mode === 'view' ? 'Inventory Adjustment Details' : 'New Inventory Adjustment'

  return (
    <div className="space-y-6">
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
          <select
            value={filters.warehouseId ?? ''}
            onChange={e => setFilters(prev => ({ ...prev, warehouseId: e.target.value }))}
            className="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            <option value="">All warehouses</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <ColumnsMenu columns={COLUMNS} isVisible={isVisible} onToggle={toggleColumn} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          {canCreate && (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              New Adjustment
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">N</kbd>
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" onFocusOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>

          {mode === 'view' && activeAdjustment ? (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Reference #</Label>
                  <div className="font-mono">{activeAdjustment.referenceNumber}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Sheet #</Label>
                  <div>{activeAdjustment.sheetNumber ?? '—'}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Warehouse</Label>
                  <div>{activeAdjustment.warehouseName}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Adjustment Date</Label>
                  <div>{formatDate(activeAdjustment.adjustmentDate)}</div>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs text-[hsl(var(--muted-foreground))]">Reason</Label>
                  <div>{activeAdjustment.reason ?? '—'}</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Lines</Label>
                <div className="rounded-md border border-[hsl(var(--border))] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/40">
                        <th className="text-left py-1.5 px-3 font-medium">Item</th>
                        <th className="text-right py-1.5 px-3 font-medium">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeAdjustment.lines.map(line => (
                        <tr key={line.id} className="border-b border-[hsl(var(--border))] last:border-0">
                          <td className="py-1.5 px-3">{line.itemCode} — {line.itemName}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums">{line.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                {showCompanyColumn && (
                  <div className="flex justify-between">
                    <span>Company</span>
                    <span className="text-[hsl(var(--foreground))]">{activeAdjustment.companyName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Posted by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeAdjustment.createdBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Posted at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeAdjustment.createdAt)}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {canPrint && (
                  <Button type="button" variant="outline" onClick={handlePrint} loading={printing}>
                    <Printer className="w-4 h-4" />
                    Print
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              {showCompanyColumn && (
                <div className="space-y-1.5">
                  <Label htmlFor="adj-company">Company</Label>
                  <select
                    id="adj-company"
                    value={companyId}
                    onChange={e => handleCompanyChange(e.target.value ? Number(e.target.value) : '')}
                    required
                    autoFocus
                    className="flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  >
                    <option value="">Select a company…</option>
                    {companyOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="adj-warehouse">Warehouse</Label>
                  <select
                    id="adj-warehouse"
                    value={warehouseId}
                    onChange={e => setWarehouseId(e.target.value ? Number(e.target.value) : '')}
                    required
                    autoFocus={!showCompanyColumn}
                    className="flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  >
                    <option value="">Select a warehouse…</option>
                    {formWarehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adj-date">Adjustment Date</Label>
                  <Input id="adj-date" type="date" value={adjustmentDate}
                    onChange={e => setAdjustmentDate(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-sheet">Sheet #</Label>
                <Input id="adj-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} placeholder="Optional control number" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-reason">Reason</Label>
                <Input id="adj-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional" />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Lines</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    <Plus className="w-3.5 h-3.5" />
                    Add Line
                  </Button>
                </div>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={line.itemId}
                        onChange={e => updateLine(i, { itemId: e.target.value ? Number(e.target.value) : '' })}
                        className="flex h-9 flex-1 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      >
                        <option value="">Select an item…</option>
                        {formInventoryItems.map(item => (
                          <option key={item.id} value={item.id}>{item.itemCode} — {item.name}</option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        step="0.0001"
                        placeholder="Quantity"
                        value={line.quantity}
                        onChange={e => updateLine(i, { quantity: e.target.value })}
                        className="w-32"
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)} disabled={lines.length === 1}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                {formInventoryItems.length === 0 && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    No items are tagged Inventory — tag an item on the Items page before posting an adjustment.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" loading={loading}>Post Adjustment</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

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
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'warehouse' && key !== 'company' && key !== 'reason'}
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
      {printPortal}
    </div>
  )
}
