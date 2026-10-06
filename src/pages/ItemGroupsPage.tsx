import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocCheck, DocText, DocSignatures } from '@/components/ui/doc-form'
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

interface ItemGroup {
  id: number
  companyId: number
  companyName: string
  name: string
  description: string | null
  bnInitials: string | null
  commissionRate: number
  focalCommissionRate: number
  active: boolean
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

type GroupForm = {
  name: string
  description: string
  bnInitials: string
  commissionRate: string
  focalCommissionRate: string
  active: boolean
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description' },
    { key: 'bnInitials', label: 'BN Initials' },
    { key: 'commissionRate', label: 'Commission %' },
    { key: 'focalCommissionRate', label: 'Focal Commission %' },
    { key: 'active', label: 'Active', type: 'boolean' },
    { key: 'createdBy', label: 'Created by' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

/** Commission rates are server-side only filterable as text, so they're excluded from the filter row. */
const UNFILTERABLE = new Set(['commissionRate', 'focalCommissionRate'])

function emptyForm(): GroupForm {
  return { name: '', description: '', bnInitials: '', commissionRate: '0', focalCommissionRate: '0', active: true }
}

function groupToForm(g: ItemGroup): GroupForm {
  return {
    name: g.name,
    description: g.description ?? '',
    bnInitials: g.bnInitials ?? '',
    commissionRate: String(g.commissionRate),
    focalCommissionRate: String(g.focalCommissionRate),
    active: g.active,
  }
}

function formatRate(rate: number | string | null | undefined): string {
  if (rate === null || rate === undefined || rate === '') return '—'
  return `${Number(rate).toFixed(2)}%`
}

function groupSearchText(g: ItemGroup): string {
  return [g.name, g.description ?? '', g.bnInitials ?? '', g.companyName, g.active ? 'active' : 'inactive', g.createdBy ?? '', g.updatedBy ?? ''].join(' ')
}

export function ItemGroupsPage() {
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
  const { items: groups, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<ItemGroup>('/item-groups', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load item groups.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: groupSearchText,
  })

  const [mode, setMode]               = useState<FormMode>('view')
  const rec = useRecordTab<ItemGroup>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<ItemGroup>(`/item-groups/${id}`),
  })
  const [activeGroup, setActiveGroup] = useState<ItemGroup | null>(null)
  const [form, setForm]               = useState<GroupForm>(emptyForm)
  const [companyId, setCompanyId]     = useState<number | ''>('')
  const [loading, setLoading]         = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, menu: columnMenu } = useColumnVisibility('item-groups')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_ITEM_GROUP')
  const canUpdate = hasPermission('UPDATE_ITEM_GROUP')
  const canDeleteGroup = hasPermission('DELETE_ITEM_GROUP')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: groups,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteGroup ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteGroup,
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

  function openView(group: ItemGroup) {
    if (!rec.isRecordTab) return rec.open('view', group)
    setActiveGroup(group)
    const nextForm = groupToForm(group)
    setForm(nextForm)
    markClean({ form: nextForm, companyId })
    setMode('view')
  }

  function openEdit(group: ItemGroup) {
    if (!rec.isRecordTab) return rec.open('edit', group)
    setActiveGroup(group)
    const nextForm = groupToForm(group)
    setForm(nextForm)
    markClean({ form: nextForm, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveGroup(null)
    const nextForm = emptyForm()
    const nextCompanyId = activeCompanyId ?? ''
    setForm(nextForm)
    setCompanyId(nextCompanyId)
    markClean({ form: nextForm, companyId: nextCompanyId })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ form, companyId }, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'create' && !companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create item group "${form.name}"?` : `Save changes to item group "${form.name}"?`)) return
    setLoading(true)
    try {
      const body = {
        companyId: mode === 'create' ? companyId : activeGroup!.companyId,
        name: form.name,
        description: form.description || null,
        bnInitials: form.bnInitials || null,
        commissionRate: Number(form.commissionRate),
        focalCommissionRate: Number(form.focalCommissionRate),
        active: form.active,
      }
      if (mode === 'create') {
        await apiFetch<ItemGroup>('/item-groups', { method: 'POST', body: JSON.stringify(body) })
        toast('Item group created successfully.', 'success')
      } else {
        await apiFetch<ItemGroup>(`/item-groups/${activeGroup!.id}`, { method: 'PUT', body: JSON.stringify(body) })
        toast('Item group updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch (err) {
      const fallback = mode === 'create' ? 'Failed to create item group.' : 'Failed to update item group.'
      toast(err instanceof Error && err.message ? err.message : fallback, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(group: ItemGroup) {
    if (!window.confirm(`Delete item group "${group.name}"?`)) return
    try {
      await apiFetch(`/item-groups/${group.id}`, { method: 'DELETE' })
      toast('Item group deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete item group.'), 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<ItemGroup>(qs ? `/item-groups?${qs}` : '/item-groups', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(g => groupSearchText(g).toLowerCase().includes(term)) : all
    const rows = matching.map(g => ({
      name: g.name,
      description: g.description ?? '',
      bnInitials: g.bnInitials ?? '',
      commissionRate: formatRate(g.commissionRate),
      focalCommissionRate: formatRate(g.focalCommissionRate),
      active: g.active ? 'Yes' : 'No',
      company: g.companyName,
      createdBy: resolveDisplayName(g.createdBy),
      updatedAt: formatDateTime(g.updatedAt),
    }))
    exportToXlsx('item-groups', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const recordName = activeGroup?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Item Group' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Item Group'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Item Groups</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search groups… (/)"
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
              <DocLetterhead company={
                  <CompanyField
                    id="group-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? activeCompany?.name : activeGroup?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={setCompanyId}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Item Group Record">
                  <DocRow>
                    <DocCell label="BN Initials" htmlFor="group-bn-initials">
                      <Input
                        id="group-bn-initials"
                        value={form.bnInitials}
                        readOnly={ro}
                        maxLength={20}
                        onChange={e => setForm(f => ({ ...f, bnInitials: e.target.value }))}
                      />
                    </DocCell>
                    <DocCell label="Status">
                      <DocCheck
                        id="group-active"
                        label="Active"
                        checked={form.active}
                        disabled={ro}
                        onChange={active => setForm(f => ({ ...f, active }))}
                      />
                    </DocCell>
                  </DocRow>
                </DocHeader>
              </DocLetterhead>
              <DocRow>
                <DocCell label="Name" htmlFor="group-name" required={!ro}>
                  <Input
                    id="group-name"
                    value={form.name}
                    readOnly={ro}
                    maxLength={255}
                    autoFocus={!(mode === 'create' && showCompanyColumn)}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required={!ro}
                  />
                </DocCell>
              </DocRow>
              <DocRow>
                <DocCell label="Description" htmlFor="group-description">
                  <Input
                    id="group-description"
                    value={form.description}
                    readOnly={ro}
                    maxLength={255}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  />
                </DocCell>
              </DocRow>
              <DocRow>
                <DocCell label="Commission Rate (%)" htmlFor="group-commission-rate" align="right" required={!ro}>
                  {ro ? (
                    <DocText className="tabular-nums">{formatRate(form.commissionRate)}</DocText>
                  ) : (
                    <Input id="group-commission-rate" type="number" step="0.01" min="0" max="100" className="text-right"
                      value={form.commissionRate} required
                      onChange={e => setForm(f => ({ ...f, commissionRate: e.target.value }))} />
                  )}
                </DocCell>
                <DocCell label="Focal Commission Rate (%)" htmlFor="group-focal-commission-rate" align="right" required={!ro}>
                  {ro ? (
                    <DocText className="tabular-nums">{formatRate(form.focalCommissionRate)}</DocText>
                  ) : (
                    <Input id="group-focal-commission-rate" type="number" step="0.01" min="0" max="100" className="text-right"
                      value={form.focalCommissionRate} required
                      onChange={e => setForm(f => ({ ...f, focalCommissionRate: e.target.value }))} />
                  )}
                </DocCell>
              </DocRow>
              {ro && activeGroup && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeGroup.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeGroup.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeGroup.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeGroup.updatedAt) },
                ]} />
              )}
              {ro && activeGroup && <ChangeHistory type="ITEM_GROUP" id={activeGroup.id} refreshKey={activeGroup.updatedAt} />}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {canUpdate && (
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
                {isVisible('description') && <th className="text-left py-2 px-4 font-medium">Description</th>}
                {isVisible('bnInitials') && <th className="text-left py-2 px-4 font-medium">BN Initials</th>}
                {isVisible('commissionRate') && <th className="text-right py-2 px-4 font-medium">Commission %</th>}
                {isVisible('focalCommissionRate') && <th className="text-right py-2 px-4 font-medium">Focal Commission %</th>}
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
                filterable={key => !UNFILTERABLE.has(key)}
              />
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No groups match your search/filters.' : 'No item groups to display.'}
                  </td>
                </tr>
              ) : (
                groups.map((group, i) => (
                  <tr
                    key={group.id}
                    onClick={() => { setActiveIndex(i); openView(group) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{group.companyName}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{group.name}</td>}
                    {isVisible('description') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{group.description || '—'}</td>}
                    {isVisible('bnInitials') && <td className="py-2 px-4 font-mono text-xs">{group.bnInitials || '—'}</td>}
                    {isVisible('commissionRate') && <td className="py-2 px-4 text-right tabular-nums">{formatRate(group.commissionRate)}</td>}
                    {isVisible('focalCommissionRate') && <td className="py-2 px-4 text-right tabular-nums">{formatRate(group.focalCommissionRate)}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          group.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {group.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(group.createdBy)}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(group.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(group)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(group)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteGroup && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(group)}>
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
