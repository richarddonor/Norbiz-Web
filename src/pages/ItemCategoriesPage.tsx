import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocSignatures } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
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
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create' | 'edit'

interface CompanyOption {
  id: number
  name: string
}

interface ItemCategory {
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

function categorySearchText(c: ItemCategory): string {
  return [c.name, c.companyName, c.createdBy ?? '', c.updatedBy ?? ''].join(' ')
}

export function ItemCategoriesPage() {
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
  const { items: categories, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<ItemCategory>('/item-categories', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load item categories.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: categorySearchText,
  })

  const [mode, setMode]                   = useState<FormMode>('view')
  const rec = useRecordTab<ItemCategory>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<ItemCategory>(`/item-categories/${id}`),
  })
  const [activeCategory, setActiveCategory] = useState<ItemCategory | null>(null)
  const [name, setName]                   = useState('')
  const [companyId, setCompanyId]         = useState<number | ''>('')
  const [loading, setLoading]             = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('item-categories')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_ITEM_CATEGORY')
  const canUpdate = hasPermission('UPDATE_ITEM_CATEGORY')
  const canDeleteCategory = hasPermission('DELETE_ITEM_CATEGORY')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: categories,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteCategory ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteCategory,
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

  function openView(category: ItemCategory) {
    if (!rec.isRecordTab) return rec.open('view', category)
    setActiveCategory(category)
    setName(category.name)
    markClean({ name: category.name, companyId })
    setMode('view')
  }

  function openEdit(category: ItemCategory) {
    if (!rec.isRecordTab) return rec.open('edit', category)
    setActiveCategory(category)
    setName(category.name)
    markClean({ name: category.name, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveCategory(null)
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
    if (!window.confirm(mode === 'create' ? `Create item category "${name}"?` : `Save changes to item category "${name}"?`)) return
    setLoading(true)
    try {
      if (mode === 'create') {
        await apiFetch<ItemCategory>('/item-categories', {
          method: 'POST',
          body: JSON.stringify({ name, companyId }),
        })
        toast('Item category created successfully.', 'success')
      } else {
        await apiFetch<ItemCategory>(`/item-categories/${activeCategory!.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, companyId: activeCategory!.companyId }),
        })
        toast('Item category updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create item category.' : 'Failed to update item category.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(category: ItemCategory) {
    if (!window.confirm(`Delete item category "${category.name}"?`)) return
    try {
      await apiFetch(`/item-categories/${category.id}`, { method: 'DELETE' })
      toast('Item category deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete item category.'), 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<ItemCategory>(qs ? `/item-categories?${qs}` : '/item-categories', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(c => categorySearchText(c).toLowerCase().includes(term)) : all
    const rows = matching.map(c => ({
      name: c.name,
      company: c.companyName,
      createdBy: resolveDisplayName(c.createdBy),
      updatedAt: formatDateTime(c.updatedAt),
    }))
    exportToXlsx('item-categories', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const recordName = activeCategory?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Item Category' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Item Category'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Item Categories</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search categories… (/)"
              className="pl-8 w-56"
            />
          </div>
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
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DocSheet>
              <DocLetterhead company={
                  <CompanyField
                    id="category-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? activeCompany?.name : activeCategory?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={setCompanyId}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Item Category Record" />
              </DocLetterhead>
              <DocRow>
                <DocCell label="Name" htmlFor="category-name">
                  <Input
                    id="category-name"
                    value={name}
                    readOnly={ro}
                    autoFocus={!(mode === 'create' && showCompanyColumn)}
                    onChange={e => setName(e.target.value)}
                    required={!ro}
                  />
                </DocCell>
              </DocRow>
              {ro && activeCategory && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeCategory.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeCategory.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeCategory.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeCategory.updatedAt) },
                ]} />
              )}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {hasPermission('UPDATE_ITEM_CATEGORY') && (
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
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No categories match your search/filters.' : 'No item categories to display.'}
                  </td>
                </tr>
              ) : (
                categories.map((category, i) => (
                  <tr
                    key={category.id}
                    onClick={() => { setActiveIndex(i); openView(category) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{category.companyName}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{category.name}</td>}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(category.createdBy)}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(category.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(category)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(category)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteCategory && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(category)}>
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
      </>)}
    </div>
  )
}
