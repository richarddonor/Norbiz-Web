import { useState, useMemo, useEffect, type FormEvent } from 'react'
import { Plus, Ban, X } from 'lucide-react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocLines, DocTotals, DocStamp, DocSection, PendingNumber } from '@/components/ui/doc-form'
import { useRecordTab, useIsRecordTab } from '@/hooks/useRecordTab'
import { RecordSheet, RECORD_ACTIONS, CloseButton } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { TransactionActionsMenu, TransactionHistory } from '@/components/TransactionActivity'
import { useTransactionActivity } from '@/hooks/useTransactionActivity'
import { reloadList } from '@/hooks/usePagedList'
import { PrintButton } from '@/components/PrintButton'
import { OriginBadge, OriginNotice } from '@/components/TransactionOrigin'
import { ORIGIN_COLUMN, originLabel } from '@/lib/transactionOrigin'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { useLookup } from '@/lib/lookups'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'
import { AccountingList, VoidedBadge, type ListColumn } from '@/components/accounting/AccountingList'
import { useCompanyOptions } from '@/components/accounting/useCompanyOptions'
import { cents, sum, todayIso, type AccountingDocument, type BankAccountLookupOption } from '@/lib/accounting'

type FormMode = 'view' | 'create'

interface BankEntry {
  id: number
  entryDate: string
  entryType: string
  amount: string
  sourceType: string
  referenceNumber: string
  checkNumber: string | null
  checkDate: string | null
  description: string | null
}

interface Candidates {
  previousBalance: string
  previousReconciliationReferenceNumber: string | null
  previousStatementDate: string | null
  bookBalance: string
  entries: BankEntry[]
}

interface Reconciliation extends AccountingDocument {
  bankAccountId: number
  bankAccountName: string
  bankAccountNumber: string
  statementDate: string
  previousBalance: string
  statementEndingBalance: string
  clearedTotal: string
  adjustmentsTotal: string
  bookBalance: string
  outstandingTotal: string
  lines: { id: number; kind: 'CLEARED_ENTRY' | 'ADJUSTMENT'; adjustmentType: string | null; entryDate: string; referenceNumber: string;
    checkNumber: string | null; description: string | null; amount: string; lineNumber: number }[] | null
}

interface AdjustmentDraft {
  type: string
  description: string
  amount: string
}

const ADJUSTMENT_TYPES = [
  { value: 'BANK_CHARGE', label: 'Bank Charge' },
  { value: 'INTEREST', label: 'Interest' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
]

const ENTRY_LABELS: Record<string, string> = {
  DEPOSIT: 'Deposit', TRANSFER_RECEIPT: 'Transfer In', CHECK_RETURNED: 'Returned Check', CHECK_DISBURSEMENT: 'Check Issued',
  TRANSFER_DISBURSEMENT: 'Transfer Out', BANK_CHARGE: 'Bank Charge', INTEREST: 'Interest', ADJUSTMENT: 'Adjustment',
}

const EMPTY_ADJUSTMENT: AdjustmentDraft = { type: 'BANK_CHARGE', description: '', amount: '' }

/** A bank charge reduces the balance and interest raises it, whatever sign was typed; adjustments keep theirs. */
function signedAdjustment(a: AdjustmentDraft): number {
  const n = Number(a.amount) || 0
  if (a.type === 'BANK_CHARGE') return -Math.abs(n)
  if (a.type === 'INTEREST') return Math.abs(n)
  return n
}

function buildColumns(showCompanyColumn: boolean): ListColumn<Reconciliation>[] {
  const columns: ListColumn<Reconciliation>[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true, muted: true, value: r => r.companyName })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: r => r.referenceNumber },
    { key: 'sheetNumber', label: 'Sheet #', sortable: true, filterable: true, muted: true, value: r => r.sheetNumber ?? '' },
    { key: 'bankAccount', label: 'Bank Account', sortable: true, filterable: true, value: r => `${r.bankAccountName} (${r.bankAccountNumber})` },
    { key: 'date', label: 'Statement Date', sortable: true, filterable: true, type: 'date', value: r => formatDate(r.statementDate) },
    { key: 'previousBalance', label: 'Previous Balance', align: 'right', value: r => formatCurrency(r.previousBalance) },
    { key: 'statementEndingBalance', label: 'Ending Balance', sortable: true, align: 'right', value: r => formatCurrency(r.statementEndingBalance) },
    { key: 'outstandingTotal', label: 'Outstanding', align: 'right', value: r => formatCurrency(r.outstandingTotal) },
    { ...ORIGIN_COLUMN, filterable: true, value: r => originLabel(r.origin), render: r => <OriginBadge origin={r.origin} /> },
    { key: 'voided', label: 'Voided', sortable: true, type: 'boolean', filterable: true, value: r => r.voided ? 'Yes' : '', render: r => <VoidedBadge voided={r.voided} /> },
  )
  return columns
}

// Bank Reconciliation (docs/ACCOUNTING.md "Bank book and reconciliation"): tick the book entries the bank statement
// shows, add bank-only items, and post once previous balance + cleared + adjustments equals the statement's ending
// balance. Clearing a deposit clears its checks; clearing a check we issued clears that check.
export function BankReconciliationsPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const inRecordTab = useIsRecordTab()
  const companyOptions = useCompanyOptions(inRecordTab)

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<Reconciliation>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Reconciliation>(`/bank-reconciliations/${id}`),
  })
  const [active, setActive] = useState<Reconciliation | null>(null)
  const [companyId, setCompanyId] = useState<number | ''>('')
  const [bankAccountId, setBankAccountId] = useState<number | ''>('')
  const [statementDate, setStatementDate] = useState(todayIso())
  const [endingBalance, setEndingBalance] = useState('')
  const [sheetNumber, setSheetNumber] = useState('')
  const [remarks, setRemarks] = useState('')
  const [candidates, setCandidates] = useState<Candidates | null>(null)
  const [cleared, setCleared] = useState<number[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const { markClean, guardedClose } = useDirtyGuard()

  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const accounts = useLookup<BankAccountLookupOption>('bank-accounts', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load bank accounts.', 'error') })

  useEffect(() => {
    if (!creating || !bankAccountId || !statementDate) { setCandidates(null); return }
    let cancelled = false
    apiFetch<Candidates>(`/bank-reconciliations/candidates?bankAccountId=${bankAccountId}&statementDate=${statementDate}`)
      .then(c => { if (!cancelled) { setCandidates(c); setCleared(prev => prev.filter(id => c.entries.some(e => e.id === id))) } })
      .catch(err => { if (!cancelled) toast(mutationErrorMessage(err, 'Failed to load the account\'s book entries.'), 'error') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, bankAccountId, statementDate])

  const canCreate = hasPermission('CREATE_BANK_RECONCILIATION')
  const canVoid = hasPermission('VOID_BANK_RECONCILIATION')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const activity = useTransactionActivity('BANK_RECONCILIATION', inRecordTab && mode === 'view' ? active?.id : null, active?.referenceNumber, active?.voided)

  const entries = candidates?.entries ?? []
  const previous = Number(candidates?.previousBalance ?? 0)
  const clearedTotal = cents(sum(entries.filter(e => cleared.includes(e.id)).map(e => e.amount)))
  const adjustmentsTotal = cents(adjustments.reduce((s, a) => s + (a.amount.trim() ? signedAdjustment(a) : 0), 0))
  const computed = cents(previous + clearedTotal + adjustmentsTotal)
  const difference = endingBalance.trim() === '' ? null : cents(Number(endingBalance) - computed)

  function openView(reconciliation: Reconciliation) {
    if (!rec.isRecordTab) return rec.open('view', reconciliation)
    setActive(reconciliation)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActive(null)
    const next = { companyId: activeCompanyId ?? '' as number | '', bankAccountId: '' as const, statementDate: todayIso(), endingBalance: '', sheetNumber: '', remarks: '',
      cleared: [] as number[], adjustments: [] as AdjustmentDraft[] }
    setCompanyId(next.companyId)
    setBankAccountId('')
    setStatementDate(next.statementDate)
    setEndingBalance('')
    setSheetNumber('')
    setRemarks('')
    setCleared([])
    setAdjustments([])
    setCandidates(null)
    markClean(next)
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, bankAccountId, statementDate, endingBalance, sheetNumber, remarks, cleared, adjustments }, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!bankAccountId) return toast('Select the bank account.', 'error')
    if (endingBalance.trim() === '') return toast('Enter the statement\'s ending balance.', 'error')
    if (adjustments.some(a => a.amount.trim() !== '' && !a.description.trim())) return toast('Describe every adjustment.', 'error')
    if (difference !== 0) return toast(`Not balanced yet: the difference is ${formatCurrency(difference)}.`, 'error')
    if (!window.confirm('Post this bank reconciliation? Only the account\'s latest reconciliation can be voided.')) return
    setLoading(true)
    try {
      await apiFetch('/bank-reconciliations', {
        method: 'POST',
        body: JSON.stringify({
          bankAccountId,
          statementDate,
          statementEndingBalance: cents(Number(endingBalance)),
          sheetNumber: sheetNumber || null,
          remarks: remarks || null,
          clearedEntryIds: cleared,
          adjustments: adjustments.filter(a => a.amount.trim() !== '').map(a => ({ type: a.type, amount: cents(signedAdjustment(a)), description: a.description.trim() })),
        }),
      })
      toast('Bank reconciliation posted successfully.', 'success')
      rec.close()
      reloadList('/bank-reconciliations')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post bank reconciliation.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVoid() {
    if (!active) return
    if (!window.confirm(`Void bank reconciliation "${active.referenceNumber}"? Its entries become uncleared again. This cannot be undone.`)) return
    setVoiding(true)
    try {
      setActive(await apiFetch<Reconciliation>(`/bank-reconciliations/${active.id}/void`, { method: 'POST' }))
      toast('Bank reconciliation voided.', 'success')
      reloadList('/bank-reconciliations')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void bank reconciliation.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const tabTitle = mode === 'create' ? 'New Bank Reconciliation' : active?.referenceNumber || 'Bank Reconciliation'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <AccountingList
          title="Bank Reconciliations"
          endpoint="/bank-reconciliations"
          listKey="bank-reconciliations"
          columns={COLUMNS}
          searchText={r => [r.referenceNumber, r.sheetNumber ?? '', r.bankAccountName, r.bankAccountNumber, r.remarks ?? '', r.companyName].join(' ')}
          onOpen={openView}
          noun="bank reconciliations"
          defaultDateKey={null}
          onCreate={canCreate ? openCreate : undefined}
          dimmed={r => r.voided}
        />
      )}

      {inRecordTab && (
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-none">
          {mode === 'view' && active ? (
            <div className="space-y-4">
              <OriginNotice origin={active.origin} />
              <DocSheet>
                {active.voided && <DocStamp text="Voided" />}
                <DocLetterhead company={<CompanyField id="brc-company" readOnly name={active.companyName} />}>
                  <DocHeader title="Bank Reconciliation" number={active.referenceNumber}>
                    <DocRow>
                      <DocCell label="Statement Date"><DocText>{formatDate(active.statementDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{active.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Bank Account"><DocText>{active.bankAccountName} ({active.bankAccountNumber})</DocText></DocCell>
                  <DocCell label="Book Balance"><DocText>{formatCurrency(active.bookBalance)}</DocText></DocCell>
                  <DocCell label="Outstanding (deposits in transit, checks)"><DocText>{formatCurrency(active.outstandingTotal)}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(active.lines ?? [])}
                  rowKey={l => l.id}
                  lineNumber={l => l.lineNumber}
                  minRows={6}
                  columns={[
                    { key: 'date', label: 'Date', width: '7rem', render: l => formatDate(l.entryDate) },
                    { key: 'kind', label: 'Kind', width: '9rem', render: l => l.kind === 'ADJUSTMENT' ? (ADJUSTMENT_TYPES.find(t => t.value === l.adjustmentType)?.label ?? 'Adjustment') : 'Cleared' },
                    { key: 'reference', label: 'Reference', width: '10rem', render: l => l.referenceNumber },
                    { key: 'check', label: 'Check #', width: '8rem', render: l => l.checkNumber ?? '' },
                    { key: 'description', label: 'Description', render: l => l.description ?? '' },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: l => formatCurrency(l.amount) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{active.remarks}</DocText></DocCell>
                  <DocTotals entries={[
                    { label: 'Previous Balance', value: formatCurrency(active.previousBalance) },
                    { label: 'Cleared', value: formatCurrency(active.clearedTotal) },
                    { label: 'Adjustments', value: formatCurrency(active.adjustmentsTotal) },
                    { label: 'Statement Ending Balance', value: formatCurrency(active.statementEndingBalance), grand: true },
                  ]} />
                </DocRow>
                <TransactionHistory activity={activity} record={active} />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={active.voided} />
                {canVoid && !active.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton companyId={active.companyId} documentType="BANK_RECONCILIATION" data={active as unknown as Record<string, unknown>}
                    onError={() => toast(`No active print template configured for Bank Reconciliations under ${active.companyName}.`, 'error')} />
                )}
                <CloseButton onClick={requestClose} />
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <DocSheet>
                <DocLetterhead company={
                  <CompanyField id="brc-company" readOnly={!showCompanyColumn} name={companyOptions.find(c => c.id === companyId)?.name}
                    companies={companyOptions} value={companyId} onChange={v => { setCompanyId(v); setBankAccountId('') }} autoFocus={showCompanyColumn} />
                }>
                  <DocHeader title="Bank Reconciliation" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Statement Date" htmlFor="brc-date" required>
                        <Input id="brc-date" type="date" value={statementDate} onChange={e => setStatementDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="brc-sheet">
                        <Input id="brc-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Bank Account" htmlFor="brc-account" required>
                    <SearchableSelect id="brc-account" value={bankAccountId === '' ? '' : String(bankAccountId)} onChange={v => { setBankAccountId(v ? Number(v) : ''); setCleared([]) }}
                      options={accounts.map(a => ({ value: String(a.id), label: `${a.name} (${a.accountNumber}) — ${a.bankName}` }))}
                      disabled={!companyId} autoFocus={!showCompanyColumn} />
                  </DocCell>
                  <DocCell label="Previous Balance">
                    <DocText>{candidates ? `${formatCurrency(candidates.previousBalance)}${candidates.previousReconciliationReferenceNumber
                      ? ` (${candidates.previousReconciliationReferenceNumber}, ${formatDate(candidates.previousStatementDate)})` : ' (opening balance)'}` : ''}</DocText>
                  </DocCell>
                  <DocCell label="Book Balance"><DocText>{candidates ? formatCurrency(candidates.bookBalance) : ''}</DocText></DocCell>
                  <DocCell label="Statement Ending Balance" htmlFor="brc-ending" required>
                    <Input id="brc-ending" type="number" step="0.01" value={endingBalance} onChange={e => setEndingBalance(e.target.value)} className="text-right" />
                  </DocCell>
                </DocRow>
                <DocSection
                  title="Uncleared Book Entries — tick what the statement shows"
                  action={entries.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setCleared(cleared.length ? [] : entries.map(e => e.id))}>
                      {cleared.length ? 'Clear all' : 'Tick all'}
                    </Button>
                  )}
                />
                <DocLines
                  rows={entries}
                  rowKey={e => e.id}
                  minRows={6}
                  columns={[
                    {
                      key: 'pick', label: '', align: 'center', width: '2.75rem',
                      render: e => <input type="checkbox" aria-label={`Cleared ${e.referenceNumber}`} checked={cleared.includes(e.id)}
                        onChange={() => setCleared(prev => prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id])} />,
                    },
                    { key: 'date', label: 'Date', width: '7rem', readOnly: true, render: e => formatDate(e.entryDate) },
                    { key: 'type', label: 'Type', width: '9rem', readOnly: true, render: e => ENTRY_LABELS[e.entryType] ?? e.entryType },
                    { key: 'reference', label: 'Reference', width: '10rem', readOnly: true, render: e => e.referenceNumber },
                    { key: 'check', label: 'Check #', width: '8rem', readOnly: true, render: e => e.checkNumber ?? '' },
                    { key: 'description', label: 'Description', readOnly: true, render: e => e.description ?? '' },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', readOnly: true, render: e => formatCurrency(e.amount) },
                  ]}
                  footer={bankAccountId && entries.length === 0 && <span className="text-xs text-[hsl(var(--muted-foreground))]">No uncleared entries up to the statement date.</span>}
                />
                <DocSection
                  title="Bank-only Items (charges, interest)"
                  action={
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setAdjustments(prev => [...prev, EMPTY_ADJUSTMENT])}>
                      <Plus className="w-3.5 h-3.5" />
                      Add Item
                    </Button>
                  }
                />
                {adjustments.length > 0 && (
                  <DocLines
                    rows={adjustments}
                    columns={[
                      {
                        key: 'type', label: 'Type', width: '10rem',
                        render: (a, i) => <SearchableSelect value={a.type} onChange={v => setAdjustments(prev => prev.map((x, j) => j === i ? { ...x, type: v || 'BANK_CHARGE' } : x))}
                          options={ADJUSTMENT_TYPES} />,
                      },
                      {
                        key: 'description', label: 'Description', required: true,
                        render: (a, i) => <Input aria-label={`Item ${i + 1} description`} value={a.description} maxLength={255}
                          onChange={e => setAdjustments(prev => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />,
                      },
                      {
                        key: 'amount', label: 'Amount', align: 'right', width: '9rem', required: true,
                        render: (a, i) => <Input type="number" step="0.01" aria-label={`Item ${i + 1} amount`} value={a.amount} className="text-right"
                          onChange={e => setAdjustments(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />,
                      },
                      {
                        key: 'remove', label: '', align: 'center', width: '2.75rem',
                        render: (_, i) => (
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove item ${i + 1}`}
                            onClick={() => setAdjustments(prev => prev.filter((_, j) => j !== i))}>
                            <X className="w-4 h-4" />
                          </Button>
                        ),
                      },
                    ]}
                  />
                )}
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="brc-remarks">
                    <Input id="brc-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[
                    { label: 'Previous Balance', value: formatCurrency(previous) },
                    { label: `Cleared (${cleared.length})`, value: formatCurrency(clearedTotal) },
                    { label: 'Bank-only Items', value: formatCurrency(adjustmentsTotal) },
                    { label: 'Computed Ending Balance', value: formatCurrency(computed), grand: true },
                    {
                      label: 'Difference',
                      value: <span className={cn(difference !== null && difference !== 0 && 'text-[hsl(var(--destructive))]')}>{difference === null ? '—' : formatCurrency(difference)}</span>,
                    },
                  ]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading} disabled={difference !== 0}>Post Reconciliation</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}
    </div>
  )
}
