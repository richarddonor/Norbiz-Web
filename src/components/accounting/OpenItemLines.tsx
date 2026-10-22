import { Plus, X, ListOrdered } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocLines, DocSection } from '@/components/ui/doc-form'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { formatCurrency, formatDate } from '@/lib/format'
import { cents, sourceTypeLabel, statusLabel, type Allocation, type OpenItem } from '@/lib/accounting'
import { EMPTY_OPEN_ITEM_LINE, openItemOptionLabel, type OpenItemLineDraft } from '@/lib/openItems'

interface EditorProps {
  title: string
  items: OpenItem[]
  rows: OpenItemLineDraft[]
  onChange: (rows: OpenItemLineDraft[]) => void
  /** What the document can still apply (e.g. the payment total); enables "Fill oldest first". */
  available?: number
  disabled?: boolean
  emptyHint: string
}

/**
 * Editable grid of applications to a party's open items — a payment's or credit memo's applications to charges, or a
 * refund's credits. The picker lists the party's OPEN items; Balance shows what is still open on each.
 */
export function OpenItemLinesEditor({ title, items, rows, onChange, available, disabled, emptyHint }: EditorProps) {
  const byId = new Map(items.map(o => [o.id, o]))

  function update(index: number, patch: Partial<OpenItemLineDraft>) {
    onChange(rows.map((r, i) => i === index ? { ...r, ...patch } : r))
  }

  // Applies the available amount to the oldest-due items first, replacing the current lines.
  function fillOldestFirst() {
    let left = cents(available ?? 0)
    const next: OpenItemLineDraft[] = []
    const sorted = [...items].sort((a, b) => (a.dueDate ?? a.documentDate).localeCompare(b.dueDate ?? b.documentDate) || a.id - b.id)
    for (const o of sorted) {
      if (left <= 0) break
      const take = cents(Math.min(left, Number(o.balance)))
      if (take <= 0) continue
      next.push({ openItemId: o.id, amount: take.toFixed(2) })
      left = cents(left - take)
    }
    onChange(next.length ? next : [EMPTY_OPEN_ITEM_LINE])
  }

  return (
    <>
      <DocSection
        title={title}
        action={available !== undefined && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={fillOldestFirst} disabled={disabled || items.length === 0 || available <= 0}>
            <ListOrdered className="w-3.5 h-3.5" />
            Fill oldest first
          </Button>
        )}
      />
      <DocLines
        rows={rows}
        columns={[
          {
            key: 'item', label: 'Document',
            render: (row, i) => (
              <SearchableSelect
                value={row.openItemId === '' ? '' : String(row.openItemId)}
                onChange={v => {
                  const item = v ? byId.get(Number(v)) : undefined
                  update(i, { openItemId: item ? item.id : '', amount: row.amount || (item ? item.balance : '') })
                }}
                options={items
                  .filter(o => o.id === row.openItemId || !rows.some(r => r.openItemId === o.id))
                  .map(o => ({ value: String(o.id), label: openItemOptionLabel(o) }))}
                disabled={disabled}
              />
            ),
          },
          {
            key: 'due', label: 'Due', width: '7rem', readOnly: true,
            render: row => row.openItemId === '' ? '—' : formatDate(byId.get(row.openItemId)?.dueDate ?? byId.get(row.openItemId)?.documentDate),
          },
          {
            key: 'balance', label: 'Balance', align: 'right', width: '8rem', readOnly: true,
            render: row => <span className="tabular-nums">{row.openItemId === '' ? '—' : formatCurrency(byId.get(row.openItemId)?.balance)}</span>,
          },
          {
            key: 'amount', label: 'Amount', align: 'right', width: '8rem',
            render: (row, i) => (
              <Input type="number" step="0.01" min="0" aria-label={`Line ${i + 1} amount`} value={row.amount}
                onChange={e => update(i, { amount: e.target.value })} className="text-right" disabled={disabled} />
            ),
          },
          {
            key: 'remove', label: '', align: 'center', width: '2.75rem',
            render: (_, i) => (
              <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove line ${i + 1}`}
                onClick={() => onChange(rows.length === 1 ? [EMPTY_OPEN_ITEM_LINE] : rows.filter((_, j) => j !== i))}>
                <X className="w-4 h-4" />
              </Button>
            ),
          },
        ]}
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, EMPTY_OPEN_ITEM_LINE])} disabled={disabled}>
              <Plus className="w-3.5 h-3.5" />
              Add Line
            </Button>
            {!disabled && items.length === 0 && <span className="text-xs text-[hsl(var(--muted-foreground))]">{emptyHint}</span>}
          </div>
        }
      />
    </>
  )
}

/** Read-only list of a document's applications (view mode), reversed ones struck through with why. */
export function AllocationLines({ title, allocations, side }: { title: string; allocations: Allocation[]; side: 'credit' | 'charge' }) {
  if (allocations.length === 0) return null
  return (
    <>
      <DocSection title={title} />
      <DocLines
        dense
        rows={allocations}
        rowKey={a => a.id}
        columns={[
          { key: 'date', label: 'Date', width: '7rem', render: a => formatDate(a.allocationDate) },
          {
            key: 'document', label: side === 'charge' ? 'Applied To' : 'Applied From',
            render: a => (
              <span className={a.reversed ? 'line-through text-[hsl(var(--muted-foreground))]' : undefined}>
                {side === 'charge' ? a.chargeReferenceNumber : a.creditReferenceNumber}
                {' — '}{sourceTypeLabel(side === 'charge' ? a.chargeSourceType : a.creditSourceType)}
              </span>
            ),
          },
          {
            key: 'status', label: 'Status', width: '12rem',
            render: a => a.reversed
              ? `Reversed${a.reversalReason ? ` (${statusLabel(a.reversalReason === 'BOUNCED' ? 'BOUNCED' : a.reversalReason === 'CANCELLED' ? 'CANCELLED' : 'VOIDED')})` : ''} ${formatDate(a.reversedDate)}`
              : a.pending ? 'Pending (check not cleared)' : 'Applied',
          },
          { key: 'amount', label: 'Amount', align: 'right', width: '8rem', render: a => <span className="tabular-nums">{formatCurrency(a.amount)}</span> },
        ]}
      />
    </>
  )
}
