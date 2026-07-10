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
  const columns: ColumnDef[] = [{ key: 'name', label: 'Name' }]
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
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
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const { zone } = useContentFocus()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const { items: categories, page, setPage, totalPages, totalElements, reload } = usePagedList<ItemCategory>('/item-categories', {
    onError: () => toast('Failed to load item categories.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: categorySearchText,
  })

  const [open, setOpen]                   = useState(false)
  const [mode, setMode]                   = useState<FormMode>('view')
  const [activeCategory, setActiveCategory] = useState<ItemCategory | null>(null)
  const [name, setName]                   = useState('')
  const [loading, setLoading]             = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('item-categories')

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
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  function openView(category: ItemCategory) {
    setActiveCategory(category)
    setName(category.name)
    setMode('view')
    setOpen(true)
  }

  function openEdit(category: ItemCategory) {
    setActiveCategory(category)
    setName(category.name)
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveCategory(null)
    setName('')
    setMode('create')
    setOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'create') {
        await apiFetch<ItemCategory>('/item-categories', {
          method: 'POST',
          body: JSON.stringify({ name, companyId: activeCompanyId }),
        })
        toast('Item category created successfully.', 'success')
      } else {
        await apiFetch<ItemCategory>(`/item-categories/${activeCategory!.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, companyId: activeCategory!.companyId }),
        })
        toast('Item category updated successfully.', 'success')
      }
      setOpen(false)
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
    } catch {
      toast('Failed to delete item category.', 'error')
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
      createdBy: c.createdBy ?? '',
      updatedAt: formatDateTime(c.updatedAt),
    }))
    exportToXlsx('item-categories', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const dialogTitle = mode === 'view' ? 'Category Details' : mode === 'create' ? 'New Category' : 'Edit Category'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
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
          <ColumnsMenu columns={COLUMNS} isVisible={isVisible} onToggle={toggleColumn} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          {canCreate && (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              New Category
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
              <Label htmlFor="category-name">Name</Label>
              <Input
                id="category-name"
                value={name}
                readOnly={ro}
                autoFocus
                onChange={e => setName(e.target.value)}
                placeholder={ro ? undefined : 'e.g. Electronics'}
                required={!ro}
              />
            </div>

            {ro && activeCategory && (
              <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                {showCompanyColumn && (
                  <div className="flex justify-between">
                    <span>Company</span>
                    <span className="text-[hsl(var(--foreground))]">{activeCategory.companyName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Created by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeCategory.createdBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Created at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeCategory.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeCategory.updatedBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeCategory.updatedAt)}</span>
                </div>
              </div>
            )}

            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_ITEM_CATEGORY') && (
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
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
                {showCompanyColumn && isVisible('company') && <th className="text-left py-2 px-4 font-medium">Company</th>}
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
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{category.name}</td>}
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{category.companyName}</td>}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{category.createdBy ?? '—'}</td>}
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
    </div>
  )
}
