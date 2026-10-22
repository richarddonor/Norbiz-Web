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
import { reloadList, fetchAllContent } from '@/hooks/usePagedList'
import { PrintButton } from '@/components/PrintButton'
import { OriginBadge, OriginNotice } from '@/components/TransactionOrigin'
import { ORIGIN_COLUMN, originLabel } from '@/lib/transactionOrigin'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { useLookup, type LookupOption } from '@/lib/lookups'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber } from '@/lib/utils'
import { AccountingList, VoidedBadge, type ListColumn } from '@/components/accounting/AccountingList'
import { AllocationLines, OpenItemLinesEditor } from '@/components/accounting/OpenItemLines'
import { useCompanyOptions } from '@/components/accounting/useCompanyOptions'
import { EMPTY_OPEN_ITEM_LINE, useOpenItems, validOpenItemLines, type OpenItemLineDraft } from '@/lib/openItems'
import {
  cents, ISSUED_MODES, modeLabel, RECEIVED_MODES, statusLabel, sum, tenderLabel, todayIso,
  type AccountingDocument, type Allocation, type BankAccountLookupOption, type IssuedTender, type ReceivedTender,
} from '@/lib/accounting'

type FormMode = 'view' | 'create'
type Tender = ReceivedTender | IssuedTender

interface Payment extends AccountingDocument {
  customerId?: number
  customerName?: string
  supplierId?: number
  supplierName?: string
  voucherNumber?: string | null
  paymentDate: string
  totalAmount: string
  appliedAmount: string
  unappliedAmount: string
  tenders: Tender[]
  applications: Allocation[] | null
}

interface TenderDraft {
  mode: string
  amount: string
  checkNumber: string
  checkDate: string
  bankId: number | ''
  bankAccountId: number | ''
  officialReceiptNumber: string
  provisionalReceiptNumber: string
  replacesTenderId: number | ''
}

function emptyTender(mode: string): TenderDraft {
  return { mode, amount: '', checkNumber: '', checkDate: todayIso(), bankId: '', bankAccountId: '', officialReceiptNumber: '', provisionalReceiptNumber: '', replacesTenderId: '' }
}

export interface PaymentConfig {
  side: 'customer' | 'supplier'
  title: string
  endpoint: string
}

// Customer and supplier payments (docs/ACCOUNTING.md): one or more tenders, optionally applied to the party's open
// charges; whatever stays unapplied is an advance. Customer tenders are received (cash, checks, transfers, cards);
// supplier tenders are issued from our bank accounts.
export function PaymentPage({ config }: { config: PaymentConfig }) {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const inRecordTab = useIsRecordTab()
  const companyOptions = useCompanyOptions(inRecordTab)
  const customer = config.side === 'customer'
  const partyLabel = customer ? 'Customer' : 'Supplier'
  const permission = customer ? 'CUSTOMER_PAYMENT' : 'SUPPLIER_PAYMENT'
  const transactionType = customer ? 'CUSTOMER_PAYMENT' : 'SUPPLIER_PAYMENT'
  const modes = customer ? RECEIVED_MODES : ISSUED_MODES
  const defaultMode = customer ? 'CASH' : 'CHECK'

  const COLUMNS = useMemo(() => {
    const columns: ListColumn<Payment>[] = []
    if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true, muted: true, value: r => r.companyName })
    columns.push(
      { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: r => r.referenceNumber },
      { key: 'sheetNumber', label: 'Sheet #', sortable: true, filterable: true, muted: true, value: r => r.sheetNumber ?? '' },
    )
    if (!customer) columns.push({ key: 'voucherNumber', label: 'Voucher #', sortable: true, filterable: true, muted: true, value: r => r.voucherNumber ?? '' })
    columns.push(
      { key: config.side, label: partyLabel, sortable: true, filterable: true, value: r => (customer ? r.customerName : r.supplierName) ?? '' },
      { key: 'date', label: 'Payment Date', sortable: true, filterable: true, type: 'date', value: r => formatDate(r.paymentDate) },
      { key: 'tenders', label: 'Tenders', value: r => r.tenders.map(tenderLabel).join(', ') },
      { key: 'checkNumber', label: 'Check #', filterable: true, mono: true, value: r => r.tenders.map(t => t.checkNumber).filter(Boolean).join(', ') },
    )
    if (customer) columns.push({ key: 'receiptNumber', label: 'OR / PR #', filterable: true, muted: true,
      value: r => (r.tenders as ReceivedTender[]).flatMap(t => [t.officialReceiptNumber, t.provisionalReceiptNumber]).filter(Boolean).join(', ') })
    columns.push(
      { key: 'totalAmount', label: 'Total', sortable: true, align: 'right', total: 'currency', value: r => formatCurrency(r.totalAmount) },
      { key: 'unappliedAmount', label: 'Unapplied', align: 'right', total: 'currency', value: r => r.voided ? '' : formatCurrency(r.unappliedAmount) },
      { key: 'remarks', label: 'Remarks', filterable: true, muted: true, value: r => r.remarks ?? '' },
      { ...ORIGIN_COLUMN, filterable: true, value: r => originLabel(r.origin), render: r => <OriginBadge origin={r.origin} /> },
      { key: 'voided', label: 'Voided', sortable: true, type: 'boolean', filterable: true, value: r => r.voided ? 'Yes' : '', render: r => <VoidedBadge voided={r.voided} /> },
    )
    return columns
  }, [showCompanyColumn, customer, config.side, partyLabel])

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<Payment>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Payment>(`${config.endpoint}/${id}`),
  })
  const [active, setActive] = useState<Payment | null>(null)
  const [companyId, setCompanyId] = useState<number | ''>('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [paymentDate, setPaymentDate] = useState(todayIso())
  const [voucherNumber, setVoucherNumber] = useState('')
  const [sheetNumber, setSheetNumber] = useState('')
  const [remarks, setRemarks] = useState('')
  const [tenders, setTenders] = useState<TenderDraft[]>([emptyTender(defaultMode)])
  const [applications, setApplications] = useState<OpenItemLineDraft[]>([EMPTY_OPEN_ITEM_LINE])
  const [replaceable, setReplaceable] = useState<Tender[]>([])
  const [loading, setLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const { markClean, guardedClose } = useDirtyGuard()

  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const parties = useLookup<LookupOption>(customer ? 'customers' : 'suppliers', lookupCompanyId, { enabled: creating, onError: () => toast(`Failed to load ${config.side}s.`, 'error') })
  const banks = useLookup<LookupOption>('banks', lookupCompanyId, { enabled: creating && customer, onError: () => toast('Failed to load banks.', 'error') })
  const accounts = useLookup<BankAccountLookupOption>('bank-accounts', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load bank accounts.', 'error') })
  const charges = useOpenItems(lookupCompanyId, customer ? 'RECEIVABLE' : 'PAYABLE', partyId, 'CHARGE', creating)
  const total = cents(sum(tenders.map(t => t.amount)))

  const canCreate = hasPermission(`CREATE_${permission}`)
  const canVoid = hasPermission(`VOID_${permission}`)
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const activity = useTransactionActivity(transactionType, inRecordTab && mode === 'view' ? active?.id : null, active?.referenceNumber, active?.voided)

  // Bounced (customer) / cancelled (supplier) checks of the party a new tender may replace.
  useEffect(() => {
    if (!creating || partyId === '' || !hasPermission(`VIEW_${permission}`)) { setReplaceable([]); return }
    const status = customer ? 'BOUNCED' : 'CANCELLED'
    fetchAllContent<Tender>(`${config.endpoint.replace('payments', 'payment-tenders')}?status=${status}&${customer ? 'customerId' : 'supplierId'}=${partyId}`)
      .then(setReplaceable)
      .catch(() => setReplaceable([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, partyId])

  function snapshot() {
    return { companyId, partyId, paymentDate, voucherNumber, sheetNumber, remarks, tenders, applications }
  }

  function openView(payment: Payment) {
    if (!rec.isRecordTab) return rec.open('view', payment)
    setActive(payment)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActive(null)
    const next = { companyId: activeCompanyId ?? '' as number | '', partyId: '' as const, paymentDate: todayIso(), voucherNumber: '', sheetNumber: '', remarks: '',
      tenders: [emptyTender(defaultMode)], applications: [EMPTY_OPEN_ITEM_LINE] }
    setCompanyId(next.companyId)
    setPartyId('')
    setPaymentDate(next.paymentDate)
    setVoucherNumber('')
    setSheetNumber('')
    setRemarks('')
    setTenders(next.tenders)
    setApplications(next.applications)
    markClean(next)
    setMode('create')
  }

  function requestClose() {
    guardedClose(snapshot(), () => rec.close())
  }

  function updateTender(index: number, patch: Partial<TenderDraft>) {
    setTenders(prev => prev.map((t, i) => i === index ? { ...t, ...patch } : t))
  }

  // Which tender fields a mode uses (mirrors the backend's validation).
  function needs(t: TenderDraft) {
    return {
      check: t.mode === 'CHECK',
      reference: t.mode === 'CHECK' || t.mode === 'BANK_TRANSFER' || t.mode === 'CREDIT_CARD',
      bank: customer && t.mode === 'CHECK',
      account: customer ? t.mode === 'BANK_TRANSFER' || t.mode === 'CREDIT_CARD' : t.mode === 'CHECK' || t.mode === 'BANK_TRANSFER',
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return toast('Select a company.', 'error')
    if (!partyId) return toast(`Select a ${config.side}.`, 'error')
    const filled = tenders.filter(t => t.amount.trim() !== '')
    if (filled.length === 0) return toast('Add at least one tender with an amount.', 'error')
    for (const t of filled) {
      const n = needs(t)
      if (!(Number(t.amount) > 0)) return toast('Tender amounts must be greater than zero.', 'error')
      if (n.check && (!t.checkNumber.trim() || !t.checkDate)) return toast('Checks need a check number and date.', 'error')
      if (n.bank && !t.bankId) return toast('Checks need the drawee bank.', 'error')
      if (n.account && !t.bankAccountId) return toast(`${modeLabel(t.mode)} needs ${customer ? 'the account it landed in' : 'the account it is drawn on'}.`, 'error')
    }
    const result = validOpenItemLines(applications, charges)
    if ('error' in result) return toast(result.error, 'error')
    if (sum(result.lines.map(a => a.amount)) > total) return toast('The applications exceed the amount paid.', 'error')
    const advance = cents(total - sum(result.lines.map(a => a.amount)))
    const confirmText = `Post this ${config.side} payment of ${formatCurrency(total)}?` + (advance > 0 ? ` ${formatCurrency(advance)} stays unapplied as an advance.` : '')
      + ' This cannot be edited afterward — only voided.'
    if (!window.confirm(confirmText)) return
    setLoading(true)
    try {
      await apiFetch<Payment>(config.endpoint, {
        method: 'POST',
        body: JSON.stringify({
          companyId,
          [customer ? 'customerId' : 'supplierId']: partyId,
          paymentDate,
          voucherNumber: !customer && voucherNumber ? voucherNumber : undefined,
          sheetNumber: sheetNumber || null,
          remarks: remarks || null,
          tenders: filled.map(t => {
            const n = needs(t)
            return {
              mode: t.mode,
              amount: cents(Number(t.amount)),
              checkNumber: n.reference && t.checkNumber.trim() ? t.checkNumber.trim() : null,
              checkDate: n.check ? t.checkDate : null,
              ...(customer ? {
                bankId: n.bank ? t.bankId : null,
                depositBankAccountId: n.account ? t.bankAccountId : null,
                officialReceiptNumber: t.officialReceiptNumber || null,
                provisionalReceiptNumber: t.provisionalReceiptNumber || null,
              } : { bankAccountId: n.account ? t.bankAccountId : null }),
              replacesTenderId: t.replacesTenderId || null,
            }
          }),
          applications: result.lines.length ? result.lines : null,
        }),
      })
      toast(`${partyLabel} payment posted successfully.`, 'success')
      rec.close()
      reloadList(config.endpoint)
    } catch (err) {
      toast(mutationErrorMessage(err, `Failed to post ${config.side} payment.`), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVoid() {
    if (!active) return
    if (!window.confirm(`Void ${config.side} payment "${active.referenceNumber}"? Its applications are reversed. This cannot be undone.`)) return
    setVoiding(true)
    try {
      setActive(await apiFetch<Payment>(`${config.endpoint}/${active.id}/void`, { method: 'POST' }))
      toast(`${partyLabel} payment voided.`, 'success')
      reloadList(config.endpoint)
    } catch (err) {
      toast(mutationErrorMessage(err, `Failed to void ${config.side} payment.`), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const tabTitle = mode === 'create' ? `New ${partyLabel} Payment` : active?.referenceNumber || `${partyLabel} Payment`
  const applied = sum(applications.map(a => a.amount))

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <AccountingList
          title={config.title}
          endpoint={config.endpoint}
          listKey={config.endpoint.slice(1)}
          columns={COLUMNS}
          searchText={r => [r.referenceNumber, r.sheetNumber ?? '', r.voucherNumber ?? '', r.customerName ?? '', r.supplierName ?? '',
            r.tenders.map(t => `${tenderLabel(t)} ${t.checkNumber ?? ''}`).join(' '), r.remarks ?? '', r.companyName].join(' ')}
          onOpen={openView}
          noun={`${config.side} payments`}
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
                <DocLetterhead company={<CompanyField id="pay-company" readOnly name={active.companyName} />}>
                  <DocHeader title={`${partyLabel} Payment`} number={active.referenceNumber}>
                    <DocRow>
                      <DocCell label="Payment Date"><DocText>{formatDate(active.paymentDate)}</DocText></DocCell>
                      {!customer && <DocCell label="Voucher #"><DocText>{active.voucherNumber}</DocText></DocCell>}
                      <DocCell label="Sheet #"><DocText>{active.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label={partyLabel}><DocText>{customer ? active.customerName : active.supplierName}</DocText></DocCell>
                </DocRow>
                <DocSection title="Payment" />
                <DocLines
                  rows={byLineNumber(active.tenders)}
                  rowKey={t => t.id}
                  lineNumber={t => t.lineNumber}
                  columns={[
                    { key: 'mode', label: 'Mode', width: '8rem', render: t => modeLabel(t.mode) },
                    { key: 'number', label: 'Check / Ref #', render: t => t.checkNumber ?? '' },
                    { key: 'date', label: 'Check Date', width: '7rem', render: t => formatDate(t.checkDate) },
                    {
                      key: 'bank', label: customer ? 'Bank / Account' : 'Account',
                      render: t => customer ? ((t as ReceivedTender).bankName ?? (t as ReceivedTender).depositBankAccountName ?? '') : ((t as IssuedTender).bankAccountName ?? ''),
                    },
                    ...(customer ? [{ key: 'or', label: 'OR / PR #', width: '8rem',
                      render: (t: Tender) => [(t as ReceivedTender).officialReceiptNumber, (t as ReceivedTender).provisionalReceiptNumber].filter(Boolean).join(' / ') }] : []),
                    { key: 'status', label: 'Status', width: '9rem', render: t => statusLabel(t.status) + ((t as ReceivedTender).bounceReason ? ` (${(t as ReceivedTender).bounceReason})` : '') },
                    { key: 'unapplied', label: 'Unapplied', align: 'right', width: '8rem', render: t => formatCurrency(t.unappliedAmount) },
                    { key: 'amount', label: 'Amount', align: 'right', width: '8rem', render: t => formatCurrency(t.amount) },
                  ]}
                />
                <AllocationLines title="Applied To" allocations={active.applications ?? []} side="charge" />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{active.remarks}</DocText></DocCell>
                  <DocTotals entries={[
                    { label: 'Total Paid', value: formatCurrency(active.totalAmount), grand: true },
                    { label: 'Applied', value: formatCurrency(active.appliedAmount) },
                    { label: 'Unapplied (advance)', value: formatCurrency(active.unappliedAmount) },
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
                  <PrintButton companyId={active.companyId} documentType={transactionType} data={active as unknown as Record<string, unknown>}
                    onError={() => toast(`No active print template configured for ${config.title} under ${active.companyName}.`, 'error')} />
                )}
                <CloseButton onClick={requestClose} />
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <DocSheet>
                <DocLetterhead company={
                  <CompanyField id="pay-company" readOnly={!showCompanyColumn} name={companyOptions.find(c => c.id === companyId)?.name}
                    companies={companyOptions} value={companyId}
                    onChange={v => { setCompanyId(v); setPartyId(''); setTenders([emptyTender(defaultMode)]); setApplications([EMPTY_OPEN_ITEM_LINE]) }}
                    autoFocus={showCompanyColumn} />
                }>
                  <DocHeader title={`${partyLabel} Payment`} number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Payment Date" htmlFor="pay-date" required>
                        <Input id="pay-date" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} required />
                      </DocCell>
                      {!customer && (
                        <DocCell label="Voucher #" htmlFor="pay-voucher">
                          <Input id="pay-voucher" value={voucherNumber} onChange={e => setVoucherNumber(e.target.value)} maxLength={50} />
                        </DocCell>
                      )}
                      <DocCell label="Sheet #" htmlFor="pay-sheet">
                        <Input id="pay-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label={partyLabel} htmlFor="pay-party" required>
                    <SearchableSelect id="pay-party" value={partyId === '' ? '' : String(partyId)}
                      onChange={v => { setPartyId(v ? Number(v) : ''); setApplications([EMPTY_OPEN_ITEM_LINE]) }}
                      options={parties.map(p => ({ value: String(p.id), label: p.code ? `${p.code} — ${p.name}` : p.name }))}
                      disabled={!companyId} autoFocus={!showCompanyColumn} />
                  </DocCell>
                </DocRow>
                <DocSection title="Payment" />
                <DocLines
                  rows={tenders}
                  columns={[
                    {
                      key: 'mode', label: 'Mode', width: '9rem', required: true,
                      render: (t, i) => (
                        <SearchableSelect value={t.mode} onChange={v => updateTender(i, { mode: v || defaultMode })}
                          options={modes.map(m => ({ value: m.value, label: m.label }))} />
                      ),
                    },
                    {
                      key: 'amount', label: 'Amount', align: 'right', width: '8rem', required: true,
                      render: (t, i) => (
                        <Input type="number" step="0.01" min="0" aria-label={`Tender ${i + 1} amount`} value={t.amount} className="text-right"
                          onChange={e => updateTender(i, { amount: e.target.value })} />
                      ),
                    },
                    {
                      key: 'number', label: 'Check / Ref #', width: '9rem',
                      render: (t, i) => needs(t).reference
                        ? <Input aria-label={`Tender ${i + 1} check or reference number`} value={t.checkNumber} maxLength={50} onChange={e => updateTender(i, { checkNumber: e.target.value })} />
                        : <span className="text-[hsl(var(--muted-foreground))]">—</span>,
                    },
                    {
                      key: 'date', label: 'Check Date', width: '9.5rem',
                      render: (t, i) => needs(t).check
                        ? <Input type="date" aria-label={`Tender ${i + 1} check date`} value={t.checkDate} onChange={e => updateTender(i, { checkDate: e.target.value })} />
                        : <span className="text-[hsl(var(--muted-foreground))]">—</span>,
                    },
                    ...(customer ? [{
                      key: 'bank', label: 'Drawee Bank', width: '10rem',
                      render: (t: TenderDraft, i: number) => needs(t).bank
                        ? <SearchableSelect value={t.bankId === '' ? '' : String(t.bankId)} onChange={v => updateTender(i, { bankId: v ? Number(v) : '' })}
                            options={banks.map(b => ({ value: String(b.id), label: b.name }))} />
                        : <span className="text-[hsl(var(--muted-foreground))]">—</span>,
                    }] : []),
                    {
                      key: 'account', label: customer ? 'Deposited To' : 'Drawn On', width: '11rem',
                      render: (t, i) => needs(t).account
                        ? <SearchableSelect value={t.bankAccountId === '' ? '' : String(t.bankAccountId)} onChange={v => updateTender(i, { bankAccountId: v ? Number(v) : '' })}
                            options={accounts.map(a => ({ value: String(a.id), label: `${a.name} (${a.accountNumber})` }))} />
                        : <span className="text-[hsl(var(--muted-foreground))]">{customer && t.mode !== 'OTHERS' ? 'via Deposit' : '—'}</span>,
                    },
                    ...(customer ? [{
                      key: 'or', label: 'OR #', width: '7rem',
                      render: (t: TenderDraft, i: number) => <Input aria-label={`Tender ${i + 1} OR number`} value={t.officialReceiptNumber} maxLength={50}
                        onChange={e => updateTender(i, { officialReceiptNumber: e.target.value })} />,
                    }, {
                      key: 'pr', label: 'PR #', width: '7rem',
                      render: (t: TenderDraft, i: number) => <Input aria-label={`Tender ${i + 1} PR number`} value={t.provisionalReceiptNumber} maxLength={50}
                        onChange={e => updateTender(i, { provisionalReceiptNumber: e.target.value })} />,
                    }] : []),
                    ...(replaceable.length > 0 ? [{
                      key: 'replaces', label: customer ? 'Replaces Bounced' : 'Replaces Cancelled', width: '11rem',
                      render: (t: TenderDraft, i: number) => (
                        <SearchableSelect value={t.replacesTenderId === '' ? '' : String(t.replacesTenderId)}
                          onChange={v => updateTender(i, { replacesTenderId: v ? Number(v) : '' })} placeholder="None"
                          options={replaceable.map(r => ({ value: String(r.id), label: `${tenderLabel(r)} · ${formatCurrency(r.amount)} (${r.paymentReferenceNumber})` }))} />
                      ),
                    }] : []),
                    {
                      key: 'remove', label: '', align: 'center', width: '2.75rem',
                      render: (_, i) => (
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove tender ${i + 1}`}
                          onClick={() => setTenders(prev => prev.filter((_, j) => j !== i))} disabled={tenders.length === 1}>
                          <X className="w-4 h-4" />
                        </Button>
                      ),
                    },
                  ]}
                  footer={
                    <Button type="button" variant="ghost" size="sm" onClick={() => setTenders(prev => [...prev, emptyTender(defaultMode)])}>
                      <Plus className="w-3.5 h-3.5" />
                      Add Tender
                    </Button>
                  }
                />
                <OpenItemLinesEditor
                  title={`Apply To (optional — what is left stays as an advance)`}
                  items={charges}
                  rows={applications}
                  onChange={setApplications}
                  available={total}
                  disabled={partyId === ''}
                  emptyHint={partyId === '' ? `Select a ${config.side} first.` : `No open ${customer ? 'receivables' : 'payables'} for this ${config.side}.`}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="pay-remarks">
                    <Input id="pay-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[
                    { label: 'Total Paid', value: formatCurrency(total), grand: true },
                    { label: 'Applied', value: formatCurrency(applied) },
                    { label: 'Unapplied (advance)', value: formatCurrency(Math.max(0, cents(total - applied))) },
                  ]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Post {partyLabel} Payment</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}
    </div>
  )
}
