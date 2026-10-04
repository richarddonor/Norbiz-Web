import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { DocSection, DocLines } from '@/components/ui/doc-form'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import type { PageResponse } from '@/hooks/usePagedList'
import { formatDateTime } from '@/lib/format'

// "Change History" section at the foot of a master-data record sheet (view mode).
// Backend: GET /master-data/{type}/{id}/history — field-level diffs from the audit log, newest first.

// Mirrors the backend's MasterDataType enum.
export type MasterDataType = 'BRAND' | 'ITEM_CATEGORY' | 'ITEM_GROUP' | 'ITEM' | 'ITEM_SKU'
  | 'EMPLOYEE' | 'WAREHOUSE' | 'SUPPLIER' | 'CUSTOMER' | 'USER'

interface FieldChange {
  /** Entity field (`itemCategory`), or `<part>.<field>` for an item's SKUs/prices. */
  field: string
  /** Backend-made caption for parts (`SKU ABC-1 · Unit Price`); otherwise derived from `field`. */
  label: string | null
  kind: 'ADDED' | 'REMOVED' | 'CHANGED'
  oldValue: string | null
  newValue: string | null
}

interface ChangeHistoryEntry {
  id: number
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  changedBy: string | null
  changedAt: string
  changes: FieldChange[]
  /** False for entries logged before associations/SKUs/prices were recorded. */
  detailed: boolean
}

const PAGE_SIZE = 20
const MUTED = 'text-[hsl(var(--muted-foreground))]'
const ACTION_LABEL: Record<ChangeHistoryEntry['action'], string> = { CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted' }

// Entity field names whose form caption isn't just the title-cased name.
const FIELD_LABELS: Record<string, string> = {
  bnInitials: 'BN Initials',
  employeeCode: 'Employee No.',
  imagePath: 'Image',
  main: 'Main Warehouse',
  outlet: 'Outlet Warehouse',
  skuCode: 'SKU Code',
  user: 'Linked User',
  warehouse: 'Outlet Warehouse',
}

/** `itemCode` → `Item Code`, unless FIELD_LABELS names it or the backend sent a caption. */
function fieldLabel(c: FieldChange): string {
  return c.label ?? FIELD_LABELS[c.field] ?? c.field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, ch => ch.toUpperCase())
}

function formatValue(value: string | null): string {
  if (value === null || value === '') return '—'
  if (value === 'true') return 'Yes'
  if (value === 'false') return 'No'
  return value
}

/** Pass `id` only in view mode; `refreshKey` (the record's `updatedAt`) re-fetches after an edit. */
export function ChangeHistory({ type, id, refreshKey }: {
  type: MasterDataType
  id: number | null | undefined
  refreshKey?: unknown
}) {
  const resolveDisplayName = useUserDisplayNames()
  const [entries, setEntries] = useState<ChangeHistoryEntry[]>([])
  const [page, setPage] = useState(0)
  const [last, setLast] = useState(true)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (recordId: number, nextPage: number) => {
    setLoading(true)
    try {
      const res = await apiFetch<PageResponse<ChangeHistoryEntry>>(
        `/master-data/${type}/${recordId}/history?page=${nextPage}&size=${PAGE_SIZE}`)
      setEntries(prev => nextPage === 1 ? res.content : [...prev, ...res.content])
      setPage(nextPage)
      setLast(res.last)
      setFailed(false)
    } catch {
      // History is supplementary — show an inline note rather than a toast over the record.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [type])

  useEffect(() => {
    setEntries([])
    setPage(0)
    setLast(true)
    setFailed(false)
    if (id) load(id, 1)
  }, [id, refreshKey, load])

  if (!id) return null

  function renderChanges(e: ChangeHistoryEntry) {
    if (e.action === 'UPDATE') {
      if (e.changes.length === 0) {
        return <span className={MUTED}>{e.detailed ? 'No visible changes' : 'Related details changed (not itemized)'}</span>
      }
      return (
        <ul className="space-y-0.5 py-1.5">
          {e.changes.map((c, i) => (
            <li key={i} className="break-words">
              {c.kind === 'ADDED' ? (
                <><span className="font-medium">{fieldLabel(c)} added</span>{c.newValue && <>: {c.newValue}</>}</>
              ) : c.kind === 'REMOVED' ? (
                <><span className="font-medium">{fieldLabel(c)} removed</span>{c.oldValue && <>: <s className={MUTED}>{c.oldValue}</s></>}</>
              ) : (
                <><span className="font-medium">{fieldLabel(c)}:</span>{' '}
                  <span className={MUTED}>{formatValue(c.oldValue)}</span> → {formatValue(c.newValue)}</>
              )}
            </li>
          ))}
        </ul>
      )
    }
    const values = e.changes.filter(c => c.newValue !== null && c.newValue !== '')
    if (values.length === 0) return <span className={MUTED}>Record {ACTION_LABEL[e.action].toLowerCase()}</span>
    return (
      <details className="py-1.5">
        <summary className={`cursor-pointer rounded-sm ${MUTED} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]`}>
          {e.action === 'CREATE' ? 'Initial values' : 'Final values'}
        </summary>
        <ul className="mt-1 space-y-0.5">
          {values.map((c, i) => (
            <li key={i} className="break-words">
              <span className="font-medium">{fieldLabel(c)}:</span> {formatValue(c.newValue)}
            </li>
          ))}
        </ul>
      </details>
    )
  }

  const placeholder = failed ? 'Change history could not be loaded.' : loading ? 'Loading…' : 'No changes recorded.'

  return (
    <>
      <DocSection
        title="Change History"
        action={!last && (
          <Button type="button" variant="ghost" size="sm" loading={loading} onClick={() => load(id, page + 1)}>
            Load older changes
          </Button>
        )}
      />
      {entries.length === 0 ? (
        <div className={`border-t border-[hsl(var(--rule-soft))] px-3 py-2.5 text-sm italic ${MUTED}`}>{placeholder}</div>
      ) : (
        <DocLines
          rows={entries}
          rowKey={e => e.id}
          columns={[
            { key: 'at', label: 'Date / Time', width: '11rem', render: e => <span className="whitespace-nowrap tabular-nums">{formatDateTime(e.changedAt)}</span> },
            { key: 'action', label: 'Action', width: '6rem', render: e => ACTION_LABEL[e.action] },
            { key: 'by', label: 'By', width: '10rem', render: e => <span className="block truncate">{e.changedBy ? resolveDisplayName(e.changedBy) : '—'}</span> },
            { key: 'changes', label: 'Changes', render: renderChanges },
          ]}
        />
      )}
    </>
  )
}
