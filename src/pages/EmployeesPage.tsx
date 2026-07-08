import { useState, useEffect, useRef, type FormEvent } from 'react'
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
import { usePagedList, fetchAllContent } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { TagCheckboxes } from '@/components/TagCheckboxes'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create' | 'edit'

const EMPLOYEE_TAGS = [{ value: 'AGENT', label: 'Agent' }]

interface UserOption {
  id: number
  username: string
  displayName: string | null
}

interface Employee {
  id: number
  companyId: number
  companyName: string
  userId: number | null
  username: string | null
  employeeCode: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  active: boolean
  tags: string[]
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

type EmployeeForm = {
  employeeCode: string
  firstName: string
  lastName: string
  email: string
  phone: string
  active: boolean
  tags: Set<string>
  userId: number | ''
}

const COLUMNS: readonly ColumnDef[] = [
  { key: 'employeeCode', label: 'Employee Code' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'active', label: 'Active' },
  { key: 'tags', label: 'Tags' },
  { key: 'username', label: 'Linked User' },
  { key: 'company', label: 'Company' },
]

function emptyForm(): EmployeeForm {
  return { employeeCode: '', firstName: '', lastName: '', email: '', phone: '', active: true, tags: new Set(), userId: '' }
}

function employeeToForm(e: Employee): EmployeeForm {
  return {
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email ?? '',
    phone: e.phone ?? '',
    active: e.active,
    tags: new Set(e.tags),
    userId: e.userId ?? '',
  }
}

function employeeSearchText(e: Employee): string {
  return [e.employeeCode, e.firstName, e.lastName, e.email ?? '', e.phone ?? '', e.username ?? '', e.companyName, ...e.tags].join(' ')
}

export function EmployeesPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId } = useAuth()
  const { zone } = useContentFocus()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const isFiltering = !!debouncedSearch.trim()

  const { items: employees, page, setPage, totalPages, totalElements, reload } = usePagedList<Employee>('/employees', {
    onError: () => toast('Failed to load employees.', 'error'),
    search: debouncedSearch,
    searchText: employeeSearchText,
  })
  const [allUsers, setAllUsers] = useState<UserOption[]>([])

  const [open, setOpen]                   = useState(false)
  const [mode, setMode]                   = useState<FormMode>('view')
  const [activeEmployee, setActiveEmployee] = useState<Employee | null>(null)
  const [form, setForm]                   = useState<EmployeeForm>(emptyForm())
  const [loading, setLoading]             = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('employees')

  const canCreate = hasPermission('CREATE_EMPLOYEE')
  const canUpdate = hasPermission('UPDATE_EMPLOYEE')
  const canDeleteEmployee = hasPermission('DELETE_EMPLOYEE')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: employees,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteEmployee ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteEmployee,
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  useEffect(() => {
    fetchAllContent<UserOption>('/users')
      .then(setAllUsers)
      .catch(() => toast('Failed to load users.', 'error'))
  }, [])

  function openView(employee: Employee) {
    setActiveEmployee(employee)
    setForm(employeeToForm(employee))
    setMode('view')
    setOpen(true)
  }

  function openEdit(employee: Employee) {
    setActiveEmployee(employee)
    setForm(employeeToForm(employee))
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveEmployee(null)
    setForm(emptyForm())
    setMode('create')
    setOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const companyId = mode === 'create' ? activeCompanyId : activeEmployee!.companyId
      const body = {
        companyId,
        userId: form.userId || null,
        employeeCode: form.employeeCode,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email || null,
        phone: form.phone || null,
        active: form.active,
        tags: Array.from(form.tags),
      }
      if (mode === 'create') {
        await apiFetch<Employee>('/employees', { method: 'POST', body: JSON.stringify(body) })
        toast('Employee created successfully.', 'success')
      } else {
        await apiFetch<Employee>(`/employees/${activeEmployee!.id}`, { method: 'PUT', body: JSON.stringify(body) })
        toast('Employee updated successfully.', 'success')
      }
      setOpen(false)
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create employee.' : 'Failed to update employee.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(employee: Employee) {
    if (!window.confirm(`Delete employee "${employee.firstName} ${employee.lastName}"?`)) return
    try {
      await apiFetch(`/employees/${employee.id}`, { method: 'DELETE' })
      toast('Employee deleted.', 'success')
      reload()
    } catch {
      toast('Failed to delete employee.', 'error')
    }
  }

  async function handleExport() {
    const all = await fetchAllContent<Employee>('/employees', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(e => employeeSearchText(e).toLowerCase().includes(term)) : all
    const rows = matching.map(e => ({
      employeeCode: e.employeeCode,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email ?? '',
      phone: e.phone ?? '',
      active: e.active ? 'Yes' : 'No',
      tags: e.tags.join(', '),
      username: e.username ?? '',
      company: e.companyName,
    }))
    exportToXlsx('employees', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const dialogTitle = mode === 'view' ? 'Employee Details' : mode === 'create' ? 'New Employee' : 'Edit Employee'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Employees</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search employees… (/)"
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
              New Employee
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">N</kbd>
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" onFocusOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="emp-code">Employee Code</Label>
                <Input id="emp-code" value={form.employeeCode} readOnly={ro} autoFocus
                  onChange={e => setForm(f => ({ ...f, employeeCode: e.target.value }))} required={!ro} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-phone">Phone</Label>
                <Input id="emp-phone" value={form.phone} readOnly={ro}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-first">First Name</Label>
                <Input id="emp-first" value={form.firstName} readOnly={ro}
                  onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} required={!ro} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-last">Last Name</Label>
                <Input id="emp-last" value={form.lastName} readOnly={ro}
                  onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} required={!ro} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-email">Email</Label>
              <Input id="emp-email" type={ro ? 'text' : 'email'} value={form.email} readOnly={ro}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-user">Linked User</Label>
              {ro ? (
                <Input id="emp-user" value={activeEmployee?.username ?? '—'} readOnly />
              ) : (
                <select
                  id="emp-user"
                  value={form.userId}
                  onChange={e => setForm(f => ({ ...f, userId: e.target.value ? Number(e.target.value) : '' }))}
                  className="flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">None — not a Norbiz user</option>
                  {allUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.displayName ?? u.username}</option>
                  ))}
                </select>
              )}
            </div>
            <TagCheckboxes label="Tags" options={EMPLOYEE_TAGS} selected={form.tags} readOnly={ro}
              onToggle={value => setForm(f => {
                const next = new Set(f.tags)
                if (next.has(value)) next.delete(value)
                else next.add(value)
                return { ...f, tags: next }
              })}
            />
            <div className="flex items-center gap-2">
              <input
                id="emp-active"
                type="checkbox"
                checked={form.active}
                disabled={ro}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                className="accent-[hsl(var(--primary))]"
              />
              <Label htmlFor="emp-active" className="cursor-pointer">Active</Label>
            </div>

            {ro && activeEmployee && (
              <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                <div className="flex justify-between">
                  <span>Company</span>
                  <span className="text-[hsl(var(--foreground))]">{activeEmployee.companyName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Created by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeEmployee.createdBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Created at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeEmployee.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated by</span>
                  <span className="text-[hsl(var(--foreground))]">{activeEmployee.updatedBy ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last updated at</span>
                  <span className="text-[hsl(var(--foreground))]">{formatDateTime(activeEmployee.updatedAt)}</span>
                </div>
              </div>
            )}

            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_EMPLOYEE') && (
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
                {isVisible('employeeCode') && <th className="text-left py-2 px-4 font-medium">Employee Code</th>}
                {isVisible('firstName') && <th className="text-left py-2 px-4 font-medium">First Name</th>}
                {isVisible('lastName') && <th className="text-left py-2 px-4 font-medium">Last Name</th>}
                {isVisible('email') && <th className="text-left py-2 px-4 font-medium">Email</th>}
                {isVisible('phone') && <th className="text-left py-2 px-4 font-medium">Phone</th>}
                {isVisible('active') && <th className="text-left py-2 px-4 font-medium">Active</th>}
                {isVisible('tags') && <th className="text-left py-2 px-4 font-medium">Tags</th>}
                {isVisible('username') && <th className="text-left py-2 px-4 font-medium">Linked User</th>}
                {isVisible('company') && <th className="text-left py-2 px-4 font-medium">Company</th>}
                <th className="py-2 px-4" />
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No employees match your search.' : 'No employees to display.'}
                  </td>
                </tr>
              ) : (
                employees.map((employee, i) => (
                  <tr
                    key={employee.id}
                    onClick={() => { setActiveIndex(i); openView(employee) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {isVisible('employeeCode') && <td className="py-2 px-4 font-mono text-xs">{employee.employeeCode}</td>}
                    {isVisible('firstName') && <td className="py-2 px-4">{employee.firstName}</td>}
                    {isVisible('lastName') && <td className="py-2 px-4">{employee.lastName}</td>}
                    {isVisible('email') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{employee.email ?? '—'}</td>}
                    {isVisible('phone') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{employee.phone ?? '—'}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          employee.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {employee.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('tags') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{employee.tags.join(', ') || '—'}</td>}
                    {isVisible('username') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{employee.username ?? '—'}</td>}
                    {isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{employee.companyName}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(employee)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(employee)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteEmployee && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(employee)}>
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
