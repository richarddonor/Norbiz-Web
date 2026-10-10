import { useState, useEffect, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocSection } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS } from '@/components/RecordTab'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { ScrollTable } from '@/components/ScrollTable'
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
  onSetMany,
  readOnly,
  search,
  onSearchChange,
}: {
  allPermissions: Permission[]
  selected: Set<string>
  onToggle: (name: string) => void
  onSetMany: (names: string[], checked: boolean) => void
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
    <DocCell label={readOnly ? undefined : 'Search Permissions'} htmlFor="role-perm-search">
      {!readOnly && (
        <Input
          id="role-perm-search"
          placeholder="Type to filter…"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />
      )}
      {!readOnly && (
        <div className="flex items-center gap-2 py-1">
          <Button type="button" variant="outline" size="sm" disabled={filtered.length === 0}
            onClick={() => onSetMany(filtered.map(p => p.name), true)}>
            Check all
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={filtered.length === 0}
            onClick={() => onSetMany(filtered.map(p => p.name), false)}>
            Uncheck all
          </Button>
          {term && (
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Applies to the {filtered.length} filtered permission{filtered.length === 1 ? '' : 's'}</span>
          )}
        </div>
      )}
      <div className="max-h-56 overflow-y-auto border-t border-[hsl(var(--rule))] py-1 sm:columns-2">
        {readOnly ? (
          selected.size > 0
            ? allPermissions
                .filter(p => selected.has(p.name))
                .map(p => (
                  <div key={p.name} className="break-inside-avoid py-0.5 text-sm">☑ {label(p)}</div>
                ))
            : <div className="text-sm text-[hsl(var(--muted-foreground))]">No permissions assigned.</div>
        ) : (
          filtered.map(p => (
            <label key={p.id} className="flex break-inside-avoid items-center gap-2 py-0.5 text-sm cursor-pointer">
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
    </DocCell>
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

  const inRecordTab = useIsRecordTab()
  const { items: roles, page, setPage, totalPages, totalElements, reload, loading: listLoading, searchAll } = usePagedList<Role>('/roles', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load roles.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: roleSearchText,
  })
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])

  const [mode, setMode]               = useState<FormMode>('view')
  const rec = useRecordTab<Role>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Role>(`/roles/${id}`),
  })
  const [activeRole, setActiveRole]   = useState<Role | null>(null)
  const [form, setForm]               = useState<RoleForm>(emptyForm())
  const [permSearch, setPermSearch]   = useState('')
  const [loading, setLoading]         = useState(false)
  const { isVisible, menu: columnMenu } = useColumnVisibility('roles')
  const { markClean, guardedClose } = useDirtyGuard()

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
    enabled: !inRecordTab && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: 'r', handler: () => reload() },
  ], !inRecordTab && zone === 'content')

  useEffect(() => {
    fetchAllContent<Permission>('/permissions')
      .then(setAllPermissions)
      .catch(() => toast('Failed to load permissions.', 'error'))
  }, [])

  function openView(role: Role) {
    if (!rec.isRecordTab) return rec.open('view', role)
    setActiveRole(role)
    const nextForm = roleToForm(role)
    setForm(nextForm)
    setPermSearch('')
    markClean(nextForm)
    setMode('view')
  }

  function openEdit(role: Role) {
    if (!rec.isRecordTab) return rec.open('edit', role)
    setActiveRole(role)
    const nextForm = roleToForm(role)
    setForm(nextForm)
    setPermSearch('')
    markClean(nextForm)
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveRole(null)
    const nextForm = emptyForm()
    setForm(nextForm)
    setPermSearch('')
    markClean(nextForm)
    setMode('create')
  }

  function requestClose() {
    guardedClose(form, () => rec.close())
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

  function setPermissions(names: string[], checked: boolean) {
    setForm(prev => {
      const next = new Set(prev.selectedPermissions)
      names.forEach(n => checked ? next.add(n) : next.delete(n))
      return { ...prev, selectedPermissions: next }
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!window.confirm(mode === 'create' ? `Create role "${form.displayName || form.name}"?` : `Save changes to role "${form.displayName || form.name}"?`)) return
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
      rec.close()
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
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete role.'), 'error')
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
  const recordName = activeRole ? activeRole.displayName || activeRole.name : ''
  const tabTitle = mode === 'create' ? 'New Role' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Role'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Roles</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} {...columnMenu} />
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
          <GlobalSearch value={search} onChange={setSearch} status={searchAll} />
        </div>
      </div>

      </>)}

      {inRecordTab && (
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DocSheet>
              <DocRow cols="3fr 2fr">
                <DocCell label="Role Name" htmlFor="form-name" required={!ro}>
                  <Input id="form-name" value={form.name} readOnly={ro || mode === 'edit'} autoFocus
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required={!ro} className="font-semibold" />
                </DocCell>
                <DocHeader title="Role Definition" />
              </DocRow>
              <DocRow>
                <DocCell label="Display Name" htmlFor="form-displayName">
                  <Input id="form-displayName" value={form.displayName} readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} />
                </DocCell>
              </DocRow>
              {(mode === 'edit' || mode === 'view') && (
                <>
                  <DocSection title="Permissions Granted" />
                  <DocRow>
                    <PermissionsField
                      allPermissions={allPermissions}
                      selected={form.selectedPermissions}
                      onToggle={togglePermission}
                      onSetMany={setPermissions}
                      readOnly={ro}
                      search={permSearch}
                      onSearchChange={setPermSearch}
                    />
                  </DocRow>
                </>
              )}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {hasPermission('UPDATE_ROLE') && (
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

      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable activeIndex={activeIndex}>
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
          </ScrollTable>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
      </>)}
    </div>
  )
}