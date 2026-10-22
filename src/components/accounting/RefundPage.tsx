import { useState, useMemo, type FormEvent } from 'react'
import { Ban } from 'lucide-react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocLines, DocTotals, DocStamp, PendingNumber } from '@/components/ui/doc-form'
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
import { useLookup, type LookupOption } from '@/lib/lookups'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber } from '@/lib/utils'
import { AccountingList, VoidedBadge, type ListColumn } from '@/components/accounting/AccountingList'
import { OpenItemLinesEditor } from '@/components/accounting/OpenItemLines'
import { useCompanyOptions } from '@/components/accounting/useCompanyOptions'
import { EMPTY_OPEN_ITEM_LINE, useOpenItems, validOpenItemLines, type OpenItemLineDraft } from '@/lib/openItems'
import {
  ISSUED_MODES, modeLabel, RECEIVED_MODES, sourceTypeLabel, statusLabel, sum, todayIso,
  type AccountingDocument, type BankAccountLookupOption, type OpenItemSourceType,
} from '@/lib/accounting'

type FormMode = 'view' | 'create'

interface Refund extends AccountingDocument {
  customerId: number | null
  customerName: string | null
  supplierId: number | null
  supplierName: string | null
  refundDate: string
  amount: string
  mode: string
  bankAccountId: number | null
  bankAccountName: string | null
  checkNumber: string | null
  checkDate: string | null
  bankId: number | null
  bankName: string | null
  status: string | null
  lines: { id: number; creditItemId: number; creditSourceType: OpenItemSourceType; creditReferenceNumber: string; amount: string; lineNumber: number }[]
}

export interface RefundConfig {
  side: 'customer' | 'supplier'
  title: string
  endpoint: string
}

// Customer Refund (we pay unused customer credit back) and Supplier Refund (a supplier pays unused credit back to us) —
// docs/ACCOUNTING.md "Refunds". Each refunds part of the party's unapplied credits through one instrument.
export function RefundPage({ config }: { config: RefundConfig }) {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const inRecordTab = useIsRecordTab()
  const companyOptions = useCompanyOptions(inRecordTab)
  const customer = config.side === 'customer'
  const partyLabel = customer ? 'Customer' : 'Supplier'
  const permission = customer ? 'CUSTOMER_REFUND' : 'SUPPLIER_REFUND'
  const modes = customer ? ISSUED_MODES : RECEIVED_MODES

  const COLUMNS = useMemo(() => {
    const columns: ListColumn<Refund>[] = []
    if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true, muted: true, value: r => r.companyName })
    columns.push(
      { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: r => r.referenceNumber },
      { key: 'sheetNumber', label: 'Sheet #', sortable: true, filterable: true, muted: true, value: r => r.sheetNumber ?? '' },
      { key: config.side, label: partyLabel, sortable: true, filterable: true, value: r => (customer ? r.customerName : r.supplierName) ?? '' },
      { key: 'date', label: 'Refund Date', sortable: true, filterable: true, type: 'date', value: r => formatDate(r.refundDate) },
      { key: 'mode', label: 'Mode', sortable: true, value: r => modeLabel(r.mode) },
      { key: 'checkNumber', label: 'Check #', sortable: true, filterable: true, mono: true, value: r => r.checkNumber ?? '' },
      { key: 'amount', label: 'Amount', sortable: true, align: 'right', total: 'currency', value: r => formatCurrency(r.amount) },
    )
    if (customer) columns.push({ key: 'status', label: 'Check Status', value: r => statusLabel(r.status) })
    columns.push(
      { ...ORIGIN_COLUMN, filterable: true, value: r => originLabel(r.origin), render: r => <OriginBadge origin={r.origin} /> },
      { key: 'voided', label: 'Voided', sortable: true, type: 'boolean', filterable: true, value: r => r.voided ? 'Yes' : '', render: r => <VoidedBadge voided={r.voided} /> },
    )
    return columns
  }, [showCompanyColumn, customer, config.side, partyLabel])

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<Refund>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Refund>(`${config.endpoint}/${id}`),
  })
  const [active, setActive] = useState<Refund | null>(null)
  const [companyId, setCompanyId] = useState<number | ''>('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [refundDate, setRefundDate] = useState(todayIso())
  const [refundMode, setRefundMode] = useState(customer ? 'CHECK' : 'BANK_TRANSFER')
  const [bankAccountId, setBankAccountId] = useState<number | ''>('')
  const [bankId, setBankId] = useState<number | ''>('')
  const [checkNumber, setCheckNumber] = useState('')
  const [checkDate, setCheckDate] = useState(todayIso())
  const [sheetNumber, setSheetNumber] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<OpenItemLineDraft[]>([EMPTY_OPEN_ITEM_LINE])
  const [loading, setLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const { markClean, guardedClose } = useDirtyGuard()

  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const parties = useLookup<LookupOption>(customer ? 'customers' : 'suppliers', lookupCompanyId, { enabled: creating, onError: () => toast(`Failed to load ${config.side}s.`, 'error') })
  const accounts = useLookup<BankAccountLookupOption>('bank-accounts', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load bank accounts.', 'error') })
  const banks = useLookup<LookupOption>('banks', lookupCompanyId, { enabled: creating && !customer, onError: () => toast('Failed to load banks.', 'error') })
  // Credits paid by checks that haven't cleared can't be refunded yet (the backend refuses them).
  const credits = useOpenItems(lookupCompanyId, customer ? 'RECEIVABLE' : 'PAYABLE', partyId, 'CREDIT', creating).filter(o => o.cleared)
  const needsAccount = customer ? refundMode === 'CHECK' || refundMode === 'BANK_TRANSFER' : refundMode !== 'CASH' && refundMode !== 'OTHERS'
  const isCheck = refundMode === 'CHECK'

  const canCreate = hasPermission(`CREATE_${permission}`)
  const canVoid = hasPermission(`VOID_${permission}`)
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const activity = useTransactionActivity(permission, inRecordTab && mode === 'view' ? active?.id : null, active?.referenceNumber, active?.voided)

  function snapshot() {
    return { companyId, partyId, refundDate, refundMode, bankAccountId, bankId, checkNumber, checkDate, sheetNumber, remarks, lines }
  }

  function openView(refund: Refund) {
    if (!rec.isRecordTab) return rec.open('view', refund)
    setActive(refund)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActive(null)
    const next = { companyId: activeCompanyId ?? '' as number | '', partyId: '' as const, refundDate: todayIso(), refundMode: customer ? 'CHECK' : 'BANK_TRANSFER',
      bankAccountId: '' as const, bankId: '' as const, checkNumber: '', checkDate: todayIso(), sheetNumber: '', remarks: '', lines: [EMPTY_OPEN_ITEM_LINE] }
    setCompanyId(next.companyId)
    setPartyId('')
    setRefundDate(next.refundDate)
    setRefundMode(next.refundMode)
    setBankAccountId('')
    setBankId('')
    setCheckNumber('')
    setCheckDate(next.checkDate)
    setSheetNumber('')
    setRemarks('')
    setLines(next.lines)
    markClean(next)
    setMode('create')
  }

  function requestClose() {
    guardedClose(snapshot(), () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return toast('Select a company.', 'error')
    if (!partyId) return toast(`Select a ${config.side}.`, 'error')
    const result = validOpenItemLines(lines, credits)
    if ('error' in result) return toast(result.error, 'error')
    if (result.lines.length === 0) return toast('Pick at least one credit to refund.', 'error')
    if (needsAccount && !bankAccountId) return toast('Select the bank account.', 'error')
    if (isCheck && (!checkNumber.trim() || !checkDate)) return toast('A check needs its number and date.', 'error')
    if (isCheck && !customer && !bankId) return toast('Select the drawee bank of the supplier\'s check.', 'error')
    const amount = sum(result.lines.map(l => l.amount))
    if (!window.confirm(`Post this ${config.side} refund of ${formatCurrency(amount)}? This cannot be edited afterward — only voided.`)) return
    setLoading(true)
    try {
      await apiFetch(config.endpoint, {
        method: 'POST',
        body: JSON.stringify({
          companyId,
          [customer ? 'customerId' : 'supplierId']: partyId,
          refundDate,
          mode: refundMode,
          bankAccountId: needsAccount ? bankAccountId : null,
          checkNumber: checkNumber.trim() || null,
          checkDate: isCheck ? checkDate : null,
          ...(customer ? {} : { bankId: isCheck ? bankId : null }),
          sheetNumber: sheetNumber || null,
          remarks: remarks || null,
          lines: result.lines.map(l => ({ creditItemId: l.openItemId, amount: l.amount })),
        }),
      })
      toast(`${partyLabel} refund posted successfully.`, 'success')
      rec.close()
      reloadList(config.endpoint)
    } catch (err) {
      toast(mutationErrorMessage(err, `Failed to post ${config.side} refund.`), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVoid() {
    if (!active) return
    if (!window.confirm(`Void ${config.side} refund "${active.referenceNumber}"? The refunded credits reopen. This cannot be undone.`)) return
    setVoiding(true)
    try {
      setActive(await apiFetch<Refund>(`${config.endpoint}/${active.id}/void`, { method: 'POST' }))
      toast(`${partyLabel} refund voided.`, 'success')
      reloadList(config.endpoint)
    } catch (err) {
      toast(mutationErrorMessage(err, `Failed to void ${config.side} refund.`), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const tabTitle = mode === 'create' ? `New ${partyLabel} Refund` : active?.referenceNumber || `${partyLabel} Refund`

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <AccountingList
          title={config.title}
          endpoint={config.endpoint}
          listKey={config.endpoint.slice(1)}
          columns={COLUMNS}
          searchText={r => [r.referenceNumber, r.sheetNumber ?? '', r.customerName ?? '', r.supplierName ?? '', r.checkNumber ?? '', r.remarks ?? '', r.companyName].join(' ')}
          onOpen={openView}
          noun={`${config.side} refunds`}
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
                <DocLetterhead company={<CompanyField id="rf-company" readOnly name={active.companyName} />}>
                  <DocHeader title={`${partyLabel} Refund`} number={active.referenceNumber}>
                    <DocRow>
                      <DocCell label="Refund Date"><DocText>{formatDate(active.refundDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{active.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label={partyLabel}><DocText>{customer ? active.customerName : active.supplierName}</DocText></DocCell>
                  <DocCell label="Mode"><DocText>{modeLabel(active.mode)}{active.status ? ` (${statusLabel(active.status)})` : ''}</DocText></DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Bank Account"><DocText>{active.bankAccountName}</DocText></DocCell>
                  <DocCell label="Check / Ref #"><DocText>{active.checkNumber}</DocText></DocCell>
                  <DocCell label="Check Date"><DocText>{formatDate(active.checkDate)}</DocText></DocCell>
                  {!customer && <DocCell label="Drawee Bank"><DocText>{active.bankName}</DocText></DocCell>}
                </DocRow>
                <DocLines
                  rows={byLineNumber(active.lines)}
                  rowKey={l => l.id}
                  lineNumber={l => l.lineNumber}
                  minRows={3}
                  columns={[
                    { key: 'credit', label: 'Refunded Credit', render: l => `${l.creditReferenceNumber} — ${sourceTypeLabel(l.creditSourceType)}` },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: l => formatCurrency(l.amount) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{active.remarks}</DocText></DocCell>
                  <DocTotals entries={[{ label: 'Refund Amount', value: formatCurrency(active.amount), grand: true }]} />
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
                  <PrintButton companyId={active.companyId} documentType={permission} data={active as unknown as Record<string, unknown>}
                    onError={() => toast(`No active print template configured for ${config.title} under ${active.companyName}.`, 'error')} />
                )}
                <CloseButton onClick={requestClose} />
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <DocSheet>
                <DocLetterhead company={
                  <CompanyField id="rf-company" readOnly={!showCompanyColumn} name={companyOptions.find(c => c.id === companyId)?.name}
                    companies={companyOptions} value={companyId} onChange={v => { setCompanyId(v); setPartyId(''); setLines([EMPTY_OPEN_ITEM_LINE]) }} autoFocus={showCompanyColumn} />
                }>
                  <DocHeader title={`${partyLabel} Refund`} number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Refund Date" htmlFor="rf-date" required>
                        <Input id="rf-date" type="date" value={refundDate} onChange={e => setRefundDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="rf-sheet">
                        <Input id="rf-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label={partyLabel} htmlFor="rf-party" required>
                    <SearchableSelect id="rf-party" value={partyId === '' ? '' : String(partyId)}
                      onChange={v => { setPartyId(v ? Number(v) : ''); setLines([EMPTY_OPEN_ITEM_LINE]) }}
                      options={parties.map(p => ({ value: String(p.id), label: p.code ? `${p.code} — ${p.name}` : p.name }))}
                      disabled={!companyId} autoFocus={!showCompanyColumn} />
                  </DocCell>
                  <DocCell label="Mode" htmlFor="rf-mode" required>
                    <SearchableSelect id="rf-mode" value={refundMode} onChange={v => setRefundMode(v || modes[0].value)} options={modes} />
                  </DocCell>
                </DocRow>
                <DocRow>
                  {needsAccount && (
                    <DocCell label={customer ? 'Drawn On' : 'Deposited To'} htmlFor="rf-account" required>
                      <SearchableSelect id="rf-account" value={bankAccountId === '' ? '' : String(bankAccountId)} onChange={v => setBankAccountId(v ? Number(v) : '')}
                        options={accounts.map(a => ({ value: String(a.id), label: `${a.name} (${a.accountNumber})` }))} />
                    </DocCell>
                  )}
                  {(isCheck || refundMode === 'BANK_TRANSFER' || refundMode === 'CREDIT_CARD') && (
                    <DocCell label="Check / Ref #" htmlFor="rf-check" required={isCheck}>
                      <Input id="rf-check" value={checkNumber} maxLength={50} onChange={e => setCheckNumber(e.target.value)} />
                    </DocCell>
                  )}
                  {isCheck && (
                    <DocCell label="Check Date" htmlFor="rf-check-date" required>
                      <Input id="rf-check-date" type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)} />
                    </DocCell>
                  )}
                  {isCheck && !customer && (
                    <DocCell label="Drawee Bank" htmlFor="rf-bank" required>
                      <SearchableSelect id="rf-bank" value={bankId === '' ? '' : String(bankId)} onChange={v => setBankId(v ? Number(v) : '')}
                        options={banks.map(b => ({ value: String(b.id), label: b.name }))} />
                    </DocCell>
                  )}
                </DocRow>
                <OpenItemLinesEditor
                  title="Credits Refunded"
                  items={credits}
                  rows={lines}
                  onChange={setLines}
                  disabled={partyId === ''}
                  emptyHint={partyId === '' ? `Select a ${config.side} first.` : `This ${config.side} has no cleared, unapplied credits.`}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="rf-remarks">
                    <Input id="rf-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[{ label: 'Refund Amount', value: formatCurrency(sum(lines.map(l => l.amount))), grand: true }]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Post {partyLabel} Refund</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}
    </div>
  )
}
