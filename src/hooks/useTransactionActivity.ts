import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import type { PageResponse } from '@/hooks/usePagedList'

// Backend: /transactions/{type}/{id}/history|actions — see ../Norbiz/docs/TRANSACTION_ACTIONS.md.

export type TransactionType = 'INVENTORY_ADJUSTMENT' | 'PURCHASE_ORDER' | 'PURCHASE_INVOICE' | 'PURCHASE_RECEIPT'
  | 'DELIVERY_RECEIPT' | 'OUTLET_RECEIPT' | 'OUTLET_DELIVERY_RECEIPT' | 'OUTLET_DELIVERY_RETURN'
  | 'STOCK_TRANSFER' | 'OUTLET_PULL_OUT' | 'PULL_OUT_RECEIPT' | 'ASSEMBLY'
  | 'SALES_INVOICE' | 'SALES_INVOICE_RETURN' | 'CUSTOMER_MEMO' | 'SUPPLIER_MEMO' | 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT'
  | 'CUSTOMER_REFUND' | 'SUPPLIER_REFUND' | 'DEPOSIT' | 'BANK_RECONCILIATION' | 'STATEMENT_OF_ACCOUNT'

// Mirrors the backend's TransactionType enum — add an entry when a new transaction type is registered there.
export const TRANSACTION_TYPES: { value: TransactionType; label: string }[] = [
  { value: 'INVENTORY_ADJUSTMENT', label: 'Inventory Adjustment' },
  { value: 'PURCHASE_ORDER', label: 'Purchase Order' },
  { value: 'PURCHASE_INVOICE', label: 'Purchase Invoice' },
  { value: 'PURCHASE_RECEIPT', label: 'Purchase Receipt' },
  { value: 'DELIVERY_RECEIPT', label: 'Delivery Receipt' },
  { value: 'OUTLET_RECEIPT', label: 'Outlet Receipt' },
  { value: 'OUTLET_DELIVERY_RECEIPT', label: 'Outlet Delivery Receipt' },
  { value: 'OUTLET_DELIVERY_RETURN', label: 'Outlet Delivery Return' },
  { value: 'STOCK_TRANSFER', label: 'Stock Transfer' },
  { value: 'OUTLET_PULL_OUT', label: 'Outlet Pull-out' },
  { value: 'PULL_OUT_RECEIPT', label: 'Pull-out Receipt' },
  { value: 'ASSEMBLY', label: 'Assembly' },
  { value: 'SALES_INVOICE', label: 'Sales Invoice' },
  { value: 'SALES_INVOICE_RETURN', label: 'Sales Invoice Return' },
  { value: 'CUSTOMER_MEMO', label: 'Customer Memo' },
  { value: 'SUPPLIER_MEMO', label: 'Supplier Memo' },
  { value: 'CUSTOMER_PAYMENT', label: 'Customer Payment' },
  { value: 'SUPPLIER_PAYMENT', label: 'Supplier Payment' },
  { value: 'CUSTOMER_REFUND', label: 'Customer Refund' },
  { value: 'SUPPLIER_REFUND', label: 'Supplier Refund' },
  { value: 'DEPOSIT', label: 'Deposit' },
  { value: 'BANK_RECONCILIATION', label: 'Bank Reconciliation' },
  { value: 'STATEMENT_OF_ACCOUNT', label: 'Statement of Account' },
]

export function transactionTypeLabel(value: string): string {
  return TRANSACTION_TYPES.find(t => t.value === value)?.label ?? value
}

export interface TransactionEvent {
  id: number
  /** STATUS_CHANGED: a payment's check was deposited/cleared/bounced/replaced/cancelled (remarks say which) */
  eventType: 'CREATED' | 'VOIDED' | 'ACTION' | 'STATUS_CHANGED'
  actionCode: string | null
  actionName: string | null
  performedBy: string
  performedAt: string
  remarks: string | null
}

export interface AvailableTransactionAction {
  actionDefinitionId: number
  code: string
  name: string
  sortOrder: number
  takenByMe: boolean
  allowedForMe: boolean
  prerequisitesMet: boolean
  canTake: boolean
  missingPrerequisites: string[]
  takenBy: string[]
}

export interface TransactionActivity {
  history: TransactionEvent[]
  actions: AvailableTransactionAction[]
  loaded: boolean
  taking: boolean
  takeAction: (action: AvailableTransactionAction) => Promise<void>
}

/** History + available actions for one posted transaction. Pass `id` only while viewing a
 * saved record; `refreshKey` (the record's `voided` flag) re-fetches after a void. */
export function useTransactionActivity(
  type: TransactionType,
  id: number | null | undefined,
  referenceNumber: string | null | undefined,
  refreshKey?: unknown,
): TransactionActivity {
  const { toast } = useToast()
  const [history, setHistory] = useState<TransactionEvent[]>([])
  const [actions, setActions] = useState<AvailableTransactionAction[]>([])
  const [loaded, setLoaded] = useState(false)
  const [taking, setTaking] = useState(false)

  const load = useCallback(async (txnId: number) => {
    const base = `/transactions/${type}/${txnId}`
    const [h, a] = await Promise.allSettled([
      apiFetch<PageResponse<TransactionEvent>>(`${base}/history?page=1&size=500`),
      apiFetch<AvailableTransactionAction[]>(`${base}/actions`),
    ])
    setHistory(h.status === 'fulfilled' ? h.value.content : [])
    setActions(a.status === 'fulfilled' ? a.value : [])
    setLoaded(true)
  }, [type])

  useEffect(() => {
    setHistory([])
    setActions([])
    setLoaded(false)
    if (id) load(id)
  }, [id, refreshKey, load])

  async function takeAction(action: AvailableTransactionAction) {
    if (!id || !action.canTake) return
    // prompt doubles as the confirm (null = cancelled), matching the window.confirm convention.
    const remarks = window.prompt(
      `Take action "${action.name}" on ${referenceNumber ?? 'this transaction'}? This cannot be undone.\n\nRemarks (optional):`,
      '',
    )
    if (remarks === null) return
    setTaking(true)
    try {
      await apiFetch(`/transactions/${type}/${id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ actionDefinitionId: action.actionDefinitionId, remarks: remarks.trim().slice(0, 255) || null }),
      })
      toast(`${action.name} recorded.`, 'success')
      await load(id)
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : `Failed to record ${action.name}.`, 'error')
    } finally {
      setTaking(false)
    }
  }

  return { history, actions, loaded, taking, takeAction }
}
