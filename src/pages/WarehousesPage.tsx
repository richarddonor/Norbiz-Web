import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, FileDown } from 'lucide-react'
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
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { CompanyField } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface CompanyOption {
  id: number
  name: string
}

type FormMode = 'view' | 'create' | 'edit'

interface Warehouse {
  id: number
  companyId: number
  companyName: string
  code: string | null
  name: string
  active: boolean
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

type WarehouseForm = {
  code: string
  name: string
  active: boolean
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push({ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' })
  columns.push(
    { key: 'active', label: 'Active', type: 'boolean' },
    { key: 'createdBy', label: 'Created by' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

function emptyForm(): WarehouseForm {
  return { code: '', name: '', active: true }
}

function warehouseToForm(w: Warehouse): WarehouseForm {
  return { code: w.code ?? '', name: w.name, active: w.active }
}

function warehouseSearchText(w: Warehouse): string {
  return [w.code ?? '', w.name, w.companyName, w.active ? 'active' : 'inactive', w.createdBy ?? '', w.updatedBy ?? ''].join(' ')
}

export function WarehousesPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, activeCompany, showCompanyColumn, companies } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const { items: warehouses, page, setPage, totalPages, totalElements, reload } = usePagedList<Warehouse>('/warehouses', {
    onError: () => toast('Failed to load warehouses.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: warehouseSearchText,
  })

  const [open, setOpen]                   = useState(false)
  const [mode, setMode]                   = useState<FormMode>('view')
  const [activeWarehouse, setActiveWarehouse] = useState<Warehouse | null>(null)
  const [form, setForm]                   = useState<WarehouseForm>(emptyForm())
  const [companyId, setCompanyId]         = useState<number | ''>('')
  const [loading, setLoading]             = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('warehouses')

  const canCreate = hasPermission('CREATE_WAREHOUSE')
  const canUpdate = hasPermission('UPDATE_WAREHOUSE')
  const canDeleteWarehouse = hasPermission('DELETE_WAREHOUSE')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: warehouses,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteWarehouse ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteWarehouse,
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  useEffect(() => {
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function openView(warehouse: Warehouse) {
    setActiveWarehouse(warehouse)
    setForm(warehouseToForm(warehouse))
    setMode('view')
    setOpen(true)
  }

  function openEdit(warehouse: Warehouse) {
    setActiveWarehouse(warehouse)
    setForm(warehouseToForm(warehouse))
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveWarehouse(null)
    setForm(emptyForm())
    setCompanyId(activeCompanyId ?? '')
    setMode('create')
    setOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'create' && !companyId) {
      toast('Select a company.', 'error')
      return
    }
    setLoading(true)
    try {
      const submitCompanyId = mode === 'create' ? companyId : activeWarehouse!.companyId
      const body = { companyId: submitCompanyId, code: form.code || null, name: form.name, active: form.active }
      if (mode === 'create') {
        await apiFetch<Warehouse>('/warehouses', { method: 'POST', body: JSON.stringify(body) })
        toast('Warehouse created successfully.', 'success')
      } else {
        await apiFetch<Warehouse>(`/warehouses/${activeWarehouse!.id}`, { method: 'PUT', body: JSON.stringify(body) })
        toast('Warehouse updated successfully.', 'success')
      }
      setOpen(false)
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create warehouse.' : 'Failed to update warehouse.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(warehouse: Warehouse) {
    if (!window.confirm(`Delete warehouse "${warehouse.name}"?`)) return
    try {
      await apiFetch(`/warehouses/${warehouse.id}`, { method: 'DELETE' })
      toast('Warehouse deleted.', 'success')
      reload()
    } catch {
      toast('Failed to delete warehouse.', 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<Warehouse>(qs ? `/warehouses?${qs}` : '/warehouses', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(w => warehouseSearchText(w).toLowerCase().includes(term)) : all
    const rows = matching.map(w => ({
      code: w.code ?? '',
      name: w.name,
      company: w.companyName,
      active: w.active ? 'Yes' : 'No',
      createdBy: w.createdBy ?? '',
      updatedAt: formatDateTime(w.updatedAt),
    }))
    exportToXlsx('warehouses', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const dialogTitle = mode === 'view' ? 'Warehouse Details' : mode === 'create' ? 'New Warehouse' : 'Edit Warehouse'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Warehouses</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search warehouses… (/)"
              className="pl-8 w-56"
            />
          </div>
          <ColumnsMenu columns={COLUMNS} isVisible={isVisible} onToggle={toggleColumn} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          {canCreate && (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              New Warehouse
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">N</kbd>
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onFocusOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <CompanyField
              id="warehouse-company"
              readOnly={mode !== 'create' || !showCompanyColumn}
              name={mode === 'create' ? activeCompany?.name : activeWarehouse?.companyName}
              companies={companyOptions}
              value={companyId}
              onChange={setCompanyId}
              autoFocus={mode === 'create' && showCompanyColumn}
            />
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-code">Code</Label>
              <Input
                id="warehouse-code"
                value={form.code}
                readOnly={ro}
                autoFocus={!(mode === 'create' && showCompanyColumn)}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                placeholder={ro ? undefined : 'e.g. WH-01'}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-name">Name</Label>
              <Input
                id="warehouse-name"
                value={form.name}
                readOnly={ro}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={ro ? undefined : 'e.g. Main Warehouse'}
                required={!ro}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="warehouse-active"
                type="checkbox"
                checked={form.active}
                disabled={ro}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                className="accent-[hsl(var(--primary))]"
              />
              <Label htmlFor="warehouse-active" className="cursor-pointer">Active</Label>
            </div>

            {ro && activeWarehouse && (
              <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                <div className="flex justify-between">
                  <span>Created by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeWarehouse.createdBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Created at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeWarehouse.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeWarehouse.updatedBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeWarehouse.updatedAt)}</span>
                </div>
              </div>
            )}

            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_WAREHOUSE') && (
                    <Button type="button" onClick={() => setMode('edit')}>Edit</Button>
                  )}
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" loading={loading}>
                    {mode === 'create' ? 'Create' : 'Save'}
                  </Button>
                </>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="pt-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {showCompanyColumn && isVisible('company') && <th className="text-left py-2 px-4 font-medium">Company</th>}
                {isVisible('code') && <th className="text-left py-2 px-4 font-medium">Code</th>}
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
                {isVisible('active') && <th className="text-left py-2 px-4 font-medium">Active</th>}
                {isVisible('createdBy') && <th className="text-left py-2 px-4 font-medium">Created by</th>}
                {isVisible('updatedAt') && <th className="text-left py-2 px-4 font-medium">Last updated</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
              />
            </thead>
            <tbody>
              {warehouses.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No warehouses match your search/filters.' : 'No warehouses to display.'}
                  </td>
                </tr>
              ) : (
                warehouses.map((warehouse, i) => (
                  <tr
                    key={warehouse.id}
                    onClick={() => { setActiveIndex(i); openView(warehouse) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{warehouse.companyName}</td>}
                    {isVisible('code') && <td className="py-2 px-4 font-mono text-xs">{warehouse.code ?? '—'}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{warehouse.name}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          warehouse.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {warehouse.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{warehouse.createdBy ?? '—'}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(warehouse.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(warehouse)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(warehouse)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteWarehouse && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(warehouse)}>
                            <Trash2 className="w-4 h-4 text-[hsl(var(--destructive))]" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  )
}
