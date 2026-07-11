import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, ImageOff, Eye, Search, FileDown } from 'lucide-react'
import { apiFetch, apiUpload } from '@/lib/api'
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
import { TagCheckboxes } from '@/components/TagCheckboxes'
import { CompanyField } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

const API_BASE = import.meta.env.VITE_API_BASE as string

type FormMode = 'view' | 'create' | 'edit'

interface CompanyOption {
  id: number
  name: string
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'image', label: 'Image' },
    { key: 'itemCode', label: 'Item Code' },
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category' },
    { key: 'skus', label: 'SKUs' },
    { key: 'unitPrice', label: 'Unit Price' },
    { key: 'tags', label: 'Tags' },
  )
  return columns
}

const ITEM_TAGS = [{ value: 'INVENTORY', label: 'Inventory' }]

const PRICE_TYPES = ['UNIT_PRICE', 'COST_PRICE', 'FOCAL_PRICE', 'MARKDOWN_PRICE'] as const
type PriceType = typeof PRICE_TYPES[number]

const PRICE_LABELS: Record<PriceType, string> = {
  UNIT_PRICE: 'Unit Price',
  COST_PRICE: 'Cost Price',
  FOCAL_PRICE: 'Focal Price',
  MARKDOWN_PRICE: 'Mark Down Price',
}

interface PriceEntry {
  priceType: PriceType
  amount: string
}

interface ItemCategory {
  id: number
  name: string
}

interface ItemSku {
  id: number
  skuCode: string
}

interface Item {
  id: number
  companyId: number
  companyName: string
  itemCategoryId: number
  itemCategoryName: string
  itemCode: string
  name: string
  imagePath: string | null
  active: boolean
  skus: string[]
  prices: PriceEntry[]
  tags: string[]
}

type ItemForm = {
  itemCode: string
  name: string
  categoryId: number | ''
  skus: string[]
  prices: Record<PriceType, string>
  tags: Set<string>
}

function emptyPrices(): Record<PriceType, string> {
  return { UNIT_PRICE: '', COST_PRICE: '', FOCAL_PRICE: '', MARKDOWN_PRICE: '' }
}

function formToPayload(form: ItemForm, companyId: number) {
  return {
    companyId,
    itemCode: form.itemCode,
    name: form.name,
    itemCategoryId: form.categoryId,
    skus: form.skus,
    prices: PRICE_TYPES
      .filter(t => form.prices[t] !== '')
      .map(t => ({ priceType: t, amount: Number(form.prices[t]) })),
    tags: Array.from(form.tags),
  }
}

function itemToForm(item: Item): ItemForm {
  const prices = emptyPrices()
  for (const p of item.prices) {
    prices[p.priceType] = p.amount
  }
  return {
    itemCode: item.itemCode,
    name: item.name,
    categoryId: item.itemCategoryId,
    skus: item.skus,
    prices,
    tags: new Set(item.tags),
  }
}

function imageUrl(imagePath: string, ts?: number) {
  const base = `${API_BASE}/item-images/${imagePath}`
  return ts ? `${base}?v=${ts}` : base
}

function itemUnitPrice(item: Item): string {
  return item.prices.find(p => p.priceType === 'UNIT_PRICE')?.amount ?? ''
}

function itemSearchText(item: Item): string {
  return [item.itemCode, item.name, item.itemCategoryName, item.companyName, ...item.skus, itemUnitPrice(item), ...item.tags].join(' ')
}

// ── Image display / picker ────────────────────────────────────────────────────
function ItemImage({
  currentPath,
  onFileSelected,
  readOnly,
  cacheBust,
}: {
  currentPath: string | null
  onFileSelected: (file: File | null) => void
  readOnly: boolean
  cacheBust?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(
    currentPath ? imageUrl(currentPath, cacheBust) : null,
  )

  useEffect(() => {
    setPreview(currentPath ? imageUrl(currentPath, cacheBust) : null)
  }, [currentPath, cacheBust])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file) {
      setPreview(URL.createObjectURL(file))
      onFileSelected(file)
    }
  }

  const containerBase = 'flex items-center justify-center w-full aspect-square rounded-md overflow-hidden'

  return (
    <div className="space-y-2">
      <Label>Image</Label>
      {readOnly ? (
        <div className={`${containerBase} border border-[hsl(var(--border))] bg-[hsl(var(--secondary))]`}>
          {preview
            ? <img src={preview} alt="Item" className="object-contain w-full h-full" />
            : <div className="flex flex-col items-center gap-1 text-[hsl(var(--muted-foreground))]">
                <ImageOff className="w-8 h-8" />
                <span className="text-xs">No image</span>
              </div>
          }
        </div>
      ) : (
        <>
          <div
            onClick={() => inputRef.current?.click()}
            className={`${containerBase} border-2 border-dashed border-[hsl(var(--border))] cursor-pointer hover:border-[hsl(var(--primary))] transition-colors`}
          >
            {preview
              ? <img src={preview} alt="Item" className="object-contain w-full h-full" />
              : <div className="flex flex-col items-center gap-1 text-[hsl(var(--muted-foreground))]">
                  <ImageOff className="w-8 h-8" />
                  <span className="text-xs">Click to upload</span>
                </div>
            }
          </div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />
        </>
      )}
    </div>
  )
}

// ── Form fields ───────────────────────────────────────────────────────────────
function ItemFormFields({
  codeAutoFocus,
  form,
  setForm,
  categories,
  allSkus,
  currentImagePath,
  onFileSelected,
  mode,
  cacheBust,
  canViewCostPrice,
}: {
  codeAutoFocus: boolean
  form: ItemForm
  setForm: React.Dispatch<React.SetStateAction<ItemForm>>
  categories: ItemCategory[]
  allSkus: ItemSku[]
  currentImagePath: string | null
  onFileSelected: (f: File | null) => void
  mode: FormMode
  cacheBust?: number
  canViewCostPrice: boolean
}) {
  const ro = mode === 'view'
  const [skuSearch, setSkuSearch] = useState('')
  const filteredSkus = allSkus.filter(s =>
    s.skuCode.toLowerCase().includes(skuSearch.toLowerCase())
  )
  return (
    <div className="flex gap-6">
      {/* Left: text fields */}
      <div className="flex-1 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="form-code">Item Code</Label>
          <Input id="form-code" value={form.itemCode} readOnly={ro || mode === 'edit'} autoFocus={codeAutoFocus}
            onChange={e => setForm(f => ({ ...f, itemCode: e.target.value }))} required={!ro} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="form-name">Name</Label>
          <Input id="form-name" value={form.name} readOnly={ro}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required={!ro} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="form-category">Category</Label>
          {ro ? (
            <Input id="form-category" value={categories.find(c => c.id === form.categoryId)?.name ?? '—'} readOnly />
          ) : (
            <select
              id="form-category"
              value={form.categoryId}
              onChange={e => setForm(f => ({ ...f, categoryId: e.target.value ? Number(e.target.value) : '' }))}
              required
              className="flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select a category…</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>SKU Codes</Label>
          {ro ? (
            <div className="min-h-9 flex flex-wrap gap-1 py-1">
              {form.skus.length > 0
                ? form.skus.map(s => (
                    <span key={s} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))]">{s}</span>
                  ))
                : <span className="text-sm text-[hsl(var(--muted-foreground))]">—</span>
              }
            </div>
          ) : (
            <>
              <Input
                placeholder="Search SKUs…"
                value={skuSearch}
                onChange={e => setSkuSearch(e.target.value)}
              />
              <div className="max-h-36 overflow-y-auto rounded-md border border-[hsl(var(--input))] p-2 space-y-0.5">
                {filteredSkus.length === 0 ? (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] py-2 text-center">
                    {allSkus.length === 0 ? 'No SKUs in database.' : 'No SKUs match.'}
                  </p>
                ) : (
                  filteredSkus.map(sku => (
                    <label key={sku.id} className="flex items-center gap-2 text-sm cursor-pointer px-1 py-1 rounded hover:bg-[hsl(var(--secondary))]">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={form.skus.includes(sku.skuCode)}
                        onChange={e => setForm(f => ({
                          ...f,
                          skus: e.target.checked
                            ? [...f.skus, sku.skuCode]
                            : f.skus.filter(s => s !== sku.skuCode),
                        }))}
                      />
                      {sku.skuCode}
                    </label>
                  ))
                )}
              </div>
              {form.skus.length > 0 && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {form.skus.length} selected: {form.skus.join(', ')}
                </p>
              )}
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Prices</Label>
          <div className="grid grid-cols-2 gap-3">
            {PRICE_TYPES.filter(type => type !== 'COST_PRICE' || canViewCostPrice).map(type => (
              <div key={type} className="space-y-1">
                <Label className="text-xs text-[hsl(var(--muted-foreground))]">{PRICE_LABELS[type]}</Label>
                {ro ? (
                  <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 py-2 text-sm h-9 flex items-center">
                    {formatCurrency(form.prices[type] || null)}
                  </div>
                ) : (
                  <Input type="number" step="0.0001" min="0"
                    value={form.prices[type]}
                    onChange={e => setForm(f => ({ ...f, prices: { ...f.prices, [type]: e.target.value } }))} />
                )}
              </div>
            ))}
          </div>
        </div>
        <TagCheckboxes label="Tags" options={ITEM_TAGS} selected={form.tags} readOnly={ro}
          onToggle={value => setForm(f => {
            const next = new Set(f.tags)
            if (next.has(value)) next.delete(value)
            else next.add(value)
            return { ...f, tags: next }
          })}
        />
      </div>
      {/* Right: image panel */}
      <div className="w-72 shrink-0">
        <ItemImage currentPath={currentImagePath} onFileSelected={onFileSelected} readOnly={ro} cacheBust={cacheBust} />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function ItemsPage() {
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

  const { items, page, setPage, totalPages, totalElements, reload } = usePagedList<Item>('/items', {
    onError: () => toast('Failed to load items.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: itemSearchText,
  })
  const [categories, setCategories] = useState<ItemCategory[]>([])
  const [allSkus, setAllSkus] = useState<ItemSku[]>([])

  const [open, setOpen]               = useState(false)
  const [mode, setMode]               = useState<FormMode>('view')
  const [activeItem, setActiveItem]   = useState<Item | null>(null)
  const [form, setForm]               = useState<ItemForm>({ itemCode: '', name: '', categoryId: '', skus: [], prices: emptyPrices(), tags: new Set() })
  const [companyId, setCompanyId]     = useState<number | ''>('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [loading, setLoading]         = useState(false)
  const [imageVersions, setImageVersions] = useState<Record<number, number>>({})
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('items')

  const canCreate = hasPermission('CREATE_ITEM')
  const canUpdate = hasPermission('UPDATE_ITEM')
  const canDeleteItem = hasPermission('DELETE_ITEM')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteItem ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteItem,
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  useEffect(() => {
    fetchAllContent<ItemCategory>('/item-categories')
      .then(setCategories)
      .catch(() => toast('Failed to load categories.', 'error'))
    fetchAllContent<ItemSku>('/item-skus')
      .then(setAllSkus)
      .catch(() => toast('Failed to load SKUs.', 'error'))
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function openView(item: Item) {
    setActiveItem(item)
    setForm(itemToForm(item))
    setSelectedFile(null)
    setMode('view')
    setOpen(true)
  }

  function openEdit(item: Item) {
    setActiveItem(item)
    setForm(itemToForm(item))
    setSelectedFile(null)
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveItem(null)
    setForm({ itemCode: '', name: '', categoryId: '', skus: [], prices: emptyPrices(), tags: new Set() })
    setCompanyId(activeCompanyId ?? '')
    setSelectedFile(null)
    setMode('create')
    setOpen(true)
  }

  function switchToEdit() {
    setMode('edit')
  }

  async function uploadImage(itemId: number, file: File): Promise<string | null> {
    try {
      const res = await apiUpload<{ imagePath: string }>(`/items/${itemId}/image`, file)
      setImageVersions(prev => ({ ...prev, [itemId]: Date.now() }))
      return res.imagePath
    } catch {
      toast('Item saved, but image upload failed.', 'error')
      return null
    }
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
        const created = await apiFetch<Item>('/items', {
          method: 'POST',
          body: JSON.stringify(formToPayload(form, companyId as number)),
        })
        if (selectedFile) {
          await uploadImage(created.id, selectedFile)
        }
        toast('Item created successfully.', 'success')
      } else {
        const updated = await apiFetch<Item>(`/items/${activeItem!.id}`, {
          method: 'PUT',
          body: JSON.stringify(formToPayload(form, activeItem!.companyId)),
        })
        if (selectedFile) {
          await uploadImage(updated.id, selectedFile)
        }
        toast('Item updated successfully.', 'success')
      }
      setOpen(false)
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create item.' : 'Failed to update item.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(item: Item) {
    if (!window.confirm(`Delete item "${item.name}"?`)) return
    try {
      await apiFetch(`/items/${item.id}`, { method: 'DELETE' })
      toast('Item deleted.', 'success')
      reload()
    } catch {
      toast('Failed to delete item.', 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<Item>(qs ? `/items?${qs}` : '/items', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(item => itemSearchText(item).toLowerCase().includes(term)) : all
    const rows = matching.map(item => ({
      itemCode: item.itemCode,
      name: item.name,
      category: item.itemCategoryName,
      company: item.companyName,
      skus: item.skus.join(', '),
      unitPrice: formatCurrency(itemUnitPrice(item)),
      tags: item.tags.join(', '),
    }))
    exportToXlsx('items', COLUMNS.filter(c => c.key !== 'image' && isVisible(c.key)), rows)
  }

  const dialogTitle = mode === 'view' ? 'Item Details' : mode === 'create' ? 'New Item' : 'Edit Item'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Items</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search items… (/)"
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
              New Item
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
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <CompanyField
              id="item-company"
              readOnly={mode !== 'create' || !showCompanyColumn}
              name={mode === 'create' ? activeCompany?.name : activeItem?.companyName}
              companies={companyOptions}
              value={companyId}
              onChange={setCompanyId}
              autoFocus={mode === 'create' && showCompanyColumn}
            />
            <ItemFormFields
              codeAutoFocus={!(mode === 'create' && showCompanyColumn)}
              form={form}
              setForm={setForm}
              categories={categories}
              allSkus={allSkus}
              currentImagePath={activeItem?.imagePath ?? null}
              onFileSelected={setSelectedFile}
              mode={mode}
              cacheBust={activeItem ? imageVersions[activeItem.id] : undefined}
              canViewCostPrice={hasPermission('VIEW_COST_PRICE')}
            />
            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_ITEM') && (
                    <Button type="button" onClick={switchToEdit}>Edit</Button>
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
                {isVisible('image') && <th className="text-left py-2 px-4 font-medium w-12" />}
                {isVisible('itemCode') && <th className="text-left py-2 px-4 font-medium">Item Code</th>}
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
                {isVisible('category') && <th className="text-left py-2 px-4 font-medium">Category</th>}
                {isVisible('skus') && <th className="text-left py-2 px-4 font-medium">SKUs</th>}
                {isVisible('unitPrice') && <th className="text-left py-2 px-4 font-medium">Unit Price</th>}
                {isVisible('tags') && <th className="text-left py-2 px-4 font-medium">Tags</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'image' && key !== 'tags'}
              />
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No items match your search/filters.' : 'No items to display.'}
                  </td>
                </tr>
              ) : (
                items.map((item, i) => (
                  <tr
                    key={item.id}
                    onClick={() => { setActiveIndex(i); openView(item) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{item.companyName}</td>}
                    {isVisible('image') && (
                      <td className="py-2 px-4">
                        {item.imagePath ? (
                          <img src={imageUrl(item.imagePath, imageVersions[item.id])} alt={item.name}
                            className="w-10 h-10 object-cover rounded-md border border-[hsl(var(--border))]" />
                        ) : (
                          <div className="w-10 h-10 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] flex items-center justify-center">
                            <ImageOff className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                          </div>
                        )}
                      </td>
                    )}
                    {isVisible('itemCode') && <td className="py-2 px-4 font-mono text-xs">{item.itemCode}</td>}
                    {isVisible('name') && <td className="py-2 px-4">{item.name}</td>}
                    {isVisible('category') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{item.itemCategoryName}</td>}
                    {isVisible('skus') && (
                      <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                        {item.skus.length > 0 ? item.skus.join(', ') : '—'}
                      </td>
                    )}
                    {isVisible('unitPrice') && (
                      <td className="py-2 px-4 tabular-nums">
                        {formatCurrency(itemUnitPrice(item) || null)}
                      </td>
                    )}
                    {isVisible('tags') && (
                      <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                        {item.tags.length > 0 ? item.tags.join(', ') : '—'}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(item)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteItem && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(item)}>
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