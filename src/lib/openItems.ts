import { useToast } from '@/context/ToastContext'
import { useLookup } from '@/lib/lookups'
import { formatCurrency, formatDate } from '@/lib/format'
import { cents, sourceTypeLabel, type AccountSide, type OpenItem, type OpenItemDirection } from '@/lib/accounting'

// Open-item pickers shared by the accounting forms (OpenItemLinesEditor renders them).

/** One line applying (or refunding) an amount against an open item. */
export interface OpenItemLineDraft {
  openItemId: number | ''
  amount: string
}

export const EMPTY_OPEN_ITEM_LINE: OpenItemLineDraft = { openItemId: '', amount: '' }

/** A party's OPEN items of one direction, for a picker (`/lookups/open-items`, not cached). */
export function useOpenItems(companyId: number | '' | null | undefined, side: AccountSide, partyId: number | '', direction: OpenItemDirection,
                             enabled: boolean): OpenItem[] {
  const { toast } = useToast()
  const params: Record<string, string> = { side, direction }
  if (partyId !== '') params[side === 'RECEIVABLE' ? 'customerId' : 'supplierId'] = String(partyId)
  return useLookup<OpenItem>('open-items', companyId, {
    params,
    enabled: enabled && partyId !== '',
    onError: () => toast('Failed to load open items.', 'error'),
  })
}

export function openItemOptionLabel(o: OpenItem): string {
  const due = o.dueDate ? ` · due ${formatDate(o.dueDate)}` : ''
  return `${o.referenceNumber} — ${sourceTypeLabel(o.sourceType)}${due} · balance ${formatCurrency(o.balance)}`
}

/** Validates drafts: returns the filled lines, or an error message. */
export function validOpenItemLines(rows: OpenItemLineDraft[], items: OpenItem[]): { lines: { openItemId: number; amount: number }[] } | { error: string } {
  const filled = rows.filter(r => r.openItemId !== '' || r.amount.trim() !== '')
  const byId = new Map(items.map(o => [o.id, o]))
  for (const r of filled) {
    if (r.openItemId === '') return { error: 'Pick a document on every line, or remove the empty line.' }
    const amount = Number(r.amount)
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Every line needs an amount greater than zero.' }
    const item = byId.get(r.openItemId)
    if (item && amount > Number(item.balance)) return { error: `${item.referenceNumber}: ${formatCurrency(amount)} is more than its balance of ${formatCurrency(item.balance)}.` }
  }
  return { lines: filled.map(r => ({ openItemId: r.openItemId as number, amount: cents(Number(r.amount)) })) }
}
