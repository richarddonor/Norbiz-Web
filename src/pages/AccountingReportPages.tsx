import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, ChevronRight, ChevronDown } from 'lucide-react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ReloadButton } from '@/components/ReloadButton'
import { ScrollTable, PINNED_TH, PINNED_TD } from '@/components/ScrollTable'
import { useTransactionDrillDown } from '@/hooks/useTransactionDrillDown'
import type { TransactionType } from '@/hooks/useTransactionActivity'
import { useLookup, type LookupOption } from '@/lib/lookups'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatCurrency, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AccountingList, type ListColumn } from '@/components/accounting/AccountingList'
import { sourceTypeLabel, statusLabel, todayIso, type AccountSide, type BankAccountLookupOption, type OpenItem, type OpenItemSourceType } from '@/lib/accounting'

// AR/AP reports (docs/ACCOUNTING.md "Reports"): aging and party ledgers as of a date, the bank book, and the open-item
// lists. They are computed for one company — the session's active company.

/** The transaction a source document opens in (payment tenders open nothing — they're lines of a payment). */
const SOURCE_TRANSACTION: Partial<Record<OpenItemSourceType, TransactionType>> = {
  SALES_INVOICE: 'SALES_INVOICE',
  PURCHASE_INVOICE: 'PURCHASE_INVOICE',
  CUSTOMER_DEBIT_MEMO: 'CUSTOMER_MEMO',
  CUSTOMER_CREDIT_MEMO: 'CUSTOMER_MEMO',
  SALES_INVOICE_RETURN: 'SALES_INVOICE_RETURN',
  SUPPLIER_DEBIT_MEMO: 'SUPPLIER_MEMO',
  SUPPLIER_CREDIT_MEMO: 'SUPPLIER_MEMO',
  CUSTOMER_REFUND: 'CUSTOMER_REFUND',
  SUPPLIER_REFUND: 'SUPPLIER_REFUND',
}

function monthStartIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const TH = 'py-2 px-4 font-medium'
const NUM = 'py-2 px-4 text-right tabular-nums'

// ---- aging ---------------------------------------------------------------------------------------------------------

interface AgingItem {
  openItemId: number
  sourceType: OpenItemSourceType
  sourceId: number
  direction: 'CHARGE' | 'CREDIT'
  referenceNumber: string
  documentDate: string
  dueDate: string | null
  amount: string
  paidAmount: string
  balance: string
  daysOverdue: number
  bucket: string
}

interface AgingRow {
  partyId: number | null
  partyCode: string | null
  partyName: string | null
  current: string
  days1To30: string
  days31To60: string
  days61To90: string
  days91To120: string
  over120: string
  totalDue: string
  unappliedCredits: string
  netBalance: string
  items: AgingItem[]
}

interface AgingReport {
  rows: AgingRow[]
  totals: AgingRow
}

const BUCKETS: { key: keyof AgingRow; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'days1To30', label: '1-30' },
  { key: 'days31To60', label: '31-60' },
  { key: 'days61To90', label: '61-90' },
  { key: 'days91To120', label: '91-120' },
  { key: 'over120', label: 'Over 120' },
  { key: 'totalDue', label: 'Total Due' },
  { key: 'unappliedCredits', label: 'Unapplied Credits' },
  { key: 'netBalance', label: 'Net Balance' },
]

function AgingReportPage({ side }: { side: AccountSide }) {
  const { toast } = useToast()
  const { activeCompanyId } = useAuth()
  const drillDown = useTransactionDrillDown()
  const receivable = side === 'RECEIVABLE'
  const partyLabel = receivable ? 'Customer' : 'Supplier'
  const [asOf, setAsOf] = useState(todayIso())
  const [basis, setBasis] = useState('DUE_DATE')
  const [partyId, setPartyId] = useState('')
  const [report, setReport] = useState<AgingReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const parties = useLookup<LookupOption>(receivable ? 'customers' : 'suppliers', activeCompanyId, { params: { activeOnly: 'false' } })

  const load = useCallback(() => {
    if (!activeCompanyId || !asOf) return
    setLoading(true)
    const party = partyId ? `&${receivable ? 'customerId' : 'supplierId'}=${partyId}` : ''
    apiFetch<AgingReport>(`/reports/${receivable ? 'ar' : 'ap'}-aging?companyId=${activeCompanyId}&asOf=${asOf}&basis=${basis}&detail=true${party}`)
      .then(setReport)
      .catch(err => toast(mutationErrorMessage(err, 'Failed to load the aging report.'), 'error'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, asOf, basis, partyId, receivable])

  useEffect(load, [load])

  function handleExport() {
    if (!report) return
    const columns = [{ key: 'party', label: partyLabel }, ...BUCKETS.map(b => ({ key: b.key, label: b.label, total: 'currency' as const }))]
    const rows = report.rows.map(r => ({ party: r.partyName, ...Object.fromEntries(BUCKETS.map(b => [b.key, formatCurrency(r[b.key] as string)])) }))
    exportToXlsx(`${receivable ? 'ar' : 'ap'}-aging-${asOf}`, columns, rows)
  }

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{receivable ? 'Accounts Receivable Aging' : 'Accounts Payable Aging'}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-[hsl(var(--muted-foreground))]" htmlFor="aging-as-of">As of</label>
          <Input id="aging-as-of" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="w-40" />
          <SearchableSelect value={basis} onChange={v => setBasis(v || 'DUE_DATE')} className="w-44"
            options={[{ value: 'DUE_DATE', label: 'Days past due' }, { value: 'DOCUMENT_DATE', label: 'Days since document' }]} />
          <SearchableSelect value={partyId} onChange={setPartyId} options={parties.map(p => ({ value: String(p.id), label: p.name }))}
            placeholder={`All ${partyLabel.toLowerCase()}s`} className="w-52" />
          <ReloadButton onReload={load} loading={loading} />
          <Button variant="outline" onClick={handleExport} disabled={!report}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>
      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable>
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className={cn(TH, 'text-left', PINNED_TH)}>{partyLabel}</th>
                {BUCKETS.map(b => <th key={b.key} className={cn(TH, 'text-right')}>{b.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {(report?.rows ?? []).length === 0 ? (
                <tr><td colSpan={BUCKETS.length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">Nothing outstanding as of {formatDate(asOf)}.</td></tr>
              ) : report!.rows.map(r => (
                <Fragment key={r.partyId}>
                  <tr className="group border-b border-[hsl(var(--border))] cursor-pointer bg-[hsl(var(--card))] hover:bg-[hsl(var(--secondary))]" onClick={() => toggle(r.partyId!)}>
                    <td className={cn('py-2 px-4 font-medium', PINNED_TD)}>
                      <span className="inline-flex items-center gap-1">
                        {expanded.has(r.partyId!) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {r.partyName}
                      </span>
                    </td>
                    {BUCKETS.map(b => <td key={b.key} className={cn(NUM, b.key === 'netBalance' && 'font-semibold')}>{formatCurrency(r[b.key] as string)}</td>)}
                  </tr>
                  {expanded.has(r.partyId!) && r.items.map(item => (
                    <tr key={item.openItemId} className="border-b border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] cursor-pointer hover:bg-[hsl(var(--secondary))]"
                      onClick={() => drillDown.open(SOURCE_TRANSACTION[item.sourceType] ?? null, item.sourceId)}>
                      <td className="py-1.5 px-4 pl-10">
                        <span className="font-mono">{item.referenceNumber}</span> — {sourceTypeLabel(item.sourceType)} · {formatDate(item.documentDate)}
                        {item.dueDate && ` · due ${formatDate(item.dueDate)}`}{item.daysOverdue > 0 && ` · ${item.daysOverdue} days`}
                      </td>
                      {BUCKETS.map(b => (
                        <td key={b.key} className="py-1.5 px-4 text-right tabular-nums">
                          {item.bucket === bucketOf(b.key) ? formatCurrency(item.balance) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            {report && report.rows.length > 0 && (
              <tfoot className="sticky bottom-0 bg-[hsl(var(--card))]">
                <tr className="border-t-2 border-[hsl(var(--border))] font-semibold">
                  <td className={cn('py-2 px-4', PINNED_TD)}>Grand total</td>
                  {BUCKETS.map(b => <td key={b.key} className={NUM}>{formatCurrency(report.totals[b.key] as string)}</td>)}
                </tr>
              </tfoot>
            )}
          </ScrollTable>
        </CardContent>
      </Card>
    </div>
  )
}

function bucketOf(key: keyof AgingRow): string {
  return ({ current: 'CURRENT', days1To30: 'DAYS_1_30', days31To60: 'DAYS_31_60', days61To90: 'DAYS_61_90', days91To120: 'DAYS_91_120',
    over120: 'OVER_120', unappliedCredits: 'UNAPPLIED_CREDIT' } as Record<string, string>)[key] ?? ''
}

// ---- party ledger --------------------------------------------------------------------------------------------------

interface LedgerLine {
  date: string
  openItemId: number
  sourceType: OpenItemSourceType
  sourceId: number
  referenceNumber: string
  description: string
  debit: string | null
  credit: string | null
  balance: string
}

interface Ledger {
  partyName: string
  openingBalance: string
  closingBalance: string
  lines: LedgerLine[]
}

function LedgerReportPage({ side }: { side: AccountSide }) {
  const { toast } = useToast()
  const { activeCompanyId } = useAuth()
  const drillDown = useTransactionDrillDown()
  const receivable = side === 'RECEIVABLE'
  const partyLabel = receivable ? 'Customer' : 'Supplier'
  const [partyId, setPartyId] = useState('')
  const [dateFrom, setDateFrom] = useState(monthStartIso())
  const [dateTo, setDateTo] = useState(todayIso())
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [loading, setLoading] = useState(false)
  const parties = useLookup<LookupOption>(receivable ? 'customers' : 'suppliers', activeCompanyId, { params: { activeOnly: 'false' } })

  const load = useCallback(() => {
    if (!activeCompanyId || !partyId || !dateFrom || !dateTo) { setLedger(null); return }
    setLoading(true)
    apiFetch<Ledger>(`/reports/${receivable ? 'customer' : 'supplier'}-ledger?companyId=${activeCompanyId}&${receivable ? 'customerId' : 'supplierId'}=${partyId}&dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(setLedger)
      .catch(err => toast(mutationErrorMessage(err, 'Failed to load the ledger.'), 'error'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, partyId, dateFrom, dateTo, receivable])

  useEffect(load, [load])

  function handleExport() {
    if (!ledger) return
    exportToXlsx(`${partyLabel.toLowerCase()}-ledger-${ledger.partyName}`, [
      { key: 'date', label: 'Date' }, { key: 'reference', label: 'Reference' }, { key: 'description', label: 'Description' },
      { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }, { key: 'balance', label: 'Balance' },
    ], [
      { date: formatDate(dateFrom), reference: '', description: 'Opening balance', debit: '', credit: '', balance: formatCurrency(ledger.openingBalance) },
      ...ledger.lines.map(l => ({ date: formatDate(l.date), reference: l.referenceNumber, description: l.description,
        debit: l.debit ? formatCurrency(l.debit) : '', credit: l.credit ? formatCurrency(l.credit) : '', balance: formatCurrency(l.balance) })),
    ])
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{partyLabel} Ledger</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect value={partyId} onChange={setPartyId} options={parties.map(p => ({ value: String(p.id), label: p.code ? `${p.code} — ${p.name}` : p.name }))}
            placeholder={`Select a ${partyLabel.toLowerCase()}…`} className="w-64" />
          <Input type="date" aria-label="From" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <span className="text-sm text-[hsl(var(--muted-foreground))]">to</span>
          <Input type="date" aria-label="To" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
          <ReloadButton onReload={load} loading={loading} />
          <Button variant="outline" onClick={handleExport} disabled={!ledger}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>
      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable>
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className={cn(TH, 'text-left')}>Date</th>
                <th className={cn(TH, 'text-left')}>Reference</th>
                <th className={cn(TH, 'text-left')}>Description</th>
                <th className={cn(TH, 'text-right')}>Debit</th>
                <th className={cn(TH, 'text-right')}>Credit</th>
                <th className={cn(TH, 'text-right')}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {!ledger ? (
                <tr><td colSpan={6} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">Select a {partyLabel.toLowerCase()} to see the ledger.</td></tr>
              ) : (
                <>
                  <tr className="border-b border-[hsl(var(--border))] font-medium">
                    <td className="py-2 px-4">{formatDate(dateFrom)}</td>
                    <td className="py-2 px-4" />
                    <td className="py-2 px-4">Opening balance</td>
                    <td className="py-2 px-4" />
                    <td className="py-2 px-4" />
                    <td className={NUM}>{formatCurrency(ledger.openingBalance)}</td>
                  </tr>
                  {ledger.lines.map((l, i) => (
                    <tr key={`${l.openItemId}-${i}`} className="border-b border-[hsl(var(--border))] cursor-pointer hover:bg-[hsl(var(--secondary))]"
                      onClick={() => drillDown.open(SOURCE_TRANSACTION[l.sourceType] ?? null, l.sourceId)}>
                      <td className="py-2 px-4">{formatDate(l.date)}</td>
                      <td className="py-2 px-4 font-mono text-xs">{l.referenceNumber}</td>
                      <td className="py-2 px-4">{l.description}</td>
                      <td className={NUM}>{l.debit ? formatCurrency(l.debit) : ''}</td>
                      <td className={NUM}>{l.credit ? formatCurrency(l.credit) : ''}</td>
                      <td className={NUM}>{formatCurrency(l.balance)}</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
            {ledger && (
              <tfoot className="sticky bottom-0 bg-[hsl(var(--card))]">
                <tr className="border-t-2 border-[hsl(var(--border))] font-semibold">
                  <td className="py-2 px-4" colSpan={5}>Closing balance ({receivable ? 'owed to us' : 'owed by us'})</td>
                  <td className={NUM}>{formatCurrency(ledger.closingBalance)}</td>
                </tr>
              </tfoot>
            )}
          </ScrollTable>
        </CardContent>
      </Card>
    </div>
  )
}

// ---- bank book -----------------------------------------------------------------------------------------------------

interface BankBookEntry {
  id: number
  entryDate: string
  entryType: string
  amount: string
  sourceType: TransactionType
  sourceId: number
  referenceNumber: string
  checkNumber: string | null
  description: string | null
  cleared: boolean
  clearedDate: string | null
  bankReconciliationReferenceNumber: string | null
  runningBalance: string
}

interface BankBook {
  openingBalance: string
  closingBalance: string
  entries: BankBookEntry[]
}

const ENTRY_LABELS: Record<string, string> = {
  DEPOSIT: 'Deposit', TRANSFER_RECEIPT: 'Transfer In', CHECK_RETURNED: 'Returned Check', CHECK_DISBURSEMENT: 'Check Issued',
  TRANSFER_DISBURSEMENT: 'Transfer Out', BANK_CHARGE: 'Bank Charge', INTEREST: 'Interest', ADJUSTMENT: 'Adjustment',
}

export function BankBookPage() {
  const { toast } = useToast()
  const { activeCompanyId } = useAuth()
  const drillDown = useTransactionDrillDown()
  const [accountId, setAccountId] = useState('')
  const [dateFrom, setDateFrom] = useState(monthStartIso())
  const [dateTo, setDateTo] = useState(todayIso())
  const [book, setBook] = useState<BankBook | null>(null)
  const [loading, setLoading] = useState(false)
  const accounts = useLookup<BankAccountLookupOption>('bank-accounts', activeCompanyId, { params: { activeOnly: 'false' } })

  const load = useCallback(() => {
    if (!accountId || !dateFrom || !dateTo) { setBook(null); return }
    setLoading(true)
    apiFetch<BankBook>(`/reports/bank-book?bankAccountId=${accountId}&dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(setBook)
      .catch(err => toast(mutationErrorMessage(err, 'Failed to load the bank book.'), 'error'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, dateFrom, dateTo])

  useEffect(load, [load])

  function handleExport() {
    if (!book) return
    exportToXlsx('bank-book', [
      { key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'reference', label: 'Reference' }, { key: 'check', label: 'Check #' },
      { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount' }, { key: 'balance', label: 'Balance' }, { key: 'cleared', label: 'Cleared' },
    ], book.entries.map(e => ({ date: formatDate(e.entryDate), type: ENTRY_LABELS[e.entryType] ?? e.entryType, reference: e.referenceNumber,
      check: e.checkNumber ?? '', description: e.description ?? '', amount: formatCurrency(e.amount), balance: formatCurrency(e.runningBalance),
      cleared: e.cleared ? `${formatDate(e.clearedDate)} ${e.bankReconciliationReferenceNumber ?? ''}` : '' })))
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Bank Book</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect value={accountId} onChange={setAccountId} options={accounts.map(a => ({ value: String(a.id), label: `${a.name} (${a.accountNumber})` }))}
            placeholder="Select a bank account…" className="w-64" />
          <Input type="date" aria-label="From" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <span className="text-sm text-[hsl(var(--muted-foreground))]">to</span>
          <Input type="date" aria-label="To" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
          <ReloadButton onReload={load} loading={loading} />
          <Button variant="outline" onClick={handleExport} disabled={!book}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>
      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable>
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {['Date', 'Type', 'Reference', 'Check #', 'Description'].map(h => <th key={h} className={cn(TH, 'text-left')}>{h}</th>)}
                <th className={cn(TH, 'text-right')}>Amount</th>
                <th className={cn(TH, 'text-right')}>Balance</th>
                <th className={cn(TH, 'text-left')}>Cleared</th>
              </tr>
            </thead>
            <tbody>
              {!book ? (
                <tr><td colSpan={8} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">Select a bank account to see its book.</td></tr>
              ) : (
                <>
                  <tr className="border-b border-[hsl(var(--border))] font-medium">
                    <td className="py-2 px-4">{formatDate(dateFrom)}</td>
                    <td className="py-2 px-4" colSpan={5}>Opening balance</td>
                    <td className={NUM}>{formatCurrency(book.openingBalance)}</td>
                    <td className="py-2 px-4" />
                  </tr>
                  {book.entries.map(e => (
                    <tr key={e.id} className="border-b border-[hsl(var(--border))] cursor-pointer hover:bg-[hsl(var(--secondary))]"
                      onClick={() => drillDown.open(e.sourceType, e.sourceId)}>
                      <td className="py-2 px-4">{formatDate(e.entryDate)}</td>
                      <td className="py-2 px-4">{ENTRY_LABELS[e.entryType] ?? e.entryType}</td>
                      <td className="py-2 px-4 font-mono text-xs">{e.referenceNumber}</td>
                      <td className="py-2 px-4 font-mono text-xs">{e.checkNumber ?? ''}</td>
                      <td className="py-2 px-4"><div className="max-w-xs truncate" title={e.description ?? undefined}>{e.description ?? ''}</div></td>
                      <td className={cn(NUM, Number(e.amount) < 0 && 'text-[hsl(var(--destructive))]')}>{formatCurrency(e.amount)}</td>
                      <td className={NUM}>{formatCurrency(e.runningBalance)}</td>
                      <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{e.cleared ? `${formatDate(e.clearedDate)} · ${e.bankReconciliationReferenceNumber ?? ''}` : ''}</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
            {book && (
              <tfoot className="sticky bottom-0 bg-[hsl(var(--card))]">
                <tr className="border-t-2 border-[hsl(var(--border))] font-semibold">
                  <td className="py-2 px-4" colSpan={6}>Closing book balance</td>
                  <td className={NUM}>{formatCurrency(book.closingBalance)}</td>
                  <td className="py-2 px-4" />
                </tr>
              </tfoot>
            )}
          </ScrollTable>
        </CardContent>
      </Card>
    </div>
  )
}

// ---- open items ----------------------------------------------------------------------------------------------------

function OpenItemsPage({ side }: { side: AccountSide }) {
  const { activeCompanyId } = useAuth()
  const drillDown = useTransactionDrillDown()
  const receivable = side === 'RECEIVABLE'
  const [status, setStatus] = useState('OPEN')
  const [direction, setDirection] = useState('')
  const columns = useMemo(() => {
    const cols: ListColumn<OpenItem>[] = []
    cols.push(
      { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: o => o.referenceNumber },
      { key: receivable ? 'customer' : 'supplier', label: receivable ? 'Customer' : 'Supplier', sortable: true, filterable: true,
        value: o => (receivable ? o.customerName : o.supplierName) ?? '' },
      { key: 'sourceType', label: 'Document', sortable: true, value: o => sourceTypeLabel(o.sourceType) },
      { key: 'date', label: 'Date', filterable: true, type: 'date', value: o => formatDate(o.documentDate) },
      { key: 'dueDate', label: 'Due', sortable: true, value: o => formatDate(o.dueDate) },
      { key: 'amount', label: 'Amount', sortable: true, align: 'right', total: 'currency', value: o => formatCurrency(o.direction === 'CREDIT' ? -Number(o.amount) : o.amount) },
      { key: 'applied', label: 'Applied', align: 'right', value: o => formatCurrency(o.appliedAmount) },
      { key: 'pending', label: 'In Uncleared Checks', align: 'right', value: o => Number(o.pendingAmount) ? formatCurrency(o.pendingAmount) : '' },
      { key: 'balance', label: 'Balance', sortable: true, align: 'right', total: 'currency', value: o => formatCurrency(o.direction === 'CREDIT' ? -Number(o.balance) : o.balance) },
      { key: 'status', label: 'Status', sortable: true, value: o => statusLabel(o.status) },
    )
    return cols
  }, [receivable])

  return (
    <div className="flex h-full flex-col gap-6">
      <AccountingList
        title={receivable ? 'Open Receivables' : 'Open Payables'}
        endpoint="/open-items"
        listKey={receivable ? 'open-receivables' : 'open-payables'}
        columns={columns}
        searchText={o => [o.referenceNumber, o.customerName ?? '', o.supplierName ?? '', sourceTypeLabel(o.sourceType)].join(' ')}
        onOpen={o => drillDown.open(SOURCE_TRANSACTION[o.sourceType] ?? null, o.sourceId)}
        noun={receivable ? 'receivables' : 'payables'}
        defaultDateKey={null}
        totals
        extraFilters={{ side, status, direction, companyId: activeCompanyId ? String(activeCompanyId) : '' }}
        toolbar={<>
          <SearchableSelect value={direction} onChange={setDirection} className="w-44" placeholder="Charges and credits"
            options={[{ value: 'CHARGE', label: receivable ? 'Receivables' : 'Payables' }, { value: 'CREDIT', label: 'Credits / advances' }]} />
          <SearchableSelect value={status} onChange={setStatus} className="w-36" placeholder="Any status"
            options={['OPEN', 'CLOSED', 'VOIDED'].map(s => ({ value: s, label: statusLabel(s) }))} />
        </>}
        rowActions={() => null}
        dimmed={o => o.status === 'VOIDED'}
      />
    </div>
  )
}

export const ArAgingPage = () => <AgingReportPage side="RECEIVABLE" />
export const ApAgingPage = () => <AgingReportPage side="PAYABLE" />
export const CustomerLedgerPage = () => <LedgerReportPage side="RECEIVABLE" />
export const SupplierLedgerPage = () => <LedgerReportPage side="PAYABLE" />
export const OpenReceivablesPage = () => <OpenItemsPage side="RECEIVABLE" />
export const OpenPayablesPage = () => <OpenItemsPage side="PAYABLE" />
