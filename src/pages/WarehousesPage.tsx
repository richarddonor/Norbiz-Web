import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, FileDown } from 'lucide-react'
import { apiFetch, ApiError, deleteErrorMessage } from '@/lib/api'
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
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { ScrollTable } from '@/components/ScrollTable'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface CompanyOption {
  id: number
  name: string
}

type FormMode = 'view' | 'create' | 'edit'

interface Warehouse {
  id: number
  companyId: number
  companyName: string
  code: string | null
  name: string
  active: boolean
  /** The company's main warehouse — Delivery Receipts deduct stock from it. */
  main: boolean
  /** Auto-created for an OUTLET customer and managed through that customer. */
  outlet: boolean
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

type WarehouseForm = {
  code: string
  name: string
  active: boolean
  main: boolean
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push({ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'kind', label: 'Type' })
  columns.push(
    { key: 'active', label: 'Active', type: 'boolean' },
    { key: 'createdBy', label: 'Created by' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

function emptyForm(): WarehouseForm {
  return { code: '', name: '', active: true, main: false }
}

function warehouseToForm(w: Warehouse): WarehouseForm {
  return { code: w.code ?? '', name: w.name, active: w.active, main: w.main }
}

function warehouseKind(w: Warehouse): string {
  return w.main ? 'Main' : w.outlet ? 'Outlet' : ''
}

function warehouseSearchText(w: Warehouse): string {
  return [w.code ?? '', w.name, warehouseKind(w), w.companyName, w.active ? 'active' : 'inactive', w.createdBy ?? '', w.updatedBy ?? ''].join(' ')
}

export function WarehousesPage() {
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
  const { items: warehouses, page, setPage, totalPages, totalElements, reload, loading: listLoading, searchAll } = usePagedList<Warehouse>('/warehouses', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load warehouses.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: warehouseSearchText,
  })

  const [mode, setMode]                   = useState<FormMode>('view')
  const rec = useRecordTab<Warehouse>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Warehouse>(`/warehouses/${id}`),
  })
  const [activeWarehouse, setActiveWarehouse] = useState<Warehouse | null>(null)
  const [form, setForm]                   = useState<WarehouseForm>(emptyForm())
  const [companyId, setCompanyId]         = useState<number | ''>('')
  const [loading, setLoading]             = useState(false)
  const { isVisible, menu: columnMenu } = useColumnVisibility('warehouses')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_WAREHOUSE')
  const canUpdate = hasPermission('UPDATE_WAREHOUSE')
  const canDeleteWarehouse = hasPermission('DELETE_WAREHOUSE')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: warehouses,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteWarehouse ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteWarehouse,
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

  function openView(warehouse: Warehouse) {
    if (!rec.isRecordTab) return rec.open('view', warehouse)
    setActiveWarehouse(warehouse)
    const nextForm = warehouseToForm(warehouse)
    setForm(nextForm)
    markClean({ form: nextForm, companyId })
    setMode('view')
  }

  function openEdit(warehouse: Warehouse) {
    if (warehouse.outlet) {
      toast(`"${warehouse.name}" is an outlet's warehouse — edit it through its customer record.`, 'error')
      return
    }
    if (!rec.isRecordTab) return rec.open('edit', warehouse)
    setActiveWarehouse(warehouse)
    const nextForm = warehouseToForm(warehouse)
    setForm(nextForm)
    markClean({ form: nextForm, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveWarehouse(null)
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
    if (form.main && !form.active) {
      toast('The main warehouse must be active.', 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create warehouse "${form.name}"?` : `Save changes to warehouse "${form.name}"?`)) return
    setLoading(true)
    try {
      const submitCompanyId = mode === 'create' ? companyId : activeWarehouse!.companyId
      const body = { companyId: submitCompanyId, code: form.code || null, name: form.name, active: form.active, main: form.main }
      if (mode === 'create') {
        await apiFetch<Warehouse>('/warehouses', { method: 'POST', body: JSON.stringify(body) })
        toast('Warehouse created successfully.', 'success')
      } else {
        await apiFetch<Warehouse>(`/warehouses/${activeWarehouse!.id}`, { method: 'PUT', body: JSON.stringify(body) })
        toast('Warehouse updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch (err) {
      toast(err instanceof ApiError && err.status === 400 && err.message
        ? err.message
        : mode === 'create' ? 'Failed to create warehouse.' : 'Failed to update warehouse.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(warehouse: Warehouse) {
    if (warehouse.outlet) {
      toast(`"${warehouse.name}" is an outlet's warehouse — it's removed together with its customer.`, 'error')
      return
    }
    if (!window.confirm(`Delete warehouse "${warehouse.name}"?`)) return
    try {
      await apiFetch(`/warehouses/${warehouse.id}`, { method: 'DELETE' })
      toast('Warehouse deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete warehouse.'), 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<Warehouse>(qs ? `/warehouses?${qs}` : '/warehouses', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(w => warehouseSearchText(w).toLowerCase().includes(term)) : all
    const rows = matching.map(w => ({
      code: w.code ?? '',
      name: w.name,
      kind: warehouseKind(w),
      company: w.companyName,
      active: w.active ? 'Yes' : 'No',
      createdBy: resolveDisplayName(w.createdBy),
      updatedAt: formatDateTime(w.updatedAt),
    }))
    exportToXlsx('warehouses', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const recordName = activeWarehouse?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Warehouse' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Warehouse'
  const ro = mode === 'view'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Warehouses</h1>
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
                    id="warehouse-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? activeCompany?.name : activeWarehouse?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={setCompanyId}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Warehouse Record">
                  <DocRow>
                    <DocCell label="Code" htmlFor="warehouse-code">
                      <Input
                        id="warehouse-code"
                        value={form.code}
                        readOnly={ro}
                        autoFocus={!(mode === 'create' && showCompanyColumn)}
                        onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                      />
                    </DocCell>
                    <DocCell label="Status">
                      <DocCheck
                        id="warehouse-active"
                        label="Active"
                        checked={form.active}
                        disabled={ro}
                        onChange={active => setForm(f => ({ ...f, active }))}
                      />
                      <DocCheck
                        id="warehouse-main"
                        label="Main warehouse"
                        checked={form.main}
                        disabled={ro || !!activeWarehouse?.outlet}
                        onChange={main => setForm(f => ({ ...f, main }))}
                      />
                    </DocCell>
                  </DocRow>
                </DocHeader>
              </DocLetterhead>
              <DocRow>
                <DocCell label="Warehouse Name" htmlFor="warehouse-name" required={!ro}>
                  <Input
                    id="warehouse-name"
                    value={form.name}
                    readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required={!ro}
                  />
                </DocCell>
              </DocRow>
              {form.main && !ro && !activeWarehouse?.main && (
                <DocRow>
                  <DocCell label="Main warehouse">
                    <DocText className="text-xs text-[hsl(var(--muted-foreground))]">
                      Delivery Receipts will deduct stock from this warehouse. Any other main warehouse in the company is unmarked on save.
                    </DocText>
                  </DocCell>
                </DocRow>
              )}
              {activeWarehouse?.outlet && (
                <DocRow>
                  <DocCell label="Outlet warehouse">
                    <DocText className="text-xs text-[hsl(var(--muted-foreground))]">
                      Created automatically for an outlet customer. Its name, code and status follow that customer — change them on the Customers page.
                    </DocText>
                  </DocCell>
                </DocRow>
              )}
              {ro && activeWarehouse && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeWarehouse.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeWarehouse.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeWarehouse.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeWarehouse.updatedAt) },
                ]} />
              )}
              {ro && activeWarehouse && <ChangeHistory type="WAREHOUSE" id={activeWarehouse.id} refreshKey={activeWarehouse.updatedAt} />}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {hasPermission('UPDATE_WAREHOUSE') && !activeWarehouse?.outlet && (
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
                {isVisible('code') && <th className="text-left py-2 px-4 font-medium">Code</th>}
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
                {isVisible('kind') && <th className="text-left py-2 px-4 font-medium">Type</th>}
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
                filterable={key => key !== 'kind'}
              />
            </thead>
            <tbody>
              {warehouses.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No warehouses match your search/filters.' : 'No warehouses to display.'}
                  </td>
                </tr>
              ) : (
                warehouses.map((warehouse, i) => (
                  <tr
                    key={warehouse.id}
                    onClick={() => { setActiveIndex(i); openView(warehouse) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{warehouse.companyName}</td>}
                    {isVisible('code') && <td className="py-2 px-4 font-mono text-xs">{warehouse.code ?? '—'}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{warehouse.name}</td>}
                    {isVisible('kind') && (
                      <td className="py-2 px-4">
                        {warehouseKind(warehouse) && (
                          <span className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                            warehouse.main
                              ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                              : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                          )}>
                            {warehouseKind(warehouse)}
                          </span>
                        )}
                      </td>
                    )}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          warehouse.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {warehouse.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(warehouse.createdBy)}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(warehouse.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(warehouse)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && !warehouse.outlet && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(warehouse)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteWarehouse && !warehouse.outlet && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(warehouse)}>
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
