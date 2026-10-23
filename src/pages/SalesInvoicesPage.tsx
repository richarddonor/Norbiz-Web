import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Ban, X } from 'lucide-react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText, DocLines, DocTotals, DocStamp, PendingNumber, TRANSACTION_MIN_ROWS } from '@/components/ui/doc-form'
import { useRecordTab, useIsRecordTab } from '@/hooks/useRecordTab'
import { RecordSheet, RECORD_ACTIONS, CloseButton } from '@/components/RecordTab'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ItemSelect } from '@/components/ItemSelect'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { TransactionActionsMenu, TransactionHistory } from '@/components/TransactionActivity'
import { useTransactionActivity } from '@/hooks/useTransactionActivity'
import { reloadList } from '@/hooks/usePagedList'
import { PrintButton } from '@/components/PrintButton'
import { OriginBadge, OriginNotice } from '@/components/TransactionOrigin'
import { ORIGIN_COLUMN, originLabel, type TransactionOrigin } from '@/lib/transactionOrigin'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { useLookup, useStock, type CustomerLookupOption, type ItemLookupOption, type LookupOption, type TransactionLookupOption } from '@/lib/lookups'
import { StockCell } from '@/components/StockCell'
import { shortItems } from '@/lib/stock'
import { formatCurrency, formatDate } from '@/lib/format'
import { byLineNumber } from '@/lib/utils'
import { AccountingList, VoidedBadge, type ListColumn } from '@/components/accounting/AccountingList'
import { AllocationLines } from '@/components/accounting/OpenItemLines'
import { useCompanyOptions } from '@/components/accounting/useCompanyOptions'
import { cents, statusLabel, todayIso, type Allocation, type OpenItem, type PaymentStatus } from '@/lib/accounting'

type FormMode = 'view' | 'create'
type InvoiceMode = 'DIRECT' | 'DELIVERY_RECEIPT'

interface SalesInvoiceLine {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  deliveryReceiptLineId: number | null
  quantity: string
  unitPrice: string
  discountPercentage: string
  lineNet: string
  lineNumber: number
  /** returned so far by Sales Invoice Returns */
  quantityLoaded: string
}

interface SalesInvoice {
  id: number
  companyId: number
  companyName: string
  customerId: number
  customerName: string
  warehouseId: number
  warehouseName: string
  deliveryReceiptId: number | null
  deliveryReceiptReferenceNumber: string | null
  referenceNumber: string
  sheetNumber: string | null
  invoiceDate: string
  termDays: number
  dueDate: string
  remarks: string | null
  discountPercentage: string
  itemsSubtotal: string
  discountAmount: string
  netAmount: string
  paymentStatus: PaymentStatus
  openItemId: number | null
  appliedAmount: string | null
  pendingAmount: string | null
  bouncedAmount: string | null
  balance: string | null
  createdAt: string | null
  createdBy: string | null
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  /** fully returned */
  loaded: boolean
  origin: TransactionOrigin
  lines: SalesInvoiceLine[]
}

interface LineDraft {
  itemId: number | ''
  quantity: string
  unitPrice: string
  discountPercentage: string
}

const EMPTY_LINE: LineDraft = { itemId: '', quantity: '', unitPrice: '', discountPercentage: '' }

function lineNet(quantity: number, price: number, discount: number): number {
  const gross = quantity * price
  return gross - gross * discount / 100
}

function invoiceSearchText(r: SalesInvoice): string {
  return [r.referenceNumber, r.sheetNumber ?? '', r.customerName, r.deliveryReceiptReferenceNumber ?? '', statusLabel(r.paymentStatus),
    r.remarks ?? '', r.companyName, formatDate(r.invoiceDate)].join(' ')
}

function buildColumns(showCompanyColumn: boolean): ListColumn<SalesInvoice>[] {
  const columns: ListColumn<SalesInvoice>[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true, muted: true, value: r => r.companyName })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #', sortable: true, filterable: true, mono: true, value: r => r.referenceNumber },
    { key: 'sheetNumber', label: 'Sheet #', sortable: true, filterable: true, muted: true, value: r => r.sheetNumber ?? '' },
    { key: 'customer', label: 'Customer', sortable: true, filterable: true, value: r => r.customerName },
    { key: 'deliveryReceipt', label: 'DR #', sortable: true, filterable: true, mono: true, value: r => r.deliveryReceiptReferenceNumber ?? '' },
    { key: 'date', label: 'Invoice Date', sortable: true, filterable: true, type: 'date', value: r => formatDate(r.invoiceDate) },
    { key: 'dueDate', label: 'Due Date', sortable: true, value: r => formatDate(r.dueDate) },
    { key: 'netAmount', label: 'Net Amount', sortable: true, align: 'right', total: 'currency', value: r => formatCurrency(r.netAmount) },
    { key: 'balance', label: 'Balance', sortable: true, align: 'right', total: 'currency', value: r => r.voided ? '' : formatCurrency(r.balance) },
    { key: 'paymentStatus', label: 'Payment Status', sortable: true, value: r => statusLabel(r.paymentStatus) },
    { ...ORIGIN_COLUMN, filterable: true, value: r => originLabel(r.origin), render: r => <OriginBadge origin={r.origin} /> },
    { key: 'voided', label: 'Voided', sortable: true, type: 'boolean', filterable: true, value: r => r.voided ? 'Yes' : '', render: r => <VoidedBadge voided={r.voided} /> },
  )
  return columns
}

export function SalesInvoicesPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, showCompanyColumn } = useAuth()
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const inRecordTab = useIsRecordTab()
  const companyOptions = useCompanyOptions(inRecordTab)

  const [mode, setMode] = useState<FormMode>('view')
  const rec = useRecordTab<SalesInvoice>({
    mode,
    onOpen: { view: openView, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<SalesInvoice>(`/sales-invoices/${id}`),
  })
  const [active, setActive] = useState<SalesInvoice | null>(null)
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [companyId, setCompanyId] = useState<number | ''>('')
  const [invoiceMode, setInvoiceMode] = useState<InvoiceMode>('DIRECT')
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [deliveryReceiptId, setDeliveryReceiptId] = useState<number | ''>('')
  const [invoiceDate, setInvoiceDate] = useState(todayIso())
  const [termDays, setTermDays] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [discount, setDiscount] = useState('')
  const [remarks, setRemarks] = useState('')
  const [sheetNumber, setSheetNumber] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([EMPTY_LINE])
  const [drDiscounts, setDrDiscounts] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const { markClean, guardedClose } = useDirtyGuard()

  const lookupCompanyId = companyId || activeCompanyId
  const creating = inRecordTab && mode === 'create'
  const customers = useLookup<CustomerLookupOption>('customers', lookupCompanyId, { enabled: !inRecordTab || creating, params: { type: 'CUSTOMER' }, onError: () => toast('Failed to load customers.', 'error') })
  const billable = useLookup<TransactionLookupOption>('billable-delivery-receipts', lookupCompanyId, {
    enabled: creating && invoiceMode === 'DELIVERY_RECEIPT',
    params: customerId !== '' ? { customerId: String(customerId) } : undefined,
    onError: () => toast('Failed to load delivery receipts.', 'error'),
  })
  const mainWarehouses = useLookup<LookupOption>('warehouses', lookupCompanyId, { enabled: creating && invoiceMode === 'DIRECT', params: { mainOnly: 'true' }, onError: () => toast('Failed to load the main warehouse.', 'error') })
  const mainWarehouse = mainWarehouses[0] as LookupOption | undefined
  const mainWarehouseId: number | '' = mainWarehouse?.id ?? ''
  const stock = useStock(lookupCompanyId, mainWarehouseId, lines.map(l => l.itemId), { enabled: creating && invoiceMode === 'DIRECT', onError: () => toast('Failed to load stock balances.', 'error') })
  const shortStock = shortItems(lines, stock, l => Number(l.quantity))
  const selectedDr = deliveryReceiptId === '' ? undefined : billable.find(d => d.id === deliveryReceiptId)

  const canCreate = hasPermission('CREATE_SALES_INVOICE')
  const canVoid = hasPermission('VOID_SALES_INVOICE')
  const canPrint = hasPermission('MANAGE_DOCUMENT_TEMPLATES')
  const canViewPayments = hasPermission('VIEW_AR_REPORT')
  const activity = useTransactionActivity('SALES_INVOICE', inRecordTab && mode === 'view' ? active?.id : null, active?.referenceNumber, active?.voided)

  // Payments applied to the invoice (its open item's allocations) — needs the AR report permission.
  useEffect(() => {
    if (!inRecordTab || mode !== 'view' || !active?.openItemId || !canViewPayments) { setAllocations([]); return }
    apiFetch<{ item: OpenItem; allocations: Allocation[] }>(`/open-items/${active.openItemId}`)
      .then(res => setAllocations(res.allocations))
      .catch(() => setAllocations([]))
  }, [inRecordTab, mode, active?.openItemId, active?.balance, canViewPayments])

  const draftSubtotal = invoiceMode === 'DIRECT'
    ? lines.reduce((s, l) => s + (l.itemId !== '' ? lineNet(Number(l.quantity) || 0, Number(l.unitPrice) || 0, Number(l.discountPercentage) || 0) : 0), 0)
    : (selectedDr?.lines ?? []).reduce((s, l) => s + lineNet(Number(l.quantity), Number(l.unitPrice ?? 0), Number(drDiscounts[l.itemId] ?? 0) || 0), 0)
  const draftDiscount = draftSubtotal * (Number(discount) || 0) / 100
  const draftNet = cents(draftSubtotal - draftDiscount)

  function snapshot() {
    return { companyId, invoiceMode, customerId, deliveryReceiptId, invoiceDate, termDays, dueDate, discount, remarks, sheetNumber, lines, drDiscounts }
  }

  function openView(invoice: SalesInvoice) {
    if (!rec.isRecordTab) return rec.open('view', invoice)
    setActive(invoice)
    setMode('view')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActive(null)
    const next = { companyId: activeCompanyId ?? '' as number | '', invoiceMode: 'DIRECT' as InvoiceMode, customerId: '' as const, deliveryReceiptId: '' as const,
      invoiceDate: todayIso(), termDays: '', dueDate: '', discount: '', remarks: '', sheetNumber: '', lines: [EMPTY_LINE], drDiscounts: {} }
    setCompanyId(next.companyId)
    setInvoiceMode(next.invoiceMode)
    setCustomerId('')
    setDeliveryReceiptId('')
    setInvoiceDate(next.invoiceDate)
    setTermDays('')
    setDueDate('')
    setDiscount('')
    setRemarks('')
    setSheetNumber('')
    setLines(next.lines)
    setDrDiscounts({})
    markClean(next)
    setMode('create')
  }

  function requestClose() {
    guardedClose(snapshot(), () => rec.close())
  }

  function handleCompanyChange(value: number | '') {
    setCompanyId(value)
    setCustomerId('')
    setDeliveryReceiptId('')
    setLines([EMPTY_LINE])
  }

  function handleCustomerChange(value: string) {
    const id = value ? Number(value) : ''
    setCustomerId(id)
    setDeliveryReceiptId('')
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  function handleLineItemChange(index: number, item: ItemLookupOption | null) {
    updateLine(index, { itemId: item ? item.id : '', unitPrice: item?.unitPrice != null ? String(item.unitPrice) : '' })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return toast('Select a company.', 'error')
    const body: Record<string, unknown> = {
      companyId,
      invoiceDate,
      termDays: termDays.trim() !== '' ? Number(termDays) : null,
      dueDate: dueDate || null,
      discountPercentage: discount.trim() !== '' ? Number(discount) : null,
      remarks: remarks || null,
      sheetNumber: sheetNumber || null,
    }
    if (invoiceMode === 'DELIVERY_RECEIPT') {
      if (!deliveryReceiptId || !selectedDr) return toast('Select the delivery receipt to bill.', 'error')
      body.deliveryReceiptId = deliveryReceiptId
      body.customerId = selectedDr.customerId
      body.lines = Object.entries(drDiscounts).filter(([, v]) => v.trim() !== '').map(([itemId, v]) => ({ itemId: Number(itemId), discountPercentage: Number(v) }))
    } else {
      if (!customerId) return toast('Select a customer.', 'error')
      const valid = lines.filter(l => l.itemId !== '' && l.quantity.trim() !== '')
      if (valid.length === 0) return toast('Add at least one line with an item and quantity.', 'error')
      if (valid.some(l => Number(l.quantity) <= 0)) return toast('Line quantities must be greater than zero.', 'error')
      if (shortStock.size > 0) return toast('Not enough stock on hand in the main warehouse for the highlighted line(s).', 'error')
      body.customerId = customerId
      body.lines = valid.map(l => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice.trim() !== '' ? Number(l.unitPrice) : null,
        discountPercentage: l.discountPercentage.trim() !== '' ? Number(l.discountPercentage) : null,
      }))
    }
    // A zero total is allowed (free goods, testers): it opens no receivable and is paid from the start.
    const confirmText = draftNet === 0
      ? 'Post this zero-value sales invoice? It bills nothing and cannot be edited afterward — only voided.'
      : 'Post this sales invoice? This cannot be edited afterward — only voided.'
    if (!window.confirm(confirmText)) return
    setLoading(true)
    try {
      await apiFetch<SalesInvoice>('/sales-invoices', { method: 'POST', body: JSON.stringify(body) })
      toast('Sales invoice posted successfully.', 'success')
      rec.close()
      reloadList('/sales-invoices')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to post sales invoice.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVoid() {
    if (!active) return
    const what = active.deliveryReceiptId ? `un-bills ${active.deliveryReceiptReferenceNumber}` : `returns its stock to ${active.warehouseName}`
    if (!window.confirm(`Void sales invoice "${active.referenceNumber}"? This ${what} and cannot be undone.`)) return
    setVoiding(true)
    try {
      setActive(await apiFetch<SalesInvoice>(`/sales-invoices/${active.id}/void`, { method: 'POST' }))
      toast('Sales invoice voided.', 'success')
      reloadList('/sales-invoices')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to void sales invoice.'), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const tabTitle = mode === 'create' ? 'New Sales Invoice' : active?.referenceNumber || 'Sales Invoice'
  const paid = !!active && Number(active.appliedAmount ?? 0) > 0
  const returned = !!active && active.lines.some(l => Number(l.quantityLoaded) > 0)

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (
        <AccountingList
          title="Sales Invoices"
          endpoint="/sales-invoices"
          listKey="sales-invoices"
          columns={COLUMNS}
          searchText={invoiceSearchText}
          onOpen={openView}
          noun="sales invoices"
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
                <DocLetterhead company={<CompanyField id="si-company" readOnly name={active.companyName} />}>
                  <DocHeader title="Sales Invoice" number={active.referenceNumber}>
                    <DocRow>
                      <DocCell label="Invoice Date"><DocText>{formatDate(active.invoiceDate)}</DocText></DocCell>
                      <DocCell label="Due Date"><DocText>{formatDate(active.dueDate)} ({active.termDays} days)</DocText></DocCell>
                      <DocCell label="Sheet #"><DocText>{active.sheetNumber}</DocText></DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Customer"><DocText>{active.customerName}</DocText></DocCell>
                  <DocCell label={active.deliveryReceiptId ? 'Delivery Receipt' : 'Stock From'}>
                    <DocText>{active.deliveryReceiptReferenceNumber ?? active.warehouseName}</DocText>
                  </DocCell>
                  <DocCell label="Payment Status"><DocText>{statusLabel(active.paymentStatus)}</DocText></DocCell>
                </DocRow>
                <DocLines
                  rows={byLineNumber(active.lines)}
                  rowKey={l => l.id}
                  lineNumber={l => l.lineNumber}
                  minRows={TRANSACTION_MIN_ROWS}
                  columns={[
                    { key: 'item', label: 'Item', render: l => `${l.itemCode} — ${l.itemName}` },
                    { key: 'quantity', label: 'Quantity', align: 'right', width: '7rem', render: l => l.quantity },
                    ...(returned ? [{ key: 'returned', label: 'Returned', align: 'right' as const, width: '6rem', render: (l: SalesInvoiceLine) => Number(l.quantityLoaded) ? l.quantityLoaded : '' }] : []),
                    { key: 'unitPrice', label: 'Unit Price', align: 'right', width: '8rem', render: l => formatCurrency(l.unitPrice) },
                    { key: 'discount', label: 'Disc %', align: 'right', width: '5rem', render: l => Number(l.discountPercentage) ? l.discountPercentage : '' },
                    { key: 'amount', label: 'Amount', align: 'right', width: '9rem', render: l => formatCurrency(l.lineNet) },
                  ]}
                />
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks"><DocText>{active.remarks}</DocText></DocCell>
                  <DocTotals entries={[
                    { label: 'Subtotal', value: formatCurrency(active.itemsSubtotal) },
                    ...(Number(active.discountPercentage) ? [{ label: `Discount (${active.discountPercentage}%)`, value: `− ${formatCurrency(active.discountAmount)}` }] : []),
                    { label: 'Net Amount', value: formatCurrency(active.netAmount), grand: true },
                    ...(active.balance !== null && !active.voided ? [
                      { label: 'Paid', value: formatCurrency(active.appliedAmount) },
                      ...(Number(active.pendingAmount) ? [{ label: 'of which in uncleared checks', value: formatCurrency(active.pendingAmount) }] : []),
                      { label: 'Balance', value: formatCurrency(active.balance), grand: true },
                    ] : []),
                  ]} />
                </DocRow>
                <AllocationLines title="Payments and Credits" allocations={allocations} side="credit" />
                <TransactionHistory activity={activity} record={active} />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <TransactionActionsMenu activity={activity} voided={active.voided} />
                {canVoid && !active.voided && (
                  <Button type="button" variant="outline" onClick={handleVoid} loading={voiding} disabled={paid || returned}
                    title={returned ? 'Items were returned against it — void the sales invoice return(s) first.'
                      : paid ? 'Payments or credits are applied — void those first.' : undefined}>
                    <Ban className="w-4 h-4 text-[hsl(var(--destructive))]" />
                    Void
                  </Button>
                )}
                {canPrint && (
                  <PrintButton companyId={active.companyId} documentType="SALES_INVOICE" data={active as unknown as Record<string, unknown>}
                    onError={() => toast(`No active print template configured for Sales Invoices under ${active.companyName}.`, 'error')} />
                )}
                <CloseButton onClick={requestClose} />
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4"
              onKeyDown={e => { if (invoiceMode === 'DIRECT' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); setLines(prev => [...prev, EMPTY_LINE]) } }}>
              <DocSheet>
                <DocLetterhead company={
                  <CompanyField id="si-company" readOnly={!showCompanyColumn} name={companyOptions.find(c => c.id === companyId)?.name}
                    companies={companyOptions} value={companyId} onChange={handleCompanyChange} autoFocus={showCompanyColumn} />
                }>
                  <DocHeader title="Sales Invoice" number={<PendingNumber />}>
                    <DocRow>
                      <DocCell label="Invoice Type" htmlFor="si-mode" required>
                        <SearchableSelect id="si-mode" value={invoiceMode}
                          onChange={v => { setInvoiceMode((v || 'DIRECT') as InvoiceMode); setDeliveryReceiptId(''); setLines([EMPTY_LINE]) }}
                          options={[{ value: 'DIRECT', label: 'Direct (from main warehouse)' }, { value: 'DELIVERY_RECEIPT', label: 'Bill a Delivery Receipt' }]}
                          autoFocus={!showCompanyColumn} />
                      </DocCell>
                      <DocCell label="Invoice Date" htmlFor="si-date" required>
                        <Input id="si-date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} required />
                      </DocCell>
                      <DocCell label="Sheet #" htmlFor="si-sheet">
                        <Input id="si-sheet" value={sheetNumber} onChange={e => setSheetNumber(e.target.value)} />
                      </DocCell>
                    </DocRow>
                  </DocHeader>
                </DocLetterhead>
                <DocRow>
                  <DocCell label="Customer" htmlFor="si-customer" required={invoiceMode === 'DIRECT'}>
                    <SearchableSelect id="si-customer" value={customerId === '' ? '' : String(customerId)} onChange={handleCustomerChange}
                      options={customers.map(c => ({ value: String(c.id), label: c.name }))} disabled={!companyId}
                      placeholder={invoiceMode === 'DELIVERY_RECEIPT' ? 'Any customer' : undefined} />
                  </DocCell>
                  {invoiceMode === 'DELIVERY_RECEIPT' ? (
                    <DocCell label="Delivery Receipt" htmlFor="si-dr" required>
                      <SearchableSelect id="si-dr" value={deliveryReceiptId === '' ? '' : String(deliveryReceiptId)}
                        onChange={v => { setDeliveryReceiptId(v ? Number(v) : ''); setDrDiscounts({}) }}
                        options={billable.map(d => ({ value: String(d.id), label: `${d.referenceNumber} — ${d.customerName} · ${formatDate(d.transactionDate)}` }))}
                        disabled={!companyId} />
                      {companyId && billable.length === 0 && (
                        <p className="pb-1 text-xs text-[hsl(var(--muted-foreground))]">No unbilled delivery receipts to plain customers.</p>
                      )}
                    </DocCell>
                  ) : (
                    <DocCell label="Stock From"><DocText>{mainWarehouse?.name ?? 'The company\'s main warehouse'}</DocText></DocCell>
                  )}
                </DocRow>
                <DocRow>
                  <DocCell label="Terms (days)" htmlFor="si-terms">
                    <Input id="si-terms" type="number" min="0" max="365" value={termDays} onChange={e => setTermDays(e.target.value)}
                      placeholder="Customer's terms" />
                  </DocCell>
                  <DocCell label="Due Date" htmlFor="si-due">
                    <Input id="si-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                  </DocCell>
                  <DocCell label="Discount %" htmlFor="si-discount">
                    <Input id="si-discount" type="number" step="0.01" min="0" max="100" value={discount} onChange={e => setDiscount(e.target.value)} className="text-right" />
                  </DocCell>
                </DocRow>
                {invoiceMode === 'DELIVERY_RECEIPT' ? (
                  <DocLines
                    rows={selectedDr ? byLineNumber(selectedDr.lines) : []}
                    rowKey={l => l.id}
                    lineNumber={l => l.lineNumber}
                    minRows={TRANSACTION_MIN_ROWS}
                    columns={[
                      { key: 'item', label: 'Item', readOnly: true, render: l => `${l.itemCode} — ${l.itemName}` },
                      { key: 'quantity', label: 'Quantity', align: 'right', width: '7rem', readOnly: true, render: l => l.quantity },
                      { key: 'unitPrice', label: 'Unit Price', align: 'right', width: '8rem', readOnly: true, render: l => formatCurrency(l.unitPrice) },
                      {
                        key: 'discount', label: 'Disc %', align: 'right', width: '6rem',
                        render: (l, i) => (
                          <Input type="number" step="0.01" min="0" max="100" aria-label={`Line ${i + 1} discount`} value={drDiscounts[l.itemId] ?? ''}
                            onChange={e => setDrDiscounts(prev => ({ ...prev, [l.itemId]: e.target.value }))} className="text-right" />
                        ),
                      },
                      { key: 'amount', label: 'Amount', align: 'right', width: '8rem', readOnly: true,
                        render: l => formatCurrency(lineNet(Number(l.quantity), Number(l.unitPrice ?? 0), Number(drDiscounts[l.itemId] ?? 0) || 0)) },
                    ]}
                  />
                ) : (
                  <DocLines
                    rows={lines}
                    columns={[
                      {
                        key: 'item', label: 'Item', required: true,
                        render: (line, i) => (
                          <ItemSelect companyId={lookupCompanyId} params={{ tag: 'INVENTORY' }} value={line.itemId === '' ? '' : String(line.itemId)}
                            onChange={(_, item) => handleLineItemChange(i, item)} onError={() => toast('Failed to load items.', 'error')} />
                        ),
                      },
                      {
                        key: 'onHand', label: 'On Hand', align: 'right', width: '7rem', readOnly: true,
                        render: line => (
                          <StockCell stock={stock} field="quantity" itemId={line.itemId} warehouseChosen={mainWarehouseId !== ''}
                            short={() => line.itemId !== '' && shortStock.has(line.itemId)} />
                        ),
                      },
                      {
                        key: 'quantity', label: 'Quantity', align: 'right', width: '7rem', required: true,
                        render: (line, i) => (
                          <Input type="number" step="0.0001" min="0" aria-label={`Line ${i + 1} quantity`} value={line.quantity}
                            onChange={e => updateLine(i, { quantity: e.target.value })} className="text-right" />
                        ),
                      },
                      {
                        key: 'unitPrice', label: 'Unit Price', align: 'right', width: '8rem',
                        render: (line, i) => (
                          <Input type="number" step="0.01" min="0" aria-label={`Line ${i + 1} unit price`} value={line.unitPrice}
                            onChange={e => updateLine(i, { unitPrice: e.target.value })} className="text-right" />
                        ),
                      },
                      {
                        key: 'discount', label: 'Disc %', align: 'right', width: '5.5rem',
                        render: (line, i) => (
                          <Input type="number" step="0.01" min="0" max="100" aria-label={`Line ${i + 1} discount`} value={line.discountPercentage}
                            onChange={e => updateLine(i, { discountPercentage: e.target.value })} className="text-right" />
                        ),
                      },
                      {
                        key: 'amount', label: 'Amount', align: 'right', width: '8rem', readOnly: true,
                        render: line => <span className="tabular-nums">{line.itemId !== '' && line.quantity.trim() !== ''
                          ? formatCurrency(lineNet(Number(line.quantity) || 0, Number(line.unitPrice) || 0, Number(line.discountPercentage) || 0)) : '—'}</span>,
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
                        <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">Ctrl+Enter</kbd>
                      </Button>
                    }
                  />
                )}
                <DocRow cols="3fr 2fr">
                  <DocCell label="Remarks" htmlFor="si-remarks">
                    <Input id="si-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                  <DocTotals entries={[
                    { label: 'Subtotal', value: formatCurrency(draftSubtotal) },
                    ...(Number(discount) ? [{ label: `Discount (${discount}%)`, value: `− ${formatCurrency(draftDiscount)}` }] : []),
                    { label: 'Net Amount', value: formatCurrency(draftNet), grand: true },
                  ]} />
                </DocRow>
                <TransactionHistory pending />
              </DocSheet>
              <div className={RECORD_ACTIONS}>
                <CloseButton onClick={requestClose} label="Cancel" />
                <Button type="submit" loading={loading}>Post Sales Invoice</Button>
              </div>
            </form>
          )}
        </RecordSheet>
      )}
    </div>
  )
}
