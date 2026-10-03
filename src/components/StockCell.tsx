import type { StockRow } from '@/lib/lookups'
import { formatQuantity } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Read-only On Hand / In Transit figure beside a transaction line on create — only a
 * guide to whether there's enough stock, so it never appears on a posted transaction.
 * `short` flags the line (destructive colour) when the entered quantity would exceed it.
 */
export function StockCell({ stock, field, itemId, warehouseChosen, short }: {
  stock: Map<number, StockRow>
  field: 'quantity' | 'transitQuantity'
  itemId: number | ''
  warehouseChosen: boolean
  short?: (available: number) => boolean
}) {
  if (itemId === '' || !warehouseChosen) {
    return <span className="text-[hsl(var(--muted-foreground))]">—</span>
  }
  const row = stock.get(itemId)
  if (!row) return <span className="text-[hsl(var(--muted-foreground))]">…</span>
  const available = Number(row[field])
  const insufficient = short?.(available) ?? false
  return (
    <span
      className={cn('tabular-nums', insufficient ? 'text-[hsl(var(--destructive))] font-medium' : 'text-[hsl(var(--muted-foreground))]')}
      title={insufficient ? 'Not enough stock for the entered quantity' : undefined}
    >
      {formatQuantity(available)}
    </span>
  )
}
