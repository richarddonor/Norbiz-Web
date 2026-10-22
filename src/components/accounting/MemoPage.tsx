import { useState, useMemo, type FormEvent } from 'react'
import { Plus, Ban, X } from 'lucide-react'
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
import { useTransactionActivity, type TransactionType } from '@/hooks/useTransactionActivity'
import { reloadList } from '@/hooks/usePagedList'
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
import { cents, reasonLabel, sum, todayIso, type AccountingDocument, type Allocation } from '@/lib/accounting'

type FormMode = 'view' | 'create'
type MemoType = 'DEBIT' | 'CREDIT'

interface Memo extends AccountingDocument {
  customerId: number | null
  customerName: string | null
  supplierId: number | null
  supplierName: string | null
  memoType: MemoType
  reason: string
  memoDate: string
  termDays: number
  dueDate: string | null
  originalReference: string | null
  amount: string
  direction: 'CHARGE' | 'CREDIT' | null
  openItemId: number | null
  appliedAmount: string | null
  balance: string | null
  lines: { id: number; description: string; amount: string; lineNumber: number }[]
  applications: Allocation[] | null
}

interface LineDraft {
  description: string
  amount: string
}

const EMPTY_LINE: LineDraft = { description: '', amount: '' }

export interface MemoConfig {
  side: 'customer' | 'supplier'
  title: string
  endpoint: string
  transactionType: TransactionType
  permission: string
  /** The memo type that lowers the balance and can be applied to open charges. */
  applyingType: MemoType
  typeLabels: Record<MemoType, string>
  reasons: { value: string; label: string }[]
}

// Customer and supplier debit/credit memos (docs/ACCOUNTING.md "Memos"): lines of described amounts that raise or lower a
// party's balance. The lowering type can be applied to open charges right away. OPENING_BALANCE memos carry balances from
// before the accounting start date.
export function MemoPage({ config }: { config: MemoConfig }) {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const inRecordTab = useIsRecordTab()
  const companyOptions = useCompanyOptions(inRecordTab)
  const party = config.side
  const partyLabel = party === 'customer' ? 'Customer' : 'Supplier'
  const side = party === 'customer' ? 'RECEIVABLE' : 'PAYABLE'

  const COLUMNS = useMemo(() => {
    const columns: ListColumn<Memo>[] = []
    if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true, muted: true, value: r => r.companyName })
    columns.push(
      { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: r => r.referenceNumber },
      { key: 'sheetNumber', label: 'Sheet #', sortable: true, filterable: true, muted: true, value: r => r.sheetNumber ?? '' },
      { key: party, label: partyLabel, sortable: true, filterable: true, value: r => (party === 'customer' ? r.customerName : r.supplierName) ?? '' },
      { key: 'memoType', label: 'Type', sortable: true, value: r => r.memoType === 'DEBIT' ? 'Debit' : 'Credit' },
      { key: 'reason', label: 'Reason', sortable: true, value: r => reasonLabel(r.reason) },
      { key: 'date', label: 'Memo Date', sortable: true, filterable: true, type: 'date', value: r => formatDate(r.memoDate) },
      { key: 'amount', label: 'Amount', sortable: true, align: 'right', total: 'currency', value: r => formatCurrency(r.amount) },
      { key: 'balance', label: 'Balance', sortable: true, align: 'right', total: 'currency', value: r => r.voided ? '' : formatCurrency(r.balance) },
      { key: 'remarks', label: 'Remarks', filterable: true, muted: true, value: r => r.remarks ?? '' },
      { ...ORIGIN_COLUMN, filterable: true, value: r => originLabel(r.origin), render: r => <OriginBadge origin={r.origin} /> },
      { key: 'voided', label: 'Voided', sortable: true, type: 'boolean', filterable: true, value: r => r.voided ? 'Yes' : '', render: r => <VoidedBadge voided={r.voided} /> },
    )
    return columns
  }, [showCompanyColumn, party, partyLabel])

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<Memo>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Memo>(`${config.endpoint}/${id}`),
  })
  const [active, setActive] = useState<Memo | null>(null)
  const [companyId, setCompanyId] = useState<number | ''>('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [memoType, setMemoType] = useState<MemoType>(config.applyingType)
  const [reason, setReason] = useState('')
  const [memoDate, setMemoDate] = useState(todayIso())
  const [termDays, setTermDays] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [originalReference, setOriginalReference] = useState('')
  const [sheetNumber, setSheetNumber] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([EMPTY_LINE])
  const [applications, setApplications] = useState<OpenItemLineDraft[]>([EMPTY_OPEN_ITEM_LINE])
  const [loading, setLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const { markClean, guardedClose } = useDirtyGuard()

  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const applies = memoType === config.applyingType
  const parties = useLookup<LookupOption>(party === 'customer' ? 'customers' : 'suppliers', lookupCompanyId, {
    enabled: creating, onError: () => toast(`Failed to load ${party}s.`, 'error'),
  })
  const charges = useOpenItems(lookupCompanyId, side, partyId, 'CHARGE', creating && applies)
  const total = cents(sum(lines.map(l => l.amount)))

  const canCreate = hasPermission(`CREATE_${config.permission}`)
  const canVoid = hasPermission(`VOID_${config.permission}`)
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const activity = useTransactionActivity(config.transactionType, inRecordTab && mode === 'view' ? active?.id : null, active?.referenceNumber, active?.voided)

  function snapshot() {
    return { companyId, partyId, memoType, reason, memoDate, termDays, dueDate, originalReference, sheetNumber, remarks, lines, applications }
  }

  function openView(memo: Memo) {
    if (!rec.isRecordTab) return rec.open('view', memo)
    setActive(memo)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActive(null)
    const next = { companyId: activeCompanyId ?? '' as number | '', partyId: '' as const, memoType: config.applyingType, reason: '', memoDate: todayIso(),
      termDays: '', dueDate: '', originalReference: '', sheetNumber: '', remarks: '', lines: [EMPTY_LINE], applications: [EMPTY_OPEN_ITEM_LINE] }
    setCompanyId(next.companyId)
    setPartyId('')
    setMemoType(next.memoType)
    setReason('')
    setMemoDate(next.memoDate)
    setTermDays('')
    setDueDate('')
    setOriginalReference('')
    setSheetNumber('')
    setRemarks('')
    setLines(next.lines)
    setApplications(next.applications)
    markClean(next)
    setMode('create')
  }

  function requestClose() {
    guardedClose(snapshot(), () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return toast('Select a company.', 'error')
    if (!partyId) return toast(`Select a ${party}.`, 'error')
    if (!reason) return toast('Select a reason.', 'error')
    const filled = lines.filter(l => l.description.trim() !== '' || l.amount.trim() !== '')
    if (filled.length === 0) return toast('Add at least one line.', 'error')
    if (filled.some(l => l.description.trim() === '' || !(Number(l.amount) > 0))) return toast('Every line needs a description and an amount greater than zero.', 'error')
    let applied: { openItemId: number; amount: number }[] = []
    if (applies) {
      const result = validOpenItemLines(applications, charges)
      if ('error' in result) return toast(result.error, 'error')
      applied = result.lines
      if (sum(applied.map(a => a.amount)) > total) return toast('The applications exceed the memo amount.', 'error')
    }
    if (!window.confirm(`Post this ${party} memo? This cannot be edited afterward — only voided.`)) return
    setLoading(true)
    try {
      await apiFetch<Memo>(config.endpoint, {
        method: 'POST',
        body: JSON.stringify({
          companyId,
          [party === 'customer' ? 'customerId' : 'supplierId']: partyId,
          memoType,
          reason,
          memoDate,
          termDays: !applies && termDays.trim() !== '' ? Number(termDays) : null,
          dueDate: !applies && dueDate ? dueDate : null,
          originalReference: originalReference || null,
          sheetNumber: sheetNumber || null,
          remarks: remarks || null,
          lines: filled.map(l => ({ description: l.description.trim(), amount: cents(Number(l.amount)) })),
          applications: applied.length ? applied : null,
        }),
      })
      toast(`${partyLabel} memo posted successfully.`, 'success')
      rec.close()
      reloadList(config.endpoint)
    } catch (err) {
      toast(mutationErrorMessage(err, `Failed to post ${party} memo.`), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVoid() {
    if (!active) return
    if (!window.confirm(`Void ${party} memo "${active.referenceNumber}"? Its applications are reversed. This cannot be undone.`)) return
    setVoiding(true)
    try {
      setActive(await apiFetch<Memo>(`${config.endpoint}/${active.id}/void`, { method: 'POST' }))
      toast(`${partyLabel} memo voided.`, 'success')
      reloadList(config.endpoint)
    } catch (err) {
      toast(mutationErrorMessage(err, `Failed to void ${party} memo.`), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const tabTitle = mode === 'create' ? `New ${partyLabel} Memo` : active?.referenceNumber || `${partyLabel} Memo`
  const partyName = active ? (party === 'customer' ? active.customerName : active.supplierName) : null

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <AccountingList
          title={config.title}
          endpoint={config.endpoint}
          listKey={config.endpoint.slice(1)}
          columns={COLUMNS}
          searchText={r => [r.referenceNumber, r.sheetNumber ?? '', r.customerName ?? '', r.supplierName ?? '', reasonLabel(r.reason),
            r.originalReference ?? '', r.remarks ?? '', r.companyName].join(' ')}
          onOpen={openView}
          noun={`${party} memos`}
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
                <DocLetterhead company={<CompanyField id="memo-company" readOnly name={active.companyName} />}>
                  <DocHeader title={config.typeLabels[active.memoType]} number={active.referenceNumber}>
                    <DocRow>
                      <DocCell label="Memo Date"><DocText>{formatDate(active.memoDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{active.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label={partyLabel}><DocText>{partyName}</DocText></DocCell>
                  <DocCell label="Reason"><DocText>{reasonLabel(active.reason)}</DocText></DocCell>
                  {active.dueDate && <DocCell label="Due Date"><DocText>{formatDate(active.dueDate)}</DocText></DocCell>}
                  {active.originalReference && <DocCell label="Original Reference"><DocText>{active.originalReference}</DocText></DocCell>}
                </DocRow>
                <DocLines
                  rows={byLineNumber(active.lines)}
                  rowKey={l => l.id}
                  lineNumber={l => l.lineNumber}
                  minRows={4}
                  columns={[
                    { key: 'description', label: 'Description', render: l => l.description },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: l => formatCurrency(l.amount) },
                  ]}
                />
                <AllocationLines title="Applied To" allocations={active.applications ?? []} side="charge" />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{active.remarks}</DocText></DocCell>
                  <DocTotals entries={[
                    { label: 'Amount', value: formatCurrency(active.amount), grand: true },
                    ...(active.balance !== null && !active.voided ? [
                      { label: active.direction === 'CREDIT' ? 'Applied' : 'Paid', value: formatCurrency(active.appliedAmount) },
                      { label: active.direction === 'CREDIT' ? 'Unapplied' : 'Balance', value: formatCurrency(active.balance) },
                    ] : []),
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
                  <PrintButton companyId={active.companyId} documentType={config.transactionType} data={active as unknown as Record<string, unknown>}
                    onError={() => toast(`No active print template configured for ${config.title} under ${active.companyName}.`, 'error')} />
                )}
                <CloseButton onClick={requestClose} />
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <DocSheet>
                <DocLetterhead company={
                  <CompanyField id="memo-company" readOnly={!showCompanyColumn} name={companyOptions.find(c => c.id === companyId)?.name}
                    companies={companyOptions} value={companyId}
                    onChange={v => { setCompanyId(v); setPartyId(''); setApplications([EMPTY_OPEN_ITEM_LINE]) }} autoFocus={showCompanyColumn} />
                }>
                  <DocHeader title={config.typeLabels[memoType]} number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Memo Type" htmlFor="memo-type" required>
                        <SearchableSelect id="memo-type" value={memoType}
                          onChange={v => { setMemoType((v || config.applyingType) as MemoType); setApplications([EMPTY_OPEN_ITEM_LINE]) }}
                          options={(['DEBIT', 'CREDIT'] as const).map(t => ({ value: t, label: config.typeLabels[t] }))} autoFocus={!showCompanyColumn} />
                      </DocCell>
                      <DocCell label="Memo Date" htmlFor="memo-date" required>
                        <Input id="memo-date" type="date" value={memoDate} onChange={e => setMemoDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="memo-sheet">
                        <Input id="memo-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label={partyLabel} htmlFor="memo-party" required>
                    <SearchableSelect id="memo-party" value={partyId === '' ? '' : String(partyId)}
                      onChange={v => { setPartyId(v ? Number(v) : ''); setApplications([EMPTY_OPEN_ITEM_LINE]) }}
                      options={parties.map(p => ({ value: String(p.id), label: p.code ? `${p.code} — ${p.name}` : p.name }))} disabled={!companyId} />
                  </DocCell>
                  <DocCell label="Reason" htmlFor="memo-reason" required>
                    <SearchableSelect id="memo-reason" value={reason} onChange={setReason} options={config.reasons} />
                  </DocCell>
                </DocRow>
                <DocRow>
                  {!applies && (
                    <DocCell label="Terms (days)" htmlFor="memo-terms">
                      <Input id="memo-terms" type="number" min="0" max="365" value={termDays} onChange={e => setTermDays(e.target.value)} placeholder={`${partyLabel}'s terms`} />
                    </DocCell>
                  )}
                  {!applies && (
                    <DocCell label="Due Date" htmlFor="memo-due">
                      <Input id="memo-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                    </DocCell>
                  )}
                  <DocCell label="Original Reference" htmlFor="memo-original">
                    <Input id="memo-original" value={originalReference} onChange={e => setOriginalReference(e.target.value)}
                      placeholder={reason === 'OPENING_BALANCE' ? 'Legacy document number' : undefined} />
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={lines}
                  columns={[
                    {
                      key: 'description', label: 'Description', required: true,
                      render: (line, i) => (
                        <Input aria-label={`Line ${i + 1} description`} value={line.description} maxLength={255}
                          onChange={e => setLines(prev => prev.map((l, j) => j === i ? { ...l, description: e.target.value } : l))} />
                      ),
                    },
                    {
                      key: 'amount', label: 'Amount', align: 'right', width: '9rem', required: true,
                      render: (line, i) => (
                        <Input type="number" step="0.01" min="0" aria-label={`Line ${i + 1} amount`} value={line.amount} className="text-right"
                          onChange={e => setLines(prev => prev.map((l, j) => j === i ? { ...l, amount: e.target.value } : l))} />
                      ),
                    },
                    {
                      key: 'remove', label: '', align: 'center', width: '2.75rem',
                      render: (_, i) => (
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove line ${i + 1}`}
                          onClick={() => setLines(prev => prev.filter((_, j) => j !== i))} disabled={lines.length === 1}>
                          <X className="w-4 h-4" />
                        </Button>
                      ),
                    },
                  ]}
                  footer={
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLines(prev => [...prev, EMPTY_LINE])}>
                      <Plus className="w-3.5 h-3.5" />
                      Add Line
                    </Button>
                  }
                />
                {applies && (
                  <OpenItemLinesEditor
                    title={`Apply To (optional — or later with a ${partyLabel} Credit Application)`}
                    items={charges}
                    rows={applications}
                    onChange={setApplications}
                    available={total}
                    disabled={partyId === ''}
                    emptyHint={partyId === '' ? `Select a ${party} first.` : `No open ${party === 'customer' ? 'receivables' : 'payables'} for this ${party}.`}
                  />
                )}
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="memo-remarks">
                    <Input id="memo-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[
                    { label: 'Amount', value: formatCurrency(total), grand: true },
                    ...(applies ? [{ label: 'Applied now', value: formatCurrency(sum(applications.map(a => a.amount))) }] : []),
                  ]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Post {partyLabel} Memo</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}
    </div>
  )
}
