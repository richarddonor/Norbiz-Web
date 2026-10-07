import { originLabel, type TransactionOrigin } from '@/lib/transactionOrigin'

/** Small list-cell badge; renders nothing for NATIVE so ordinary rows stay uncluttered. */
export function OriginBadge({ origin }: { origin: TransactionOrigin }) {
  if (origin === 'NATIVE') return null
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]">
      {originLabel(origin)}
    </span>
  )
}

/** Banner above a migrated/reconstructed document so nobody mistakes it for one posted in Norbiz. */
export function OriginNotice({ origin }: { origin: TransactionOrigin }) {
  if (origin === 'NATIVE') return null
  return (
    <div role="note" className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/60 px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
      {origin === 'MIGRATED'
        ? 'Migrated from the legacy system. The reference number is the original legacy number.'
        : 'Reconstructed during the legacy migration to complete a flow the legacy data skipped. See Remarks for the source.'}
    </div>
  )
}
