import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocCheck, DocSignatures } from '@/components/ui/doc-form'
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

interface PullOutReason {
  id: number
  companyId: number
  companyName: string
  name: string
  active: boolean
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'name', label: 'Name' },
    { key: 'active', label: 'Active', type: 'boolean' },
  )
  columns.push(
    { key: 'createdBy', label: 'Created by' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

function reasonSearchText(r: PullOutReason): string {
  return [r.name, r.companyName, r.active ? 'active' : 'inactive', r.createdBy ?? '', r.updatedBy ?? ''].join(' ')
}

export function PullOutReasonsPage() {
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
  const { items: reasons, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<PullOutReason>('/pull-out-reasons', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load pull out reasons.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: reasonSearchText,
  })

  const [mode, setMode]                   = useState<FormMode>('view')
  const rec = useRecordTab<PullOutReason>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<PullOutReason>(`/pull-out-reasons/${id}`),
  })
  const [activeReason, setActiveReason]   = useState<PullOutReason | null>(null)
  const [name, setName]                   = useState('')
  const [active, setActive]               = useState(true)
  const [companyId, setCompanyId]         = useState<number | ''>('')
  const [loading, setLoading]             = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, menu: columnMenu } = useColumnVisibility('pull-out-reasons')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_PULL_OUT_REASON')
  const canUpdate = hasPermission('UPDATE_PULL_OUT_REASON')
  const canDeleteReason = hasPermission('DELETE_PULL_OUT_REASON')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: reasons,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteReason ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteReason,
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

  function openView(reason: PullOutReason) {
    if (!rec.isRecordTab) return rec.open('view', reason)
    setActiveReason(reason)
    setName(reason.name)
    setActive(reason.active)
    markClean({ name: reason.name, active: reason.active, companyId })
    setMode('view')
  }

  function openEdit(reason: PullOutReason) {
    if (!rec.isRecordTab) return rec.open('edit', reason)
    setActiveReason(reason)
    setName(reason.name)
    setActive(reason.active)
    markClean({ name: reason.name, active: reason.active, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveReason(null)
    setName('')
    setActive(true)
    const nextCompanyId = activeCompanyId ?? ''
    setCompanyId(nextCompanyId)
    markClean({ name: '', active: true, companyId: nextCompanyId })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ name, active, companyId }, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'create' && !companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create pull out reason "${name}"?` : `Save changes to pull out reason "${name}"?`)) return
    setLoading(true)
    try {
      if (mode === 'create') {
        await apiFetch<PullOutReason>('/pull-out-reasons', {
          method: 'POST',
          body: JSON.stringify({ name, active, companyId }),
        })
        toast('Pull out reason created successfully.', 'success')
      } else {
        await apiFetch<PullOutReason>(`/pull-out-reasons/${activeReason!.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, active, companyId: activeReason!.companyId }),
        })
        toast('Pull out reason updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, mode === 'create' ? 'Failed to create pull out reason.' : 'Failed to update pull out reason.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(reason: PullOutReason) {
    if (!window.confirm(`Delete pull out reason "${reason.name}"?`)) return
    try {
      await apiFetch(`/pull-out-reasons/${reason.id}`, { method: 'DELETE' })
      toast('Pull out reason deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete pull out reason.'), 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<PullOutReason>(qs ? `/pull-out-reasons?${qs}` : '/pull-out-reasons', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(c => reasonSearchText(c).toLowerCase().includes(term)) : all
    const rows = matching.map(c => ({
      name: c.name,
      active: c.active ? 'Yes' : 'No',
      company: c.companyName,
      createdBy: resolveDisplayName(c.createdBy),
      updatedAt: formatDateTime(c.updatedAt),
    }))
    exportToXlsx('pull-out-reasons', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const recordName = activeReason?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Pull Out Reason' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Pull Out Reason'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Pull Out Reasons</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pull out reasons… (/)"
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
                    id="reason-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? activeCompany?.name : activeReason?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={setCompanyId}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Pull Out Reason Record" />
              </DocLetterhead>
              <DocRow>
                <DocCell label="Name" htmlFor="reason-name" required={!ro}>
                  <Input
                    id="reason-name"
                    value={name}
                    readOnly={ro}
                    autoFocus={!(mode === 'create' && showCompanyColumn)}
                    onChange={e => setName(e.target.value)}
                    required={!ro}
                  />
                </DocCell>
                <DocCell label="Status">
                  <DocCheck id="reason-active" label="Active" checked={active} disabled={ro} onChange={setActive} />
                </DocCell>
              </DocRow>
              {ro && activeReason && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeReason.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeReason.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeReason.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeReason.updatedAt) },
                ]} />
              )}
              {ro && activeReason && <ChangeHistory type="PULL_OUT_REASON" id={activeReason.id} refreshKey={activeReason.updatedAt} />}
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
              {reasons.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No pull out reasons match your search/filters.' : 'No pull out reasons to display.'}
                  </td>
                </tr>
              ) : (
                reasons.map((reason, i) => (
                  <tr
                    key={reason.id}
                    onClick={() => { setActiveIndex(i); openView(reason) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{reason.companyName}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{reason.name}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          reason.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {reason.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(reason.createdBy)}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(reason.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(reason)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(reason)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteReason && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(reason)}>
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
