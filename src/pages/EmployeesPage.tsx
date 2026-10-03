import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocCheck, DocSection, DocSignatures } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { TagCheckboxes } from '@/components/TagCheckboxes'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, type LookupOption } from '@/lib/lookups'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create' | 'edit'

const EMPLOYEE_TAGS = [{ value: 'AGENT', label: 'Agent' }]

interface CompanyOption {
  id: number
  name: string
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

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'employeeCode', label: 'Employee Code' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'active', label: 'Active' },
    { key: 'tags', label: 'Tags' },
    { key: 'username', label: 'Linked User' },
  )
  return columns
}

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
  const { hasPermission, activeCompanyId, activeCompany, showCompanyColumn, companies } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const isFiltering = !!debouncedSearch.trim()

  const inRecordTab = useIsRecordTab()
  const { items: employees, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<Employee>('/employees', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load employees.', 'error'),
    search: debouncedSearch,
    searchText: employeeSearchText,
  })

  const [mode, setMode]                   = useState<FormMode>('view')
  const rec = useRecordTab<Employee>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Employee>(`/employees/${id}`),
  })
  const [activeEmployee, setActiveEmployee] = useState<Employee | null>(null)
  const [form, setForm]                   = useState<EmployeeForm>(emptyForm())
  const [companyId, setCompanyId]         = useState<number | ''>('')
  // Linkable users are members of the employee's company: the picked one on create, the record's own on edit.
  const userCompanyId = (mode === 'create' ? companyId : activeEmployee?.companyId) || activeCompanyId
  const allUsers = useLookup<LookupOption>('users', userCompanyId, { enabled: inRecordTab && mode !== 'view', onError: () => toast('Failed to load users.', 'error') })
  const [loading, setLoading]             = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('employees')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()

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

  function openView(employee: Employee) {
    if (!rec.isRecordTab) return rec.open('view', employee)
    setActiveEmployee(employee)
    const nextForm = employeeToForm(employee)
    setForm(nextForm)
    markClean({ form: nextForm, companyId })
    setMode('view')
  }

  function openEdit(employee: Employee) {
    if (!rec.isRecordTab) return rec.open('edit', employee)
    setActiveEmployee(employee)
    const nextForm = employeeToForm(employee)
    setForm(nextForm)
    markClean({ form: nextForm, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveEmployee(null)
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
    if (!window.confirm(mode === 'create' ? `Create employee "${form.firstName} ${form.lastName}"?` : `Save changes to employee "${form.firstName} ${form.lastName}"?`)) return
    setLoading(true)
    try {
      const submitCompanyId = mode === 'create' ? companyId : activeEmployee!.companyId
      const body = {
        companyId: submitCompanyId,
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
      rec.close()
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
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete employee.'), 'error')
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

  const recordName = activeEmployee ? `${activeEmployee.lastName}, ${activeEmployee.firstName}` : ''
  const tabTitle = mode === 'create' ? 'New Employee' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Employee'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
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
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} isVisible={isVisible} onToggle={toggleColumn} />
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
                    id="emp-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? activeCompany?.name : activeEmployee?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={setCompanyId}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Employee Record">
                  <DocRow>
                    <DocCell label="Employee No." htmlFor="emp-code">
                      <Input id="emp-code" value={form.employeeCode} readOnly={ro} autoFocus={!(mode === 'create' && showCompanyColumn)}
                        onChange={e => setForm(f => ({ ...f, employeeCode: e.target.value }))} required={!ro} />
                    </DocCell>
                    <DocCell label="Status">
                      <DocCheck id="emp-active" label="Active" checked={form.active} disabled={ro}
                        onChange={active => setForm(f => ({ ...f, active }))} />
                    </DocCell>
                  </DocRow>
                </DocHeader>
              </DocLetterhead>
              <DocSection title="Personal Information" />
              <DocRow>
                <DocCell label="Last Name" htmlFor="emp-last">
                  <Input id="emp-last" value={form.lastName} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} required={!ro} />
                </DocCell>
                <DocCell label="First Name" htmlFor="emp-first">
                  <Input id="emp-first" value={form.firstName} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} required={!ro} />
                </DocCell>
              </DocRow>
              <DocSection title="Contact Information" />
              <DocRow>
                <DocCell label="Email" htmlFor="emp-email">
                  <Input id="emp-email" type={ro ? 'text' : 'email'} value={form.email} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </DocCell>
                <DocCell label="Phone" htmlFor="emp-phone">
                  <Input id="emp-phone" value={form.phone} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </DocCell>
              </DocRow>
              <DocSection title="System Access & Classification" />
              <DocRow>
                <DocCell label="Linked User" htmlFor="emp-user">
                  {ro ? (
                    <Input id="emp-user" value={activeEmployee?.username ? resolveDisplayName(activeEmployee.username) : '—'} readOnly />
                  ) : (
                    <SearchableSelect
                      id="emp-user"
                      value={form.userId === '' ? '' : String(form.userId)}
                      onChange={v => setForm(f => ({ ...f, userId: v ? Number(v) : '' }))}
                      options={allUsers.map(u => ({ value: String(u.id), label: u.name || u.code || '' }))}
                      placeholder="None — not a Norbiz user"
                    />
                  )}
                </DocCell>
                <TagCheckboxes label="Tags" options={EMPLOYEE_TAGS} selected={form.tags} readOnly={ro}
                  onToggle={value => setForm(f => {
                    const next = new Set(f.tags)
                    if (next.has(value)) next.delete(value)
                    else next.add(value)
                    return { ...f, tags: next }
                  })}
                />
              </DocRow>
              {ro && activeEmployee && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeEmployee.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeEmployee.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeEmployee.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeEmployee.updatedAt) },
                ]} />
              )}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {hasPermission('UPDATE_EMPLOYEE') && (
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
                {isVisible('employeeCode') && <th className="text-left py-2 px-4 font-medium">Employee Code</th>}
                {isVisible('firstName') && <th className="text-left py-2 px-4 font-medium">First Name</th>}
                {isVisible('lastName') && <th className="text-left py-2 px-4 font-medium">Last Name</th>}
                {isVisible('email') && <th className="text-left py-2 px-4 font-medium">Email</th>}
                {isVisible('phone') && <th className="text-left py-2 px-4 font-medium">Phone</th>}
                {isVisible('active') && <th className="text-left py-2 px-4 font-medium">Active</th>}
                {isVisible('tags') && <th className="text-left py-2 px-4 font-medium">Tags</th>}
                {isVisible('username') && <th className="text-left py-2 px-4 font-medium">Linked User</th>}
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
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{employee.companyName}</td>}
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
      </>)}
    </div>
  )
}
