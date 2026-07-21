import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
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
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create' | 'edit'

interface CompanyInfo {
  id: number
  name: string
}

interface User {
  id: number
  username: string
  displayName: string | null
  email: string
  roles: string[]
  roleIds: number[]
  companies: CompanyInfo[]
}

interface Role {
  id: number
  name: string
  displayName: string | null
}

type UserForm = {
  username: string
  displayName: string
  email: string
  password: string
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'companies', label: 'Companies' })
  columns.push(
    { key: 'displayName', label: 'Display Name' },
    { key: 'username', label: 'Username' },
    { key: 'email', label: 'Email' },
    { key: 'roles', label: 'Roles' },
  )
  return columns
}

function emptyForm(): UserForm {
  return { username: '', displayName: '', email: '', password: '' }
}

function userSearchText(user: User): string {
  return [user.username, user.displayName ?? '', user.email, ...user.roles, ...user.companies.map(c => c.name)].join(' ')
}

// ── Company selector (only shown to SUPER_ADMIN) ──────────────────────────────
function CompanyCheckboxes({
  allCompanies,
  selectedIds,
  onChange,
  readOnly,
}: {
  allCompanies: CompanyInfo[]
  selectedIds: Set<number>
  onChange: (id: number) => void
  readOnly: boolean
}) {
  if (readOnly) {
    const selected = allCompanies.filter(c => selectedIds.has(c.id))
    return (
      <div className="space-y-1.5">
        <Label>Companies</Label>
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 py-2 text-sm min-h-[2.5rem]">
          {selected.length > 0 ? selected.map(c => c.name).join(', ') : '—'}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Label>Companies</Label>
      <div className="max-h-36 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-3 space-y-2">
        {allCompanies.map(c => (
          <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.has(c.id)}
              onChange={() => onChange(c.id)}
              className="accent-[hsl(var(--primary))]"
            />
            {c.name}
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Roles selector ────────────────────────────────────────────────────────────
function RolesField({
  allRoles,
  selectedIds,
  onToggle,
  readOnly,
  userRoleNames,
}: {
  allRoles: Role[]
  selectedIds: Set<number>
  onToggle: (id: number) => void
  readOnly: boolean
  userRoleNames?: string[]
}) {
  if (readOnly) {
    return (
      <div className="space-y-1.5">
        <Label>Roles</Label>
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 py-2 text-sm min-h-[2.5rem]">
          {userRoleNames && userRoleNames.length > 0 ? userRoleNames.join(', ') : '—'}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Label>Roles</Label>
      <div className="max-h-36 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-3 space-y-2">
        {allRoles.map(role => (
          <label key={role.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.has(role.id)}
              onChange={() => onToggle(role.id)}
              className="accent-[hsl(var(--primary))]"
            />
            {role.displayName ?? role.name}
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function UsersPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const { items: users, page, setPage, totalPages, totalElements, reload } = usePagedList<User>('/users', {
    onError: () => toast('Failed to load users.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: userSearchText,
  })
  const [allRoles, setAllRoles]         = useState<Role[]>([])
  const [allCompanies, setAllCompanies] = useState<CompanyInfo[]>([])

  const [open, setOpen]               = useState(false)
  const [mode, setMode]               = useState<FormMode>('view')
  const [activeUser, setActiveUser]   = useState<User | null>(null)
  const [form, setForm]               = useState<UserForm>(emptyForm())
  const [roleIds, setRoleIds]         = useState<Set<number>>(new Set())
  const [companyIds, setCompanyIds]   = useState<Set<number>>(new Set())
  const [loading, setLoading]         = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('users')
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_USER')
  const canUpdate = hasPermission('UPDATE_USER')
  const canDeleteUser = hasPermission('DELETE_USER')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: users,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteUser ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteUser,
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  useEffect(() => {
    fetchAllContent<Role>('/roles')
      .then(data => setAllRoles(data.filter(r => r.name !== 'SUPER_ADMIN')))
      .catch(() => toast('Failed to load roles.', 'error'))

    if (isSuperAdmin) {
      fetchAllContent<CompanyInfo>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function toggleSet(prev: Set<number>, id: number): Set<number> {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  }

  function openView(user: User) {
    setActiveUser(user)
    const nextForm = { username: user.username, displayName: user.displayName ?? '', email: user.email, password: '' }
    const nextRoleIds = new Set(user.roleIds)
    const nextCompanyIds = new Set(user.companies.map(c => c.id))
    setForm(nextForm)
    setRoleIds(nextRoleIds)
    setCompanyIds(nextCompanyIds)
    markClean({ form: nextForm, roleIds: nextRoleIds, companyIds: nextCompanyIds })
    setMode('view')
    setOpen(true)
  }

  function openEdit(user: User) {
    setActiveUser(user)
    const nextForm = { username: user.username, displayName: user.displayName ?? '', email: user.email, password: '' }
    const nextRoleIds = new Set(user.roleIds)
    const nextCompanyIds = isSuperAdmin
      ? new Set(user.companies.map(c => c.id))
      : activeCompanyId ? new Set([activeCompanyId]) : new Set<number>()
    setForm(nextForm)
    setRoleIds(nextRoleIds)
    setCompanyIds(nextCompanyIds)
    markClean({ form: nextForm, roleIds: nextRoleIds, companyIds: nextCompanyIds })
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveUser(null)
    const nextForm = emptyForm()
    const nextRoleIds = new Set<number>()
    const nextCompanyIds = isSuperAdmin ? new Set<number>() : activeCompanyId ? new Set([activeCompanyId]) : new Set<number>()
    setForm(nextForm)
    setRoleIds(nextRoleIds)
    setCompanyIds(nextCompanyIds)
    markClean({ form: nextForm, roleIds: nextRoleIds, companyIds: nextCompanyIds })
    setMode('create')
    setOpen(true)
  }

  function requestClose() {
    guardedClose({ form, roleIds, companyIds }, () => setOpen(false))
  }

  function switchToEdit() {
    if (!activeUser) return
    setCompanyIds(
      isSuperAdmin
        ? new Set(activeUser.companies.map(c => c.id))
        : activeCompanyId ? new Set([activeCompanyId]) : new Set()
    )
    setMode('edit')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!window.confirm(mode === 'create' ? `Create user "${form.username}"?` : `Save changes to user "${form.username}"?`)) return
    setLoading(true)
    try {
      if (mode === 'create') {
        const body = { ...form, companyIds: Array.from(companyIds) }
        await apiFetch<User>('/users', { method: 'POST', body: JSON.stringify(body) })
        toast('User created successfully.', 'success')
      } else {
        const body = {
          username: form.username,
          displayName: form.displayName,
          email: form.email,
          roleIds: Array.from(roleIds),
          companyIds: Array.from(companyIds),
        }
        await apiFetch<User>(`/users/${activeUser!.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        toast('User updated successfully.', 'success')
      }
      setOpen(false)
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create user.' : 'Failed to update user.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(user: User) {
    if (!window.confirm(`Delete user "${user.username}"?`)) return
    try {
      await apiFetch(`/users/${user.id}`, { method: 'DELETE' })
      toast('User deleted.', 'success')
      reload()
    } catch {
      toast('Failed to delete user.', 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<User>(qs ? `/users?${qs}` : '/users', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(u => userSearchText(u).toLowerCase().includes(term)) : all
    const rows = matching.map(u => ({
      displayName: u.displayName ?? '',
      username: u.username,
      email: u.email,
      roles: u.roles.join(', '),
      companies: u.companies.map(c => c.name).join(', '),
    }))
    exportToXlsx('users', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const ro = mode === 'view'
  const dialogTitle = mode === 'view' ? 'User Details' : mode === 'create' ? 'New User' : 'Edit User'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Users</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search users… (/)"
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
              New User
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">N</kbd>
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={v => (v ? setOpen(true) : requestClose())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" onFocusOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="form-username">Username</Label>
              <Input id="form-username" value={form.username} readOnly={ro || mode === 'edit'} autoFocus
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required={!ro} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="form-displayName">Display Name</Label>
              <Input id="form-displayName" value={form.displayName} readOnly={ro}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="form-email">Email</Label>
              <Input id="form-email" type={ro ? 'text' : 'email'} value={form.email} readOnly={ro}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required={!ro} />
            </div>
            {mode === 'create' && (
              <div className="space-y-1.5">
                <Label htmlFor="form-password">Password</Label>
                <Input id="form-password" type="password" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
              </div>
            )}

            {mode !== 'create' && (
              <RolesField
                allRoles={allRoles}
                selectedIds={roleIds}
                onToggle={id => setRoleIds(prev => toggleSet(prev, id))}
                readOnly={ro}
                userRoleNames={activeUser?.roles}
              />
            )}

            {isSuperAdmin ? (
              <CompanyCheckboxes
                allCompanies={allCompanies}
                selectedIds={companyIds}
                onChange={id => setCompanyIds(prev => toggleSet(prev, id))}
                readOnly={ro}
              />
            ) : (
              <div className="space-y-1.5">
                <Label>Company</Label>
                {ro ? (
                  <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 py-2 text-sm min-h-[2.5rem]">
                    {activeUser?.companies.map(c => c.name).join(', ') || '—'}
                  </div>
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] px-1">
                    {mode === 'create'
                      ? 'User will be added to your current company.'
                      : 'User will remain in your current company.'}
                  </p>
                )}
              </div>
            )}

            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {hasPermission('UPDATE_USER') && (
                    <Button type="button" onClick={switchToEdit}>Edit</Button>
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
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="pt-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {showCompanyColumn && isVisible('companies') && <th className="text-left py-2 px-4 font-medium">Companies</th>}
                {isVisible('displayName') && <th className="text-left py-2 px-4 font-medium">Display Name</th>}
                {isVisible('username') && <th className="text-left py-2 px-4 font-medium">Username</th>}
                {isVisible('email') && <th className="text-left py-2 px-4 font-medium">Email</th>}
                {isVisible('roles') && <th className="text-left py-2 px-4 font-medium">Roles</th>}
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
              {users.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No users match your search/filters.' : 'No users to display.'}
                  </td>
                </tr>
              ) : (
                users.map((user, i) => (
                  <tr
                    key={user.id}
                    onClick={() => { setActiveIndex(i); openView(user) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('companies') && (
                      <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                        {user.companies?.map(c => c.name).join(', ') || '—'}
                      </td>
                    )}
                    {isVisible('displayName') && <td className="py-2 px-4">{user.displayName ?? '—'}</td>}
                    {isVisible('username') && <td className="py-2 px-4">{user.username}</td>}
                    {isVisible('email') && <td className="py-2 px-4">{user.email}</td>}
                    {isVisible('roles') && <td className="py-2 px-4">{user.roles.join(', ') || '—'}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(user)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteUser && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(user)}>
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
