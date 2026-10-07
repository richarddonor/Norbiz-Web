import { useState, useRef, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { ChangeHistory } from '@/components/ChangeHistory'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, type ItemLookupOption } from '@/lib/lookups'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create' | 'edit'

const COLUMNS: readonly ColumnDef[] = [
  { key: 'skuCode', label: 'SKU Code' },
  { key: 'itemCode', label: 'Item Code' },
  { key: 'itemName', label: 'Item Name' },
  { key: 'unitPrice', label: 'Unit Price' },
]

function skuSearchText(sku: ItemSku): string {
  return [sku.skuCode, sku.itemCode, sku.itemName, String(sku.unitPrice)].join(' ')
}


interface ItemSku {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  skuCode: string
  unitPrice: number
}

type SkuForm = {
  itemId: number | ''
  skuCode: string
  unitPrice: string
}

function emptyForm(): SkuForm {
  return { itemId: '', skuCode: '', unitPrice: '' }
}

function skuToForm(sku: ItemSku): SkuForm {
  return {
    itemId: sku.itemId,
    skuCode: sku.skuCode,
    unitPrice: String(sku.unitPrice),
  }
}

export function ItemSkusPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId } = useAuth()
  const { zone } = useContentFocus()

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const inRecordTab = useIsRecordTab()
  const { items: skus, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<ItemSku>('/item-skus', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load SKUs.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: skuSearchText,
  })

  const [mode, setMode]           = useState<FormMode>('view')
  const rec = useRecordTab<ItemSku>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<ItemSku>(`/item-skus/${id}`),
  })
  const [activeSku, setActiveSku] = useState<ItemSku | null>(null)
  const [form, setForm]           = useState<SkuForm>(emptyForm())
  const [loading, setLoading]     = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, menu: columnMenu } = useColumnVisibility('item-skus')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_ITEM')
  const canUpdate = hasPermission('UPDATE_ITEM')
  const canDeleteSku = hasPermission('DELETE_ITEM')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: skus,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteSku ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteSku,
    enabled: !inRecordTab && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
    { key: 'r', handler: () => reload() },
  ], !inRecordTab && zone === 'content')

  function openView(sku: ItemSku) {
    if (!rec.isRecordTab) return rec.open('view', sku)
    setActiveSku(sku)
    const nextForm = skuToForm(sku)
    setForm(nextForm)
    markClean(nextForm)
    setMode('view')
  }

  function openEdit(sku: ItemSku) {
    if (!rec.isRecordTab) return rec.open('edit', sku)
    setActiveSku(sku)
    const nextForm = skuToForm(sku)
    setForm(nextForm)
    markClean(nextForm)
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveSku(null)
    const nextForm = emptyForm()
    setForm(nextForm)
    markClean(nextForm)
    setMode('create')
  }

  function requestClose() {
    guardedClose(form, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'create' && !form.itemId) {
      toast('Select an item.', 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create SKU "${form.skuCode}"?` : `Save changes to SKU "${form.skuCode}"?`)) return
    setLoading(true)
    try {
      if (mode === 'create') {
        await apiFetch<ItemSku>('/item-skus', {
          method: 'POST',
          body: JSON.stringify({
            itemId: form.itemId,
            skuCode: form.skuCode,
            unitPrice: Number(form.unitPrice),
          }),
        })
        toast('SKU created successfully.', 'success')
      } else {
        await apiFetch<ItemSku>(`/item-skus/${activeSku!.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            skuCode: form.skuCode,
            unitPrice: Number(form.unitPrice),
          }),
        })
        toast('SKU updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create SKU.' : 'Failed to update SKU.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(sku: ItemSku) {
    if (!window.confirm(`Delete SKU "${sku.skuCode}"?`)) return
    try {
      await apiFetch(`/item-skus/${sku.id}`, { method: 'DELETE' })
      toast('SKU deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete SKU.'), 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<ItemSku>(qs ? `/item-skus?${qs}` : '/item-skus', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(sku => skuSearchText(sku).toLowerCase().includes(term)) : all
    const rows = matching.map(sku => ({
      skuCode: sku.skuCode,
      itemCode: sku.itemCode,
      itemName: sku.itemName,
      unitPrice: formatCurrency(sku.unitPrice),
    }))
    exportToXlsx('item-skus', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const recordName = activeSku?.skuCode ?? ''
  const tabTitle = mode === 'create' ? 'New Item SKU' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Item SKU'
  const ro = mode === 'view'
  // Item dropdown for the session's active company (an SKU belongs to its item's company).
  const items = useLookup<ItemLookupOption>('items', activeCompanyId, { enabled: inRecordTab && mode !== 'view', onError: () => toast('Failed to load items.', 'error') })
  const selectedItem = items.find(i => i.id === form.itemId)

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Item SKUs</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search SKUs… (/)"
              className="pl-8 w-56"
            />
          </div>
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
        </div>
      </div>

      </>)}

      {inRecordTab && (
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DocSheet>
              <DocRow cols="3fr 2fr">
                {/* Item — selector on create, read-only display on edit/view */}
                <DocCell label="Item" htmlFor="sku-item" required={mode === 'create'}>
                  {mode === 'create' ? (
                    <SearchableSelect
                      id="sku-item"
                      autoFocus
                      value={form.itemId === '' ? '' : String(form.itemId)}
                      onChange={v => setForm(f => ({ ...f, itemId: v ? Number(v) : '' }))}
                      options={items.map(item => ({ value: String(item.id), label: `${item.code} — ${item.name}` }))}
                    />
                  ) : (
                    <Input
                      id="sku-item"
                      autoFocus
                      value={selectedItem ? `${selectedItem.code} — ${selectedItem.name}` : `${activeSku?.itemCode} — ${activeSku?.itemName}`}
                      readOnly
                      className="font-semibold"
                    />
                  )}
                </DocCell>
                <DocHeader title="SKU Record" />
              </DocRow>
              <DocRow cols="3fr 2fr">
                <DocCell label="SKU Code" htmlFor="sku-code" required={!ro}>
                  <Input
                    id="sku-code"
                    value={form.skuCode}
                    readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, skuCode: e.target.value }))}
                    required={!ro}
                  />
                </DocCell>
                <DocCell label="Unit Price" htmlFor="sku-price" align="right" required={!ro}>
                  {ro ? (
                    <DocText className="tabular-nums">{formatCurrency(form.unitPrice || null)}</DocText>
                  ) : (
                    <Input
                      id="sku-price"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={form.unitPrice}
                      onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))}
                      className="text-right"
                      required
                    />
                  )}
                </DocCell>
              </DocRow>
              {ro && activeSku && <ChangeHistory type="ITEM_SKU" id={activeSku.id} />}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {hasPermission('UPDATE_ITEM') && (
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
                {isVisible('skuCode') && <th className="text-left py-2 px-4 font-medium">SKU Code</th>}
                {isVisible('itemCode') && <th className="text-left py-2 px-4 font-medium">Item Code</th>}
                {isVisible('itemName') && <th className="text-left py-2 px-4 font-medium">Item Name</th>}
                {isVisible('unitPrice') && <th className="text-right py-2 px-4 font-medium">Unit Price</th>}
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
              {skus.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No SKUs match your search/filters.' : 'No SKUs to display.'}
                  </td>
                </tr>
              ) : (
                skus.map((sku, i) => (
                  <tr
                    key={sku.id}
                    onClick={() => { setActiveIndex(i); openView(sku) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {isVisible('skuCode') && <td className="py-2 px-4 font-mono text-xs font-medium">{sku.skuCode}</td>}
                    {isVisible('itemCode') && <td className="py-2 px-4 font-mono text-xs text-[hsl(var(--muted-foreground))]">{sku.itemCode}</td>}
                    {isVisible('itemName') && <td className="py-2 px-4">{sku.itemName}</td>}
                    {isVisible('unitPrice') && <td className="py-2 px-4 text-right tabular-nums">{formatCurrency(sku.unitPrice)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(sku)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(sku)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteSku && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(sku)}>
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
