import type { ColumnDef } from '@/components/ColumnsMenu'

/** Mirrors the backend `TransactionOrigin` enum. Only the legacy migration writes anything but NATIVE. */
export type TransactionOrigin = 'NATIVE' | 'MIGRATED' | 'RECONSTRUCTED'

const LABELS: Record<TransactionOrigin, string> = {
  NATIVE: 'Norbiz',
  MIGRATED: 'Migrated',
  RECONSTRUCTED: 'Reconstructed',
}

export function originLabel(origin: TransactionOrigin): string {
  return LABELS[origin] ?? origin
}

/** List column for every transaction page; filters via the backend `origin` query param. */
export const ORIGIN_COLUMN: ColumnDef = {
  key: 'origin',
  label: 'Origin',
  type: 'select',
  options: (Object.keys(LABELS) as TransactionOrigin[]).map(value => ({ value, label: LABELS[value] })),
}
