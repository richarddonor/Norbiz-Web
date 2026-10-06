import type { StockRow } from '@/lib/lookups'

/**
 * Items whose total outgoing quantity on a create form exceeds the warehouse's on-hand stock —
 * the client-side mirror of the backend rule that on-hand can never go below zero (see Norbiz
 * docs/INVENTORY.md "Negative stock"). `outgoing` returns how much a line takes out of the
 * warehouse (≤ 0 for lines that add stock); lines for the same item are summed, matching the
 * server. Items whose balance hasn't loaded yet are left out — the backend still enforces the rule.
 */
export function shortItems<L extends { itemId: number | '' }>(
  lines: L[],
  stock: Map<number, StockRow>,
  outgoing: (line: L) => number,
): Set<number> {
  const required = new Map<number, number>()
  for (const line of lines) {
    if (line.itemId === '') continue
    const qty = outgoing(line)
    if (!Number.isFinite(qty) || qty <= 0) continue
    required.set(line.itemId, (required.get(line.itemId) ?? 0) + qty)
  }
  const short = new Set<number>()
  for (const [itemId, qty] of required) {
    const row = stock.get(itemId)
    // Compare at the backend's 4-decimal scale so float sums like 0.1 + 0.2 don't misfire.
    if (row && Math.round(qty * 10000) > Math.round(Number(row.quantity) * 10000)) short.add(itemId)
  }
  return short
}
