import { useState, useEffect, type FormEvent } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface Role {
  id: number
  name: string
  displayName: string | null
  permissions: string[]
}

interface Permission {
  id: number
  name: string
}

export function RolesPage() {
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const [roles, setRoles] = useState<Role[]>([])
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', displayName: '' })

  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [editForm, setEditForm] = useState({ name: '', displayName: '', selectedPermissions: new Set<string>() })
  const [permissionSearch, setPermissionSearch] = useState('')

  useEffect(() => {
    apiFetch<Role[]>('/roles')
      .then(data => setRoles(data.filter(r => r.name !== 'SUPER_ADMIN')))
      .catch(() => toast('Failed to load roles.', 'error'))

    apiFetch<Permission[]>('/permissions')
      .then(setAllPermissions)
      .catch(() => toast('Failed to load permissions.', 'error'))
  }, [])

  function openEdit(role: Role) {
    setEditingRole(role)
    setEditForm({
      name: role.name,
      displayName: role.displayName ?? '',
      selectedPermissions: new Set(role.permissions),
    })
    setPermissionSearch('')
    setEditOpen(true)
  }

  function handleCreateChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCreateForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  function handleEditChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEditForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  function togglePermission(permName: string) {
    setEditForm(prev => {
      const next = new Set(prev.selectedPermissions)
      next.has(permName) ? next.delete(permName) : next.add(permName)
      return { ...prev, selectedPermissions: next }
    })
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateLoading(true)
    try {
      const created = await apiFetch<Role>('/roles', {
        method: 'POST',
        body: JSON.stringify({ name: createForm.name, displayName: createForm.displayName, permissionIds: [] }),
      })
      setRoles(prev => [...prev, created])
      toast('Role created successfully.', 'success')
      setCreateOpen(false)
      setCreateForm({ name: '', displayName: '' })
    } catch {
      toast('Failed to create role.', 'error')
    } finally {
      setCreateLoading(false)
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

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingRole) return
    setEditLoading(true)
    try {
      const permissionIds = allPermissions
        .filter(p => editForm.selectedPermissions.has(p.name))
        .map(p => p.id)

      const updated = await apiFetch<Role>(`/roles/${editingRole.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editForm.name, displayName: editForm.displayName, permissionIds }),
      })
      setRoles(prev => prev.map(r => r.id === updated.id ? updated : r))
      toast('Role updated successfully.', 'success')
      setEditOpen(false)
    } catch {
      toast('Failed to update role.', 'error')
    } finally {
      setEditLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Roles</h1>

        {hasPermission('CREATE_ROLE') && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4" />
              New Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Role</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="create-name">Role Name</Label>
                <Input id="create-name" name="name" value={createForm.name} onChange={handleCreateChange} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-displayName">Display Name</Label>
                <Input id="create-displayName" name="displayName" value={createForm.displayName} onChange={handleCreateChange} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" loading={createLoading}>Create</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Role Name</Label>
              <Input id="edit-name" name="name" value={editForm.name} onChange={handleEditChange} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-displayName">Display Name</Label>
              <Input id="edit-displayName" name="displayName" value={editForm.displayName} onChange={handleEditChange} />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <Input
                placeholder="Search permissions..."
                value={permissionSearch}
                onChange={e => setPermissionSearch(e.target.value)}
              />
              <div className="max-h-48 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-3 space-y-2">
                {allPermissions
                  .filter(p => p.name.toLowerCase().includes(permissionSearch.toLowerCase()))
                  .map(p => (
                    <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.selectedPermissions.has(p.name)}
                        onChange={() => togglePermission(p.name)}
                        className="accent-[hsl(var(--primary))]"
                      />
                      {p.name}
                    </label>
                  ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" loading={editLoading}>Save</Button>
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
                  <tr key={role.id} className="border-b border-[hsl(var(--border))] last:border-0">
                    <td className="py-2 px-4">{role.displayName ?? '—'}</td>
                    <td className="py-2 px-4">{role.name}</td>
                    <td className="py-2 px-4">{role.permissions.join(', ') || '—'}</td>
                    <td className="py-2 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
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