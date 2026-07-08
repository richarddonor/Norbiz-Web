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
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { cn } from '@/lib/utils'

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

const COLUMNS: readonly ColumnDef[] = [
  { key: 'displayName', label: 'Display Name' },
  { key: 'name', label: 'Name' },
  { key: 'permissions', label: 'Permissions' },
]

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

function roleSearchText(role: Role): string {
  return [role.name, role.displayName ?? '', ...role.permissions].join(' ')
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
  const { zone } = useContentFocus()

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const { items: roles, page, setPage, totalPages, totalElements, reload } = usePagedList<Role>('/roles', {
    onError: () => toast('Failed to load roles.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: roleSearchText,
  })
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])

  const [open, setOpen]               = useState(false)
  const [mode, setMode]               = useState<FormMode>('view')
  const [activeRole, setActiveRole]   = useState<Role | null>(null)
  const [form, setForm]               = useState<RoleForm>(emptyForm())
  const [permSearch, setPermSearch]   = useState('')
  const [loading, setLoading]         = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('roles')

  const canCreate = hasPermission('CREATE_ROLE')
  const canUpdate = hasPermission('UPDATE_ROLE')
  const canDeleteRole = hasPermission('DELETE_ROLE')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: roles,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteRole ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteRole,
    enabled: !open && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
  ], !open && zone === 'content')

  useEffect(() => {
    fetchAllContent<Permission>('/permissions')
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
        await apiFetch<Role>('/roles', {
          method: 'POST',
          body: JSON.stringify({ name: form.name, displayName: form.displayName, permissionIds: [] }),
        })
        toast('Role created successfully.', 'success')
      } else {
        const permissionIds = allPermissions
          .filter(p => form.selectedPermissions.has(p.name))
          .map(p => p.id)

        await apiFetch<Role>(`/roles/${activeRole!.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: form.name, displayName: form.displayName, permissionIds }),
        })
        toast('Role updated successfully.', 'success')
      }
      setOpen(false)
      reload()
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
      toast('Role deleted.', 'success')
      reload()
    } catch {
      toast('Failed to delete role.', 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<Role>(qs ? `/roles?${qs}` : '/roles', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(r => roleSearchText(r).toLowerCase().includes(term)) : all
    const rows = matching.map(r => ({
      displayName: r.displayName ?? '',
      name: r.name,
      permissions: r.permissions.join(', '),
    }))
    exportToXlsx('roles', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  const ro = mode === 'view'
  const dialogTitle = mode === 'view' ? 'Role Details' : mode === 'create' ? 'New Role' : 'Edit Role'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Roles</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search roles… (/)"
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
              New Role
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
            <div className="space-y-1.5">
              <Label htmlFor="form-name">Role Name</Label>
              <Input id="form-name" value={form.name} readOnly={ro || mode === 'edit'} autoFocus
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {isVisible('displayName') && <th className="text-left py-2 px-4 font-medium">Display Name</th>}
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
                {isVisible('permissions') && <th className="text-left py-2 px-4 font-medium">Permissions</th>}
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
              {roles.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No roles match your search/filters.' : 'No roles to display.'}
                  </td>
                </tr>
              ) : (
                roles.map((role, i) => (
                  <tr
                    key={role.id}
                    onClick={() => { setActiveIndex(i); openView(role) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {isVisible('displayName') && <td className="py-2 px-4">{role.displayName ?? '—'}</td>}
                    {isVisible('name') && <td className="py-2 px-4">{role.name}</td>}
                    {isVisible('permissions') && (
                      <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                        {role.permissions.length > 0 ? role.permissions.join(', ') : '—'}
                      </td>
                    )}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(role)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(role)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteRole && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(role)}>
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