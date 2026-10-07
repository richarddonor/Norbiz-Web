import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, FileDown, X } from 'lucide-react'
import { apiFetch, deleteErrorMessage, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocCheck, DocText, DocLines, DocSignatures } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { SearchableSelect } from '@/components/ui/searchable-select'
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
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, type ItemLookupOption } from '@/lib/lookups'
import { formatDateTime } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'

// Bills of materials: the raw-material components (quantity per unit) needed to assemble one unit
// of an output item. An Assembly prefills its raw materials from them. Backend: /bills-of-materials,
// see ../Norbiz/docs/MASTER_DATA.md "Bills of Materials".

type FormMode = 'view' | 'create' | 'edit'

interface CompanyOption {
  id: number
  name: string
}

interface Component {
  id: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  quantity: string
}

interface BillOfMaterial {
  id: number
  companyId: number
  companyName: string
  code: string
  itemId: number
  itemCode: string
  itemName: string
  active: boolean
  components: Component[]
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

interface ComponentDraft {
  itemId: number | ''
  quantity: string
}

interface FormState {
  code: string
  itemId: number | ''
  active: boolean
  components: ComponentDraft[]
}

const EMPTY_COMPONENT: ComponentDraft = { itemId: '', quantity: '' }

function emptyForm(): FormState {
  return { code: '', itemId: '', active: true, components: [EMPTY_COMPONENT] }
}

function formOf(bom: BillOfMaterial): FormState {
  return {
    code: bom.code,
    itemId: bom.itemId,
    active: bom.active,
    components: byLineNumber(bom.components).map(c => ({ itemId: c.itemId, quantity: String(c.quantity) })),
  }
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'code', label: 'Code' },
    { key: 'item', label: 'Output Item' },
    { key: 'components', label: 'Components' },
    { key: 'active', label: 'Active', type: 'boolean' },
    { key: 'createdBy', label: 'Created by' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

function bomSearchText(b: BillOfMaterial): string {
  return [b.code, b.itemCode, b.itemName, b.companyName, b.active ? 'active' : 'inactive',
    ...b.components.map(c => `${c.itemCode} ${c.itemName}`), b.createdBy ?? '', b.updatedBy ?? ''].join(' ')
}

export function BillsOfMaterialsPage() {
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
  const { items: boms, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<BillOfMaterial>('/bills-of-materials', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load bills of materials.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: bomSearchText,
  })

  const [mode, setMode]               = useState<FormMode>('view')
  const rec = useRecordTab<BillOfMaterial>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<BillOfMaterial>(`/bills-of-materials/${id}`),
  })
  const [activeBom, setActiveBom]     = useState<BillOfMaterial | null>(null)
  const [form, setForm]               = useState<FormState>(emptyForm())
  const [companyId, setCompanyId]     = useState<number | ''>('')
  const [loading, setLoading]         = useState(false)
  const editing = inRecordTab && mode !== 'view'
  const lookupCompanyId = (mode === 'create' ? companyId : activeBom?.companyId) || activeCompanyId
  const formInventoryItems = useLookup<ItemLookupOption>('items', lookupCompanyId, { enabled: editing, params: { tag: 'INVENTORY' }, onError: () => toast('Failed to load items.', 'error') })
  const itemOptions = formInventoryItems.map(item => ({ value: String(item.id), label: `${item.code} — ${item.name}` }))
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, menu: columnMenu } = useColumnVisibility('bills-of-materials')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_BILL_OF_MATERIAL')
  const canUpdate = hasPermission('UPDATE_BILL_OF_MATERIAL')
  const canDeleteBom = hasPermission('DELETE_BILL_OF_MATERIAL')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: boms,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteBom ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteBom,
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

  function openView(bom: BillOfMaterial) {
    if (!rec.isRecordTab) return rec.open('view', bom)
    setActiveBom(bom)
    const next = formOf(bom)
    setForm(next)
    markClean({ form: next, companyId })
    setMode('view')
  }

  function openEdit(bom: BillOfMaterial) {
    if (!rec.isRecordTab) return rec.open('edit', bom)
    setActiveBom(bom)
    const next = formOf(bom)
    setForm(next)
    markClean({ form: next, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveBom(null)
    const next = emptyForm()
    setForm(next)
    const nextCompanyId = activeCompanyId ?? ''
    setCompanyId(nextCompanyId)
    markClean({ form: next, companyId: nextCompanyId })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ form, companyId }, () => rec.close())
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setForm(f => ({ ...f, itemId: '', components: [EMPTY_COMPONENT] }))
  }

  function updateComponent(index: number, patch: Partial<ComponentDraft>) {
    setForm(f => ({ ...f, components: f.components.map((c, i) => i === index ? { ...c, ...patch } : c) }))
  }

  function addComponent() {
    setForm(f => ({ ...f, components: [...f.components, EMPTY_COMPONENT] }))
  }

  function removeComponent(index: number) {
    setForm(f => ({ ...f, components: f.components.filter((_, i) => i !== index) }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'create' && !companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (form.itemId === '') {
      toast('Select the output item.', 'error')
      return
    }
    const components = form.components.filter(c => c.itemId !== '' && c.quantity.trim() !== '')
    if (components.length === 0) {
      toast('Add at least one component with an item and quantity.', 'error')
      return
    }
    if (components.some(c => Number(c.quantity) <= 0)) {
      toast('Component quantities must be greater than zero.', 'error')
      return
    }
    if (components.some(c => c.itemId === form.itemId)) {
      toast('The output item can\'t be one of its own components.', 'error')
      return
    }
    if (new Set(components.map(c => c.itemId)).size !== components.length) {
      toast('Each component item can only be listed once.', 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create bill of materials "${form.code}"?` : `Save changes to bill of materials "${form.code}"?`)) return
    setLoading(true)
    try {
      const body = {
        companyId: mode === 'create' ? companyId : activeBom!.companyId,
        code: form.code,
        itemId: form.itemId,
        active: form.active,
        components: components.map(c => ({ itemId: c.itemId, quantity: Number(c.quantity) })),
      }
      if (mode === 'create') {
        await apiFetch<BillOfMaterial>('/bills-of-materials', { method: 'POST', body: JSON.stringify(body) })
        toast('Bill of materials created successfully.', 'success')
      } else {
        await apiFetch<BillOfMaterial>(`/bills-of-materials/${activeBom!.id}`, { method: 'PUT', body: JSON.stringify(body) })
        toast('Bill of materials updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, mode === 'create' ? 'Failed to create bill of materials.' : 'Failed to update bill of materials.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(bom: BillOfMaterial) {
    if (!window.confirm(`Delete bill of materials "${bom.code}"?`)) return
    try {
      await apiFetch(`/bills-of-materials/${bom.id}`, { method: 'DELETE' })
      toast('Bill of materials deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete bill of materials.'), 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<BillOfMaterial>(qs ? `/bills-of-materials?${qs}` : '/bills-of-materials', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(b => bomSearchText(b).toLowerCase().includes(term)) : all
    const rows = matching.map(b => ({
      code: b.code,
      item: `${b.itemCode} — ${b.itemName}`,
      components: b.components.map(c => `${c.itemCode} × ${c.quantity}`).join(', '),
      active: b.active ? 'Yes' : 'No',
      company: b.companyName,
      createdBy: resolveDisplayName(b.createdBy),
      updatedAt: formatDateTime(b.updatedAt),
    }))
    exportToXlsx('bills-of-materials', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const recordName = activeBom?.code ?? ''
  const tabTitle = mode === 'create' ? 'New Bill of Materials' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Bill of Materials'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Bills of Materials</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search bills of materials… (/)"
              className="pl-8 w-64"
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
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-3xl">
          <form onSubmit={handleSubmit} className="space-y-4"
            onKeyDown={e => { if (!ro && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addComponent() } }}>
            <DocSheet>
              <DocLetterhead company={
                  <CompanyField
                    id="bom-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? companyOptions.find(c => c.id === companyId)?.name ?? activeCompany?.name : activeBom?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={handleCompanyChange}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Bill of Materials" />
              </DocLetterhead>
              <DocRow>
                <DocCell label="Code" htmlFor="bom-code" required={!ro}>
                  <Input
                    id="bom-code"
                    value={form.code}
                    readOnly={ro}
                    maxLength={100}
                    autoFocus={!(mode === 'create' && showCompanyColumn)}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                    required={!ro}
                  />
                </DocCell>
                <DocCell label="Status">
                  <DocCheck id="bom-active" label="Active" checked={form.active} disabled={ro} onChange={active => setForm(f => ({ ...f, active }))} />
                </DocCell>
              </DocRow>
              <DocRow>
                <DocCell label="Output Item (one unit)" htmlFor="bom-item" required={!ro}>
                  {ro ? (
                    <DocText>{activeBom ? `${activeBom.itemCode} — ${activeBom.itemName}` : ''}</DocText>
                  ) : (
                    <SearchableSelect
                      id="bom-item"
                      value={form.itemId === '' ? '' : String(form.itemId)}
                      onChange={v => setForm(f => ({ ...f, itemId: v ? Number(v) : '' }))}
                      options={itemOptions}
                      disabled={mode === 'create' && !companyId}
                    />
                  )}
                </DocCell>
              </DocRow>
              {ro && activeBom ? (
                <DocLines
                  rows={byLineNumber(activeBom.components)}
                  rowKey={c => c.id}
                  lineNumber={c => c.lineNumber}
                  minRows={3}
                  columns={[
                    { key: 'item', label: 'Component', render: c => `${c.itemCode} — ${c.itemName}` },
                    { key: 'quantity', label: 'Qty per Unit', align: 'right', width: '9rem', render: c => c.quantity },
                  ]}
                />
              ) : (
                <DocLines
                  rows={form.components}
                  columns={[
                    {
                      key: 'item', label: 'Component', required: true,
                      render: (c, i) => (
                        <SearchableSelect
                          value={c.itemId === '' ? '' : String(c.itemId)}
                          onChange={v => updateComponent(i, { itemId: v ? Number(v) : '' })}
                          options={itemOptions}
                        />
                      ),
                    },
                    {
                      key: 'quantity', label: 'Qty per Unit', align: 'right', width: '9rem', required: true,
                      render: (c, i) => (
                        <Input type="number" step="0.0001" min="0" aria-label={`Component ${i + 1} quantity`} value={c.quantity}
                          onChange={e => updateComponent(i, { quantity: e.target.value })} className="text-right" />
                      ),
                    },
                    {
                      key: 'remove', label: '', align: 'center', width: '2.75rem',
                      render: (_, i) => (
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove component ${i + 1}`}
                          onClick={() => removeComponent(i)} disabled={form.components.length === 1}>
                          <X className="w-4 h-4" />
                        </Button>
                      ),
                    },
                  ]}
                  footer={
                    <Button type="button" variant="ghost" size="sm" onClick={addComponent}>
                      <Plus className="w-3.5 h-3.5" />
                      Add Component
                      <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">Ctrl+Enter</kbd>
                    </Button>
                  }
                />
              )}
              {ro && activeBom && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeBom.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeBom.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeBom.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeBom.updatedAt) },
                ]} />
              )}
              {ro && activeBom && <ChangeHistory type="BILL_OF_MATERIAL" id={activeBom.id} refreshKey={activeBom.updatedAt} />}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {canUpdate && activeBom && (
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
                {isVisible('code') && <th className="text-left py-2 px-4 font-medium">Code</th>}
                {isVisible('item') && <th className="text-left py-2 px-4 font-medium">Output Item</th>}
                {isVisible('components') && <th className="text-left py-2 px-4 font-medium">Components</th>}
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
                filterable={key => key !== 'components'}
              />
            </thead>
            <tbody>
              {boms.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No bills of materials match your search/filters.' : 'No bills of materials to display.'}
                  </td>
                </tr>
              ) : (
                boms.map((bom, i) => (
                  <tr
                    key={bom.id}
                    onClick={() => { setActiveIndex(i); openView(bom) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{bom.companyName}</td>}
                    {isVisible('code') && <td className="py-2 px-4 font-mono text-xs">{bom.code}</td>}
                    {isVisible('item') && <td className="py-2 px-4 font-medium">{bom.itemCode} — {bom.itemName}</td>}
                    {isVisible('components') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))] tabular-nums">{bom.components.length}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          bom.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {bom.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(bom.createdBy)}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(bom.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(bom)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(bom)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteBom && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(bom)}>
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
