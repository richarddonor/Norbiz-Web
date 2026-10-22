import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, ImageOff, Eye, FileDown, X, ScanSearch } from 'lucide-react'
import { apiFetch, apiUpload, deleteErrorMessage, ApiError } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocSection, DocLines, DocCheck } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { ChangeHistory } from '@/components/ChangeHistory'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS, CloseButton } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { useRowGrouping, useGroupedRows } from '@/hooks/useRowGrouping'
import { GroupByMenu } from '@/components/RowGrouping'
import { groupedRows } from '@/components/groupedRows'
import { useListSort } from '@/hooks/useListSort'
import { SortableTh } from '@/components/SortableTh'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { TagCheckboxes } from '@/components/TagCheckboxes'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { ScrollTable } from '@/components/ScrollTable'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, type LookupOption } from '@/lib/lookups'
import { formatCurrency } from '@/lib/format'
import { isRecognitionUnavailable, itemImageUrl as imageUrl, useItemRecognitionAvailable, type ItemRecognitionMatch } from '@/lib/itemRecognition'
import { ItemRecognitionDialog } from '@/components/ItemRecognitionDialog'
import type { ItemLookupOption } from '@/lib/lookups'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

type FormMode = 'view' | 'create' | 'edit'

interface CompanyOption {
  id: number
  name: string
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true })
  columns.push(
    { key: 'image', label: 'Image', groupable: false },
    { key: 'itemCode', label: 'Item Code', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'category', label: 'Category', sortable: true },
    { key: 'group', label: 'Item Group', sortable: true },
    { key: 'skus', label: 'SKUs' },
    { key: 'unitPrice', label: 'Unit Price' },
    { key: 'tags', label: 'Tags' },
    { key: 'active', label: 'Active', sortable: true, type: 'boolean' },
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

/** One SKU line on the item form; the backend matches lines to the item's SKUs by code. */
interface SkuLine {
  skuCode: string
  unitPrice: string
  /** Display only — a SKU's brand is edited on the Item SKUs page, never sent on save. */
  brandName: string | null
}

interface Item {
  id: number
  companyId: number
  companyName: string
  itemCategoryId: number
  itemCategoryName: string
  itemGroupId: number | null
  itemGroupName: string | null
  itemCode: string
  name: string
  imagePath: string | null
  active: boolean
  skus: string[]
  /** Absent on list responses cached before the field existed — the form then leaves SKUs alone. */
  skuLines?: { id: number; skuCode: string; unitPrice: string | number; brandName?: string | null }[] | null
  prices: PriceEntry[]
  tags: string[]
}

type ItemForm = {
  itemCode: string
  name: string
  categoryId: number | ''
  groupId: number | ''
  /** null = unknown (stale cached row): sent as null so the backend leaves the SKUs untouched. */
  skus: SkuLine[] | null
  prices: Record<PriceType, string>
  tags: Set<string>
  active: boolean
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
    itemGroupId: form.groupId === '' ? null : form.groupId,
    skuLines: form.skus === null ? null : form.skus
      .filter(l => l.skuCode.trim() !== '')
      .map(l => ({ skuCode: l.skuCode.trim(), unitPrice: Number(l.unitPrice) })),
    prices: PRICE_TYPES
      .filter(t => form.prices[t] !== '')
      .map(t => ({ priceType: t, amount: Number(form.prices[t]) })),
    tags: Array.from(form.tags),
    active: form.active,
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
    groupId: item.itemGroupId ?? '',
    skus: item.skuLines ? item.skuLines.map(l => ({ skuCode: l.skuCode, unitPrice: String(l.unitPrice), brandName: l.brandName ?? null })) : null,
    prices,
    tags: new Set(item.tags),
    active: item.active,
  }
}

function itemUnitPrice(item: Item): string {
  return item.prices.find(p => p.priceType === 'UNIT_PRICE')?.amount ?? ''
}

function itemSearchText(item: Item): string {
  return [item.itemCode, item.name, item.itemCategoryName, item.itemGroupName ?? '', item.companyName, ...item.skus, itemUnitPrice(item), ...item.tags, item.active ? 'active' : 'inactive'].join(' ')
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

  const containerBase = 'flex items-center justify-center w-full aspect-square overflow-hidden'

  return (
    <div className="pb-2">
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
  companyField,
  codeAutoFocus,
  form,
  setForm,
  categories,
  groups,
  currentImagePath,
  onFileSelected,
  mode,
  cacheBust,
  canViewCostPrice,
  currentSkuCodes,
  onAddSku,
  footer,
}: {
  companyField: React.ReactNode
  codeAutoFocus: boolean
  form: ItemForm
  setForm: React.Dispatch<React.SetStateAction<ItemForm>>
  categories: LookupOption[]
  groups: LookupOption[]
  currentImagePath: string | null
  onFileSelected: (f: File | null) => void
  mode: FormMode
  cacheBust?: number
  canViewCostPrice: boolean
  /** The saved record's SKU codes, shown when `form.skus` is null. */
  currentSkuCodes: string[]
  onAddSku: () => void
  /** Rendered at the foot of the sheet (view mode's Change History). */
  footer?: React.ReactNode
}) {
  const ro = mode === 'view'
  const skus = form.skus
  const updateSku = (index: number, patch: Partial<SkuLine>) =>
    setForm(f => ({ ...f, skus: (f.skus ?? []).map((l, i) => i === index ? { ...l, ...patch } : l) }))
  const removeSku = (index: number) =>
    setForm(f => ({ ...f, skus: (f.skus ?? []).filter((_, i) => i !== index) }))
  return (
    <DocSheet>
      <DocRow cols="minmax(0, 1fr) 12rem">
        <div className="flex min-w-0 flex-col">
          <DocLetterhead company={companyField}>
            <DocHeader title="Item Record" />
          </DocLetterhead>
          <DocRow>
            <DocCell label="Item Code" htmlFor="form-code" required={mode === 'create'}>
              <Input id="form-code" value={form.itemCode} maxLength={100} readOnly={ro || mode === 'edit'} autoFocus={codeAutoFocus}
                onChange={e => setForm(f => ({ ...f, itemCode: e.target.value }))} required={!ro} />
            </DocCell>
            <DocCell label="Category" htmlFor="form-category" required={!ro}>
              {ro ? (
                <Input id="form-category" value={categories.find(c => c.id === form.categoryId)?.name ?? '—'} readOnly />
              ) : (
                <SearchableSelect
                  id="form-category"
                  value={form.categoryId === '' ? '' : String(form.categoryId)}
                  onChange={v => setForm(f => ({ ...f, categoryId: v ? Number(v) : '' }))}
                  options={categories.map(c => ({ value: String(c.id), label: c.name }))}
                />
              )}
            </DocCell>
            <DocCell label="Item Group" htmlFor="form-group">
              {ro ? (
                <Input id="form-group" value={groups.find(g => g.id === form.groupId)?.name ?? '—'} readOnly />
              ) : (
                <SearchableSelect
                  id="form-group"
                  value={form.groupId === '' ? '' : String(form.groupId)}
                  onChange={v => setForm(f => ({ ...f, groupId: v ? Number(v) : '' }))}
                  options={groups.map(g => ({ value: String(g.id), label: g.name }))}
                  placeholder="None"
                />
              )}
            </DocCell>
          </DocRow>
          <DocRow>
            <DocCell label="Item Name / Description" htmlFor="form-name" required={!ro}>
              <Input id="form-name" value={form.name} maxLength={255} readOnly={ro}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required={!ro} />
            </DocCell>
            <DocCell label="Status">
              <DocCheck id="form-active" label="Active" checked={form.active} disabled={ro}
                onChange={active => setForm(f => ({ ...f, active }))} />
            </DocCell>
          </DocRow>
          <DocRow>
            <TagCheckboxes label="Tags" options={ITEM_TAGS} selected={form.tags} readOnly={ro}
              onToggle={value => setForm(f => {
                const next = new Set(f.tags)
                if (next.has(value)) next.delete(value)
                else next.add(value)
                return { ...f, tags: next }
              })}
            />
          </DocRow>
        </div>
        <DocCell label="Photo">
          <ItemImage currentPath={currentImagePath} onFileSelected={onFileSelected} readOnly={ro} cacheBust={cacheBust} />
        </DocCell>
      </DocRow>

      <DocSection title="Prices" />
      <DocRow>
        {PRICE_TYPES.filter(type => type !== 'COST_PRICE' || canViewCostPrice).map(type => (
          <DocCell key={type} label={PRICE_LABELS[type]} htmlFor={`form-price-${type}`} align="right">
            {ro ? (
              <DocText className="tabular-nums">{formatCurrency(form.prices[type] || null)}</DocText>
            ) : (
              <Input id={`form-price-${type}`} type="number" step="0.0001" min="0" className="text-right"
                value={form.prices[type]}
                onChange={e => setForm(f => ({ ...f, prices: { ...f.prices, [type]: e.target.value } }))} />
            )}
          </DocCell>
        ))}
      </DocRow>

      <DocSection title="SKUs" />
      {skus === null ? (
        // Stale cached row without unit prices — show the codes, keep them out of the save.
        <DocRow>
          <DocCell label="SKU Codes"><DocText>{currentSkuCodes.join(', ')}</DocText></DocCell>
        </DocRow>
      ) : (
        <DocLines
          rows={skus}
          minRows={ro ? 1 : 0}
          columns={[
            {
              key: 'code', label: 'SKU Code', required: !ro,
              render: (line, i) => ro ? line.skuCode : (
                <Input aria-label={`SKU line ${i + 1} code`} value={line.skuCode} maxLength={100}
                  onChange={e => updateSku(i, { skuCode: e.target.value })} />
              ),
            },
            {
              key: 'brand', label: 'Brand', width: '12rem',
              render: line => <span className="text-[hsl(var(--muted-foreground))]">{line.brandName ?? '—'}</span>,
            },
            {
              key: 'unitPrice', label: 'Unit Price', align: 'right', width: '10rem', required: !ro,
              render: (line, i) => ro ? formatCurrency(line.unitPrice || null) : (
                <Input type="number" step="0.0001" min="0" aria-label={`SKU line ${i + 1} unit price`} value={line.unitPrice}
                  onChange={e => updateSku(i, { unitPrice: e.target.value })} className="text-right" />
              ),
            },
            !ro && {
              key: 'remove', label: '', align: 'center', width: '2.75rem',
              render: (_, i) => (
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove SKU line ${i + 1}`}
                  onClick={() => removeSku(i)}>
                  <X className="w-4 h-4" />
                </Button>
              ),
            },
          ]}
          footer={!ro && (
            <Button type="button" variant="ghost" size="sm" onClick={onAddSku}>
              <Plus className="w-3.5 h-3.5" />
              Add SKU
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">Ctrl+Enter</kbd>
            </Button>
          )}
        />
      )}
      {footer}
    </DocSheet>
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
  // Photo filter: the list shows only the items that look like the user's photo (sent as the
  // backend's `ids` filter, so column filters and the Global Filter still narrow it), best match first.
  const [photoFilter, setPhotoFilter] = useState<{ matches: ItemRecognitionMatch[]; preview: string } | null>(null)
  useEffect(() => () => { if (photoFilter) URL.revokeObjectURL(photoFilter.preview) }, [photoFilter])
  const photoSimilarity = useMemo(
    () => new Map(photoFilter?.matches.map(m => [m.item.id, m.similarity]) ?? []),
    [photoFilter],
  )
  const listFilters = useMemo(
    () => photoFilter ? { ...debouncedFilters, ids: photoFilter.matches.map(m => m.item.id).join(',') } : debouncedFilters,
    [debouncedFilters, photoFilter],
  )
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim()) || !!photoFilter

  const inRecordTab = useIsRecordTab()
  const grouping = useRowGrouping(COLUMNS, 'items')
  const sorting = useListSort(COLUMNS)
  const { items: pageItems, page, setPage, pageSize, setPageSize, totalPages, totalElements, reload, loading: listLoading, searchAll, allRows } = usePagedList<Item>('/items', {
    all: grouping.active,
    enabled: !inRecordTab,
    onError: () => toast('Failed to load items.', 'error'),
    search: debouncedSearch,
    filters: sorting.apply(listFilters),
    searchText: itemSearchText,
  })
  // At most 20 photo matches, so they fit on one page and sorting the page sorts them all.
  const items = useMemo(
    () => photoFilter ? [...pageItems].sort((a, b) => (photoSimilarity.get(b.id) ?? 0) - (photoSimilarity.get(a.id) ?? 0)) : pageItems,
    [pageItems, photoFilter, photoSimilarity],
  )

  const [mode, setMode]               = useState<FormMode>('view')
  const rec = useRecordTab<Item>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => fetchAllContent<Item>('/items', 100000).then(all => { const found = all.find(r => String(r.id) === id); if (!found) throw new Error('not found'); return found }),
  })
  const [activeItem, setActiveItem]   = useState<Item | null>(null)
  const [form, setForm]               = useState<ItemForm>({ itemCode: '', name: '', categoryId: '', groupId: '', skus: [], prices: emptyPrices(), tags: new Set(), active: true })
  const [companyId, setCompanyId]     = useState<number | ''>('')
  // Categories belong to the item's company: the picked company on create, the record's own otherwise.
  const categoryCompanyId = (mode === 'create' ? companyId : activeItem?.companyId) || activeCompanyId
  const activeCategories = useLookup<LookupOption>('item-categories', categoryCompanyId, { enabled: inRecordTab, onError: () => toast('Failed to load categories.', 'error') })
  // The lookup only returns active categories; keep an item's current (possibly deactivated) category selectable.
  const categories = useMemo(() => {
    if (!activeItem?.itemCategoryId || activeCategories.some(c => c.id === activeItem.itemCategoryId)) return activeCategories
    return [...activeCategories, { id: activeItem.itemCategoryId, companyId: activeItem.companyId, code: null, name: activeItem.itemCategoryName, active: false }]
  }, [activeCategories, activeItem])
  const activeGroups = useLookup<LookupOption>('item-groups', categoryCompanyId, { enabled: inRecordTab, onError: () => toast('Failed to load item groups.', 'error') })
  // The lookup only returns active groups; keep an item's current (possibly deactivated) group selectable.
  const groups = useMemo(() => {
    if (!activeItem?.itemGroupId || activeGroups.some(g => g.id === activeItem.itemGroupId)) return activeGroups
    return [...activeGroups, { id: activeItem.itemGroupId, companyId: activeItem.companyId, code: null, name: activeItem.itemGroupName ?? '', active: false }]
  }, [activeGroups, activeItem])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [loading, setLoading]         = useState(false)
  const [imageVersions, setImageVersions] = useState<Record<number, number>>({})
  const { isVisible, menu: columnMenu } = useColumnVisibility('items')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_ITEM')
  const canUpdate = hasPermission('UPDATE_ITEM')
  const canDeleteItem = hasPermission('DELETE_ITEM')
  // Re-embedding a whole catalog is an admin action, separate from editing items.
  const canReindexPhotos = hasPermission('REINDEX_ITEM_IMAGES')
  // Finding an item by photo is for anyone on this page; it hides once the backend reports recognition unavailable.
  const recognitionAvailable = useItemRecognitionAvailable()
  const canFindByPhoto = recognitionAvailable && !!activeCompanyId
  const [photoDialog, setPhotoDialog] = useState<'filter' | 'find' | null>(null)

  const view = useGroupedRows(grouping, items, listRow)
  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items,
    view,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteItem ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteItem,
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

  function openView(item: Item) {
    if (!rec.isRecordTab) return rec.open('view', item)
    setActiveItem(item)
    const nextForm = itemToForm(item)
    setForm(nextForm)
    setSelectedFile(null)
    markClean({ form: nextForm, companyId, hasFile: false })
    setMode('view')
  }

  function openEdit(item: Item) {
    if (!rec.isRecordTab) return rec.open('edit', item)
    setActiveItem(item)
    const nextForm = itemToForm(item)
    setForm(nextForm)
    setSelectedFile(null)
    markClean({ form: nextForm, companyId, hasFile: false })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveItem(null)
    const nextForm: ItemForm = { itemCode: '', name: '', categoryId: '', groupId: '', skus: [], prices: emptyPrices(), tags: new Set(['INVENTORY']), active: true }
    const nextCompanyId = activeCompanyId ?? ''
    setForm(nextForm)
    setCompanyId(nextCompanyId)
    setSelectedFile(null)
    markClean({ form: nextForm, companyId: nextCompanyId, hasFile: false })
    setMode('create')
  }

  // New SKUs default to the item's unit price — usually what a variant sells for.
  function addSkuLine() {
    if (form.skus === null) return
    setForm(f => ({ ...f, skus: [...(f.skus ?? []), { skuCode: '', unitPrice: f.prices.UNIT_PRICE, brandName: null }] }))
  }

  function requestClose() {
    guardedClose({ form, companyId, hasFile: !!selectedFile }, () => rec.close())
  }

  function switchToEdit() {
    setMode('edit')
  }

  // The photo match is a lookup option, so the full item is fetched (by its code, then id) before its tab opens.
  async function openPhotoMatch(match: ItemLookupOption) {
    setPhotoDialog(null)
    try {
      const candidates = await fetchAllContent<Item>(`/items?itemCode=${encodeURIComponent(match.code ?? '')}`)
      const item = candidates.find(i => i.id === match.id)
      if (!item) { toast('That item could not be opened.', 'error'); return }
      openView(item)
    } catch {
      toast('Failed to load item.', 'error')
    }
  }

  function applyPhotoFilter(matches: ItemRecognitionMatch[], photo: File) {
    setPhotoDialog(null)
    setPhotoFilter({ matches, preview: URL.createObjectURL(photo) })
  }

  // Background job on the backend (202): by default only images not indexed yet, `force` redoes all.
  async function reindexPhotos(force: boolean) {
    const prompt = force
      ? 'Re-index every item photo for photo search? This runs in the background and can take a while.'
      : 'Index item photos that aren\'t searchable by photo yet? This runs in the background.'
    if (!window.confirm(prompt)) return
    try {
      const res = await apiFetch<{ queued: number }>(`/items/image-recognition/reindex${force ? '?force=true' : ''}`, { method: 'POST' })
      toast(res.queued === 0
        ? 'All item photos are already indexed.'
        : `Indexing ${res.queued} item photo${res.queued === 1 ? '' : 's'} in the background.`, 'success')
    } catch (err) {
      if (isRecognitionUnavailable(err)) toast('Photo search is turned off on the server.', 'error')
      else toast(err instanceof ApiError && err.status < 500 && err.message ? err.message : 'Failed to start photo indexing.', 'error')
    }
  }

  async function uploadImage(itemId: number, file: File): Promise<string | null> {
    try {
      const res = await apiUpload<{ imagePath: string; recognitionIndexed: boolean }>(`/items/${itemId}/image`, file)
      setImageVersions(prev => ({ ...prev, [itemId]: Date.now() }))
      if (res.recognitionIndexed === false) {
        toast('Image saved, but it couldn\'t be indexed for photo search. Use Photo Search → Index new photos later.')
      }
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
    if (!form.categoryId) {
      toast('Select a category.', 'error')
      return
    }
    const skuLines = (form.skus ?? []).filter(l => l.skuCode.trim() !== '' || l.unitPrice !== '')
    if (skuLines.some(l => l.skuCode.trim() === '')) {
      toast('Enter a code for every SKU line.', 'error')
      return
    }
    if (skuLines.some(l => l.unitPrice === '' || Number(l.unitPrice) < 0)) {
      toast('Enter a unit price for every SKU.', 'error')
      return
    }
    const codes = skuLines.map(l => l.skuCode.trim())
    const duplicate = codes.find((c, i) => codes.indexOf(c) !== i)
    if (duplicate) {
      toast(`SKU code "${duplicate}" is listed twice.`, 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create item "${form.name}"?` : `Save changes to item "${form.name}"?`)) return
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
      rec.close()
      reload()
    } catch (err) {
      // 4xx messages are user-facing (e.g. "Duplicate SKU code: X").
      const status = err instanceof ApiError ? err.status : 0
      toast(status >= 400 && status < 500 && err instanceof Error && err.message
        ? err.message
        : mode === 'create' ? 'Failed to create item.' : 'Failed to update item.', 'error')
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
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete item.'), 'error')
    }
  }

  /** One row's displayed value per column key: the export row, and what grouping groups by. */
  function listRow(item: Item) {
    return {
      itemCode: item.itemCode,
      name: item.name,
      category: item.itemCategoryName,
      group: item.itemGroupName ?? '',
      company: item.companyName,
      skus: item.skus.join(', '),
      unitPrice: formatCurrency(itemUnitPrice(item)),
      tags: item.tags.join(', '),
      active: item.active ? 'Yes' : 'No',
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(sorting.apply(listFilters))
    const all = await fetchAllContent<Item>(qs ? `/items?${qs}` : '/items', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(item => itemSearchText(item).toLowerCase().includes(term)) : all
    if (photoFilter) matching.sort((a, b) => (photoSimilarity.get(b.id) ?? 0) - (photoSimilarity.get(a.id) ?? 0))
    const rows = matching.map(listRow)
    exportToXlsx('items', COLUMNS.filter(c => c.key !== 'image' && isVisible(c.key)), rows, grouping)
  }

  const recordName = activeItem?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Item' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Item'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Items</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} {...columnMenu} />
          <GroupByMenu grouping={grouping} view={view} status={allRows} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          {(canFindByPhoto || canReindexPhotos) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <ScanSearch className="w-4 h-4" />
                  Photo Search
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {canFindByPhoto && <>
                  <DropdownMenuItem onSelect={() => setPhotoDialog('filter')}>Filter list by photo</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPhotoDialog('find')}>Find item by photo</DropdownMenuItem>
                </>}
                {canFindByPhoto && canReindexPhotos && <DropdownMenuSeparator />}
                {canReindexPhotos && <>
                  <DropdownMenuItem onSelect={() => reindexPhotos(false)}>Index new photos</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => reindexPhotos(true)}>Re-index all photos</DropdownMenuItem>
                </>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canFindByPhoto && (
            <ItemRecognitionDialog
              open={photoDialog !== null}
              onOpenChange={open => { if (!open) setPhotoDialog(null) }}
              companyId={activeCompanyId!}
              {...(photoDialog === 'filter'
                ? { title: 'Filter list by photo', limit: 20, onMatches: applyPhotoFilter }
                : { onPick: openPhotoMatch })}
            />
          )}
          {canCreate && (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              New
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">N</kbd>
            </Button>
          )}
          <GlobalSearch value={search} onChange={setSearch} status={searchAll} />
        </div>
        {photoFilter && (
          <div className="flex w-fit items-center gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] py-1 pl-1 pr-2 text-sm">
            <img src={photoFilter.preview} alt="Your photo" className="h-10 w-10 rounded object-cover" />
            <span>
              Showing the {photoFilter.matches.length} item{photoFilter.matches.length === 1 ? '' : 's'} that look most like your photo, best match first
            </span>
            <Button variant="ghost" size="sm" onClick={() => setPhotoFilter(null)} aria-label="Clear photo filter">
              <X className="h-4 w-4" />
              Clear
            </Button>
          </div>
        )}
      </div>

      </>)}

      {inRecordTab && (
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-3xl">
          <form onSubmit={handleSubmit} className="space-y-4"
            onKeyDown={e => { if (mode !== 'view' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addSkuLine() } }}>
            <ItemFormFields
              companyField={
                <CompanyField
                  id="item-company"
                  readOnly={mode !== 'create' || !showCompanyColumn}
                  name={mode === 'create' ? activeCompany?.name : activeItem?.companyName}
                  companies={companyOptions}
                  value={companyId}
                  onChange={setCompanyId}
                  autoFocus={mode === 'create' && showCompanyColumn}
                />
              }
              codeAutoFocus={!(mode === 'create' && showCompanyColumn)}
              form={form}
              setForm={setForm}
              categories={categories}
              groups={groups}
              currentSkuCodes={activeItem?.skus ?? []}
              onAddSku={addSkuLine}
              currentImagePath={activeItem?.imagePath ?? null}
              onFileSelected={setSelectedFile}
              mode={mode}
              cacheBust={activeItem ? imageVersions[activeItem.id] : undefined}
              canViewCostPrice={hasPermission('VIEW_COST_PRICE')}
              footer={mode === 'view' && activeItem && <ChangeHistory type="ITEM" id={activeItem.id} />}
            />
            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <CloseButton onClick={requestClose} />
                  {hasPermission('UPDATE_ITEM') && (
                    <Button type="button" onClick={switchToEdit}>Edit</Button>
                  )}
                </>
              ) : (
                <>
                  <CloseButton onClick={requestClose} label="Cancel" />
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
                {showCompanyColumn && isVisible('company') && <SortableTh sorting={sorting} column="company" className="text-left py-2 px-4 font-medium">Company</SortableTh>}
                {isVisible('image') && <th className="text-left py-2 px-4 font-medium w-12" />}
                {isVisible('itemCode') && <SortableTh sorting={sorting} column="itemCode" className="text-left py-2 px-4 font-medium">Item Code</SortableTh>}
                {isVisible('name') && <SortableTh sorting={sorting} column="name" className="text-left py-2 px-4 font-medium">Name</SortableTh>}
                {isVisible('category') && <SortableTh sorting={sorting} column="category" className="text-left py-2 px-4 font-medium">Category</SortableTh>}
                {isVisible('group') && <SortableTh sorting={sorting} column="group" className="text-left py-2 px-4 font-medium">Item Group</SortableTh>}
                {isVisible('skus') && <SortableTh sorting={sorting} column="skus" className="text-left py-2 px-4 font-medium">SKUs</SortableTh>}
                {isVisible('unitPrice') && <SortableTh sorting={sorting} column="unitPrice" className="text-right py-2 px-4 font-medium">Unit Price</SortableTh>}
                {isVisible('tags') && <SortableTh sorting={sorting} column="tags" className="text-left py-2 px-4 font-medium">Tags</SortableTh>}
                {isVisible('active') && <SortableTh sorting={sorting} column="active" className="text-left py-2 px-4 font-medium">Active</SortableTh>}
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
                groupedRows(view, { isVisible, activeIndex, onActivate: setActiveIndex }, (item, i) => (
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
                    {isVisible('name') && (
                      <td className="py-2 px-4">
                        {item.name}
                        {photoSimilarity.has(item.id) && (
                          <span className="ml-2 tabular-nums text-xs text-[hsl(var(--muted-foreground))]">
                            {Math.round(photoSimilarity.get(item.id)! * 100)}% match
                          </span>
                        )}
                      </td>
                    )}
                    {isVisible('category') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{item.itemCategoryName}</td>}
                    {isVisible('group') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{item.itemGroupName ?? '—'}</td>}
                    {isVisible('skus') && (
                      <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                        {item.skus.length > 0 ? item.skus.join(', ') : '—'}
                      </td>
                    )}
                    {isVisible('unitPrice') && (
                      <td className="py-2 px-4 text-right tabular-nums">
                        {formatCurrency(itemUnitPrice(item) || null)}
                      </td>
                    )}
                    {isVisible('tags') && (
                      <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                        {item.tags.length > 0 ? item.tags.join(', ') : '—'}
                      </td>
                    )}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          item.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {item.active ? 'Active' : 'Inactive'}
                        </span>
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
          </ScrollTable>
          <Pagination summary={view.summary} page={page} totalPages={totalPages} totalElements={totalElements} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </CardContent>
      </Card>
      </>)}
    </div>
  )
}