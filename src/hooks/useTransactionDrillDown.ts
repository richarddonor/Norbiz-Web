import { useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { navItems, canAccess } from '@/lib/nav'
import type { TransactionType } from '@/hooks/useTransactionActivity'

// Report drill-down: opens the transaction behind a report row in its own record tab.

/** The module page each transaction type's records open under. */
const TRANSACTION_PATHS: Record<TransactionType, string> = {
  INVENTORY_ADJUSTMENT: '/inventory-adjustments',
  PURCHASE_ORDER: '/purchase-orders',
  PURCHASE_INVOICE: '/purchase-invoices',
  PURCHASE_RECEIVE: '/purchase-receives',
  DELIVERY_RECEIPT: '/delivery-receipts',
  OUTLET_RECEIVE: '/outlet-receives',
  OUTLET_DELIVERY_RECEIPT: '/outlet-delivery-receipts',
  OUTLET_DELIVERY_RETURN: '/outlet-delivery-returns',
  STOCK_TRANSFER: '/stock-transfers',
  OUTLET_PULL_OUT: '/outlet-pull-outs',
  PULL_OUT_RECEIVE: '/pull-out-receives',
  ASSEMBLY: '/assemblies',
}

/** The transaction type an inventory movement's `sourceType` refers to — a void posts
 * reversing movements as `<TYPE>_VOID`, which still belong to the original record. */
export function sourceTransactionType(sourceType: string): TransactionType | null {
  const type = sourceType.replace(/_VOID$/, '')
  return type in TRANSACTION_PATHS ? (type as TransactionType) : null
}

/** `canOpen(type)` — whether the user may view that transaction type's records (its
 * module's `VIEW_` permission); `open(type, id)` opens the record in a workspace tab,
 * which fetches it by id. */
export function useTransactionDrillDown() {
  const { hasPermission } = useAuth()
  const { openRecord } = useWorkspace()

  const canOpen = useCallback((type: TransactionType | null): type is TransactionType => {
    if (!type) return false
    const item = navItems.find(n => n.to === TRANSACTION_PATHS[type])
    return !!item && canAccess(item, hasPermission)
  }, [hasPermission])

  const open = useCallback((type: TransactionType | null, id: number) => {
    if (canOpen(type)) openRecord(`${TRANSACTION_PATHS[type]}/${id}`, { mode: 'view' })
  }, [canOpen, openRecord])

  return { canOpen, open }
}
