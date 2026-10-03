import { useState, type Key, type ReactNode } from 'react'
import { ChevronDown, ListChecks } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { DocSection, DocLines } from '@/components/ui/doc-form'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useContentFocus } from '@/components/AppLayout'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import type { AvailableTransactionAction, TransactionActivity } from '@/hooks/useTransactionActivity'
import { formatDateTime } from '@/lib/format'

// Action menu + history section for transaction record tabs; data comes from useTransactionActivity.

/** "Actions ▾" dropdown for the record tab's action bar. Hidden on voided transactions and when
 * the user's roles allow none of the configured actions. `A` opens it. */
export function TransactionActionsMenu({ activity, voided }: { activity: TransactionActivity; voided: boolean }) {
  const resolveDisplayName = useUserDisplayNames()
  const { zone } = useContentFocus()
  const [open, setOpen] = useState(false)
  const visible = activity.actions
    .filter(a => a.allowedForMe)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const shown = !voided && visible.length > 0

  useHotkeys([{ key: 'a', handler: () => setOpen(true) }], shown && zone === 'content')

  if (!shown) return null

  function note(a: AvailableTransactionAction) {
    if (a.takenByMe) return 'Done by you'
    if (!a.prerequisitesMet) return `Needs: ${a.missingPrerequisites.join(', ')}`
    if (a.takenBy.length > 0) return `Done by ${a.takenBy.map(u => resolveDisplayName(u)).join(', ')}`
    return null
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" loading={activity.taking}>
          <ListChecks className="w-4 h-4" />
          Actions
          <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">A</kbd>
          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        {visible.map(a => {
          const sub = note(a)
          return (
            <DropdownMenuItem
              key={a.actionDefinitionId}
              disabled={!a.canTake}
              onSelect={() => activity.takeAction(a)}
              className="flex-col items-start gap-0"
            >
              <span>{a.name}</span>
              {sub && <span className="text-xs text-[hsl(var(--muted-foreground))]">{sub}</span>}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface HistoryRecord {
  createdBy: string | null
  createdAt: string | null
  voided: boolean
  voidedBy: string | null
  voidedAt: string | null
}

interface HistoryRow {
  key: Key
  at: ReactNode
  action: string
  by: string
  remarks: string | null
}

const PENDING = 'italic text-[hsl(var(--muted-foreground))]'

/** "Transaction History" section at the foot of a transaction sheet — replaces the old
 * Posted by / Date posted signature strip. `pending` renders the create-mode placeholder. */
export function TransactionHistory(props: { activity: TransactionActivity; record: HistoryRecord } | { pending: true }) {
  const resolveDisplayName = useUserDisplayNames()
  const { displayName, username } = useAuth()

  let rows: HistoryRow[]
  if ('pending' in props) {
    rows = [{ key: 'pending', at: <span className={PENDING}>On posting</span>, action: 'Posted', by: displayName ?? username ?? '', remarks: null }]
  } else {
    const { activity, record } = props
    const events = [...activity.history]
    // Older transactions may predate the history feature (backfill not run) — fall back to the
    // record's own audit fields so who posted/voided it is never lost.
    if (record.createdAt && !events.some(e => e.eventType === 'CREATED')) {
      events.unshift({ id: -1, eventType: 'CREATED', actionCode: null, actionName: null, performedBy: record.createdBy ?? '', performedAt: record.createdAt, remarks: null })
    }
    if (record.voided && record.voidedAt && !events.some(e => e.eventType === 'VOIDED')) {
      events.push({ id: -2, eventType: 'VOIDED', actionCode: null, actionName: null, performedBy: record.voidedBy ?? '', performedAt: record.voidedAt, remarks: null })
    }
    rows = events.map(e => ({
      key: e.id,
      at: formatDateTime(e.performedAt),
      action: e.eventType === 'CREATED' ? 'Posted' : e.eventType === 'VOIDED' ? 'Voided' : (e.actionName ?? e.actionCode ?? 'Action'),
      by: resolveDisplayName(e.performedBy),
      remarks: e.remarks,
    }))
  }

  return (
    <>
      <DocSection title="Transaction History" />
      <DocLines
        rows={rows}
        rowKey={r => r.key}
        columns={[
          { key: 'at', label: 'Date / Time', width: '9.5rem', render: r => <span className="tabular-nums">{r.at}</span> },
          { key: 'action', label: 'Action', render: r => r.action },
          { key: 'by', label: 'By', render: r => r.by || '—' },
          { key: 'remarks', label: 'Remarks', render: r => r.remarks || '' },
        ]}
      />
    </>
  )
}
