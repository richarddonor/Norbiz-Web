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

type FormMode = 'view' | 'create' | 'edit'

interface CompanyOption {
  id: number
  name: string
}

interface Brand {
  id: number
  companyId: number
  companyName: string
  name: string
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push({ key: 'name', label: 'Name' })
  columns.push(
    { key: 'createdBy', label: 'Created by' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

function brandSearchText(b: Brand): string {
  return [b.name, b.companyName, b.createdBy ?? '', b.updatedBy ?? ''].join(' ')
}


export function BrandsPage() {
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

  const { items: brands, page, setPage, totalPages, totalElements, reload } = usePagedList<Brand>('/brands', {
    onError: () => toast('Failed to load brands.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: brandSearchText,
  })

  const [open, setOpen]               = useState(false)
  const [mode, setMode]               = useState<FormMode>('view')
  const [activeBrand, setActiveBrand] = useState<Brand | null>(null)
  const [name, setName]               = useState('')
  const [companyId, setCompanyId]     = useState<number | ''>('')
  const [loading, setLoading]         = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('brands')

  const canCreate = hasPermission('CREATE_BRAND')
  const canUpdate = hasPermission('UPDATE_BRAND')
  const canDeleteBrand = hasPermission('DELETE_BRAND')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: brands,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteBrand ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteBrand,
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

  function openView(brand: Brand) {
    setActiveBrand(brand)
    setName(brand.name)
    setMode('view')
    setOpen(true)
  }

  function openEdit(brand: Brand) {
    setActiveBrand(brand)
    setName(brand.name)
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveBrand(null)
    setName('')
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
      if (mode === 'create') {
        await apiFetch<Brand>('/brands', {
          method: 'POST',
          body: JSON.stringify({ name, companyId }),
        })
        toast('Brand created successfully.', 'success')
      } else {
        await apiFetch<Brand>(`/brands/${activeBrand!.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, companyId: activeBrand!.companyId }),
        })
        toast('Brand updated successfully.', 'success')
      }
      setOpen(false)
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create brand.' : 'Failed to update brand.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(brand: Brand) {
    if (!window.confirm(`Delete brand "${brand.name}"?`)) return
    try {
      await apiFetch(`/brands/${brand.id}`, { method: 'DELETE' })
      toast('Brand deleted.', 'success')
      reload()
    } catch {
      toast('Failed to delete brand.', 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<Brand>(qs ? `/brands?${qs}` : '/brands', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(b => brandSearchText(b).toLowerCase().includes(term)) : all
    const rows = matching.map(b => ({
      name: b.name,
      company: b.companyName,
      createdBy: b.createdBy ?? '',
      updatedAt: formatDateTime(b.updatedAt),
    }))
    exportToXlsx('brands', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const dialogTitle = mode === 'view' ? 'Brand Details' : mode === 'create' ? 'New Brand' : 'Edit Brand'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Brands</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search brands… (/)"
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
              New Brand
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
              id="brand-company"
              readOnly={mode !== 'create' || !showCompanyColumn}
              name={mode === 'create' ? activeCompany?.name : activeBrand?.companyName}
              companies={companyOptions}
              value={companyId}
              onChange={setCompanyId}
              autoFocus={mode === 'create' && showCompanyColumn}
            />
            <div className="space-y-1.5">
              <Label htmlFor="brand-name">Name</Label>
              <Input
                id="brand-name"
                value={name}
                readOnly={ro}
                autoFocus={!(mode === 'create' && showCompanyColumn)}
                onChange={e => setName(e.target.value)}
                placeholder={ro ? undefined : 'e.g. Acme'}
                required={!ro}
              />
            </div>

            {ro && activeBrand && (
              <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                <div className="flex justify-between">
                  <span>Created by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeBrand.createdBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Created at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeBrand.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeBrand.updatedBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeBrand.updatedAt)}</span>
                </div>
              </div>
            )}

            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_BRAND') && (
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
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
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
              {brands.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No brands match your search/filters.' : 'No brands to display.'}
                  </td>
                </tr>
              ) : (
                brands.map((brand, i) => (
                  <tr
                    key={brand.id}
                    onClick={() => { setActiveIndex(i); openView(brand) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{brand.companyName}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{brand.name}</td>}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{brand.createdBy ?? '—'}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(brand.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(brand)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(brand)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteBrand && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(brand)}>
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
