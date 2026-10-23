import { useState, useMemo, type FormEvent } from 'react'
import { Ban, X } from 'lucide-react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocLines, DocTotals, DocStamp, PendingNumber, TRANSACTION_MIN_ROWS } from '@/components/ui/doc-form'
import { useRecordTab, useIsRecordTab } from '@/hooks/useRecordTab'
import { RecordSheet, RECORD_ACTIONS, CloseButton } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { TransactionActionsMenu, TransactionHistory } from '@/components/TransactionActivity'
import { useTransactionActivity } from '@/hooks/useTransactionActivity'
import { reloadList } from '@/hooks/usePagedList'
import { PrintButton } from '@/components/PrintButton'
import { OriginBadge, OriginNotice } from '@/components/TransactionOrigin'
import { ORIGIN_COLUMN, originLabel, type TransactionOrigin } from '@/lib/transactionOrigin'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { useLookup, type CustomerLookupOption, type TransactionLookupOption } from '@/lib/lookups'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber, cn } from '@/lib/utils'
import { AccountingList, VoidedBadge, type ListColumn } from '@/components/accounting/AccountingList'
import { AllocationLines } from '@/components/accounting/OpenItemLines'
import { useCompanyOptions } from '@/components/accounting/useCompanyOptions'
import { cents, todayIso, type Allocation } from '@/lib/accounting'

// Sales Invoice Return (../Norbiz/docs/ACCOUNTING.md "Sales Invoice Return"): a customer sends back items billed on its
// Sales Invoices. Stock comes back into the main warehouse and the customer is credited what the items were billed at
// (each invoice line's net unit price), applied to the returned invoices by default.

type FormMode = 'view' | 'create'

interface SalesInvoiceReturnLine {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  salesInvoiceLineId: number | null
  salesInvoiceId: number | null
  salesInvoiceReferenceNumber: string | null
  quantity: string
  unitPrice: string
  amount: string
  lineNumber: number
  postsStock: boolean
}

interface SalesInvoiceReturn {
  id: number
  companyId: number
  companyName: string
  customerId: number
  customerName: string
  warehouseId: number
  warehouseName: string
  referenceNumber: string
  sheetNumber: string | null
  returnDate: string
  remarks: string | null
  netAmount: string
  openItemId: number | null
  appliedAmount: string | null
  unappliedAmount: string | null
  salesInvoiceReferenceNumbers: string
  createdAt: string | null
  createdBy: string | null
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  origin: TransactionOrigin
  lines: SalesInvoiceReturnLine[]
  applications?: Allocation[]
}

interface LineDraft {
  salesInvoiceLineId: number
  invoiceId: number
  invoiceReference: string
  itemId: number
  itemCode: string
  itemName: string
  sold: string
  returnable: string
  unitPrice: string
  quantity: string
}

function returnSearchText(r: SalesInvoiceReturn): string {
  return [r.referenceNumber, r.sheetNumber ?? '', r.customerName, r.salesInvoiceReferenceNumbers, r.remarks ?? '', r.companyName,
    formatDate(r.returnDate)].join(' ')
}

function buildColumns(showCompanyColumn: boolean): ListColumn<SalesInvoiceReturn>[] {
  const columns: ListColumn<SalesInvoiceReturn>[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true, muted: true, value: r => r.companyName })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: r => r.referenceNumber },
    { key: 'sheetNumber', label: 'Sheet #', sortable: true, filterable: true, muted: true, value: r => r.sheetNumber ?? '' },
    { key: 'customer', label: 'Customer', sortable: true, filterable: true, value: r => r.customerName },
    { key: 'invoices', label: 'Sales Invoice(s)', mono: true, value: r => r.salesInvoiceReferenceNumbers },
    { key: 'date', label: 'Return Date', sortable: true, filterable: true, type: 'date', value: r => formatDate(r.returnDate) },
    { key: 'netAmount', label: 'Net Amount', sortable: true, align: 'right', total: 'currency', value: r => formatCurrency(r.netAmount) },
    { key: 'unapplied', label: 'Unapplied Credit', sortable: true, align: 'right', total: 'currency',
      value: r => r.voided || r.unappliedAmount === null ? '' : formatCurrency(r.unappliedAmount) },
    { ...ORIGIN_COLUMN, filterable: true, value: r => originLabel(r.origin), render: r => <OriginBadge origin={r.origin} /> },
    { key: 'voided', label: 'Voided', sortable: true, type: 'boolean', filterable: true, value: r => r.voided ? 'Yes' : '', render: r => <VoidedBadge voided={r.voided} /> },
  )
  return columns
}

function lineAmount(line: LineDraft): number {
  const qty = Number(line.quantity)
  return Number.isFinite(qty) ? qty * Number(line.unitPrice) : 0
}

export function SalesInvoiceReturnsPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const inRecordTab = useIsRecordTab()
  const companyOptions = useCompanyOptions(inRecordTab)

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<SalesInvoiceReturn>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<SalesInvoiceReturn>(`/sales-invoice-returns/${id}`),
  })
  const [active, setActive] = useState<SalesInvoiceReturn | null>(null)
  const [companyId, setCompanyId] = useState<number | ''>('')
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [returnDate, setReturnDate] = useState(todayIso())
  const [remarks, setRemarks] = useState('')
  const [sheetNumber, setSheetNumber] = useState('')
  const [applyToInvoices, setApplyToInvoices] = useState(true)
  const [lines, setLines] = useState<LineDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const { markClean, guardedClose } = useDirtyGuard()

  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const customers = useLookup<CustomerLookupOption>('customers', lookupCompanyId, { enabled: creating, onError: () => toast('Failed to load customers.', 'error') })
  // openOnly (the default) keeps only invoices that are neither voided nor fully returned.
  const invoices = useLookup<TransactionLookupOption>('sales-invoices', lookupCompanyId, {
    enabled: creating && customerId !== '',
    params: { customerId: String(customerId) },
    onError: () => toast('Failed to load sales invoices.', 'error'),
  })
  const addedInvoiceIds = new Set(lines.map(l => l.invoiceId))
  const draftTotal = cents(lines.reduce((sum, l) => sum + (l.quantity.trim() !== '' ? lineAmount(l) : 0), 0))

  const canCreate = hasPermission('CREATE_SALES_INVOICE_RETURN')
  const canVoid = hasPermission('VOID_SALES_INVOICE_RETURN')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const activity = useTransactionActivity('SALES_INVOICE_RETURN', inRecordTab && mode === 'view' ? active?.id : null, active?.referenceNumber, active?.voided)

  function snapshot() {
    return { companyId, customerId, returnDate, remarks, sheetNumber, applyToInvoices, lines }
  }

  function openView(ret: SalesInvoiceReturn) {
    if (!rec.isRecordTab) return rec.open('view', ret)
    setActive(ret)
    setMode('view')
    // List rows carry no applications; the record does.
    if (!ret.applications) {
      apiFetch<SalesInvoiceReturn>(`/sales-invoice-returns/${ret.id}`).then(setActive).catch(() => {})
    }
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActive(null)
    const next = { companyId: activeCompanyId ?? '' as number | '', customerId: '' as const, returnDate: todayIso(), remarks: '', sheetNumber: '',
      applyToInvoices: true, lines: [] as LineDraft[] }
    setCompanyId(next.companyId)
    setCustomerId('')
    setReturnDate(next.returnDate)
    setRemarks('')
    setSheetNumber('')
    setApplyToInvoices(true)
    setLines([])
    markClean(next)
    setMode('create')
  }

  function requestClose() {
    guardedClose(snapshot(), () => rec.close())
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setCustomerId('')
    setLines([])
  }

  // Lines belong to the customer's invoices, so changing the customer clears them.
  function handleCustomerChange(value: string) {
    setCustomerId(value ? Number(value) : '')
    setLines([])
  }

  // Adds the invoice's still-returnable lines; quantities start empty (a return is usually only part of a sale).
  function addInvoice(value: string) {
    const invoice = invoices.find(i => i.id === Number(value))
    if (!invoice) return
    const added = byLineNumber(invoice.lines)
      .map(l => ({
        salesInvoiceLineId: l.id,
        invoiceId: invoice.id,
        invoiceReference: invoice.referenceNumber,
        itemId: l.itemId,
        itemCode: l.itemCode,
        itemName: l.itemName,
        sold: String(l.quantity),
        returnable: (Number(l.quantity) - Number(l.quantityLoaded)).toFixed(4),
        unitPrice: l.unitPrice != null ? String(l.unitPrice) : '0',
        quantity: '',
      }))
      .filter(l => Number(l.returnable) > 0)
    if (added.length === 0) return toast(`Everything on ${invoice.referenceNumber} has already been returned.`, 'error')
    setLines(prev => [...prev, ...added])
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return toast('Select a company.', 'error')
    if (!customerId) return toast('Select a customer.', 'error')
    const valid = lines.filter(l => l.quantity.trim() !== '' && Number(l.quantity) > 0)
    if (valid.length === 0) return toast('Enter a quantity to return for at least one invoice line.', 'error')
    const over = valid.find(l => Number(l.quantity) > Number(l.returnable))
    if (over) return toast(`Quantity to return for ${over.itemCode} on ${over.invoiceReference} exceeds what is returnable (${over.returnable}).`, 'error')
    const before = valid.find(l => {
      const invoice = invoices.find(i => i.id === l.invoiceId)
      return invoice && returnDate < invoice.transactionDate.slice(0, 10)
    })
    if (before) return toast(`The return date is before the date of ${before.invoiceReference}.`, 'error')
    if (!window.confirm('Post this sales invoice return? This cannot be edited afterward — only voided.')) return
    setLoading(true)
    try {
      await apiFetch<SalesInvoiceReturn>('/sales-invoice-returns', {
        method: 'POST',
        body: JSON.stringify({
          companyId,
          customerId,
          returnDate,
          remarks: remarks || null,
          sheetNumber: sheetNumber || null,
          applyToInvoices,
          lines: valid.map(l => ({ salesInvoiceLineId: l.salesInvoiceLineId, quantity: Number(l.quantity) })),
        }),
      })
      toast('Sales invoice return posted successfully.', 'success')
      rec.close()
      reloadList('/sales-invoice-returns')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post sales invoice return.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVoid() {
    if (!active) return
    if (!window.confirm(`Void sales invoice return "${active.referenceNumber}"? This takes the stock back out of ${active.warehouseName}, `
      + 'reverses its credit, reopens the invoice lines and cannot be undone.')) return
    setVoiding(true)
    try {
      setActive(await apiFetch<SalesInvoiceReturn>(`/sales-invoice-returns/${active.id}/void`, { method: 'POST' }))
      toast('Sales invoice return voided.', 'success')
      reloadList('/sales-invoice-returns')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void sales invoice return.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const tabTitle = mode === 'create' ? 'New Sales Invoice Return' : active?.referenceNumber || 'Sales Invoice Return'
  const creditApplied = !!active && Number(active.appliedAmount ?? 0) > 0

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <AccountingList
          title="Sales Invoice Returns"
          endpoint="/sales-invoice-returns"
          listKey="sales-invoice-returns"
          columns={COLUMNS}
          searchText={returnSearchText}
          onOpen={openView}
          noun="sales invoice returns"
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
                <DocLetterhead company={<CompanyField id="sir-company" readOnly name={active.companyName} />}>
                  <DocHeader title="Sales Invoice Return" number={active.referenceNumber}>
                    <DocRow>
                      <DocCell label="Return Date"><DocText>{formatDate(active.returnDate)}</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{active.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Customer"><DocText>{active.customerName}</DocText></DocCell>
                  <DocCell label="Returned To (Warehouse)"><DocText>{active.warehouseName}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(active.lines)}
                  rowKey={l => l.id}
                  lineNumber={l => l.lineNumber}
                  minRows={TRANSACTION_MIN_ROWS}
                  columns={[
                    { key: 'invoice', label: 'Sales Invoice', width: '9rem', render: l => <span className="font-mono text-xs">{l.salesInvoiceReferenceNumber ?? '—'}</span> },
                    { key: 'item', label: 'Item', render: l => `${l.itemCode} — ${l.itemName}${l.postsStock ? '' : ' (no stock movement)'}` },
                    { key: 'quantity', label: 'Quantity Returned', align: 'right', width: '9rem', render: l => l.quantity },
                    { key: 'unitPrice', label: 'Net Unit Price', align: 'right', width: '8rem', render: l => formatCurrency(l.unitPrice) },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: l => formatCurrency(l.amount) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{active.remarks}</DocText></DocCell>
                  <DocTotals entries={[
                    { label: 'Credit', value: formatCurrency(active.netAmount), grand: true },
                    ...(active.unappliedAmount !== null && !active.voided ? [
                      { label: 'Applied', value: formatCurrency(active.appliedAmount) },
                      { label: 'Unapplied Credit', value: formatCurrency(active.unappliedAmount), grand: true },
                    ] : []),
                  ]} />
                </DocRow>
                <AllocationLines title="Credit Applied To" allocations={active.applications ?? []} side="charge" />
                <TransactionHistory activity={activity} record={active} />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={active.voided} />
                {canVoid && !active.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding}
                    title={creditApplied ? 'Voiding also reverses where the credit was applied; a later payment or refund using it must be voided first.' : undefined}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton companyId={active.companyId} documentType="SALES_INVOICE_RETURN" data={active as unknown as Record<string, unknown>}
                    onError={() => toast(`No active print template configured for Sales Invoice Returns under ${active.companyName}.`, 'error')} />
                )}
                <CloseButton onClick={requestClose} />
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <DocSheet>
                <DocLetterhead company={
                  <CompanyField id="sir-company" readOnly={!showCompanyColumn} name={companyOptions.find(c => c.id === companyId)?.name}
                    companies={companyOptions} value={companyId} onChange={handleCompanyChange} autoFocus={showCompanyColumn} />
                }>
                  <DocHeader title="Sales Invoice Return" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Return Date" htmlFor="sir-date" required>
                        <Input id="sir-date" type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="sir-sheet">
                        <Input id="sir-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Customer" htmlFor="sir-customer" required>
                    <SearchableSelect id="sir-customer" value={customerId === '' ? '' : String(customerId)} onChange={handleCustomerChange}
                      options={customers.map(c => ({ value: String(c.id), label: c.name }))} disabled={!companyId} autoFocus={!showCompanyColumn} />
                  </DocCell>
                  <DocCell label="Returned To (Warehouse)">
                    <DocText className="italic text-[hsl(var(--muted-foreground))]">The company's main warehouse</DocText>
                  </DocCell>
                </DocRow>
                <DocRow>
                  <DocCell label="Add Items From Sales Invoice" htmlFor="sir-invoice">
                    <SearchableSelect id="sir-invoice" value="" onChange={addInvoice}
                      options={invoices.filter(i => !addedInvoiceIds.has(i.id))
                        .map(i => ({ value: String(i.id), label: `${i.referenceNumber} — ${formatDate(i.transactionDate)}` }))}
                      placeholder={customerId ? 'Pick an invoice to load its returnable items…' : 'Select a customer first…'}
                      disabled={!customerId} />
                    {customerId && invoices.length === 0 && (
                      <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">No open (not voided, not fully returned) sales invoices for this customer.</p>
                    )}
                  </DocCell>
                  <DocCell label="Credit">
                    <label className="flex items-center gap-2 py-1.5 text-sm">
                      <input type="checkbox" checked={applyToInvoices} onChange={e => setApplyToInvoices(e.target.checked)} />
                      Apply to the returned invoices' balances
                    </label>
                  </DocCell>
                </DocRow>
                <DocLines
                  rows={lines}
                  rowKey={l => l.salesInvoiceLineId}
                  columns={[
                    { key: 'invoice', label: 'Sales Invoice', width: '9rem', readOnly: true, render: l => <span className="font-mono text-xs">{l.invoiceReference}</span> },
                    { key: 'item', label: 'Item', readOnly: true, render: l => `${l.itemCode} — ${l.itemName}` },
                    { key: 'sold', label: 'Sold', align: 'right', width: '6rem', readOnly: true, render: l => l.sold },
                    { key: 'returnable', label: 'Returnable', align: 'right', width: '7rem', readOnly: true, render: l => l.returnable },
                    {
                      key: 'quantity', label: 'Return Now', align: 'right', width: '8rem',
                      render: (l, i) => (
                        <Input type="number" step="0.0001" min="0" max={l.returnable} aria-label={`${l.itemCode} on ${l.invoiceReference} quantity to return`}
                          value={l.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} className="text-right" />
                      ),
                    },
                    { key: 'unitPrice', label: 'Net Unit Price', align: 'right', width: '8rem', readOnly: true, render: l => formatCurrency(l.unitPrice) },
                    {
                      key: 'amount', label: 'Amount', align: 'right', width: '8rem', readOnly: true,
                      render: l => <span className="tabular-nums">{l.quantity.trim() !== '' ? formatCurrency(lineAmount(l)) : '—'}</span>,
                    },
                    {
                      key: 'remove', label: '', align: 'center', width: '2.75rem',
                      render: (l, i) => (
                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Remove ${l.itemCode} on ${l.invoiceReference}`}
                          onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>
                          <X className="w-4 h-4" />
                        </Button>
                      ),
                    },
                  ]}
                  footer={lines.length === 0 && (
                    <p className={cn('py-1 text-xs text-[hsl(var(--muted-foreground))]')}>
                      Pick one or more of the customer's sales invoices above to load their returnable items.
                    </p>
                  )}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="sir-remarks">
                    <Input id="sir-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[{ label: 'Credit', value: formatCurrency(draftTotal), grand: true }]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Post Sales Invoice Return</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}
    </div>
  )
}
