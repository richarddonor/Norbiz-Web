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
type CustomerType = 'CUSTOMER' | 'OUTLET'

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
  const columns: ColumnDef[] = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
  ]
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
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
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const { zone } = useContentFocus()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const { items: customers, page, setPage, totalPages, totalElements, reload } = usePagedList<Customer>('/customers', {
    onError: () => toast('Failed to load customers.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: customerSearchText,
  })

  const [open, setOpen]                   = useState(false)
  const [mode, setMode]                   = useState<FormMode>('view')
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null)
  const [form, setForm]                   = useState<CustomerForm>(emptyForm())
  const [loading, setLoading]             = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('customers')

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
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  function openView(customer: Customer) {
    setActiveCustomer(customer)
    setForm(customerToForm(customer))
    setMode('view')
    setOpen(true)
  }

  function openEdit(customer: Customer) {
    setActiveCustomer(customer)
    setForm(customerToForm(customer))
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveCustomer(null)
    setForm(emptyForm())
    setMode('create')
    setOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const companyId = mode === 'create' ? activeCompanyId : activeCustomer!.companyId
      const body = { companyId, code: form.code || null, name: form.name, type: form.type, email: form.email || null, phone: form.phone || null, active: form.active }
      if (mode === 'create') {
        await apiFetch<Customer>('/customers', { method: 'POST', body: JSON.stringify(body) })
        toast('Customer created successfully.', 'success')
      } else {
        await apiFetch<Customer>(`/customers/${activeCustomer!.id}`, { method: 'PUT', body: JSON.stringify(body) })
        toast('Customer updated successfully.', 'success')
      }
      setOpen(false)
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create customer.' : 'Failed to update customer.', 'error')
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
    } catch {
      toast('Failed to delete customer.', 'error')
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
      createdBy: c.createdBy ?? '',
      updatedAt: formatDateTime(c.updatedAt),
    }))
    exportToXlsx('customers', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const dialogTitle = mode === 'view' ? 'Customer Details' : mode === 'create' ? 'New Customer' : 'Edit Customer'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Customers</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search customers… (/)"
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
              New Customer
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cust-code">Code</Label>
                <Input id="cust-code" value={form.code} readOnly={ro} autoFocus
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder={ro ? undefined : 'e.g. CUST-01'} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-type">Type</Label>
                {ro ? (
                  <Input id="cust-type" value={TYPE_LABELS[form.type]} readOnly />
                ) : (
                  <select
                    id="cust-type"
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as CustomerType }))}
                    required
                    className="flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {CUSTOMER_TYPES.map(t => (
                      <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-name">Name</Label>
              <Input id="cust-name" value={form.name} readOnly={ro}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={ro ? undefined : 'e.g. Acme Retail'} required={!ro} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cust-email">Email</Label>
                <Input id="cust-email" type={ro ? 'text' : 'email'} value={form.email} readOnly={ro}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-phone">Phone</Label>
                <Input id="cust-phone" value={form.phone} readOnly={ro}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="cust-active"
                type="checkbox"
                checked={form.active}
                disabled={ro}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                className="accent-[hsl(var(--primary))]"
              />
              <Label htmlFor="cust-active" className="cursor-pointer">Active</Label>
            </div>

            {ro && activeCustomer && (
              <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                {showCompanyColumn && (
                  <div className="flex justify-between">
                    <span>Company</span>
                    <span className="text-[hsl(var(--foreground))]">{activeCustomer.companyName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Created by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeCustomer.createdBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Created at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeCustomer.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeCustomer.updatedBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeCustomer.updatedAt)}</span>
                </div>
              </div>
            )}

            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_CUSTOMER') && (
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
                {isVisible('code') && <th className="text-left py-2 px-4 font-medium">Code</th>}
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
                {isVisible('type') && <th className="text-left py-2 px-4 font-medium">Type</th>}
                {showCompanyColumn && isVisible('company') && <th className="text-left py-2 px-4 font-medium">Company</th>}
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
                    {isVisible('code') && <td className="py-2 px-4 font-mono text-xs">{customer.code ?? '—'}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{customer.name}</td>}
                    {isVisible('type') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{TYPE_LABELS[customer.type]}</td>}
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{customer.companyName}</td>}
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
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{customer.createdBy ?? '—'}</td>}
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
          </table>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  )
}
