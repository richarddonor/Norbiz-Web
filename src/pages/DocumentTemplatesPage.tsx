import { useState, useRef, useMemo, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Eye, Search, LayoutTemplate } from 'lucide-react'
import { apiFetch, deleteErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocCheck, DocSignatures } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { useRecordTab, useIsRecordTab, RecordSheet, RECORD_ACTIONS } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/components/AppLayout'
import { usePagedList } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { formatDateTime } from '@/lib/format'
import { emptyLayout } from '@/lib/documentTemplate'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create' | 'edit'

// Mirrors the backend's hand-maintained DocumentSchemaRegistry — add an entry here
// whenever a new document type is registered on the backend.
const DOCUMENT_TYPES = [
  { value: 'INVENTORY_ADJUSTMENT', label: 'Inventory Adjustment' },
  { value: 'PURCHASE_ORDER', label: 'Purchase Order' },
  { value: 'PURCHASE_INVOICE', label: 'Purchase Invoice' },
  { value: 'PURCHASE_RECEIVE', label: 'Purchase Receive' },
]

interface DocumentTemplate {
  id: number
  companyId: number
  companyName: string
  documentType: string
  name: string
  layout: string
  defaultTemplate: boolean
  active: boolean
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

type TemplateForm = {
  documentType: string
  name: string
  defaultTemplate: boolean
  active: boolean
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push({ key: 'name', label: 'Name' }, { key: 'documentType', label: 'Document Type' })
  columns.push(
    { key: 'defaultTemplate', label: 'Default', type: 'boolean' },
    { key: 'active', label: 'Active', type: 'boolean' },
    { key: 'updatedAt', label: 'Last updated', type: 'date' },
  )
  return columns
}

function emptyForm(): TemplateForm {
  return { documentType: DOCUMENT_TYPES[0].value, name: '', defaultTemplate: false, active: true }
}

function templateToForm(t: DocumentTemplate): TemplateForm {
  return { documentType: t.documentType, name: t.name, defaultTemplate: t.defaultTemplate, active: t.active }
}

function documentTypeLabel(value: string): string {
  return DOCUMENT_TYPES.find(d => d.value === value)?.label ?? value
}

export function DocumentTemplatesPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, activeCompany, showCompanyColumn } = useAuth()
  const { zone } = useContentFocus()
  const navigate = useNavigate()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const searchText = (t: DocumentTemplate) =>
    [t.name, documentTypeLabel(t.documentType), t.companyName, t.active ? 'active' : 'inactive'].join(' ')

  const inRecordTab = useIsRecordTab()
  const { items: templates, page, setPage, totalPages, totalElements, reload, loading: listLoading } = usePagedList<DocumentTemplate>('/document-templates', {
    enabled: !inRecordTab,
    onError: () => toast('Failed to load document templates.', 'error'),
    search: debouncedSearch,
    filters: debouncedFilters,
    searchText,
  })

  const [mode, setMode]                   = useState<FormMode>('view')
  const rec = useRecordTab<DocumentTemplate>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<DocumentTemplate>(`/document-templates/${id}`),
  })
  const [activeTemplate, setActiveTemplate] = useState<DocumentTemplate | null>(null)
  const [form, setForm]                   = useState<TemplateForm>(emptyForm())
  const [loading, setLoading]             = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { isVisible, toggle: toggleColumn } = useColumnVisibility('document-templates')
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()

  const canManage = hasPermission('MANAGE_DOCUMENT_TEMPLATES')

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: templates,
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

  function openView(template: DocumentTemplate) {
    if (!rec.isRecordTab) return rec.open('view', template)
    setActiveTemplate(template)
    const nextForm = templateToForm(template)
    setForm(nextForm)
    markClean(nextForm)
    setMode('view')
  }

  async function openEdit(template: DocumentTemplate) {
    if (!rec.isRecordTab) return rec.open('edit', template)
    // List rows and long-lived record tabs hold snapshots; editing a stale one would re-send an
    // outdated Default flag on save and silently take the default back from another template.
    const fresh = await apiFetch<DocumentTemplate>(`/document-templates/${template.id}`).catch(() => template)
    setActiveTemplate(fresh)
    const nextForm = templateToForm(fresh)
    setForm(nextForm)
    markClean(nextForm)
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveTemplate(null)
    const nextForm = emptyForm()
    setForm(nextForm)
    markClean(nextForm)
    setMode('create')
  }

  function requestClose() {
    guardedClose(form, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!window.confirm(mode === 'create' ? `Create template "${form.name}"?` : `Save changes to template "${form.name}"?`)) return
    setLoading(true)
    try {
      const companyId = mode === 'create' ? activeCompanyId : activeTemplate!.companyId
      // On edit, layout is omitted so the backend keeps the stored one — the designer owns it.
      const body = { companyId, ...form, ...(mode === 'create' ? { layout: JSON.stringify(emptyLayout()) } : {}) }
      if (mode === 'create') {
        const created = await apiFetch<DocumentTemplate>('/document-templates', { method: 'POST', body: JSON.stringify(body) })
        toast('Template created — opening the designer…', 'success')
        rec.close()
        reload()
        navigate(`/document-templates/${created.id}/design`)
        return
      }
      await apiFetch<DocumentTemplate>(`/document-templates/${activeTemplate!.id}`, { method: 'PUT', body: JSON.stringify(body) })
      toast('Template updated successfully.', 'success')
      rec.close()
      reload()
    } catch {
      toast(mode === 'create' ? 'Failed to create template.' : 'Failed to update template.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(template: DocumentTemplate) {
    if (!window.confirm(`Delete template "${template.name}"?`)) return
    try {
      await apiFetch(`/document-templates/${template.id}`, { method: 'DELETE' })
      toast('Template deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete template.'), 'error')
    }
  }

  const recordName = activeTemplate?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Document Template' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Document Template'
  const ro = mode === 'view'

  return (
    <div className="space-y-6">
      {!inRecordTab && (<>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Document Templates</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates… (/)"
              className="pl-8 w-56"
            />
          </div>
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} isVisible={isVisible} onToggle={toggleColumn} />
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
                    id="template-company"
                    readOnly
                    name={mode === 'create' ? activeCompany?.name : activeTemplate?.companyName}
                  />
              }>
                <DocHeader title="Document Template">
                  <DocRow>
                    <DocCell label="Status">
                      <DocCheck id="template-active" label="Active" checked={form.active} disabled={ro}
                        onChange={active => setForm(f => ({ ...f, active }))} />
                      <DocCheck id="template-default" label="Default" checked={form.defaultTemplate} disabled={ro}
                        onChange={defaultTemplate => setForm(f => ({ ...f, defaultTemplate }))} />
                    </DocCell>
                  </DocRow>
                </DocHeader>
              </DocLetterhead>
              <DocRow cols="3fr 2fr">
                <DocCell label="Template Name" htmlFor="template-name">
                  <Input
                    id="template-name"
                    value={form.name}
                    readOnly={ro}
                    autoFocus
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required={!ro}
                  />
                </DocCell>
                <DocCell label="Document Type" htmlFor="template-type">
                  <SearchableSelect
                    id="template-type"
                    value={form.documentType}
                    disabled={ro || mode === 'edit'}
                    onChange={v => setForm(f => ({ ...f, documentType: v || DOCUMENT_TYPES[0].value }))}
                    options={DOCUMENT_TYPES}
                    placeholder={DOCUMENT_TYPES[0].label}
                  />
                </DocCell>
              </DocRow>
              {ro && activeTemplate && (
                <DocSignatures entries={[
                  { label: 'Last updated by', value: resolveDisplayName(activeTemplate.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeTemplate.updatedAt) },
                ]} />
              )}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Close</Button>
                  {canManage && activeTemplate && (
                    <Button type="button" variant="outline" onClick={() => navigate(`/document-templates/${activeTemplate.id}/design`)}>
                      <LayoutTemplate className="w-4 h-4" />
                      Open Designer
                    </Button>
                  )}
                  {canManage && (
                    <Button type="button" onClick={() => activeTemplate && openEdit(activeTemplate)}>Edit</Button>
                  )}
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
                  <Button type="submit" loading={loading}>
                    {mode === 'create' ? 'Create & Design' : 'Save'}
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
                {isVisible('name') && <th className="text-left py-2 px-4 font-medium">Name</th>}
                {isVisible('documentType') && <th className="text-left py-2 px-4 font-medium">Document Type</th>}
                {isVisible('defaultTemplate') && <th className="text-left py-2 px-4 font-medium">Default</th>}
                {isVisible('active') && <th className="text-left py-2 px-4 font-medium">Active</th>}
                {isVisible('updatedAt') && <th className="text-left py-2 px-4 font-medium">Last updated</th>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'defaultTemplate' && key !== 'active' && key !== 'company'}
              />
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No templates match your search/filters.' : 'No document templates to display.'}
                  </td>
                </tr>
              ) : (
                templates.map((template, i) => (
                  <tr
                    key={template.id}
                    onClick={() => { setActiveIndex(i); openView(template) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{template.companyName}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{template.name}</td>}
                    {isVisible('documentType') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{documentTypeLabel(template.documentType)}</td>}
                    {isVisible('defaultTemplate') && (
                      <td className="py-2 px-4">
                        {template.defaultTemplate && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
                            Default
                          </span>
                        )}
                      </td>
                    )}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          template.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {template.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(template.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(template)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canManage && (
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/document-templates/${template.id}/design`)}>
                            <LayoutTemplate className="w-4 h-4" />
                          </Button>
                        )}
                        {canManage && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(template)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canManage && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(template)}>
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
