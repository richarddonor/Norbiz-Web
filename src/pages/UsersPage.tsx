import { useState, useEffect, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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

function emptyForm(): UserForm {
  return { username: '', displayName: '', email: '', password: '' }
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
  const { hasPermission, activeCompanyId } = useAuth()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')

  const [users, setUsers]               = useState<User[]>([])
  const [allRoles, setAllRoles]         = useState<Role[]>([])
  const [allCompanies, setAllCompanies] = useState<CompanyInfo[]>([])

  const [open, setOpen]               = useState(false)
  const [mode, setMode]               = useState<FormMode>('view')
  const [activeUser, setActiveUser]   = useState<User | null>(null)
  const [form, setForm]               = useState<UserForm>(emptyForm())
  const [roleIds, setRoleIds]         = useState<Set<number>>(new Set())
  const [companyIds, setCompanyIds]   = useState<Set<number>>(new Set())
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    apiFetch<User[]>('/users')
      .then(setUsers)
      .catch(() => toast('Failed to load users.', 'error'))

    apiFetch<Role[]>('/roles')
      .then(data => setAllRoles(data.filter(r => r.name !== 'SUPER_ADMIN')))
      .catch(() => toast('Failed to load roles.', 'error'))

    if (isSuperAdmin) {
      apiFetch<CompanyInfo[]>('/companies')
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
    setForm({ username: user.username, displayName: user.displayName ?? '', email: user.email, password: '' })
    setRoleIds(new Set(user.roleIds))
    setCompanyIds(new Set(user.companies.map(c => c.id)))
    setMode('view')
    setOpen(true)
  }

  function openEdit(user: User) {
    setActiveUser(user)
    setForm({ username: user.username, displayName: user.displayName ?? '', email: user.email, password: '' })
    setRoleIds(new Set(user.roleIds))
    setCompanyIds(
      isSuperAdmin
        ? new Set(user.companies.map(c => c.id))
        : activeCompanyId ? new Set([activeCompanyId]) : new Set()
    )
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveUser(null)
    setForm(emptyForm())
    setRoleIds(new Set())
    setCompanyIds(
      isSuperAdmin ? new Set() : activeCompanyId ? new Set([activeCompanyId]) : new Set()
    )
    setMode('create')
    setOpen(true)
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
    setLoading(true)
    try {
      if (mode === 'create') {
        const body = { ...form, companyIds: Array.from(companyIds) }
        const created = await apiFetch<User>('/users', { method: 'POST', body: JSON.stringify(body) })
        setUsers(prev => [...prev, created])
        toast('User created successfully.', 'success')
      } else {
        const body = {
          username: form.username,
          displayName: form.displayName,
          email: form.email,
          roleIds: Array.from(roleIds),
          companyIds: Array.from(companyIds),
        }
        const updated = await apiFetch<User>(`/users/${activeUser!.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
        toast('User updated successfully.', 'success')
      }
      setOpen(false)
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
      setUsers(prev => prev.filter(u => u.id !== user.id))
      toast('User deleted.', 'success')
    } catch {
      toast('Failed to delete user.', 'error')
    }
  }

  const ro = mode === 'view'
  const dialogTitle = mode === 'view' ? 'User Details' : mode === 'create' ? 'New User' : 'Edit User'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        {hasPermission('CREATE_USER') && (
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" />
            New User
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" onFocusOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="form-username">Username</Label>
              <Input id="form-username" value={form.username} readOnly={ro || mode === 'edit'}
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
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_USER') && (
                    <Button type="button" onClick={switchToEdit}>Edit</Button>
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
          {users.length === 0 ? (
            <p className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">No users to display.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-left py-2 px-4 font-medium">Display Name</th>
                  <th className="text-left py-2 px-4 font-medium">Username</th>
                  <th className="text-left py-2 px-4 font-medium">Email</th>
                  <th className="text-left py-2 px-4 font-medium">Roles</th>
                  <th className="text-left py-2 px-4 font-medium">Companies</th>
                  <th className="py-2 px-4" />
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr
                    key={user.id}
                    onClick={() => openView(user)}
                    className="border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors"
                  >
                    <td className="py-2 px-4">{user.displayName ?? '—'}</td>
                    <td className="py-2 px-4">{user.username}</td>
                    <td className="py-2 px-4">{user.email}</td>
                    <td className="py-2 px-4">{user.roles.join(', ') || '—'}</td>
                    <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                      {user.companies?.map(c => c.name).join(', ') || '—'}
                    </td>
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(user)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {hasPermission('UPDATE_USER') && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {hasPermission('DELETE_USER') && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(user)}>
                            <Trash2 className="w-4 h-4 text-[hsl(var(--destructive))]" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}