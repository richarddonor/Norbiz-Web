import { useState, useMemo, useEffect, type FormEvent } from 'react'
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
import { useCompanyOptions } from '@/components/accounting/useCompanyOptions'
import { sourceTypeLabel, todayIso, type AccountingDocument, type OpenItemSourceType } from '@/lib/accounting'

type FormMode = 'view' | 'create'

interface StatementLine {
  id: number | null
  openItemId: number
  sourceType: OpenItemSourceType
  direction: 'CHARGE' | 'CREDIT'
  referenceNumber: string
  documentDate: string
  dueDate: string | null
  amount: string
  paidAmount: string
  pendingAmount: string
  balance: string
  daysOverdue: number
  lineNumber: number
}

interface Statement extends Omit<AccountingDocument, 'id'> {
  id: number | null
  customerId: number
  customerName: string
  statementDate: string
  totalBalance: string
  currentAmount: string
  days1To30: string
  days31To60: string
  days61To90: string
  days91To120: string
  over120: string
  unappliedCredits: string
  lines: StatementLine[] | null
}

function buildColumns(showCompanyColumn: boolean): ListColumn<Statement & { id: number }>[] {
  const columns: ListColumn<Statement & { id: number }>[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true, muted: true, value: r => r.companyName })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: r => r.referenceNumber },
    { key: 'sheetNumber', label: 'Sheet #', sortable: true, filterable: true, muted: true, value: r => r.sheetNumber ?? '' },
    { key: 'customer', label: 'Customer', sortable: true, filterable: true, value: r => r.customerName },
    { key: 'date', label: 'As of', sortable: true, filterable: true, type: 'date', value: r => formatDate(r.statementDate) },
    { key: 'totalBalance', label: 'Balance', sortable: true, align: 'right', value: r => formatCurrency(r.totalBalance) },
    { key: 'over120', label: 'Over 120 Days', align: 'right', value: r => formatCurrency(r.over120) },
    { ...ORIGIN_COLUMN, filterable: true, value: r => originLabel(r.origin), render: r => <OriginBadge origin={r.origin} /> },
    { key: 'voided', label: 'Voided', sortable: true, type: 'boolean', filterable: true, value: r => r.voided ? 'Yes' : '', render: r => <VoidedBadge voided={r.voided} /> },
  )
  return columns
}

/** The aging buckets and the open items of a statement — shared by the preview and an issued statement. */
function StatementBody({ statement }: { statement: Statement }) {
  return (
    <>
      <DocLines
        rows={byLineNumber(statement.lines ?? [])}
        rowKey={l => l.openItemId}
        lineNumber={l => l.lineNumber}
        minRows={6}
        columns={[
          { key: 'date', label: 'Date', width: '7rem', render: l => formatDate(l.documentDate) },
          { key: 'reference', label: 'Reference', render: l => `${l.referenceNumber} — ${sourceTypeLabel(l.sourceType)}` },
          { key: 'due', label: 'Due', width: '7rem', render: l => formatDate(l.dueDate) },
          { key: 'amount', label: 'Amount', align: 'right', width: '8rem', render: l => formatCurrency(l.amount) },
          { key: 'paid', label: 'Paid / Applied', align: 'right', width: '8rem', render: l => formatCurrency(l.paidAmount) },
          { key: 'balance', label: 'Balance', align: 'right', width: '8rem', render: l => formatCurrency(l.balance) },
          { key: 'overdue', label: 'Days Overdue', align: 'right', width: '7rem', render: l => l.daysOverdue > 0 ? String(l.daysOverdue) : '' },
        ]}
      />
      <DocRow cols="1fr 1fr 1fr 1fr 1fr 1fr">
        <DocCell label="Current"><DocText>{formatCurrency(statement.currentAmount)}</DocText></DocCell>
        <DocCell label="1-30 Days"><DocText>{formatCurrency(statement.days1To30)}</DocText></DocCell>
        <DocCell label="31-60 Days"><DocText>{formatCurrency(statement.days31To60)}</DocText></DocCell>
        <DocCell label="61-90 Days"><DocText>{formatCurrency(statement.days61To90)}</DocText></DocCell>
        <DocCell label="91-120 Days"><DocText>{formatCurrency(statement.days91To120)}</DocText></DocCell>
        <DocCell label="Over 120 Days"><DocText>{formatCurrency(statement.over120)}</DocText></DocCell>
      </DocRow>
    </>
  )
}

// Statement of Account (docs/ACCOUNTING.md): a customer's open items as of a date, aged by due date and frozen for
// printing. The create form previews it live; issuing saves it.
export function StatementsOfAccountPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const inRecordTab = useIsRecordTab()
  const companyOptions = useCompanyOptions(inRecordTab)

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<Statement & { id: number }>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<Statement & { id: number }>(`/statements-of-account/${id}`),
  })
  const [active, setActive] = useState<Statement | null>(null)
  const [companyId, setCompanyId] = useState<number | ''>('')
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [statementDate, setStatementDate] = useState(todayIso())
  const [sheetNumber, setSheetNumber] = useState('')
  const [remarks, setRemarks] = useState('')
  const [preview, setPreview] = useState<Statement | null>(null)
  const [loading, setLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const { markClean, guardedClose } = useDirtyGuard()

  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const customers = useLookup<LookupOption>('customers', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load customers.', 'error') })

  useEffect(() => {
    if (!creating || !customerId || !lookupCompanyId || !statementDate) { setPreview(null); return }
    let cancelled = false
    apiFetch<Statement>(`/statements-of-account/preview?companyId=${lookupCompanyId}&customerId=${customerId}&statementDate=${statementDate}`)
      .then(p => { if (!cancelled) setPreview(p) })
      .catch(err => { if (!cancelled) toast(mutationErrorMessage(err, 'Failed to build the statement.'), 'error') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, customerId, lookupCompanyId, statementDate])

  const canCreate = hasPermission('CREATE_STATEMENT_OF_ACCOUNT')
  const canVoid = hasPermission('VOID_STATEMENT_OF_ACCOUNT')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const activity = useTransactionActivity('STATEMENT_OF_ACCOUNT', inRecordTab && mode === 'view' ? active?.id : null, active?.referenceNumber, active?.voided)

  function openView(statement: Statement) {
    if (!rec.isRecordTab) return rec.open('view', statement as Statement & { id: number })
    setActive(statement)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActive(null)
    const next = { companyId: activeCompanyId ?? '' as number | '', customerId: '' as const, statementDate: todayIso(), sheetNumber: '', remarks: '' }
    setCompanyId(next.companyId)
    setCustomerId('')
    setStatementDate(next.statementDate)
    setSheetNumber('')
    setRemarks('')
    setPreview(null)
    markClean(next)
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, customerId, statementDate, sheetNumber, remarks }, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return toast('Select a company.', 'error')
    if (!customerId) return toast('Select a customer.', 'error')
    if (!window.confirm('Issue this statement of account?')) return
    setLoading(true)
    try {
      await apiFetch('/statements-of-account', {
        method: 'POST',
        body: JSON.stringify({ companyId, customerId, statementDate, sheetNumber: sheetNumber || null, remarks: remarks || null }),
      })
      toast('Statement of account issued.', 'success')
      rec.close()
      reloadList('/statements-of-account')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to issue statement of account.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVoid() {
    if (!active?.id) return
    if (!window.confirm(`Void statement of account "${active.referenceNumber}"?`)) return
    setVoiding(true)
    try {
      setActive(await apiFetch<Statement>(`/statements-of-account/${active.id}/void`, { method: 'POST' }))
      toast('Statement of account voided.', 'success')
      reloadList('/statements-of-account')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void statement of account.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const tabTitle = mode === 'create' ? 'New Statement of Account' : active?.referenceNumber || 'Statement of Account'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <AccountingList
          title="Statements of Account"
          endpoint="/statements-of-account"
          listKey="statements-of-account"
          columns={COLUMNS}
          searchText={r => [r.referenceNumber, r.sheetNumber ?? '', r.customerName, r.remarks ?? '', r.companyName].join(' ')}
          onOpen={openView}
          noun="statements of account"
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
                <DocLetterhead company={<CompanyField id="soa-company" readOnly name={active.companyName} />}>
                  <DocHeader title="Statement of Account" number={active.referenceNumber}>
                    <DocRow>
                      <DocCell label="As of"><DocText>{formatDate(active.statementDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{active.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Customer"><DocText>{active.customerName}</DocText></DocCell>
                </DocRow>
                <StatementBody statement={active} />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{active.remarks}</DocText></DocCell>
                  <DocTotals entries={[
                    { label: 'Unapplied Credits', value: `− ${formatCurrency(active.unappliedCredits)}` },
                    { label: 'Balance Due', value: formatCurrency(active.totalBalance), grand: true },
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
                  <PrintButton companyId={active.companyId} documentType="STATEMENT_OF_ACCOUNT" data={active as unknown as Record<string, unknown>}
                    onError={() => toast(`No active print template configured for Statements of Account under ${active.companyName}.`, 'error')} />
                )}
                <CloseButton onClick={requestClose} />
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <DocSheet>
                <DocLetterhead company={
                  <CompanyField id="soa-company" readOnly={!showCompanyColumn} name={companyOptions.find(c => c.id === companyId)?.name}
                    companies={companyOptions} value={companyId} onChange={v => { setCompanyId(v); setCustomerId('') }} autoFocus={showCompanyColumn} />
                }>
                  <DocHeader title="Statement of Account" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="As of" htmlFor="soa-date" required>
                        <Input id="soa-date" type="date" value={statementDate} onChange={e => setStatementDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="soa-sheet">
                        <Input id="soa-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Customer" htmlFor="soa-customer" required>
                    <SearchableSelect id="soa-customer" value={customerId === '' ? '' : String(customerId)} onChange={v => setCustomerId(v ? Number(v) : '')}
                      options={customers.map(c => ({ value: String(c.id), label: c.code ? `${c.code} — ${c.name}` : c.name }))}
                      disabled={!companyId} autoFocus={!showCompanyColumn} />
                  </DocCell>
                </DocRow>
                {preview && <StatementBody statement={preview} />}
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="soa-remarks">
                    <Input id="soa-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[
                    { label: 'Unapplied Credits', value: preview ? `− ${formatCurrency(preview.unappliedCredits)}` : '—' },
                    { label: 'Balance Due', value: preview ? formatCurrency(preview.totalBalance) : '—', grand: true },
                  ]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Issue Statement</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}
    </div>
  )
}
