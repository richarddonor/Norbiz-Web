import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, FileDown } from 'lucide-react'
import { apiFetch, ApiError, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocCheck, DocText, DocSection, DocSignatures } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { ChangeHistory } from '@/components/ChangeHistory'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
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

type FormMode = 'view' | 'create' | 'edit'
type CustomerType = 'CUSTOMER' | 'OUTLET'

interface CompanyOption {
  id: number
  name: string
}

const CUSTOMER_TYPES: readonly CustomerType[] = ['CUSTOMER', 'OUTLET']
const TYPE_LABELS: Record<CustomerType, string> = { CUSTOMER: 'Customer', OUTLET: 'Outlet' }

interface Customer {
  id: number
  companyId: number
  companyName: string
  code: string | null
  name: string
  type: CustomerType
  email: string | null
  phone: string | null
  active: boolean
  /** OUTLET only: the outlet's own warehouse, created automatically by the backend. */
  warehouseId: number | null
  warehouseName: string | null
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

type CustomerForm = {
  code: string
  name: string
  type: CustomerType
  email: string
  phone: string
  active: boolean
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
  )
  columns.push(
    { key: 'active', label: 'Active', type: 'boolean' },
    { key: 'createdBy', label: 'Created by' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

function emptyForm(): CustomerForm {
  return { code: '', name: '', type: 'CUSTOMER', email: '', phone: '', active: true }
}

function customerToForm(c: Customer): CustomerForm {
  return { code: c.code ?? '', name: c.name, type: c.type, email: c.email ?? '', phone: c.phone ?? '', active: c.active }
}

function customerSearchText(c: Customer): string {
  return [c.code ?? '', c.name, TYPE_LABELS[c.type], c.companyName, c.email ?? '', c.phone ?? '', c.active ? 'active' : 'inactive', c.createdBy ?? '', c.updatedBy ?? ''].join(' ')
}

export function CustomersPage() {
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
  const { items: customers, page, setPage, totalPages, totalElements, reload, loading: listLoading, searchAll } = usePagedList<Customer>('/customers', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load customers.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: customerSearchText,
  })

  const [mode, setMode]                   = useState<FormMode>('view')
  const rec = useRecordTab<Customer>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Customer>(`/customers/${id}`),
  })
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null)
  const [form, setForm]                   = useState<CustomerForm>(emptyForm())
  const [companyId, setCompanyId]         = useState<number | ''>('')
  const [loading, setLoading]             = useState(false)
  const { isVisible, menu: columnMenu } = useColumnVisibility('customers')
  const { markClean, guardedClose } = useDirtyGuard()
  const resolveDisplayName = useUserDisplayNames()

  const canCreate = hasPermission('CREATE_CUSTOMER')
  const canUpdate = hasPermission('UPDATE_CUSTOMER')
  const canDeleteCustomer = hasPermission('DELETE_CUSTOMER')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: customers,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteCustomer ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteCustomer,
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

  function openView(customer: Customer) {
    if (!rec.isRecordTab) return rec.open('view', customer)
    setActiveCustomer(customer)
    const nextForm = customerToForm(customer)
    setForm(nextForm)
    markClean({ form: nextForm, companyId })
    setMode('view')
  }

  function openEdit(customer: Customer) {
    if (!rec.isRecordTab) return rec.open('edit', customer)
    setActiveCustomer(customer)
    const nextForm = customerToForm(customer)
    setForm(nextForm)
    markClean({ form: nextForm, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveCustomer(null)
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
    if (!window.confirm(mode === 'create' ? `Create customer "${form.name}"?` : `Save changes to customer "${form.name}"?`)) return
    setLoading(true)
    try {
      const submitCompanyId = mode === 'create' ? companyId : activeCustomer!.companyId
      const body = { companyId: submitCompanyId, code: form.code || null, name: form.name, type: form.type, email: form.email || null, phone: form.phone || null, active: form.active }
      if (mode === 'create') {
        await apiFetch<Customer>('/customers', { method: 'POST', body: JSON.stringify(body) })
        toast('Customer created successfully.', 'success')
      } else {
        await apiFetch<Customer>(`/customers/${activeCustomer!.id}`, { method: 'PUT', body: JSON.stringify(body) })
        toast('Customer updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch (err) {
      // 400s carry a useful reason (e.g. an outlet's warehouse code clashes, or an outlet can't revert to Customer).
      toast(err instanceof ApiError && err.status === 400 && err.message
        ? err.message
        : mode === 'create' ? 'Failed to create customer.' : 'Failed to update customer.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(customer: Customer) {
    if (!window.confirm(`Delete customer "${customer.name}"?`)) return
    try {
      await apiFetch(`/customers/${customer.id}`, { method: 'DELETE' })
      toast('Customer deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete customer.'), 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<Customer>(qs ? `/customers?${qs}` : '/customers', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(c => customerSearchText(c).toLowerCase().includes(term)) : all
    const rows = matching.map(c => ({
      code: c.code ?? '',
      name: c.name,
      type: TYPE_LABELS[c.type],
      company: c.companyName,
      active: c.active ? 'Yes' : 'No',
      createdBy: resolveDisplayName(c.createdBy),
      updatedAt: formatDateTime(c.updatedAt),
    }))
    exportToXlsx('customers', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const recordName = activeCustomer?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Customer' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Customer'
  const ro = mode === 'view'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Customers</h1>
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
                    id="cust-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? activeCompany?.name : activeCustomer?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={setCompanyId}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Customer Record">
                  <DocRow>
                    <DocCell label="Customer Code" htmlFor="cust-code">
                      <Input id="cust-code" value={form.code} readOnly={ro} autoFocus={!(mode === 'create' && showCompanyColumn)}
                        onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
                    </DocCell>
                    <DocCell label="Status">
                      <DocCheck id="cust-active" label="Active" checked={form.active} disabled={ro}
                        onChange={active => setForm(f => ({ ...f, active }))} />
                    </DocCell>
                  </DocRow>
                </DocHeader>
              </DocLetterhead>
              <DocRow cols="3fr 1fr">
                <DocCell label="Customer Name" htmlFor="cust-name" required={!ro}>
                  <Input id="cust-name" value={form.name} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required={!ro} />
                </DocCell>
                <DocCell label="Type" htmlFor="cust-type" required={!ro && !activeCustomer?.warehouseId}>
                  {/* An outlet with its own warehouse can't revert to a plain customer (it may hold stock). */}
                  {ro || !!activeCustomer?.warehouseId ? (
                    <Input id="cust-type" value={TYPE_LABELS[form.type]} readOnly />
                  ) : (
                    <SearchableSelect
                      id="cust-type"
                      value={form.type}
                      onChange={v => setForm(f => ({ ...f, type: (v || 'CUSTOMER') as CustomerType }))}
                      options={CUSTOMER_TYPES.map(t => ({ value: t, label: TYPE_LABELS[t] }))}
                      placeholder={TYPE_LABELS.CUSTOMER}
                    />
                  )}
                </DocCell>
              </DocRow>
              {(activeCustomer?.warehouseId || (!ro && form.type === 'OUTLET')) && (
                <DocRow>
                  <DocCell label="Outlet Warehouse">
                    {activeCustomer?.warehouseId ? (
                      <DocText>{activeCustomer.warehouseName}</DocText>
                    ) : (
                      <DocText className="italic text-[hsl(var(--muted-foreground))]">
                        Created automatically on save, named after this outlet — deliveries post here in transit.
                      </DocText>
                    )}
                  </DocCell>
                </DocRow>
              )}
              <DocSection title="Contact Information" />
              <DocRow>
                <DocCell label="Email" htmlFor="cust-email">
                  <Input id="cust-email" type={ro ? 'text' : 'email'} value={form.email} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </DocCell>
                <DocCell label="Phone" htmlFor="cust-phone">
                  <Input id="cust-phone" value={form.phone} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </DocCell>
              </DocRow>
              {ro && activeCustomer && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeCustomer.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeCustomer.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeCustomer.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeCustomer.updatedAt) },
                ]} />
              )}
              {ro && activeCustomer && <ChangeHistory type="CUSTOMER" id={activeCustomer.id} refreshKey={activeCustomer.updatedAt} />}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {hasPermission('UPDATE_CUSTOMER') && (
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
                {isVisible('type') && <th className="text-left py-2 px-4 font-medium">Type</th>}
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
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No customers match your search/filters.' : 'No customers to display.'}
                  </td>
                </tr>
              ) : (
                customers.map((customer, i) => (
                  <tr
                    key={customer.id}
                    onClick={() => { setActiveIndex(i); openView(customer) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{customer.companyName}</td>}
                    {isVisible('code') && <td className="py-2 px-4 font-mono text-xs">{customer.code ?? '—'}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{customer.name}</td>}
                    {isVisible('type') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{TYPE_LABELS[customer.type]}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          customer.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {customer.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(customer.createdBy)}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(customer.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(customer)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(customer)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteCustomer && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(customer)}>
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
