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

interface Role {
  id: number
  name: string
  displayName: string | null
  permissions: string[]
}

interface Permission {
  id: number
  name: string
  description: string | null
}

type RoleForm = {
  name: string
  displayName: string
  selectedPermissions: Set<string>
}

function emptyForm(): RoleForm {
  return { name: '', displayName: '', selectedPermissions: new Set() }
}

function roleToForm(role: Role): RoleForm {
  return {
    name: role.name,
    displayName: role.displayName ?? '',
    selectedPermissions: new Set(role.permissions),
  }
}

// ── Permissions field ─────────────────────────────────────────────────────────
function PermissionsField({
  allPermissions,
  selected,
  onToggle,
  readOnly,
  search,
  onSearchChange,
}: {
  allPermissions: Permission[]
  selected: Set<string>
  onToggle: (name: string) => void
  readOnly: boolean
  search: string
  onSearchChange: (v: string) => void
}) {
  const term = search.toLowerCase()
  const filtered = allPermissions.filter(p =>
    p.name.toLowerCase().includes(term) ||
    (p.description ?? '').toLowerCase().includes(term)
  )

  function label(p: Permission) {
    return p.description ?? p.name
  }

  return (
    <div className="space-y-2">
      <Label>Permissions</Label>
      {!readOnly && (
        <Input
          placeholder="Search permissions..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />
      )}
      <div className="max-h-48 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-3 space-y-2">
        {readOnly ? (
          selected.size > 0
            ? allPermissions
                .filter(p => selected.has(p.name))
                .map(p => (
                  <div key={p.name} className="text-sm py-0.5">{label(p)}</div>
                ))
            : <div className="text-sm text-[hsl(var(--muted-foreground))]">No permissions assigned.</div>
        ) : (
          filtered.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(p.name)}
                onChange={() => onToggle(p.name)}
                className="accent-[hsl(var(--primary))]"
              />
              {label(p)}
            </label>
          ))
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function RolesPage() {
  const { toast } = useToast()
  const { hasPermission } = useAuth()

  const [roles, setRoles]               = useState<Role[]>([])
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])

  const [open, setOpen]               = useState(false)
  const [mode, setMode]               = useState<FormMode>('view')
  const [activeRole, setActiveRole]   = useState<Role | null>(null)
  const [form, setForm]               = useState<RoleForm>(emptyForm())
  const [permSearch, setPermSearch]   = useState('')
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    apiFetch<Role[]>('/roles')
      .then(data => setRoles(data.filter(r => r.name !== 'SUPER_ADMIN')))
      .catch(() => toast('Failed to load roles.', 'error'))

    apiFetch<Permission[]>('/permissions')
      .then(setAllPermissions)
      .catch(() => toast('Failed to load permissions.', 'error'))
  }, [])

  function openView(role: Role) {
    setActiveRole(role)
    setForm(roleToForm(role))
    setPermSearch('')
    setMode('view')
    setOpen(true)
  }

  function openEdit(role: Role) {
    setActiveRole(role)
    setForm(roleToForm(role))
    setPermSearch('')
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveRole(null)
    setForm(emptyForm())
    setPermSearch('')
    setMode('create')
    setOpen(true)
  }

  function switchToEdit() {
    setMode('edit')
  }

  function togglePermission(name: string) {
    setForm(prev => {
      const next = new Set(prev.selectedPermissions)
      next.has(name) ? next.delete(name) : next.add(name)
      return { ...prev, selectedPermissions: next }
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'create') {
        const created = await apiFetch<Role>('/roles', {
          method: 'POST',
          body: JSON.stringify({ name: form.name, displayName: form.displayName, permissionIds: [] }),
        })
        setRoles(prev => [...prev, created])
        toast('Role created successfully.', 'success')
      } else {
        const permissionIds = allPermissions
          .filter(p => form.selectedPermissions.has(p.name))
          .map(p => p.id)

        const updated = await apiFetch<Role>(`/roles/${activeRole!.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: form.name, displayName: form.displayName, permissionIds }),
        })
        setRoles(prev => prev.map(r => r.id === updated.id ? updated : r))
        toast('Role updated successfully.', 'success')
      }
      setOpen(false)
    } catch {
      toast(mode === 'create' ? 'Failed to create role.' : 'Failed to update role.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(role: Role) {
    if (!window.confirm(`Delete role "${role.displayName ?? role.name}"? It will be removed from all users.`)) return
    try {
      await apiFetch(`/roles/${role.id}`, { method: 'DELETE' })
      setRoles(prev => prev.filter(r => r.id !== role.id))
      toast('Role deleted.', 'success')
    } catch {
      toast('Failed to delete role.', 'error')
    }
  }

  const ro = mode === 'view'
  const dialogTitle = mode === 'view' ? 'Role Details' : mode === 'create' ? 'New Role' : 'Edit Role'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Roles</h1>
        {hasPermission('CREATE_ROLE') && (
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" />
            New Role
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
              <Label htmlFor="form-name">Role Name</Label>
              <Input id="form-name" value={form.name} readOnly={ro || mode === 'edit'}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required={!ro} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="form-displayName">Display Name</Label>
              <Input id="form-displayName" value={form.displayName} readOnly={ro}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} />
            </div>

            {(mode === 'edit' || mode === 'view') && (
              <PermissionsField
                allPermissions={allPermissions}
                selected={form.selectedPermissions}
                onToggle={togglePermission}
                readOnly={ro}
                search={permSearch}
                onSearchChange={setPermSearch}
              />
            )}

            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_ROLE') && (
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
          {roles.length === 0 ? (
            <p className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">No roles to display.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-left py-2 px-4 font-medium">Display Name</th>
                  <th className="text-left py-2 px-4 font-medium">Name</th>
                  <th className="text-left py-2 px-4 font-medium">Permissions</th>
                  <th className="py-2 px-4" />
                </tr>
              </thead>
              <tbody>
                {roles.map(role => (
                  <tr
                    key={role.id}
                    onClick={() => openView(role)}
                    className="border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors"
                  >
                    <td className="py-2 px-4">{role.displayName ?? '—'}</td>
                    <td className="py-2 px-4">{role.name}</td>
                    <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                      {role.permissions.length > 0 ? role.permissions.join(', ') : '—'}
                    </td>
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(role)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {hasPermission('UPDATE_ROLE') && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(role)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {hasPermission('DELETE_ROLE') && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(role)}>
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