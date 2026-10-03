import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import type { PageResponse } from '@/hooks/usePagedList'

// Backend: /transactions/{type}/{id}/history|actions — see ../Norbiz/docs/TRANSACTION_ACTIONS.md.

export type TransactionType = 'INVENTORY_ADJUSTMENT' | 'PURCHASE_ORDER' | 'PURCHASE_INVOICE' | 'PURCHASE_RECEIVE'

// Mirrors the backend's TransactionType enum — add an entry when a new transaction type is registered there.
export const TRANSACTION_TYPES: { value: TransactionType; label: string }[] = [
  { value: 'INVENTORY_ADJUSTMENT', label: 'Inventory Adjustment' },
  { value: 'PURCHASE_ORDER', label: 'Purchase Order' },
  { value: 'PURCHASE_INVOICE', label: 'Purchase Invoice' },
  { value: 'PURCHASE_RECEIVE', label: 'Purchase Receive' },
]

export function transactionTypeLabel(value: string): string {
  return TRANSACTION_TYPES.find(t => t.value === value)?.label ?? value
}

export interface TransactionEvent {
  id: number
  eventType: 'CREATED' | 'VOIDED' | 'ACTION'
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
