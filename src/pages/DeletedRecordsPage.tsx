import { useMemo, useState } from 'react'
import { Eye, FileDown } from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocSignatures, DocStamp } from '@/components/ui/doc-form'
import { Card, CardContent } from '@/components/ui/card'
import { ChangeHistory, type MasterDataType } from '@/components/ChangeHistory'
import { MASTER_DATA_TYPES } from '@/lib/masterData'
import { useRecordTab, useIsRecordTab } from '@/hooks/useRecordTab'
import { RecordSheet, RECORD_ACTIONS, CloseButton } from '@/components/RecordTab'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/hooks/useContentFocus'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { useRowGrouping, useGroupedRows } from '@/hooks/useRowGrouping'
import { GroupByMenu } from '@/components/RowGrouping'
import { groupedRows } from '@/components/groupedRows'
import { useListSort } from '@/hooks/useListSort'
import { SortableTh } from '@/components/SortableTh'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { DocLetterhead } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { ScrollTable, PINNED_TH, PINNED_TD } from '@/components/ScrollTable'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

// Deleted master-data records, one type at a time, read from their DELETE audit logs.
// Backend: GET /master-data/{type}/deleted; a row opens in a record tab showing the record's
// last values and its full change history (GET /master-data/{type}/{id}/history).

/** Row from the backend's DeletedRecordResponse. */
interface DeletedRecord {
  id: number
  companyId: number | null
  companyName: string | null
  code: string | null
  name: string | null
  deletedBy: string | null
  deletedAt: string
}

/** What a record tab holds: the row plus its type. Its tab id is `<TYPE>-<id>`, so a pasted
 * URL or restored tab still knows which history to load. */
interface DeletedRecordRef extends Omit<DeletedRecord, 'id' | 'deletedAt'> {
  id: string
  type: MasterDataType
  recordId: number
  deletedAt: string | null
}

// A SKU is rewritten (deleted + reinserted) on every item save, so the backend doesn't list
// deleted SKUs on their own — their removal shows in the item's history.
const LISTABLE_TYPES: MasterDataType[] = (Object.keys(MASTER_DATA_TYPES) as MasterDataType[]).filter(t => t !== 'ITEM_SKU')

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'deletedBy', label: 'Deleted by' },
    { key: 'deletedAt', label: 'Deleted at', type: 'date' },
  )
  return columns
}

function deletedRecordSearchText(r: DeletedRecord): string {
  return [r.code ?? '', r.name ?? '', r.companyName ?? '', r.deletedBy ?? ''].join(' ')
}

function toRef(type: MasterDataType, r: DeletedRecord): DeletedRecordRef {
  return { ...r, id: `${type}-${r.id}`, type, recordId: r.id }
}

/** `ITEM_CATEGORY-12` → the bare reference a record tab can show while its history loads. */
function parseRef(tabId: string): DeletedRecordRef {
  const at = tabId.lastIndexOf('-')
  const type = tabId.slice(0, at) as MasterDataType
  const recordId = Number(tabId.slice(at + 1))
  if (!(type in MASTER_DATA_TYPES) || !Number.isInteger(recordId) || recordId <= 0) throw new Error(`Bad record id: ${tabId}`)
  return { id: tabId, type, recordId, companyId: null, companyName: null, code: null, name: null, deletedBy: null, deletedAt: null }
}

export function DeletedRecordsPage() {
  const { toast } = useToast()
  const { hasPermission, showCompanyColumn } = useAuth()
  const { zone } = useContentFocus()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const resolveDisplayName = useUserDisplayNames()

  const types = useMemo(() => LISTABLE_TYPES.filter(t => hasPermission(MASTER_DATA_TYPES[t].permission)), [hasPermission])
  const [chosenType, setType] = useState<MasterDataType | null>(null)
  // Permissions arrive after the first render, so fall back to the first viewable type until one is picked.
  const type: MasterDataType | '' = chosenType && types.includes(chosenType) ? chosenType : types[0] ?? ''
  const typeLabel = type ? MASTER_DATA_TYPES[type].label : ''

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const inRecordTab = useIsRecordTab()
  const endpoint = `/master-data/${type || 'BRAND'}/deleted`
  const grouping = useRowGrouping(COLUMNS, 'deleted-records')
  const sorting = useListSort(COLUMNS)
  const { items: records, page, setPage, pageSize, setPageSize, totalPages, totalElements, reload, loading: listLoading, searchAll, allRows } = usePagedList<DeletedRecord>(endpoint, {
    all: grouping.active,
    enabled: !inRecordTab && !!type,
    pageSizeKey: 'master-data.deleted',
    onError: () => toast('Failed to load deleted records.', 'error'),
    search: debouncedSearch,
    filters: sorting.apply(debouncedFilters),
    searchText: deletedRecordSearchText,
  })

  const [active, setActive] = useState<DeletedRecordRef | null>(null)
  const rec = useRecordTab<DeletedRecordRef>({
    mode: 'view',
    onOpen: { view: openView },
    onRequestClose: requestClose,
    fetchRecord: async id => parseRef(id),
  })
  const { isVisible, menu: columnMenu } = useColumnVisibility('deleted-records')

  const view = useGroupedRows(grouping, records, listRow)
  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: records,
    view,
    onView: r => openView(toRef(type as MasterDataType, r)),
    enabled: !inRecordTab && zone === 'content',
  })

  useHotkeys([
    { key: 'r', handler: () => reload() },
  ], !inRecordTab && zone === 'content')

  function openView(ref: DeletedRecordRef) {
    if (!rec.isRecordTab) return rec.open('view', ref)
    setActive(ref)
  }

  function requestClose() {
    rec.close()
  }

  /** One row's displayed value per column key: the export row, and what grouping groups by. */
  function listRow(r: DeletedRecord) {
    return {
      company: r.companyName ?? '',
      code: r.code ?? '',
      name: r.name ?? '',
      deletedBy: resolveDisplayName(r.deletedBy),
      deletedAt: formatDateTime(r.deletedAt),
    }
  }

  async function handleExport() {
    if (!type) return
    try {
      const qs = filtersToQueryString(sorting.apply(debouncedFilters))
      const all = await fetchAllContent<DeletedRecord>(qs ? `${endpoint}?${qs}` : endpoint, 100000)
      const term = debouncedSearch.trim().toLowerCase()
      const matching = term ? all.filter(r => deletedRecordSearchText(r).toLowerCase().includes(term)) : all
      const rows = matching.map(listRow)
      exportToXlsx(`deleted-${MASTER_DATA_TYPES[type].label.toLowerCase().replace(/\s+/g, '-')}-records`, COLUMNS.filter(c => isVisible(c.key)), rows, grouping)
    } catch {
      toast('Failed to export deleted records.', 'error')
    }
  }

  const activeLabel = active ? MASTER_DATA_TYPES[active.type].label : ''
  const recordName = active ? active.name ?? active.code ?? `#${active.recordId}` : ''
  const tabTitle = active ? `Deleted ${activeLabel}: ${recordName}` : 'Deleted Record'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">Deleted Records</h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <SearchableSelect
                id="deleted-records-type"
                value={type}
                onChange={v => { if (v) { setType(v as MasterDataType); setPage(1); setActiveIndex(-1) } }}
                options={types.map(t => ({ value: t, label: MASTER_DATA_TYPES[t].label }))}
                placeholder="Record type"
              />
            </div>
            <ReloadButton onReload={reload} loading={listLoading} />
            <ColumnsMenu columns={COLUMNS} {...columnMenu} />
            <GroupByMenu grouping={grouping} view={view} status={allRows} />
            <Button variant="outline" onClick={handleExport} disabled={!type}>
              <FileDown className="w-4 h-4" />
              Export
            </Button>
            <GlobalSearch value={search} onChange={setSearch} status={searchAll} />
          </div>
        </div>
      )}

      {inRecordTab && (
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-3xl">
          {active && (
            <div className="space-y-4">
              <DocSheet>
                <DocStamp text="Deleted" />
                <DocLetterhead company={<DocCell label="Company"><DocText>{active.companyName ?? '—'}</DocText></DocCell>}>
                  <DocHeader title={`${activeLabel} Record`} number={active.recordId} />
                </DocLetterhead>
                <DocRow cols="1fr 2fr">
                  <DocCell label="Code"><DocText>{active.code ?? '—'}</DocText></DocCell>
                  <DocCell label="Name"><DocText>{active.name ?? '—'}</DocText></DocCell>
                </DocRow>
                {active.deletedAt && (
                  <DocSignatures entries={[
                    { label: 'Deleted by', value: resolveDisplayName(active.deletedBy) },
                    { label: 'Deleted at', value: formatDateTime(active.deletedAt) },
                  ]} />
                )}
                <ChangeHistory type={active.type} id={active.recordId} />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} />
              </div>
            </div>
          )}
        </RecordSheet>
      )}

      {!inRecordTab && (
        <Card className="flex min-h-0 flex-col">
          <CardContent className="flex min-h-0 flex-col pt-6">
            {!type ? (
              <div className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">You can't view any record types.</div>
            ) : (<>
              <ScrollTable activeIndex={activeIndex}>
                <thead>
                  <tr className="border-b border-[hsl(var(--border))]">
                    {showCompanyColumn && isVisible('company') && <SortableTh sorting={sorting} column="company" className="text-left py-2 px-4 font-medium">Company</SortableTh>}
                    {isVisible('code') && <SortableTh sorting={sorting} column="code" className="text-left py-2 px-4 font-medium">Code</SortableTh>}
                    {isVisible('name') && <SortableTh sorting={sorting} column="name" className={cn('text-left py-2 px-4 font-medium', PINNED_TH)}>Name</SortableTh>}
                    {isVisible('deletedBy') && <SortableTh sorting={sorting} column="deletedBy" className="text-left py-2 px-4 font-medium">Deleted by</SortableTh>}
                    {isVisible('deletedAt') && <SortableTh sorting={sorting} column="deletedAt" className="text-left py-2 px-4 font-medium">Deleted at</SortableTh>}
                    <th className="py-2 px-4" />
                  </tr>
                  <ColumnFilterRow
                    columns={COLUMNS}
                    isVisible={isVisible}
                    values={filters}
                    pinnedKey="name"
                    onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                    filterable={key => key !== 'company'}
                  />
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                        {isFiltering ? `No deleted ${typeLabel.toLowerCase()} records match your search/filters.` : `No deleted ${typeLabel.toLowerCase()} records.`}
                      </td>
                    </tr>
                  ) : (
                    groupedRows(view, { isVisible, activeIndex, onActivate: setActiveIndex }, (r, i) => (
                      <tr
                        key={r.id}
                        data-active={i === activeIndex || undefined}
                        onClick={() => { setActiveIndex(i); openView(toRef(type, r)) }}
                        className={cn(
                          'group border-b border-[hsl(var(--border))] last:border-0 cursor-pointer bg-[hsl(var(--card))] hover:bg-[hsl(var(--secondary))] transition-colors',
                          i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                        )}
                      >
                        {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{r.companyName ?? '—'}</td>}
                        {isVisible('code') && <td className="py-2 px-4">{r.code ?? '—'}</td>}
                        {isVisible('name') && <td className={cn('py-2 px-4 font-medium', PINNED_TD)}>{r.name ?? `#${r.id}`}</td>}
                        {isVisible('deletedBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(r.deletedBy)}</td>}
                        {isVisible('deletedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(r.deletedAt)}</td>}
                        <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" onClick={() => openView(toRef(type, r))} aria-label="View history">
                            <Eye className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </ScrollTable>
              <Pagination summary={view.summary} page={page} totalPages={totalPages} totalElements={totalElements} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
            </>)}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
