import { useState, useMemo, useEffect, type FormEvent } from 'react'
import { Ban } from 'lucide-react'
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
import { fetchAllContent, reloadList } from '@/hooks/usePagedList'
import { PrintButton } from '@/components/PrintButton'
import { OriginBadge, OriginNotice } from '@/components/TransactionOrigin'
import { ORIGIN_COLUMN, originLabel } from '@/lib/transactionOrigin'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { useLookup } from '@/lib/lookups'
import { formatCurrency, formatDate } from '@/lib/format'
import { AccountingList, VoidedBadge, type ListColumn } from '@/components/accounting/AccountingList'
import { useCompanyOptions } from '@/components/accounting/useCompanyOptions'
import { modeLabel, statusLabel, sum, tenderLabel, todayIso, type AccountingDocument, type BankAccountLookupOption, type ReceivedTender } from '@/lib/accounting'

type FormMode = 'view' | 'create'

interface Deposit extends AccountingDocument {
  bankAccountId: number
  bankAccountName: string
  bankAccountNumber: string
  depositDate: string
  totalAmount: string
  reconciled: boolean
  lines: ReceivedTender[] | null
}

function buildColumns(showCompanyColumn: boolean): ListColumn<Deposit>[] {
  const columns: ListColumn<Deposit>[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true, muted: true, value: r => r.companyName })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: r => r.referenceNumber },
    { key: 'sheetNumber', label: 'Deposit Slip #', sortable: true, filterable: true, muted: true, value: r => r.sheetNumber ?? '' },
    { key: 'bankAccount', label: 'Bank Account', sortable: true, value: r => `${r.bankAccountName} (${r.bankAccountNumber})` },
    { key: 'date', label: 'Deposit Date', sortable: true, filterable: true, type: 'date', value: r => formatDate(r.depositDate) },
    { key: 'totalAmount', label: 'Total', sortable: true, align: 'right', total: 'currency', value: r => formatCurrency(r.totalAmount) },
    { key: 'remarks', label: 'Remarks', filterable: true, muted: true, value: r => r.remarks ?? '' },
    { ...ORIGIN_COLUMN, filterable: true, value: r => originLabel(r.origin), render: r => <OriginBadge origin={r.origin} /> },
    { key: 'voided', label: 'Voided', sortable: true, type: 'boolean', filterable: true, value: r => r.voided ? 'Yes' : '', render: r => <VoidedBadge voided={r.voided} /> },
  )
  return columns
}

// Deposit (docs/ACCOUNTING.md "Deposits"): takes cash and checks received from customers (ON_HAND tenders) to one of our
// bank accounts. Checks become DEPOSITED until a Bank Reconciliation (or the Received Checks page) clears them.
export function DepositsPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const inRecordTab = useIsRecordTab()
  const companyOptions = useCompanyOptions(inRecordTab)

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<Deposit>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Deposit>(`/deposits/${id}`),
  })
  const [active, setActive] = useState<Deposit | null>(null)
  const [companyId, setCompanyId] = useState<number | ''>('')
  const [bankAccountId, setBankAccountId] = useState<number | ''>('')
  const [depositDate, setDepositDate] = useState(todayIso())
  const [sheetNumber, setSheetNumber] = useState('')
  const [remarks, setRemarks] = useState('')
  const [onHand, setOnHand] = useState<ReceivedTender[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const { markClean, guardedClose } = useDirtyGuard()

  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const accounts = useLookup<BankAccountLookupOption>('bank-accounts', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load bank accounts.', 'error') })

  // Cash and checks still on hand, oldest check date first. The list spans the user's companies, so keep this deposit's.
  useEffect(() => {
    if (!creating || !lookupCompanyId) { setOnHand([]); return }
    Promise.all(['CASH', 'CHECK'].map(m => fetchAllContent<ReceivedTender>(`/customer-payment-tenders?status=ON_HAND&mode=${m}&sort=checkDate,asc`)))
      .then(([cash, checks]) => setOnHand([...cash, ...checks].filter(t => t.companyId === lookupCompanyId)))
      .catch(() => toast('Failed to load cash and checks on hand.', 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, lookupCompanyId])

  const canCreate = hasPermission('CREATE_DEPOSIT')
  const canVoid = hasPermission('VOID_DEPOSIT')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const activity = useTransactionActivity('DEPOSIT', inRecordTab && mode === 'view' ? active?.id : null, active?.referenceNumber, active?.voided)
  const postDated = (t: ReceivedTender) => !!t.checkDate && t.checkDate.slice(0, 10) > depositDate
  const total = sum(onHand.filter(t => selected.includes(t.id)).map(t => t.amount))

  function openView(deposit: Deposit) {
    if (!rec.isRecordTab) return rec.open('view', deposit)
    setActive(deposit)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActive(null)
    const next = { companyId: activeCompanyId ?? '' as number | '', bankAccountId: '' as const, depositDate: todayIso(), sheetNumber: '', remarks: '', selected: [] as number[] }
    setCompanyId(next.companyId)
    setBankAccountId('')
    setDepositDate(next.depositDate)
    setSheetNumber('')
    setRemarks('')
    setSelected([])
    markClean(next)
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, bankAccountId, depositDate, sheetNumber, remarks, selected }, () => rec.close())
  }

  function toggle(id: number) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return toast('Select a company.', 'error')
    if (!bankAccountId) return toast('Select the bank account deposited to.', 'error')
    const tenderIds = onHand.filter(t => selected.includes(t.id) && !postDated(t)).map(t => t.id)
    if (tenderIds.length === 0) return toast('Tick the cash and checks on the deposit slip.', 'error')
    if (!window.confirm(`Post this deposit of ${formatCurrency(total)}? This cannot be edited afterward — only voided.`)) return
    setLoading(true)
    try {
      await apiFetch('/deposits', {
        method: 'POST',
        body: JSON.stringify({ companyId, bankAccountId, depositDate, sheetNumber: sheetNumber || null, remarks: remarks || null, tenderIds }),
      })
      toast('Deposit posted successfully.', 'success')
      rec.close()
      reloadList('/deposits')
      reloadList('/customer-payment-tenders')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post deposit.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVoid() {
    if (!active) return
    if (!window.confirm(`Void deposit "${active.referenceNumber}"? Its cash and checks go back on hand. This cannot be undone.`)) return
    setVoiding(true)
    try {
      setActive(await apiFetch<Deposit>(`/deposits/${active.id}/void`, { method: 'POST' }))
      toast('Deposit voided.', 'success')
      reloadList('/deposits')
      reloadList('/customer-payment-tenders')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void deposit.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const tabTitle = mode === 'create' ? 'New Deposit' : active?.referenceNumber || 'Deposit'
  const blocked = !!active && (active.reconciled || (active.lines ?? []).some(t => t.mode === 'CHECK' && t.status !== 'DEPOSITED'))

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <AccountingList
          title="Deposits"
          endpoint="/deposits"
          listKey="deposits"
          columns={COLUMNS}
          searchText={r => [r.referenceNumber, r.sheetNumber ?? '', r.bankAccountName, r.bankAccountNumber, r.remarks ?? '', r.companyName].join(' ')}
          onOpen={openView}
          noun="deposits"
          totals
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
                <DocLetterhead company={<CompanyField id="dep-company" readOnly name={active.companyName} />}>
                  <DocHeader title="Deposit" number={active.referenceNumber}>
                    <DocRow>
                      <DocCell label="Deposit Date"><DocText>{formatDate(active.depositDate)}</DocText></DocCell>
                      <DocCell label="Deposit Slip #"><DocText>{active.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Bank Account"><DocText>{active.bankAccountName} ({active.bankAccountNumber})</DocText></DocCell>
                  <DocCell label="Reconciled"><DocText>{active.reconciled ? 'Yes' : 'No'}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={active.lines ?? []}
                  rowKey={t => t.id}
                  minRows={6}
                  columns={[
                    { key: 'customer', label: 'Customer', render: t => t.customerName },
                    { key: 'payment', label: 'Payment', width: '9rem', render: t => t.paymentReferenceNumber },
                    { key: 'tender', label: 'Item', width: '10rem', render: t => tenderLabel(t) },
                    { key: 'bank', label: 'Bank', width: '9rem', render: t => t.bankName ?? '' },
                    { key: 'checkDate', label: 'Check Date', width: '7rem', render: t => formatDate(t.checkDate) },
                    { key: 'status', label: 'Status', width: '8rem', render: t => statusLabel(t.status) },
                    { key: 'amount', label: 'Amount', align: 'right', width: '8rem', render: t => formatCurrency(t.amount) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{active.remarks}</DocText></DocCell>
                  <DocTotals entries={[{ label: 'Total Deposited', value: formatCurrency(active.totalAmount), grand: true }]} />
                </DocRow>
                <TransactionHistory activity={activity} record={active} />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={active.voided} />
                {canVoid && !active.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding} disabled={blocked}
                    title={blocked ? 'Reconciled, or a check on it has cleared or bounced.' : undefined}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton companyId={active.companyId} documentType="DEPOSIT" data={active as unknown as Record<string, unknown>}
                    onError={() => toast(`No active print template configured for Deposits under ${active.companyName}.`, 'error')} />
                )}
                <CloseButton onClick={requestClose} />
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <DocSheet>
                <DocLetterhead company={
                  <CompanyField id="dep-company" readOnly={!showCompanyColumn} name={companyOptions.find(c => c.id === companyId)?.name}
                    companies={companyOptions} value={companyId} onChange={v => { setCompanyId(v); setBankAccountId(''); setSelected([]) }} autoFocus={showCompanyColumn} />
                }>
                  <DocHeader title="Deposit" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Deposit Date" htmlFor="dep-date" required>
                        <Input id="dep-date" type="date" value={depositDate} onChange={e => setDepositDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Deposit Slip #" htmlFor="dep-sheet">
                        <Input id="dep-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Bank Account" htmlFor="dep-account" required>
                    <SearchableSelect id="dep-account" value={bankAccountId === '' ? '' : String(bankAccountId)} onChange={v => setBankAccountId(v ? Number(v) : '')}
                      options={accounts.map(a => ({ value: String(a.id), label: `${a.name} (${a.accountNumber}) — ${a.bankName}` }))}
                      disabled={!companyId} autoFocus={!showCompanyColumn} />
                  </DocCell>
                </DocRow>
                <DocSection
                  title="Cash and Checks on Hand"
                  action={onHand.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs"
                      onClick={() => setSelected(selected.length ? [] : onHand.filter(t => !postDated(t)).map(t => t.id))}>
                      {selected.length ? 'Clear' : 'Select all due'}
                    </Button>
                  )}
                />
                <DocLines
                  rows={onHand}
                  rowKey={t => t.id}
                  minRows={6}
                  columns={[
                    {
                      key: 'pick', label: '', align: 'center', width: '2.75rem',
                      render: t => (
                        <input type="checkbox" aria-label={`Deposit ${tenderLabel(t)} of ${t.customerName}`} checked={selected.includes(t.id)}
                          disabled={postDated(t)} onChange={() => toggle(t.id)} />
                      ),
                    },
                    { key: 'customer', label: 'Customer', readOnly: true, render: t => t.customerName },
                    { key: 'payment', label: 'Payment', width: '9rem', readOnly: true, render: t => `${t.paymentReferenceNumber} · ${formatDate(t.paymentDate)}` },
                    { key: 'tender', label: 'Item', width: '10rem', readOnly: true, render: t => tenderLabel(t) },
                    { key: 'bank', label: 'Bank', width: '9rem', readOnly: true, render: t => t.bankName ?? modeLabel(t.mode) },
                    {
                      key: 'checkDate', label: 'Check Date', width: '8rem', readOnly: true,
                      render: t => <span className={postDated(t) ? 'text-[hsl(var(--muted-foreground))]' : undefined}>{formatDate(t.checkDate)}{postDated(t) ? ' (PDC)' : ''}</span>,
                    },
                    { key: 'amount', label: 'Amount', align: 'right', width: '8rem', readOnly: true, render: t => formatCurrency(t.amount) },
                  ]}
                  footer={onHand.length === 0 && <span className="text-xs text-[hsl(var(--muted-foreground))]">No cash or checks on hand.</span>}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="dep-remarks">
                    <Input id="dep-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[
                    { label: 'Items', value: String(selected.length) },
                    { label: 'Total Deposited', value: formatCurrency(total), grand: true },
                  ]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Post Deposit</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}
    </div>
  )
}
