import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocSignatures } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { ChangeHistory } from '@/components/ChangeHistory'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS } from '@/components/RecordTab'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { ScrollTable } from '@/components/ScrollTable'
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

  const inRecordTab = useIsRecordTab()
  const { items: brands, page, setPage, totalPages, totalElements, reload, loading: listLoading, searchAll } = usePagedList<Brand>('/brands', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load brands.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: brandSearchText,
  })

  const [mode, setMode]               = useState<FormMode>('view')
  const rec = useRecordTab<Brand>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Brand>(`/brands/${id}`),
  })
  const [activeBrand, setActiveBrand] = useState<Brand | null>(null)
  const [name, setName]               = useState('')
  const [companyId, setCompanyId]     = useState<number | ''>('')
  const [loading, setLoading]         = useState(false)
  const { isVisible, menu: columnMenu } = useColumnVisibility('brands')
  const { markClean, guardedClose } = useDirtyGuard()
  const resolveDisplayName = useUserDisplayNames()

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

  function openView(brand: Brand) {
    if (!rec.isRecordTab) return rec.open('view', brand)
    setActiveBrand(brand)
    setName(brand.name)
    markClean({ name: brand.name, companyId })
    setMode('view')
  }

  function openEdit(brand: Brand) {
    if (!rec.isRecordTab) return rec.open('edit', brand)
    setActiveBrand(brand)
    setName(brand.name)
    markClean({ name: brand.name, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveBrand(null)
    setName('')
    const nextCompanyId = activeCompanyId ?? ''
    setCompanyId(nextCompanyId)
    markClean({ name: '', companyId: nextCompanyId })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ name, companyId }, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'create' && !companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create brand "${name}"?` : `Save changes to brand "${name}"?`)) return
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
      rec.close()
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
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete brand.'), 'error')
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
      createdBy: resolveDisplayName(b.createdBy),
      updatedAt: formatDateTime(b.updatedAt),
    }))
    exportToXlsx('brands', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const recordName = activeBrand?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Brand' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Brand'
  const ro = mode === 'view'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Brands</h1>
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
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DocSheet>
              <DocLetterhead company={
                  <CompanyField
                    id="brand-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? activeCompany?.name : activeBrand?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={setCompanyId}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Brand Record" />
              </DocLetterhead>
              <DocRow>
                <DocCell label="Name" htmlFor="brand-name" required={!ro}>
                  <Input
                    id="brand-name"
                    value={name}
                    readOnly={ro}
                    autoFocus={!(mode === 'create' && showCompanyColumn)}
                    onChange={e => setName(e.target.value)}
                    required={!ro}
                  />
                </DocCell>
              </DocRow>
              {ro && activeBrand && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeBrand.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeBrand.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeBrand.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeBrand.updatedAt) },
                ]} />
              )}
              {ro && activeBrand && <ChangeHistory type="BRAND" id={activeBrand.id} refreshKey={activeBrand.updatedAt} />}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {hasPermission('UPDATE_BRAND') && (
                    <Button type="button" onClick={() => setMode('edit')}>Edit</Button>
                  )}
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                  <Button type="submit" loading={loading}>
                    {mode === 'create' ? 'Create' : 'Save'}
                  </Button>
                </>
              )}
            </div>
          </form>
        </RecordSheet>
      )}

      {!inRecordTab && (<>

      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable activeIndex={activeIndex}>
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
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(brand.createdBy)}</td>}
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
          </ScrollTable>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
      </>)}
    </div>
  )
}
