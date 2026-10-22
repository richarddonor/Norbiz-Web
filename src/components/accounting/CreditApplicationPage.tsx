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
import { openItemOptionLabel, useOpenItems } from '@/lib/openItems'
import { cents, sourceTypeLabel, sum, todayIso, type AccountingDocument, type Allocation, type OpenItemSourceType } from '@/lib/accounting'

type FormMode = 'view' | 'create'

interface CreditApplication extends AccountingDocument {
  customerId: number | null
  customerName: string | null
  supplierId: number | null
  supplierName: string | null
  applicationDate: string
  totalAmount: string
  lines: {
    id: number
    creditItemId: number
    creditSourceType: OpenItemSourceType
    creditReferenceNumber: string
    chargeItemId: number
    chargeSourceType: OpenItemSourceType
    chargeReferenceNumber: string
    amount: string
    lineNumber: number
  }[]
  applications: Allocation[] | null
}

interface LineDraft {
  creditItemId: number | ''
  chargeItemId: number | ''
  amount: string
}

const EMPTY_LINE: LineDraft = { creditItemId: '', chargeItemId: '', amount: '' }

export interface CreditApplicationConfig {
  side: 'customer' | 'supplier'
  title: string
  endpoint: string
}

// Customer / Supplier Credit Application (docs/ACCOUNTING.md): applies credits posted earlier — advances (unapplied
// payment tenders) and credit-side memos — to open charges, one credit → charge pair per line.
export function CreditApplicationPage({ config }: { config: CreditApplicationConfig }) {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const inRecordTab = useIsRecordTab()
  const companyOptions = useCompanyOptions(inRecordTab)
  const customer = config.side === 'customer'
  const partyLabel = customer ? 'Customer' : 'Supplier'
  const permission = customer ? 'CUSTOMER_CREDIT_APPLICATION' : 'SUPPLIER_CREDIT_APPLICATION'
  const side = customer ? 'RECEIVABLE' : 'PAYABLE'

  const COLUMNS = useMemo(() => {
    const columns: ListColumn<CreditApplication>[] = []
    if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true, muted: true, value: r => r.companyName })
    columns.push(
      { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: r => r.referenceNumber },
      { key: 'sheetNumber', label: 'Sheet #', sortable: true, filterable: true, muted: true, value: r => r.sheetNumber ?? '' },
      { key: config.side, label: partyLabel, sortable: true, filterable: true, value: r => (customer ? r.customerName : r.supplierName) ?? '' },
      { key: 'date', label: 'Application Date', sortable: true, filterable: true, type: 'date', value: r => formatDate(r.applicationDate) },
      { key: 'applied', label: 'Applied', value: r => r.lines.map(l => `${l.creditReferenceNumber} → ${l.chargeReferenceNumber}`).join(', ') },
      { key: 'totalAmount', label: 'Total', sortable: true, align: 'right', total: 'currency', value: r => formatCurrency(r.totalAmount) },
      { key: 'remarks', label: 'Remarks', filterable: true, muted: true, value: r => r.remarks ?? '' },
      { ...ORIGIN_COLUMN, filterable: true, value: r => originLabel(r.origin), render: r => <OriginBadge origin={r.origin} /> },
      { key: 'voided', label: 'Voided', sortable: true, type: 'boolean', filterable: true, value: r => r.voided ? 'Yes' : '', render: r => <VoidedBadge voided={r.voided} /> },
    )
    return columns
  }, [showCompanyColumn, customer, config.side, partyLabel])

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<CreditApplication>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<CreditApplication>(`${config.endpoint}/${id}`),
  })
  const [active, setActive] = useState<CreditApplication | null>(null)
  const [companyId, setCompanyId] = useState<number | ''>('')
  const [partyId, setPartyId] = useState<number | ''>('')
  const [applicationDate, setApplicationDate] = useState(todayIso())
  const [sheetNumber, setSheetNumber] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([EMPTY_LINE])
  const [loading, setLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const { markClean, guardedClose } = useDirtyGuard()

  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const parties = useLookup<LookupOption>(customer ? 'customers' : 'suppliers', lookupCompanyId, { enabled: creating, onError: () => toast(`Failed to load ${config.side}s.`, 'error') })
  const credits = useOpenItems(lookupCompanyId, side, partyId, 'CREDIT', creating)
  const charges = useOpenItems(lookupCompanyId, side, partyId, 'CHARGE', creating)
  const creditById = new Map(credits.map(o => [o.id, o]))
  const chargeById = new Map(charges.map(o => [o.id, o]))
  const total = cents(sum(lines.map(l => l.amount)))

  const canCreate = hasPermission(`CREATE_${permission}`)
  const canVoid = hasPermission(`VOID_${permission}`)
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const activity = useTransactionActivity(permission, inRecordTab && mode === 'view' ? active?.id : null, active?.referenceNumber, active?.voided)

  function openView(application: CreditApplication) {
    if (!rec.isRecordTab) return rec.open('view', application)
    setActive(application)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActive(null)
    const next = { companyId: activeCompanyId ?? '' as number | '', partyId: '' as const, applicationDate: todayIso(), sheetNumber: '', remarks: '', lines: [EMPTY_LINE] }
    setCompanyId(next.companyId)
    setPartyId('')
    setApplicationDate(next.applicationDate)
    setSheetNumber('')
    setRemarks('')
    setLines(next.lines)
    markClean(next)
    setMode('create')
  }

  function requestClose() {
    guardedClose({ companyId, partyId, applicationDate, sheetNumber, remarks, lines }, () => rec.close())
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines(prev => prev.map((l, i) => {
      if (i !== index) return l
      const next = { ...l, ...patch }
      // Suggest the most that can go across: the smaller of what the credit has left and what the charge owes.
      if (!l.amount && next.creditItemId !== '' && next.chargeItemId !== '') {
        const most = Math.min(Number(creditById.get(next.creditItemId)?.balance ?? 0), Number(chargeById.get(next.chargeItemId)?.balance ?? 0))
        if (most > 0) next.amount = most.toFixed(2)
      }
      return next
    }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return toast('Select a company.', 'error')
    if (!partyId) return toast(`Select a ${config.side}.`, 'error')
    const filled = lines.filter(l => l.creditItemId !== '' || l.chargeItemId !== '' || l.amount.trim() !== '')
    if (filled.length === 0) return toast('Add at least one line.', 'error')
    if (filled.some(l => l.creditItemId === '' || l.chargeItemId === '' || !(Number(l.amount) > 0))) {
      return toast('Every line needs a credit, a charge and an amount greater than zero.', 'error')
    }
    if (!window.confirm(`Post this ${config.side} credit application? This cannot be edited afterward — only voided.`)) return
    setLoading(true)
    try {
      await apiFetch(config.endpoint, {
        method: 'POST',
        body: JSON.stringify({
          companyId,
          [customer ? 'customerId' : 'supplierId']: partyId,
          applicationDate,
          sheetNumber: sheetNumber || null,
          remarks: remarks || null,
          lines: filled.map(l => ({ creditItemId: l.creditItemId, chargeItemId: l.chargeItemId, amount: cents(Number(l.amount)) })),
        }),
      })
      toast('Credit application posted successfully.', 'success')
      rec.close()
      reloadList(config.endpoint)
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post credit application.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVoid() {
    if (!active) return
    if (!window.confirm(`Void credit application "${active.referenceNumber}"? Its applications are reversed. This cannot be undone.`)) return
    setVoiding(true)
    try {
      setActive(await apiFetch<CreditApplication>(`${config.endpoint}/${active.id}/void`, { method: 'POST' }))
      toast('Credit application voided.', 'success')
      reloadList(config.endpoint)
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void credit application.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const tabTitle = mode === 'create' ? `New ${partyLabel} Credit Application` : active?.referenceNumber || `${partyLabel} Credit Application`
  // A line's application may since have been reversed (voided, or its check bounced).
  const reversed = new Set((active?.applications ?? []).filter(a => a.reversed).map(a => `${a.creditItemId}:${a.chargeItemId}`))

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <AccountingList
          title={config.title}
          endpoint={config.endpoint}
          listKey={config.endpoint.slice(1)}
          columns={COLUMNS}
          searchText={r => [r.referenceNumber, r.sheetNumber ?? '', r.customerName ?? '', r.supplierName ?? '',
            r.lines.map(l => `${l.creditReferenceNumber} ${l.chargeReferenceNumber}`).join(' '), r.remarks ?? '', r.companyName].join(' ')}
          onOpen={openView}
          noun="credit applications"
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
                <DocLetterhead company={<CompanyField id="cca-company" readOnly name={active.companyName} />}>
                  <DocHeader title={`${partyLabel} Credit Application`} number={active.referenceNumber}>
                    <DocRow>
                      <DocCell label="Application Date"><DocText>{formatDate(active.applicationDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{active.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label={partyLabel}><DocText>{customer ? active.customerName : active.supplierName}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(active.lines)}
                  rowKey={l => l.id}
                  lineNumber={l => l.lineNumber}
                  minRows={4}
                  columns={[
                    { key: 'credit', label: 'Credit', render: l => `${l.creditReferenceNumber} — ${sourceTypeLabel(l.creditSourceType)}` },
                    { key: 'charge', label: 'Applied To', render: l => `${l.chargeReferenceNumber} — ${sourceTypeLabel(l.chargeSourceType)}` },
                    { key: 'state', label: 'Status', width: '8rem', render: l => reversed.has(`${l.creditItemId}:${l.chargeItemId}`) ? 'Reversed' : 'Applied' },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: l => formatCurrency(l.amount) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{active.remarks}</DocText></DocCell>
                  <DocTotals entries={[{ label: 'Total Applied', value: formatCurrency(active.totalAmount), grand: true }]} />
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
                  <CompanyField id="cca-company" readOnly={!showCompanyColumn} name={companyOptions.find(c => c.id === companyId)?.name}
                    companies={companyOptions} value={companyId} onChange={v => { setCompanyId(v); setPartyId(''); setLines([EMPTY_LINE]) }} autoFocus={showCompanyColumn} />
                }>
                  <DocHeader title={`${partyLabel} Credit Application`} number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Application Date" htmlFor="cca-date" required>
                        <Input id="cca-date" type="date" value={applicationDate} onChange={e => setApplicationDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="cca-sheet">
                        <Input id="cca-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label={partyLabel} htmlFor="cca-party" required>
                    <SearchableSelect id="cca-party" value={partyId === '' ? '' : String(partyId)}
                      onChange={v => { setPartyId(v ? Number(v) : ''); setLines([EMPTY_LINE]) }}
                      options={parties.map(p => ({ value: String(p.id), label: p.code ? `${p.code} — ${p.name}` : p.name }))}
                      disabled={!companyId} autoFocus={!showCompanyColumn} />
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={lines}
                  columns={[
                    {
                      key: 'credit', label: 'Credit (advance / memo)', required: true,
                      render: (l, i) => (
                        <SearchableSelect value={l.creditItemId === '' ? '' : String(l.creditItemId)} onChange={v => updateLine(i, { creditItemId: v ? Number(v) : '' })}
                          options={credits.map(o => ({ value: String(o.id), label: openItemOptionLabel(o) }))} disabled={partyId === ''} />
                      ),
                    },
                    {
                      key: 'charge', label: 'Apply To', required: true,
                      render: (l, i) => (
                        <SearchableSelect value={l.chargeItemId === '' ? '' : String(l.chargeItemId)} onChange={v => updateLine(i, { chargeItemId: v ? Number(v) : '' })}
                          options={charges.map(o => ({ value: String(o.id), label: openItemOptionLabel(o) }))} disabled={partyId === ''} />
                      ),
                    },
                    {
                      key: 'amount', label: 'Amount', align: 'right', width: '9rem', required: true,
                      render: (l, i) => (
                        <Input type="number" step="0.01" min="0" aria-label={`Line ${i + 1} amount`} value={l.amount} className="text-right"
                          onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
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
                    <div className="flex items-center justify-between gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setLines(prev => [...prev, EMPTY_LINE])}>
                        <Plus className="w-3.5 h-3.5" />
                        Add Line
                      </Button>
                      {partyId !== '' && credits.length === 0 && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">This {config.side} has no unapplied credits.</span>
                      )}
                    </div>
                  }
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="cca-remarks">
                    <Input id="cca-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[{ label: 'Total Applied', value: formatCurrency(total), grand: true }]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Post Credit Application</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}
    </div>
  )
}
