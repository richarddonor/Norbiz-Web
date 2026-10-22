import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocCheck, DocSignatures } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { ChangeHistory } from '@/components/ChangeHistory'
import { useRecordTab, useIsRecordTab } from '@/hooks/useRecordTab'
import { RecordSheet, RECORD_ACTIONS, CloseButton } from '@/components/RecordTab'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/hooks/useContentFocus'
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

interface Bank {
  id: number
  companyId: number
  companyName: string
  code: string
  name: string
  active: boolean
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true })
  columns.push(
    { key: 'code', label: 'Code', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'active', label: 'Active', sortable: true, type: 'boolean' },
  )
  columns.push(
    { key: 'createdBy', label: 'Created by', sortable: true },
    { key: 'updatedAt', label: 'Last updated', sortable: true, type: 'date' },
  )
  return columns
}

function bankSearchText(r: Bank): string {
  return [r.code, r.name, r.companyName, r.active ? 'active' : 'inactive', r.createdBy ?? '', r.updatedBy ?? ''].join(' ')
}

export function BanksPage() {
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
  const grouping = useRowGrouping(COLUMNS, 'banks')
  const sorting = useListSort(COLUMNS)
  const { items: banks, page, setPage, pageSize, setPageSize, totalPages, totalElements, reload, loading: listLoading, searchAll, allRows } = usePagedList<Bank>('/banks', {
    all: grouping.active,
    enabled: !inRecordTab,
    onError: () => toast('Failed to load banks.', 'error'),
    search: debouncedSearch,
    filters: sorting.apply(debouncedFilters),
    searchText: bankSearchText,
  })

  const [mode, setMode]                   = useState<FormMode>('view')
  const rec = useRecordTab<Bank>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Bank>(`/banks/${id}`),
  })
  const [activeBank, setActiveBank]   = useState<Bank | null>(null)
  const [code, setCode]                   = useState('')
  const [name, setName]                   = useState('')
  const [active, setActive]               = useState(true)
  const [companyId, setCompanyId]         = useState<number | ''>('')
  const [loading, setLoading]             = useState(false)
  const { isVisible, menu: columnMenu } = useColumnVisibility('banks')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_BANK')
  const canUpdate = hasPermission('UPDATE_BANK')
  const canDeleteBank = hasPermission('DELETE_BANK')

  const view = useGroupedRows(grouping, banks, listRow)
  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: banks,
    view,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteBank ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteBank,
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

  function openView(bank: Bank) {
    if (!rec.isRecordTab) return rec.open('view', bank)
    setActiveBank(bank)
    setCode(bank.code)
    setName(bank.name)
    setActive(bank.active)
    markClean({ code: bank.code, name: bank.name, active: bank.active, companyId })
    setMode('view')
  }

  function openEdit(bank: Bank) {
    if (!rec.isRecordTab) return rec.open('edit', bank)
    setActiveBank(bank)
    setCode(bank.code)
    setName(bank.name)
    setActive(bank.active)
    markClean({ code: bank.code, name: bank.name, active: bank.active, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveBank(null)
    setCode('')
    setName('')
    setActive(true)
    const nextCompanyId = activeCompanyId ?? ''
    setCompanyId(nextCompanyId)
    markClean({ code: '', name: '', active: true, companyId: nextCompanyId })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ code, name, active, companyId }, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'create' && !companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create bank "${name}"?` : `Save changes to bank "${name}"?`)) return
    setLoading(true)
    try {
      if (mode === 'create') {
        await apiFetch<Bank>('/banks', {
          method: 'POST',
          body: JSON.stringify({ code, name, active, companyId }),
        })
        toast('Bank created successfully.', 'success')
      } else {
        await apiFetch<Bank>(`/banks/${activeBank!.id}`, {
          method: 'PUT',
          body: JSON.stringify({ code, name, active, companyId: activeBank!.companyId }),
        })
        toast('Bank updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, mode === 'create' ? 'Failed to create bank.' : 'Failed to update bank.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(bank: Bank) {
    if (!window.confirm(`Delete bank "${bank.name}"?`)) return
    try {
      await apiFetch(`/banks/${bank.id}`, { method: 'DELETE' })
      toast('Bank deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete bank.'), 'error')
    }
  }

  /** One row's displayed value per column key: the export row, and what grouping groups by. */
  function listRow(c: Bank) {
    return {
      code: c.code,
      name: c.name,
      active: c.active ? 'Yes' : 'No',
      company: c.companyName,
      createdBy: resolveDisplayName(c.createdBy),
      updatedAt: formatDateTime(c.updatedAt),
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(sorting.apply(debouncedFilters))
    const all = await fetchAllContent<Bank>(qs ? `/banks?${qs}` : '/banks', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(c => bankSearchText(c).toLowerCase().includes(term)) : all
    const rows = matching.map(listRow)
    exportToXlsx('banks', COLUMNS.filter(c => isVisible(c.key)), rows, grouping)
  }

  const recordName = activeBank?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Bank' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Bank'
  const ro = mode === 'view'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Banks</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} {...columnMenu} />
          <GroupByMenu grouping={grouping} view={view} status={allRows} />
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
                    id="bank-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? activeCompany?.name : activeBank?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={setCompanyId}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Bank Record" />
              </DocLetterhead>
              <DocRow>
                <DocCell label="Code" htmlFor="bank-code" required={!ro}>
                  <Input
                    id="bank-code"
                    value={code}
                    readOnly={ro}
                    maxLength={50}
                    autoFocus={!(mode === 'create' && showCompanyColumn)}
                    onChange={e => setCode(e.target.value)}
                    required={!ro}
                  />
                </DocCell>
                <DocCell label="Name" htmlFor="bank-name" required={!ro}>
                  <Input
                    id="bank-name"
                    value={name}
                    readOnly={ro}
                    onChange={e => setName(e.target.value)}
                    required={!ro}
                  />
                </DocCell>
                <DocCell label="Status">
                  <DocCheck id="bank-active" label="Active" checked={active} disabled={ro} onChange={setActive} />
                </DocCell>
              </DocRow>
              {ro && activeBank && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeBank.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeBank.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeBank.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeBank.updatedAt) },
                ]} />
              )}
              {ro && activeBank && <ChangeHistory type="BANK" id={activeBank.id} refreshKey={activeBank.updatedAt} />}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <CloseButton onClick={requestClose} />
                  {canUpdate && (
                    <Button type="button" onClick={() => setMode('edit')}>Edit</Button>
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
                {isVisible('code') && <SortableTh sorting={sorting} column="code" className="text-left py-2 px-4 font-medium">Code</SortableTh>}
                {isVisible('name') && <SortableTh sorting={sorting} column="name" className="text-left py-2 px-4 font-medium">Name</SortableTh>}
                {isVisible('active') && <SortableTh sorting={sorting} column="active" className="text-left py-2 px-4 font-medium">Active</SortableTh>}
                {isVisible('createdBy') && <SortableTh sorting={sorting} column="createdBy" className="text-left py-2 px-4 font-medium">Created by</SortableTh>}
                {isVisible('updatedAt') && <SortableTh sorting={sorting} column="updatedAt" className="text-left py-2 px-4 font-medium">Last updated</SortableTh>}
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
              {banks.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No banks match your search/filters.' : 'No banks to display.'}
                  </td>
                </tr>
              ) : (
                groupedRows(view, { isVisible, activeIndex, onActivate: setActiveIndex }, (bank, i) => (
                  <tr
                    key={bank.id}
                    onClick={() => { setActiveIndex(i); openView(bank) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{bank.companyName}</td>}
                    {isVisible('code') && <td className="py-2 px-4 font-mono text-xs">{bank.code}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{bank.name}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          bank.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {bank.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(bank.createdBy)}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(bank.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(bank)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(bank)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteBank && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(bank)}>
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
