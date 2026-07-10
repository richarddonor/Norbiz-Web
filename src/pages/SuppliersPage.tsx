import { useState, useRef, useMemo, type FormEvent } from 'react'
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
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create' | 'edit'

interface Supplier {
  id: number
  companyId: number
  companyName: string
  code: string | null
  name: string
  email: string | null
  phone: string | null
  active: boolean
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

type SupplierForm = {
  code: string
  name: string
  email: string
  phone: string
  active: boolean
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'active', label: 'Active', type: 'boolean' },
    { key: 'createdBy', label: 'Created by' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

function emptyForm(): SupplierForm {
  return { code: '', name: '', email: '', phone: '', active: true }
}

function supplierToForm(s: Supplier): SupplierForm {
  return { code: s.code ?? '', name: s.name, email: s.email ?? '', phone: s.phone ?? '', active: s.active }
}

function supplierSearchText(s: Supplier): string {
  return [s.code ?? '', s.name, s.companyName, s.email ?? '', s.phone ?? '', s.active ? 'active' : 'inactive', s.createdBy ?? '', s.updatedBy ?? ''].join(' ')
}

export function SuppliersPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const { zone } = useContentFocus()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const { items: suppliers, page, setPage, totalPages, totalElements, reload } = usePagedList<Supplier>('/suppliers', {
    onError: () => toast('Failed to load suppliers.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: supplierSearchText,
  })

  const [open, setOpen]                   = useState(false)
  const [mode, setMode]                   = useState<FormMode>('view')
  const [activeSupplier, setActiveSupplier] = useState<Supplier | null>(null)
  const [form, setForm]                   = useState<SupplierForm>(emptyForm())
  const [loading, setLoading]             = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('suppliers')

  const canCreate = hasPermission('CREATE_SUPPLIER')
  const canUpdate = hasPermission('UPDATE_SUPPLIER')
  const canDeleteSupplier = hasPermission('DELETE_SUPPLIER')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: suppliers,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteSupplier ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteSupplier,
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  function openView(supplier: Supplier) {
    setActiveSupplier(supplier)
    setForm(supplierToForm(supplier))
    setMode('view')
    setOpen(true)
  }

  function openEdit(supplier: Supplier) {
    setActiveSupplier(supplier)
    setForm(supplierToForm(supplier))
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveSupplier(null)
    setForm(emptyForm())
    setMode('create')
    setOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const companyId = mode === 'create' ? activeCompanyId : activeSupplier!.companyId
      const body = { companyId, code: form.code || null, name: form.name, email: form.email || null, phone: form.phone || null, active: form.active }
      if (mode === 'create') {
        await apiFetch<Supplier>('/suppliers', { method: 'POST', body: JSON.stringify(body) })
        toast('Supplier created successfully.', 'success')
      } else {
        await apiFetch<Supplier>(`/suppliers/${activeSupplier!.id}`, { method: 'PUT', body: JSON.stringify(body) })
        toast('Supplier updated successfully.', 'success')
      }
      setOpen(false)
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create supplier.' : 'Failed to update supplier.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(supplier: Supplier) {
    if (!window.confirm(`Delete supplier "${supplier.name}"?`)) return
    try {
      await apiFetch(`/suppliers/${supplier.id}`, { method: 'DELETE' })
      toast('Supplier deleted.', 'success')
      reload()
    } catch {
      toast('Failed to delete supplier.', 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<Supplier>(qs ? `/suppliers?${qs}` : '/suppliers', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(s => supplierSearchText(s).toLowerCase().includes(term)) : all
    const rows = matching.map(s => ({
      code: s.code ?? '',
      name: s.name,
      company: s.companyName,
      active: s.active ? 'Yes' : 'No',
      createdBy: s.createdBy ?? '',
      updatedAt: formatDateTime(s.updatedAt),
    }))
    exportToXlsx('suppliers', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const dialogTitle = mode === 'view' ? 'Supplier Details' : mode === 'create' ? 'New Supplier' : 'Edit Supplier'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Suppliers</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search suppliers… (/)"
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
              New Supplier
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
            <div className="space-y-1.5">
              <Label htmlFor="supp-code">Code</Label>
              <Input id="supp-code" value={form.code} readOnly={ro} autoFocus
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder={ro ? undefined : 'e.g. SUP-01'} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supp-name">Name</Label>
              <Input id="supp-name" value={form.name} readOnly={ro}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={ro ? undefined : 'e.g. Acme Supply Co.'} required={!ro} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="supp-email">Email</Label>
                <Input id="supp-email" type={ro ? 'text' : 'email'} value={form.email} readOnly={ro}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="supp-phone">Phone</Label>
                <Input id="supp-phone" value={form.phone} readOnly={ro}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="supp-active"
                type="checkbox"
                checked={form.active}
                disabled={ro}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                className="accent-[hsl(var(--primary))]"
              />
              <Label htmlFor="supp-active" className="cursor-pointer">Active</Label>
            </div>

            {ro && activeSupplier && (
              <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                {showCompanyColumn && (
                  <div className="flex justify-between">
                    <span>Company</span>
                    <span className="text-[hsl(var(--foreground))]">{activeSupplier.companyName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Created by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeSupplier.createdBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Created at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeSupplier.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeSupplier.updatedBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeSupplier.updatedAt)}</span>
                </div>
              </div>
            )}

            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_SUPPLIER') && (
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
                {isVisible('code') && <th className="text-left py-2 px-4 font-medium">Code</th>}
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
                {showCompanyColumn && isVisible('company') && <th className="text-left py-2 px-4 font-medium">Company</th>}
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
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No suppliers match your search/filters.' : 'No suppliers to display.'}
                  </td>
                </tr>
              ) : (
                suppliers.map((supplier, i) => (
                  <tr
                    key={supplier.id}
                    onClick={() => { setActiveIndex(i); openView(supplier) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {isVisible('code') && <td className="py-2 px-4 font-mono text-xs">{supplier.code ?? '—'}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{supplier.name}</td>}
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{supplier.companyName}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          supplier.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {supplier.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{supplier.createdBy ?? '—'}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(supplier.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(supplier)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(supplier)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteSupplier && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(supplier)}>
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
