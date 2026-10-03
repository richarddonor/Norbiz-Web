import { useEffect, useState } from 'react'
import { fetchAllContent } from '@/hooks/usePagedList'
import { apiFetch } from '@/lib/api'

// Dropdown data comes from the backend's slim `/lookups/*` endpoints (see
// ../Norbiz/docs/LIST_FILTERING.md "Dropdown lookups"), never from the full list
// endpoints: lookups are open to anyone whose form needs the data (e.g.
// CREATE_PURCHASE_ORDER can load suppliers without VIEW_SUPPLIER), and are
// always scoped to exactly one company.

export interface LookupOption {
  id: number
  /** null for system-wide (Role) and multi-company (User) records */
  companyId: number | null
  /** item code / employee code / username / role name / item group BN initials; null for item categories */
  code: string | null
  /** display name; employees are "First Last", users their display name */
  name: string
  active: boolean
}

export interface ItemLookupOption extends LookupOption {
  tags: string[]
  /** null unless the caller has VIEW_COST_PRICE */
  costPrice: number | null
}

export interface SourceLine {
  id: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  quantity: number
  quantityLoaded: number
  /** null unless the caller has VIEW_COST_PRICE */
  costPrice: number | null
}

export interface TransactionLookupOption {
  id: number
  companyId: number
  referenceNumber: string
  transactionDate: string
  supplierId: number
  supplierName: string
  warehouseId: number
  warehouseName: string
  /** Purchase Invoice only: the originating PO, null for a Direct invoice */
  purchaseOrderId: number | null
  voided: boolean
  loaded: boolean
  lines: SourceLine[]
}

/**
 * Loads every option of a `/lookups/<path>` dropdown for one company, refetching
 * when the company changes (e.g. the form's CompanyField). Returns `[]` until a
 * company is known — lookups never mix companies. Roles are system-wide, so pass
 * `{ global: true }` for them.
 */
export function useLookup<T>(
  path: string,
  companyId: number | '' | null | undefined,
  options?: { params?: Record<string, string>; enabled?: boolean; global?: boolean; onError?: () => void },
): T[] {
  const enabled = options?.enabled ?? true
  const global = options?.global ?? false
  const params = new URLSearchParams(options?.params)
  if (!global && companyId) params.set('companyId', String(companyId))
  const qs = params.toString()
  // null = nothing to fetch yet (disabled, or no company chosen)
  const url = enabled && (global || companyId) ? `/lookups/${path}${qs ? `?${qs}` : ''}` : null

  // Rows are tagged with the url they came from, so a company switch never shows
  // the previous company's options while the new ones load.
  const [state, setState] = useState<{ url: string | null; rows: T[] }>({ url: null, rows: [] })

  useEffect(() => {
    if (!url) return
    let cancelled = false
    fetchAllContent<T>(url)
      .then(rows => { if (!cancelled) setState({ url, rows }) })
      .catch(() => { if (!cancelled) options?.onError?.() })
    return () => { cancelled = true }
    // options.onError is intentionally not a dependency — callers pass inline lambdas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  return url && state.url === url ? state.rows : EMPTY
}

const EMPTY: never[] = []

/** Live balance of one item in one warehouse (`/lookups/stock`). */
export interface StockRow {
  itemId: number
  warehouseId: number
  /** on hand */
  quantity: number
  /** in transit */
  transitQuantity: number
}

/**
 * Current stock for the given items in one warehouse, keyed by itemId. Backs the
 * create-only On Hand / In Transit guide columns on inventory transaction lines.
 * Rows are kept while more items are added (only the new ones show as loading),
 * and dropped when the warehouse or company changes. Refetches whenever the set of
 * items changes, so a newly picked item gets its balance.
 */
export function useStock(
  companyId: number | '' | null | undefined,
  warehouseId: number | '' | null | undefined,
  itemIds: (number | '')[],
  options?: { enabled?: boolean; onError?: () => void },
): Map<number, StockRow> {
  const enabled = options?.enabled ?? true
  const ids = [...new Set(itemIds.filter((id): id is number => id !== ''))].sort((a, b) => a - b)
  const scope = enabled && companyId && warehouseId ? `${companyId}:${warehouseId}` : null
  const url = scope && ids.length > 0
    ? `/lookups/stock?companyId=${companyId}&warehouseId=${warehouseId}&itemIds=${ids.join(',')}`
    : null

  const [state, setState] = useState<{ scope: string | null; rows: Map<number, StockRow> }>({ scope: null, rows: new Map() })

  useEffect(() => {
    if (!url) return
    let cancelled = false
    apiFetch<StockRow[]>(url)
      .then(rows => {
        if (cancelled) return
        setState(prev => {
          const next = new Map(prev.scope === scope ? prev.rows : [])
          for (const r of rows) next.set(r.itemId, r)
          return { scope, rows: next }
        })
      })
      .catch(() => { if (!cancelled) options?.onError?.() })
    return () => { cancelled = true }
    // options.onError is intentionally not a dependency — callers pass inline lambdas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  return scope && state.scope === scope ? state.rows : EMPTY_STOCK
}

const EMPTY_STOCK = new Map<number, StockRow>()
