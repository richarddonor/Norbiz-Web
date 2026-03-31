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

interface User {
  id: number
  username: string
  displayName: string | null
  email: string
  roles: string[]
  roleIds: number[]
}

interface Role {
  id: number
  name: string
  displayName: string | null
}

export function UsersPage() {
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [allRoles, setAllRoles] = useState<Role[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', displayName: '', email: '', password: '' })

  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editForm, setEditForm] = useState({ username: '', displayName: '', email: '', selectedRoleIds: new Set<number>() })

  useEffect(() => {
    apiFetch<User[]>('/users')
      .then(setUsers)
      .catch(() => toast('Failed to load users.', 'error'))

    apiFetch<Role[]>('/roles')
      .then(data => setAllRoles(data.filter(r => r.name !== 'SUPER_ADMIN')))
      .catch(() => toast('Failed to load roles.', 'error'))
  }, [])

  function openEdit(user: User) {
    setEditingUser(user)
    setEditForm({
      username: user.username,
      displayName: user.displayName ?? '',
      email: user.email,
      selectedRoleIds: new Set(user.roleIds),
    })
    setEditOpen(true)
  }

  function toggleRole(roleId: number) {
    setEditForm(prev => {
      const next = new Set(prev.selectedRoleIds)
      next.has(roleId) ? next.delete(roleId) : next.add(roleId)
      return { ...prev, selectedRoleIds: next }
    })
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateLoading(true)
    try {
      await apiFetch('/users', { method: 'POST', body: JSON.stringify(createForm) })
      toast('User created successfully.', 'success')
      setCreateOpen(false)
      setCreateForm({ username: '', displayName: '', email: '', password: '' })
      apiFetch<User[]>('/users').then(setUsers).catch(() => {})
    } catch {
      toast('Failed to create user.', 'error')
    } finally {
      setCreateLoading(false)
    }
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingUser) return
    setEditLoading(true)
    try {
      const updated = await apiFetch<User>(`/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          username: editForm.username,
          displayName: editForm.displayName,
          email: editForm.email,
          roleIds: Array.from(editForm.selectedRoleIds),
        }),
      })
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
      toast('User updated successfully.', 'success')
      setEditOpen(false)
    } catch {
      toast('Failed to update user.', 'error')
    } finally {
      setEditLoading(false)
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>

        {hasPermission('CREATE_USER') && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4" />
                New User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create User</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="create-username">Username</Label>
                  <Input id="create-username" value={createForm.username}
                    onChange={e => setCreateForm(p => ({ ...p, username: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-displayName">Display Name</Label>
                  <Input id="create-displayName" value={createForm.displayName}
                    onChange={e => setCreateForm(p => ({ ...p, displayName: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-email">Email</Label>
                  <Input id="create-email" type="email" value={createForm.email}
                    onChange={e => setCreateForm(p => ({ ...p, email: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-password">Password</Label>
                  <Input id="create-password" type="password" value={createForm.password}
                    onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))} required />
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
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-username">Username</Label>
              <Input id="edit-username" value={editForm.username}
                onChange={e => setEditForm(p => ({ ...p, username: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-displayName">Display Name</Label>
              <Input id="edit-displayName" value={editForm.displayName}
                onChange={e => setEditForm(p => ({ ...p, displayName: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" value={editForm.email}
                onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Roles</Label>
              <div className="max-h-48 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-3 space-y-2">
                {allRoles.map(role => (
                  <label key={role.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.selectedRoleIds.has(role.id)}
                      onChange={() => toggleRole(role.id)}
                      className="accent-[hsl(var(--primary))]"
                    />
                    {role.displayName ?? role.name}
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
                  <th className="py-2 px-4" />
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className="border-b border-[hsl(var(--border))] last:border-0">
                    <td className="py-2 px-4">{user.displayName ?? '—'}</td>
                    <td className="py-2 px-4">{user.username}</td>
                    <td className="py-2 px-4">{user.email}</td>
                    <td className="py-2 px-4">{user.roles.join(', ') || '—'}</td>
                    <td className="py-2 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
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
