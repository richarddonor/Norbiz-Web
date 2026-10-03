import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, FileDown, KeyRound } from 'lucide-react'
import { apiFetch, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { DocLetterhead } from '@/components/CompanyField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocCheck, DocSection } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS } from '@/components/RecordTab'
import { ResetPasswordDialog } from '@/components/ResetPasswordDialog'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, type LookupOption } from '@/lib/lookups'
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

// Row-actions cell, pinned to the table's right edge. Needs its own opaque background so
// scrolled columns pass underneath instead of showing through.
const STICKY_ACTIONS = 'sticky right-0 py-2 px-4 bg-[hsl(var(--card))]'

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
      <DocCell label="Companies">
        <DocText className="font-semibold">{selected.map(c => c.name).join(', ')}</DocText>
      </DocCell>
    )
  }
  return (
    <DocCell label="Companies">
      <div className="max-h-36 overflow-y-auto pb-1">
        {allCompanies.map(c => (
          <DocCheck key={c.id} id={`user-company-${c.id}`} label={c.name}
            checked={selectedIds.has(c.id)} onChange={() => onChange(c.id)} />
        ))}
      </div>
    </DocCell>
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
      <DocCell label="Roles">
        <DocText>{userRoleNames?.join(', ')}</DocText>
      </DocCell>
    )
  }
  return (
    <DocCell label="Roles">
      <div className="max-h-36 overflow-y-auto pb-1">
        {allRoles.map(role => (
          <DocCheck key={role.id} id={`user-role-${role.id}`} label={role.displayName ?? role.name}
            checked={selectedIds.has(role.id)} onChange={() => onToggle(role.id)} />
        ))}
      </div>
    </DocCell>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function UsersPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, activeCompany, showCompanyColumn } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const inRecordTab = useIsRecordTab()
  // Roles are system-wide, so their lookup isn't company-scoped.
  const roleOptions = useLookup<LookupOption>('roles', null, { global: true, enabled: inRecordTab, onError: () => toast('Failed to load roles.', 'error') })
  const allRoles = useMemo<Role[]>(
    () => roleOptions.filter(r => r.code !== 'SUPER_ADMIN').map(r => ({ id: r.id, name: r.code ?? '', displayName: r.name })),
    [roleOptions])
  const { items: users, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<User>('/users', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load users.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: userSearchText,
  })
  const [allCompanies, setAllCompanies] = useState<CompanyInfo[]>([])

  const [mode, setMode]               = useState<FormMode>('view')
  const rec = useRecordTab<User>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => fetchAllContent<User>('/users', 100000).then(all => { const found = all.find(r => String(r.id) === id); if (!found) throw new Error('not found'); return found }),
  })
  const [activeUser, setActiveUser]   = useState<User | null>(null)
  const [form, setForm]               = useState<UserForm>(emptyForm())
  const [roleIds, setRoleIds]         = useState<Set<number>>(new Set())
  const [companyIds, setCompanyIds]   = useState<Set<number>>(new Set())
  const [loading, setLoading]         = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('users')
  const { markClean, guardedClose } = useDirtyGuard()
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null)

  const canCreate = hasPermission('CREATE_USER')
  const canUpdate = hasPermission('UPDATE_USER')
  const canDeleteUser = hasPermission('DELETE_USER')
  const canResetPassword = hasPermission('RESET_USER_PASSWORD')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: users,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteUser ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteUser,
    enabled: !inRecordTab && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
    { key: 'r', handler: () => reload() },
  ], !inRecordTab && zone === 'content')

  useEffect(() => {
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
    if (!rec.isRecordTab) return rec.open('view', user)
    setActiveUser(user)
    const nextForm = { username: user.username, displayName: user.displayName ?? '', email: user.email, password: '' }
    const nextRoleIds = new Set(user.roleIds)
    const nextCompanyIds = new Set(user.companies.map(c => c.id))
    setForm(nextForm)
    setRoleIds(nextRoleIds)
    setCompanyIds(nextCompanyIds)
    markClean({ form: nextForm, roleIds: nextRoleIds, companyIds: nextCompanyIds })
    setMode('view')
  }

  function openEdit(user: User) {
    if (!rec.isRecordTab) return rec.open('edit', user)
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
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveUser(null)
    const nextForm = emptyForm()
    const nextRoleIds = new Set<number>()
    const nextCompanyIds = isSuperAdmin ? new Set<number>() : activeCompanyId ? new Set([activeCompanyId]) : new Set<number>()
    setForm(nextForm)
    setRoleIds(nextRoleIds)
    setCompanyIds(nextCompanyIds)
    markClean({ form: nextForm, roleIds: nextRoleIds, companyIds: nextCompanyIds })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ form, roleIds, companyIds }, () => rec.close())
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
      rec.close()
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
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete user.'), 'error')
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
  const recordName = activeUser ? activeUser.displayName || activeUser.username : ''
  const tabTitle = mode === 'create' ? 'New User' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'User'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Users</h1>
        <div className="flex flex-wrap items-center gap-2">
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
                isSuperAdmin ? (
                  <CompanyCheckboxes
                    allCompanies={allCompanies}
                    selectedIds={companyIds}
                    onChange={id => setCompanyIds(prev => toggleSet(prev, id))}
                    readOnly={ro}
                  />
                ) : (
                  <DocCell label="Company">
                    <DocText className="font-semibold">
                      {ro ? activeUser?.companies.map(c => c.name).join(', ') : activeCompany?.name}
                    </DocText>
                    {!ro && (
                      <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">
                        {mode === 'create'
                          ? 'User will be added to your current company.'
                          : 'User will remain in your current company.'}
                      </p>
                    )}
                  </DocCell>
                )
              }>
                <DocHeader title="User Account">
                  <DocRow>
                    <DocCell label="Username" htmlFor="form-username">
                      <Input id="form-username" value={form.username} readOnly={ro || mode === 'edit'} autoFocus
                        onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required={!ro} />
                    </DocCell>
                  </DocRow>
                </DocHeader>
              </DocLetterhead>
              <DocRow>
                <DocCell label="Display Name" htmlFor="form-displayName">
                  <Input id="form-displayName" value={form.displayName} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} />
                </DocCell>
                <DocCell label="Email" htmlFor="form-email">
                  <Input id="form-email" type={ro ? 'text' : 'email'} value={form.email} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required={!ro} />
                </DocCell>
              </DocRow>
              {mode === 'create' && (
                <DocRow>
                  <DocCell label="Initial Password" htmlFor="form-password">
                    <Input id="form-password" type="password" value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
                  </DocCell>
                </DocRow>
              )}
              {mode !== 'create' && (
                <>
                  <DocSection title="Access" />
                  <DocRow>
                    <RolesField
                      allRoles={allRoles}
                      selectedIds={roleIds}
                      onToggle={id => setRoleIds(prev => toggleSet(prev, id))}
                      readOnly={ro}
                      userRoleNames={activeUser?.roles}
                    />
                  </DocRow>
                </>
              )}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  {canResetPassword && activeUser && (
                    <Button type="button" variant="outline" onClick={() => setResetPasswordUser(activeUser)}>
                      <KeyRound className="w-4 h-4" />
                      Reset Password
                    </Button>
                  )}
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
        </RecordSheet>
      )}

      {!inRecordTab && (<>

      <Card>
        <CardContent className="pt-6">
          {/* Scroll wide tables inside the card, with the actions column pinned right, so
              Edit/Delete stay reachable on narrow windows (a multi-company session adds the
              Companies column, which is what pushes this table past ~1140px). */}
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {showCompanyColumn && isVisible('companies') && <th className="text-left py-2 px-4 font-medium">Companies</th>}
                {isVisible('displayName') && <th className="text-left py-2 px-4 font-medium">Display Name</th>}
                {isVisible('username') && <th className="text-left py-2 px-4 font-medium">Username</th>}
                {isVisible('email') && <th className="text-left py-2 px-4 font-medium">Email</th>}
                {isVisible('roles') && <th className="text-left py-2 px-4 font-medium">Roles</th>}
                <th className={STICKY_ACTIONS} />
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
                      'group border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
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
                    <td
                      className={cn(STICKY_ACTIONS, 'text-right transition-colors group-hover:bg-[hsl(var(--secondary))]', i === activeIndex && 'bg-[hsl(var(--secondary))]')}
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(user)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canResetPassword && (
                          <Button variant="ghost" size="sm" onClick={() => setResetPasswordUser(user)} title="Reset Password">
                            <KeyRound className="w-4 h-4" />
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
          </div>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
      </>)}

      <ResetPasswordDialog
        open={!!resetPasswordUser}
        onOpenChange={v => !v && setResetPasswordUser(null)}
        userId={resetPasswordUser?.id ?? null}
        username={resetPasswordUser?.username}
      />
    </div>
  )
}
