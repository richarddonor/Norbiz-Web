import { useMemo, useState } from 'react'
import { CheckCircle2, CircleX, Eye } from 'lucide-react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { reloadList } from '@/hooks/usePagedList'
import { useTransactionDrillDown } from '@/hooks/useTransactionDrillDown'
import { formatCurrency, formatDate } from '@/lib/format'
import { AccountingList, type ListColumn } from '@/components/accounting/AccountingList'
import { CheckStatusDialog, type CheckStatusInput } from '@/components/accounting/CheckStatusDialog'
import {
  BOUNCE_REASONS, CANCEL_REASONS, ISSUED_MODES, modeLabel, RECEIVED_MODES, statusLabel, tenderLabel,
  type IssuedTender, type ReceivedTender,
} from '@/lib/accounting'

type CheckAction = { kind: 'clear' | 'bounce' | 'cancel'; id: number; check: string }

const RECEIVED_STATUSES = ['ON_HAND', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'REPLACED'].map(s => ({ value: s, label: statusLabel(s) }))
const ISSUED_STATUSES = ['ISSUED', 'CLEARED', 'CANCELLED'].map(s => ({ value: s, label: statusLabel(s) }))

// Received Checks (customer payment tenders) and Issued Checks (supplier payment tenders): the check registers, with the
// lifecycle actions — clear/bounce a received check, clear/cancel an issued one (docs/ACCOUNTING.md "Check lifecycles").
// A row opens its payment.

export function ReceivedChecksPage() {
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const drillDown = useTransactionDrillDown()
  const [status, setStatus] = useState('ON_HAND')
  const [mode, setMode] = useState('CHECK')
  const [action, setAction] = useState<CheckAction | null>(null)
  const canUpdate = hasPermission('UPDATE_RECEIVED_CHECK_STATUS')

  const columns = useMemo(() => {
    const cols: ListColumn<ReceivedTender>[] = []
    cols.push(
      { key: 'paymentReferenceNumber', label: 'Payment #', sortable: true, filterable: true, mono: true, value: t => t.paymentReferenceNumber },
      { key: 'paymentDate', label: 'Received', sortable: true, value: t => formatDate(t.paymentDate) },
      { key: 'customer', label: 'Customer', sortable: true, filterable: true, value: t => t.customerName },
      { key: 'mode', label: 'Mode', sortable: true, value: t => modeLabel(t.mode) },
      { key: 'checkNumber', label: 'Check #', sortable: true, filterable: true, mono: true, value: t => t.checkNumber ?? '' },
      { key: 'checkDate', label: 'Check Date', sortable: true, filterable: true, type: 'date', value: t => formatDate(t.checkDate) },
      { key: 'bank', label: 'Bank', sortable: true, filterable: true, value: t => t.bankName ?? '' },
      { key: 'amount', label: 'Amount', sortable: true, align: 'right', total: 'currency', value: t => formatCurrency(t.amount) },
      { key: 'status', label: 'Status', sortable: true, value: t => statusLabel(t.status) + (t.bounceReason ? ` (${t.bounceReason})` : '') },
      { key: 'statusDate', label: 'Status Date', sortable: true, value: t => formatDate(t.statusDate) },
      { key: 'deposit', label: 'Deposit', mono: true, value: t => t.depositReferenceNumber ?? '' },
      { key: 'unapplied', label: 'Unapplied', align: 'right', value: t => formatCurrency(t.unappliedAmount) },
    )
    return cols
  }, [])

  async function submit(input: CheckStatusInput) {
    if (!action) return
    try {
      if (action.kind === 'clear') {
        await apiFetch('/customer-payment-tenders/clear', { method: 'POST', body: JSON.stringify({ tenderIds: [action.id], clearedDate: input.date }) })
        toast(`${action.check} cleared.`, 'success')
      } else {
        await apiFetch(`/customer-payment-tenders/${action.id}/bounce`, {
          method: 'POST', body: JSON.stringify({ bouncedDate: input.date, reason: input.reason, remarks: input.remarks || null }),
        })
        toast(`${action.check} bounced — what it paid is open again.`, 'success')
      }
      setAction(null)
      reloadList('/customer-payment-tenders')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to update the check.'), 'error')
    }
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <AccountingList
        title="Received Checks"
        endpoint="/customer-payment-tenders"
        listKey="received-checks"
        columns={columns}
        searchText={t => [t.paymentReferenceNumber, t.customerName, t.checkNumber ?? '', t.bankName ?? '', t.depositReferenceNumber ?? '', statusLabel(t.status)].join(' ')}
        onOpen={t => drillDown.open('CUSTOMER_PAYMENT', t.paymentId)}
        noun="received checks"
        defaultDateKey={null}
        totals
        pinnedKey="paymentReferenceNumber"
        extraFilters={{ status, mode }}
        toolbar={<>
          <SearchableSelect value={mode} onChange={setMode} options={RECEIVED_MODES} placeholder="All modes" className="w-40" />
          <SearchableSelect value={status} onChange={setStatus} options={RECEIVED_STATUSES} placeholder="All statuses" className="w-40" />
        </>}
        rowActions={t => (
          <div className="flex items-center justify-end gap-1">
            {canUpdate && t.mode === 'CHECK' && t.status === 'DEPOSITED' && (
              <Button variant="ghost" size="sm" title="Mark cleared" onClick={() => setAction({ kind: 'clear', id: t.id, check: tenderLabel(t) })}>
                <CheckCircle2 className="w-4 h-4 text-[hsl(var(--primary))]" />
              </Button>
            )}
            {canUpdate && t.mode === 'CHECK' && (t.status === 'ON_HAND' || t.status === 'DEPOSITED') && (
              <Button variant="ghost" size="sm" title="Bounced" onClick={() => setAction({ kind: 'bounce', id: t.id, check: tenderLabel(t) })}>
                <CircleX className="w-4 h-4 text-[hsl(var(--destructive))]" />
              </Button>
            )}
            <Button variant="ghost" size="sm" title="Open payment" onClick={() => drillDown.open('CUSTOMER_PAYMENT', t.paymentId)}>
              <Eye className="w-4 h-4" />
            </Button>
          </div>
        )}
      />
      <CheckStatusDialog
        action={action && {
          title: action.kind === 'clear' ? 'Mark Check Cleared' : 'Check Bounced',
          check: `${action.check}`,
          submitLabel: action.kind === 'clear' ? 'Mark Cleared' : 'Record Bounce',
          reasons: action.kind === 'bounce' ? BOUNCE_REASONS : undefined,
        }}
        onClose={() => setAction(null)}
        onSubmit={submit}
      />
    </div>
  )
}

export function IssuedChecksPage() {
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const drillDown = useTransactionDrillDown()
  const [status, setStatus] = useState('ISSUED')
  const [mode, setMode] = useState('CHECK')
  const [action, setAction] = useState<CheckAction | null>(null)
  const canUpdate = hasPermission('UPDATE_ISSUED_CHECK_STATUS')

  const columns = useMemo(() => {
    const cols: ListColumn<IssuedTender>[] = []
    cols.push(
      { key: 'paymentReferenceNumber', label: 'Payment #', sortable: true, filterable: true, mono: true, value: t => t.paymentReferenceNumber },
      { key: 'paymentDate', label: 'Issued', sortable: true, value: t => formatDate(t.paymentDate) },
      { key: 'supplier', label: 'Supplier', sortable: true, filterable: true, value: t => t.supplierName },
      { key: 'mode', label: 'Mode', sortable: true, value: t => modeLabel(t.mode) },
      { key: 'bankAccount', label: 'Account', sortable: true, value: t => t.bankAccountName ?? '' },
      { key: 'checkNumber', label: 'Check #', sortable: true, filterable: true, mono: true, value: t => t.checkNumber ?? '' },
      { key: 'checkDate', label: 'Check Date', sortable: true, filterable: true, type: 'date', value: t => formatDate(t.checkDate) },
      { key: 'amount', label: 'Amount', sortable: true, align: 'right', total: 'currency', value: t => formatCurrency(t.amount) },
      { key: 'status', label: 'Status', sortable: true, value: t => statusLabel(t.status) + (t.cancelReason ? ` (${t.cancelReason})` : '') },
      { key: 'statusDate', label: 'Status Date', sortable: true, value: t => formatDate(t.statusDate) },
    )
    return cols
  }, [])

  async function submit(input: CheckStatusInput) {
    if (!action) return
    try {
      if (action.kind === 'clear') {
        await apiFetch('/supplier-payment-tenders/clear', { method: 'POST', body: JSON.stringify({ tenderIds: [action.id], clearedDate: input.date }) })
        toast(`${action.check} cleared.`, 'success')
      } else {
        await apiFetch(`/supplier-payment-tenders/${action.id}/cancel`, {
          method: 'POST', body: JSON.stringify({ cancelledDate: input.date, reason: input.reason, remarks: input.remarks || null }),
        })
        toast(`${action.check} cancelled — what it paid is open again.`, 'success')
      }
      setAction(null)
      reloadList('/supplier-payment-tenders')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to update the check.'), 'error')
    }
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <AccountingList
        title="Issued Checks"
        endpoint="/supplier-payment-tenders"
        listKey="issued-checks"
        columns={columns}
        searchText={t => [t.paymentReferenceNumber, t.voucherNumber ?? '', t.supplierName, t.checkNumber ?? '', t.bankAccountName ?? '', statusLabel(t.status)].join(' ')}
        onOpen={t => drillDown.open('SUPPLIER_PAYMENT', t.paymentId)}
        noun="issued checks"
        defaultDateKey={null}
        totals
        pinnedKey="paymentReferenceNumber"
        extraFilters={{ status, mode }}
        toolbar={<>
          <SearchableSelect value={mode} onChange={setMode} options={ISSUED_MODES} placeholder="All modes" className="w-40" />
          <SearchableSelect value={status} onChange={setStatus} options={ISSUED_STATUSES} placeholder="All statuses" className="w-40" />
        </>}
        rowActions={t => (
          <div className="flex items-center justify-end gap-1">
            {canUpdate && t.status === 'ISSUED' && (
              <>
                <Button variant="ghost" size="sm" title="Mark cleared" onClick={() => setAction({ kind: 'clear', id: t.id, check: tenderLabel(t) })}>
                  <CheckCircle2 className="w-4 h-4 text-[hsl(var(--primary))]" />
                </Button>
                <Button variant="ghost" size="sm" title="Cancel check" onClick={() => setAction({ kind: 'cancel', id: t.id, check: tenderLabel(t) })}>
                  <CircleX className="w-4 h-4 text-[hsl(var(--destructive))]" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" title="Open payment" onClick={() => drillDown.open('SUPPLIER_PAYMENT', t.paymentId)}>
              <Eye className="w-4 h-4" />
            </Button>
          </div>
        )}
      />
      <CheckStatusDialog
        action={action && {
          title: action.kind === 'clear' ? 'Mark Check Cleared' : 'Cancel Check',
          check: action.check,
          submitLabel: action.kind === 'clear' ? 'Mark Cleared' : 'Cancel Check',
          reasons: action.kind === 'cancel' ? CANCEL_REASONS : undefined,
        }}
        onClose={() => setAction(null)}
        onSubmit={submit}
      />
    </div>
  )
}
