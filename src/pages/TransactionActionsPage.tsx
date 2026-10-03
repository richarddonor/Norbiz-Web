import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocCheck, DocText, DocSection, DocSignatures } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { TRANSACTION_TYPES, transactionTypeLabel, type TransactionType } from '@/hooks/useTransactionActivity'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { exportToXlsx } from '@/lib/exportXlsx'
import { useLookup, type LookupOption } from '@/lib/lookups'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

// Company-configured actions users take on posted transactions (see ../Norbiz/docs/TRANSACTION_ACTIONS.md).
// Users take them from the transaction record tab's Actions menu (src/components/TransactionActivity.tsx).

type FormMode = 'view' | 'create' | 'edit'

interface CompanyOption {
  id: number
  name: string
}

interface RoleOption {
  id: number
  name: string
  displayName: string | null
}

interface Ref {
  id: number
  code: string
  name: string | null
}

interface ActionDefinition {
  id: number
  companyId: number
  companyName: string
  transactionType: TransactionType
  code: string
  name: string
  sortOrder: number
  active: boolean
  // Roles: code = role name, name = display name. Prerequisites: code/name of the action.
  allowedRoles: Ref[]
  prerequisites: Ref[]
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

type DefinitionForm = {
  companyId: number | ''
  transactionType: TransactionType
  code: string
  name: string
  sortOrder: string
  active: boolean
  roleIds: Set<number>
  prerequisiteIds: Set<number>
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'transactionType', label: 'Transaction Type' },
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'allowedRoles', label: 'Allowed Roles' },
    { key: 'prerequisites', label: 'Prerequisites' },
    { key: 'sortOrder', label: 'Order' },
    { key: 'active', label: 'Active', type: 'boolean' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

function roleLabel(r: Ref): string {
  return r.name || r.code
}

function definitionSearchText(d: ActionDefinition): string {
  return [
    d.code, d.name, transactionTypeLabel(d.transactionType), d.companyName,
    d.allowedRoles.map(roleLabel).join(' '), d.prerequisites.map(p => p.name ?? p.code).join(' '),
    d.active ? 'active' : 'inactive',
  ].join(' ')
}

function emptyForm(companyId: number | ''): DefinitionForm {
  return {
    companyId, transactionType: TRANSACTION_TYPES[0].value, code: '', name: '', sortOrder: '0', active: true,
    roleIds: new Set(), prerequisiteIds: new Set(),
  }
}

function definitionToForm(d: ActionDefinition): DefinitionForm {
  return {
    companyId: d.companyId, transactionType: d.transactionType, code: d.code, name: d.name,
    sortOrder: String(d.sortOrder), active: d.active,
    roleIds: new Set(d.allowedRoles.map(r => r.id)), prerequisiteIds: new Set(d.prerequisites.map(p => p.id)),
  }
}

/** Typed codes are coerced toward UPPER_SNAKE (the backend's pattern) as the user types. */
function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, '_').replace(/[^A-Z0-9_]/g, '')
}

function toggled(set: Set<number>, id: number): Set<number> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function TransactionActionsPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn, companies } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const inRecordTab = useIsRecordTab()
  // Roles are system-wide; MANAGE_TRANSACTION_ACTIONS unlocks the role lookup (no VIEW_ROLE needed).
  const roleOptions = useLookup<LookupOption>('roles', null, { global: true, enabled: inRecordTab, onError: () => toast('Failed to load roles.', 'error') })
  const roles = useMemo<RoleOption[]>(() => roleOptions.map(r => ({ id: r.id, name: r.code ?? '', displayName: r.name })), [roleOptions])
  const { items: definitions, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<ActionDefinition>('/transaction-action-definitions', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load transaction actions.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText: definitionSearchText,
  })

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<ActionDefinition>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<ActionDefinition>(`/transaction-action-definitions/${id}`),
  })
  const [activeDefinition, setActiveDefinition] = useState<ActionDefinition | null>(null)
  const [form, setForm]                         = useState<DefinitionForm>(emptyForm(''))
  const [candidates, setCandidates]             = useState<ActionDefinition[]>([])
  const [loading, setLoading]                   = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('transaction-actions')
  const { markClean, guardedClose } = useDirtyGuard()
  const resolveDisplayName = useUserDisplayNames()

  const canManage = hasPermission('MANAGE_TRANSACTION_ACTIONS')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: definitions,
    onView: openView,
    onEdit: canManage ? openEdit : undefined,
    onDelete: canManage ? handleDelete : undefined,
    canEdit: canManage,
    canDelete: canManage,
    enabled: !inRecordTab && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canManage && openCreate() },
    { key: '/', handler: () => searchInputRef.current?.focus() },
    { key: 'r', handler: () => reload() },
  ], !inRecordTab && zone === 'content')

  useEffect(() => {
    if (!inRecordTab) return
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [inRecordTab])

  // Prerequisite choices: the other actions of the same company + transaction type.
  const editing = inRecordTab && mode !== 'view'
  useEffect(() => {
    setCandidates([])
    if (!editing || !form.companyId) return
    fetchAllContent<ActionDefinition>(`/transaction-action-definitions?transactionType=${form.transactionType}`)
      .then(all => setCandidates(all
        .filter(d => d.companyId === form.companyId && d.id !== activeDefinition?.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)))
      .catch(() => toast('Failed to load prerequisite choices.', 'error'))
  }, [editing, form.companyId, form.transactionType, activeDefinition?.id])

  function openView(definition: ActionDefinition) {
    if (!rec.isRecordTab) return rec.open('view', definition)
    setActiveDefinition(definition)
    const nextForm = definitionToForm(definition)
    setForm(nextForm)
    markClean(nextForm)
    setMode('view')
  }

  function openEdit(definition: ActionDefinition) {
    if (!rec.isRecordTab) return rec.open('edit', definition)
    setActiveDefinition(definition)
    const nextForm = definitionToForm(definition)
    setForm(nextForm)
    markClean(nextForm)
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveDefinition(null)
    const nextForm = emptyForm(activeCompanyId ?? '')
    setForm(nextForm)
    markClean(nextForm)
    setMode('create')
  }

  function requestClose() {
    guardedClose(form, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (!CODE_PATTERN.test(form.code)) {
      toast('Code must start with a letter and use only A–Z, 0–9 and _ (e.g. BARCODE_PRINTING).', 'error')
      return
    }
    const sortOrder = Number(form.sortOrder)
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
      toast('Order must be a whole number from 0 to 9999.', 'error')
      return
    }
    if (form.roleIds.size === 0) {
      toast('Select at least one role allowed to take this action.', 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create transaction action "${form.name}"?` : `Save changes to transaction action "${form.name}"?`)) return
    setLoading(true)
    try {
      const body = {
        companyId: mode === 'create' ? form.companyId : activeDefinition!.companyId,
        transactionType: mode === 'create' ? form.transactionType : activeDefinition!.transactionType,
        code: form.code,
        name: form.name.trim(),
        sortOrder,
        active: form.active,
        allowedRoleIds: [...form.roleIds],
        prerequisiteIds: [...form.prerequisiteIds],
      }
      if (mode === 'create') {
        await apiFetch<ActionDefinition>('/transaction-action-definitions', { method: 'POST', body: JSON.stringify(body) })
        toast('Transaction action created successfully.', 'success')
      } else {
        await apiFetch<ActionDefinition>(`/transaction-action-definitions/${activeDefinition!.id}`, { method: 'PUT', body: JSON.stringify(body) })
        toast('Transaction action updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch (err) {
      // Backend messages name the problem (duplicate code, prerequisite cycle) — show them.
      const fallback = mode === 'create' ? 'Failed to create transaction action.' : 'Failed to update transaction action.'
      toast(err instanceof Error && err.message ? err.message : fallback, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(definition: ActionDefinition) {
    if (!window.confirm(`Delete transaction action "${definition.name}"?`)) return
    try {
      await apiFetch(`/transaction-action-definitions/${definition.id}`, { method: 'DELETE' })
      toast('Transaction action deleted.', 'success')
      reload()
    } catch (err) {
      // Blocked once taken or used as a prerequisite — the backend's message says what to do instead.
      toast(deleteErrorMessage(err, 'Failed to delete transaction action.'), 'error')
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(debouncedFilters)
    const all = await fetchAllContent<ActionDefinition>(qs ? `/transaction-action-definitions?${qs}` : '/transaction-action-definitions', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(d => definitionSearchText(d).toLowerCase().includes(term)) : all
    const rows = matching.map(d => ({
      company: d.companyName,
      transactionType: transactionTypeLabel(d.transactionType),
      code: d.code,
      name: d.name,
      allowedRoles: d.allowedRoles.map(roleLabel).join(', '),
      prerequisites: d.prerequisites.map(p => p.name ?? p.code).join(', '),
      sortOrder: d.sortOrder,
      active: d.active ? 'Yes' : 'No',
      updatedAt: formatDateTime(d.updatedAt),
    }))
    exportToXlsx('transaction-actions', COLUMNS.filter(c => isVisible(c.key)), rows)
  }

  function handleCompanyChange(companyId: number | '') {
    setForm(f => ({ ...f, companyId, prerequisiteIds: new Set() }))
  }

  const recordName = activeDefinition?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Transaction Action' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Transaction Action'
  const ro = mode === 'view'
  const sortedRoles = [...roles].sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name))

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Transaction Actions</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search actions… (/)"
              className="pl-8 w-56"
            />
          </div>
          <SearchableSelect
            value={filters.transactionType ?? ''}
            onChange={v => setFilters(prev => ({ ...prev, transactionType: v }))}
            options={TRANSACTION_TYPES}
            placeholder="All transaction types"
            className="w-52"
          />
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} isVisible={isVisible} onToggle={toggleColumn} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          {canManage && (
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
                    id="txn-action-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? companyOptions.find(c => c.id === form.companyId)?.name : activeDefinition?.companyName}
                    companies={companyOptions}
                    value={form.companyId}
                    onChange={handleCompanyChange}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Transaction Action Record">
                  <DocRow>
                    <DocCell label="Code" htmlFor="txn-action-code">
                      <Input
                        id="txn-action-code"
                        value={form.code}
                        readOnly={ro}
                        autoFocus={!(mode === 'create' && showCompanyColumn)}
                        maxLength={50}
                        onChange={e => setForm(f => ({ ...f, code: normalizeCode(e.target.value) }))}
                        required={!ro}
                        className="font-mono"
                      />
                    </DocCell>
                    <DocCell label="Status">
                      <DocCheck id="txn-action-active" label="Active" checked={form.active} disabled={ro}
                        onChange={active => setForm(f => ({ ...f, active }))} />
                    </DocCell>
                  </DocRow>
                </DocHeader>
              </DocLetterhead>
              <DocRow cols="2fr 3fr 1fr">
                <DocCell label="Transaction Type" htmlFor="txn-action-type">
                  {mode === 'create' ? (
                    <SearchableSelect
                      id="txn-action-type"
                      value={form.transactionType}
                      onChange={v => setForm(f => ({
                        ...f,
                        transactionType: (v || TRANSACTION_TYPES[0].value) as TransactionType,
                        prerequisiteIds: new Set(),
                      }))}
                      options={TRANSACTION_TYPES}
                      placeholder={TRANSACTION_TYPES[0].label}
                    />
                  ) : (
                    <DocText>{transactionTypeLabel(form.transactionType)}</DocText>
                  )}
                </DocCell>
                <DocCell label="Name" htmlFor="txn-action-name">
                  <Input
                    id="txn-action-name"
                    value={form.name}
                    readOnly={ro}
                    maxLength={255}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required={!ro}
                  />
                </DocCell>
                <DocCell label="Order" htmlFor="txn-action-order">
                  <Input
                    id="txn-action-order"
                    type="number"
                    min={0}
                    max={9999}
                    value={form.sortOrder}
                    readOnly={ro}
                    onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                    required={!ro}
                    className="text-right tabular-nums"
                  />
                </DocCell>
              </DocRow>

              <DocSection title="Allowed Roles" />
              <DocRow>
                <DocCell label="Users holding any of these roles may take this action">
                  {ro ? (
                    <DocText>{activeDefinition?.allowedRoles.map(roleLabel).join(', ')}</DocText>
                  ) : (
                    <div className="flex flex-wrap">
                      {sortedRoles.map(r => (
                        <DocCheck
                          key={r.id}
                          id={`txn-action-role-${r.id}`}
                          label={r.displayName || r.name}
                          checked={form.roleIds.has(r.id)}
                          onChange={() => setForm(f => ({ ...f, roleIds: toggled(f.roleIds, r.id) }))}
                        />
                      ))}
                    </div>
                  )}
                </DocCell>
              </DocRow>

              <DocSection title="Prerequisites" />
              <DocRow>
                <DocCell label="All of these must already be done on the transaction (by anyone)">
                  {ro ? (
                    <DocText>{activeDefinition?.prerequisites.map(p => p.name ?? p.code).join(', ')}</DocText>
                  ) : candidates.length === 0 ? (
                    <span className="flex min-h-8 items-center text-sm italic text-[hsl(var(--muted-foreground))]">
                      {form.companyId
                        ? `No other actions defined for ${transactionTypeLabel(form.transactionType)} yet.`
                        : 'Select a company first…'}
                    </span>
                  ) : (
                    <div className="flex flex-wrap">
                      {candidates.map(c => (
                        <DocCheck
                          key={c.id}
                          id={`txn-action-prereq-${c.id}`}
                          label={c.active ? c.name : `${c.name} (inactive)`}
                          checked={form.prerequisiteIds.has(c.id)}
                          onChange={() => setForm(f => ({ ...f, prerequisiteIds: toggled(f.prerequisiteIds, c.id) }))}
                        />
                      ))}
                    </div>
                  )}
                </DocCell>
              </DocRow>

              {ro && activeDefinition && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeDefinition.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeDefinition.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeDefinition.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeDefinition.updatedAt) },
                ]} />
              )}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {canManage && (
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
                {isVisible('transactionType') && <th className="text-left py-2 px-4 font-medium">Transaction Type</th>}
                {isVisible('code') && <th className="text-left py-2 px-4 font-medium">Code</th>}
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
                {isVisible('allowedRoles') && <th className="text-left py-2 px-4 font-medium">Allowed Roles</th>}
                {isVisible('prerequisites') && <th className="text-left py-2 px-4 font-medium">Prerequisites</th>}
                {isVisible('sortOrder') && <th className="text-right py-2 px-4 font-medium">Order</th>}
                {isVisible('active') && <th className="text-left py-2 px-4 font-medium">Active</th>}
                {isVisible('updatedAt') && <th className="text-left py-2 px-4 font-medium">Last updated</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key === 'code' || key === 'name' || key === 'active'}
              />
            </thead>
            <tbody>
              {definitions.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No transaction actions match your search/filters.' : 'No transaction actions to display.'}
                  </td>
                </tr>
              ) : (
                definitions.map((definition, i) => (
                  <tr
                    key={definition.id}
                    onClick={() => { setActiveIndex(i); openView(definition) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{definition.companyName}</td>}
                    {isVisible('transactionType') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{transactionTypeLabel(definition.transactionType)}</td>}
                    {isVisible('code') && <td className="py-2 px-4 font-mono text-xs">{definition.code}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{definition.name}</td>}
                    {isVisible('allowedRoles') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{definition.allowedRoles.map(roleLabel).join(', ')}</td>}
                    {isVisible('prerequisites') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{definition.prerequisites.map(p => p.name ?? p.code).join(', ')}</td>}
                    {isVisible('sortOrder') && <td className="py-2 px-4 text-right tabular-nums text-[hsl(var(--muted-foreground))]">{definition.sortOrder}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          definition.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {definition.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(definition.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(definition)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canManage && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(definition)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canManage && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(definition)}>
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
