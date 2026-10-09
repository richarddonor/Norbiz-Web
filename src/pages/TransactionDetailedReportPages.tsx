import { useState, useMemo } from 'react'
import { FileDown } from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { useContentFocus } from '@/components/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ItemFilterSelect } from '@/components/ItemFilterSelect'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useTransactionDrillDown } from '@/hooks/useTransactionDrillDown'
import type { TransactionType } from '@/hooks/useTransactionActivity'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useLookup, type LookupOption } from '@/lib/lookups'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ORIGIN_COLUMN, originLabel, type TransactionOrigin } from '@/lib/transactionOrigin'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { Pagination } from '@/components/Pagination'
import { ScrollTable, PINNED_TH, PINNED_TD } from '@/components/ScrollTable'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatCurrency, formatDate, formatQuantity } from '@/lib/format'
import { cn } from '@/lib/utils'

// "<Transaction> - Detailed" reports: one row per line item, flattened with its transaction's
// header. Every transaction type has one, each behind its own VIEW_<TYPE>_DETAILED_REPORT
// permission (backend: TransactionDetailedReportController / DetailedReportType). A new
// transaction type gets a config + page export here, plus its nav.ts and routes.tsx entries.
// Clicking a row (or Enter) opens its transaction in a record tab, when the user can view it.

/** One row of `/reports/detailed/*` (backend `TransactionDetailedReportRow`). */
interface DetailedReportRow {
  id: number
  transactionId: number
  companyId: number
  companyName: string
  referenceNumber: string
  sheetNumber: string | null
  transactionDate: string
  warehouseId: number
  warehouseName: string
  counterpartyId: number | null
  counterpartyName: string | null
  /** Outlet Delivery Receipt / Return only: the sales agent */
  agentId: number | null
  agentName: string | null
  sourceReferenceNumber: string | null
  remarks: string | null
  voided: boolean
  /** NATIVE, or MIGRATED / RECONSTRUCTED for transactions written by the legacy migration */
  origin: TransactionOrigin
  voidedAt: string | null
  voidedBy: string | null
  createdAt: string | null
  createdBy: string | null
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  quantity: string
  quantityLoaded: string
  /** null without VIEW_COST_PRICE on purchase reports, and always on Inventory Adjustment */
  price: string | null
  discountPercentage: string | null
  amount: string | null
}

interface DetailedReportConfig {
  title: string
  endpoint: string
  /** the transaction a row drills down to */
  transactionType: TransactionType
  /** column-visibility storage key and export file name */
  key: string
  counterparty?: { label: string; lookup: 'suppliers' | 'customers'; param: 'supplierId' | 'customerId' }
  /** adds the Agent column and an agent (employees tagged AGENT) filter */
  agent?: boolean
  /** header label for the transaction this one loads from; omit when it has none */
  sourceLabel?: string
  loadedLabel: string
  priceLabel?: string
  discount?: boolean
}

function buildColumns(config: DetailedReportConfig, showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company' })
  columns.push(
    { key: 'referenceNumber', label: 'Reference #' },
    { key: 'sheetNumber', label: 'Sheet #' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'warehouse', label: 'Warehouse' },
  )
  if (config.counterparty) columns.push({ key: 'counterparty', label: config.counterparty.label })
  if (config.agent) columns.push({ key: 'agent', label: 'Agent' })
  if (config.sourceLabel) columns.push({ key: 'sourceReferenceNumber', label: config.sourceLabel })
  columns.push(
    { key: 'remarks', label: 'Remarks' },
    { key: 'lineNumber', label: 'Line #' },
    { key: 'itemCode', label: 'Item Code' },
    { key: 'itemName', label: 'Item Name' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'quantityLoaded', label: config.loadedLabel },
  )
  if (config.priceLabel) columns.push({ key: 'price', label: config.priceLabel })
  if (config.discount) columns.push({ key: 'discountPercentage', label: 'Discount %' })
  if (config.priceLabel) columns.push({ key: 'amount', label: 'Amount' })
  columns.push(
    ORIGIN_COLUMN,
    { key: 'voided', label: 'Voided', type: 'boolean' },
    { key: 'createdBy', label: 'Posted By' },
  )
  return columns
}

/** Column keys whose filter is sent to the backend (text = contains; date/boolean per type). */
const FILTERABLE = new Set(['referenceNumber', 'sheetNumber', 'date', 'warehouse', 'counterparty', 'sourceReferenceNumber', 'remarks', 'itemCode', 'itemName', 'origin', 'voided'])

const NUMERIC = new Set(['lineNumber', 'quantity', 'quantityLoaded', 'price', 'discountPercentage', 'amount'])
/** Stays at the left edge while the table scrolls sideways. */
const PINNED = 'referenceNumber'

function rowSearchText(r: DetailedReportRow): string {
  return [r.companyName, r.referenceNumber, r.sheetNumber ?? '', formatDate(r.transactionDate), r.warehouseName, r.counterpartyName ?? '', r.agentName ?? '',
    r.sourceReferenceNumber ?? '', r.remarks ?? '', r.itemCode, r.itemName, r.createdBy ?? '', r.voided ? 'voided' : ''].join(' ')
}

function TransactionDetailedReport({ config }: { config: DetailedReportConfig }) {
  const { toast } = useToast()
  const { showCompanyColumn, activeCompanyId } = useAuth()
  const { zone } = useContentFocus()
  const COLUMNS = useMemo(() => buildColumns(config, showCompanyColumn), [config, showCompanyColumn])

  const [search, setSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [counterpartyId, setCounterpartyId] = useState('')
  const [itemId, setItemId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || !!warehouseId || !!counterpartyId || !!itemId || !!agentId || Object.values(debouncedFilters).some(v => v.trim())

  const combinedFilters: Record<string, string> = { ...debouncedFilters, warehouseId, itemId }
  if (config.counterparty) combinedFilters[config.counterparty.param] = counterpartyId
  if (config.agent) combinedFilters.agentId = agentId

  const { items: rows, page, setPage, totalPages, totalElements, loading: listLoading, reload, searchAll } = usePagedList<DetailedReportRow>(config.endpoint, {
    onError: () => toast(`Failed to load ${config.title}.`, 'error'),
    search: debouncedSearch,
    filters: combinedFilters,
    searchText: rowSearchText,
  })
  // Filter-bar options for the session's active company — inactive records included, since
  // past transactions may reference them.
  const lookupParams = { activeOnly: 'false' }
  const warehouses = useLookup<LookupOption>('warehouses', activeCompanyId, { params: lookupParams, onError: () => toast('Failed to load warehouses.', 'error') })
  const counterparties = useLookup<LookupOption>(config.counterparty?.lookup ?? 'suppliers', activeCompanyId, {
    params: lookupParams,
    enabled: !!config.counterparty,
    onError: () => toast(`Failed to load ${config.counterparty?.label.toLowerCase()}s.`, 'error'),
  })
  const agents = useLookup<LookupOption>('employees', activeCompanyId, {
    params: { ...lookupParams, tag: 'AGENT' },
    enabled: !!config.agent,
    onError: () => toast('Failed to load agents.', 'error'),
  })
  const { isVisible, menu: columnMenu } = useColumnVisibility(config.key)
  const resolveDisplayName = useUserDisplayNames()
  const drillDown = useTransactionDrillDown()
  const canDrillDown = drillDown.canOpen(config.transactionType)
  const visibleColumns = COLUMNS.filter(c => isVisible(c.key))

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: rows,
    onView: row => drillDown.open(config.transactionType, row.transactionId),
    enabled: zone === 'content',
  })

  useHotkeys([
    { key: 'r', handler: () => reload() },
  ], zone === 'content')

  function cellText(r: DetailedReportRow, key: string): string {
    switch (key) {
      case 'company': return r.companyName
      case 'referenceNumber': return r.referenceNumber
      case 'sheetNumber': return r.sheetNumber ?? ''
      case 'date': return formatDate(r.transactionDate)
      case 'warehouse': return r.warehouseName
      case 'counterparty': return r.counterpartyName ?? ''
      case 'agent': return r.agentName ?? ''
      case 'sourceReferenceNumber': return r.sourceReferenceNumber ?? ''
      case 'remarks': return r.remarks ?? ''
      case 'origin': return r.origin === 'NATIVE' ? '' : originLabel(r.origin)
      case 'lineNumber': return String(r.lineNumber)
      case 'itemCode': return r.itemCode
      case 'itemName': return r.itemName
      case 'quantity': return formatQuantity(r.quantity)
      case 'quantityLoaded': return formatQuantity(r.quantityLoaded)
      case 'price': return r.price === null ? '' : formatCurrency(r.price)
      case 'discountPercentage': return r.discountPercentage === null ? '' : formatQuantity(r.discountPercentage)
      case 'amount': return r.amount === null ? '' : formatCurrency(r.amount)
      case 'voided': return r.voided ? 'Yes' : ''
      case 'createdBy': return resolveDisplayName(r.createdBy)
      default: return ''
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(combinedFilters)
    const all = await fetchAllContent<DetailedReportRow>(qs ? `${config.endpoint}?${qs}` : config.endpoint, 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(r => rowSearchText(r).toLowerCase().includes(term)) : all
    const exportRows = matching.map(r => Object.fromEntries(COLUMNS.map(c => [c.key, cellText(r, c.key)])))
    exportToXlsx(config.key, visibleColumns, exportRows)
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{config.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map(w => ({ value: String(w.id), label: w.name }))}
            placeholder="All warehouses"
            className="w-44"
          />
          {config.counterparty && (
            <SearchableSelect
              value={counterpartyId}
              onChange={setCounterpartyId}
              options={counterparties.map(c => ({ value: String(c.id), label: c.name }))}
              placeholder={`All ${config.counterparty.label.toLowerCase()}s`}
              className="w-44"
            />
          )}
          {config.agent && (
            <SearchableSelect
              value={agentId}
              onChange={setAgentId}
              options={agents.map(a => ({ value: String(a.id), label: a.code ? `${a.code} — ${a.name}` : a.name }))}
              placeholder="All agents"
              className="w-44"
            />
          )}
          <ItemFilterSelect
            value={itemId}
            onChange={setItemId}
            companyId={activeCompanyId}
            params={lookupParams}
            onError={() => toast('Failed to load items.', 'error')}
            placeholder="All items"
            className="w-52"
          />
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} {...columnMenu} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          <GlobalSearch value={search} onChange={setSearch} status={searchAll} />
        </div>
      </div>

      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable activeIndex={activeIndex}>
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {visibleColumns.map(c => (
                  <th key={c.key} className={cn('py-2 px-4 font-medium', NUMERIC.has(c.key) ? 'text-right' : 'text-left', c.key === PINNED && PINNED_TH)}>{c.label}</th>
                ))}
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => FILTERABLE.has(key)}
                pinnedKey={PINNED}
                actions={false}
              />
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No line items match your search/filters.' : 'No line items to display.'}
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr
                    key={row.id}
                    onClick={() => { setActiveIndex(i); drillDown.open(config.transactionType, row.transactionId) }}
                    data-active={i === activeIndex || undefined}
                    title={canDrillDown ? `Open ${row.referenceNumber}` : undefined}
                    className={cn(
                      'group border-b border-[hsl(var(--border))] last:border-0 cursor-pointer bg-[hsl(var(--card))] hover:bg-[hsl(var(--secondary))] transition-colors',
                      row.voided && 'text-[hsl(var(--muted-foreground))]',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {visibleColumns.map(c => (
                      <td
                        key={c.key}
                        className={cn(
                          'py-2 px-4',
                          NUMERIC.has(c.key) && 'text-right tabular-nums',
                          (c.key === 'referenceNumber' || c.key === 'itemCode' || c.key === 'sourceReferenceNumber') && 'font-mono text-xs',
                          c.key === PINNED && PINNED_TD,
                        )}
                      >
                        {c.key === 'remarks'
                          ? <div className="max-w-xs truncate" title={cellText(row, c.key) || undefined}>{cellText(row, c.key) || '—'}</div>
                          : cellText(row, c.key) || '—'}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </ScrollTable>
          <Pagination page={page} totalPages={totalPages} totalElements={totalElements} pageSize={50} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  )
}

// Module-level so each page passes a stable object (the columns memo depends on it).
const SUPPLIER = { label: 'Supplier', lookup: 'suppliers', param: 'supplierId' } as const
const CUSTOMER = { label: 'Customer', lookup: 'customers', param: 'customerId' } as const

const INVENTORY_ADJUSTMENT: DetailedReportConfig = {
  title: 'Inventory Adjustment - Detailed', endpoint: '/reports/detailed/inventory-adjustments', transactionType: 'INVENTORY_ADJUSTMENT', key: 'inventory-adjustment-detailed',
  loadedLabel: 'Qty Loaded',
}
const OUTLET_RECEIVE: DetailedReportConfig = {
  title: 'Outlet Receive - Detailed', endpoint: '/reports/detailed/outlet-receives', transactionType: 'OUTLET_RECEIVE', key: 'outlet-receive-detailed',
  counterparty: { ...CUSTOMER, label: 'Outlet' }, sourceLabel: 'DR #', loadedLabel: 'Qty Loaded', priceLabel: 'Unit Price',
}
const PURCHASE_ORDER: DetailedReportConfig = {
  title: 'Purchase Order - Detailed', endpoint: '/reports/detailed/purchase-orders', transactionType: 'PURCHASE_ORDER', key: 'purchase-order-detailed',
  counterparty: SUPPLIER, loadedLabel: 'Qty Invoiced/Received', priceLabel: 'Cost Price',
}
const PURCHASE_INVOICE: DetailedReportConfig = {
  title: 'Purchase Invoice - Detailed', endpoint: '/reports/detailed/purchase-invoices', transactionType: 'PURCHASE_INVOICE', key: 'purchase-invoice-detailed',
  counterparty: SUPPLIER, sourceLabel: 'PO #', loadedLabel: 'Qty Received', priceLabel: 'Cost Price', discount: true,
}
const PURCHASE_RECEIVE: DetailedReportConfig = {
  title: 'Purchase Receive - Detailed', endpoint: '/reports/detailed/purchase-receives', transactionType: 'PURCHASE_RECEIVE', key: 'purchase-receive-detailed',
  counterparty: SUPPLIER, sourceLabel: 'PO / PI #', loadedLabel: 'Qty Loaded', priceLabel: 'Cost Price',
}
const DELIVERY_RECEIPT: DetailedReportConfig = {
  title: 'Delivery Receipt - Detailed', endpoint: '/reports/detailed/delivery-receipts', transactionType: 'DELIVERY_RECEIPT', key: 'delivery-receipt-detailed',
  counterparty: CUSTOMER, sourceLabel: 'STF #', loadedLabel: 'Qty Received', priceLabel: 'Unit Price',
}
const STOCK_TRANSFER: DetailedReportConfig = {
  title: 'Stock Transfer - Detailed', endpoint: '/reports/detailed/stock-transfers', transactionType: 'STOCK_TRANSFER', key: 'stock-transfer-detailed',
  counterparty: CUSTOMER, loadedLabel: 'Qty Delivered', priceLabel: 'Unit Price',
}
const OUTLET_PULL_OUT: DetailedReportConfig = {
  title: 'Outlet Pull Out - Detailed', endpoint: '/reports/detailed/outlet-pull-outs', transactionType: 'OUTLET_PULL_OUT', key: 'outlet-pull-out-detailed',
  counterparty: { ...CUSTOMER, label: 'Outlet' }, loadedLabel: 'Qty Received', priceLabel: 'Unit Price',
}
const PULL_OUT_RECEIVE: DetailedReportConfig = {
  title: 'Pull Out Receive - Detailed', endpoint: '/reports/detailed/pull-out-receives', transactionType: 'PULL_OUT_RECEIVE', key: 'pull-out-receive-detailed',
  counterparty: { ...CUSTOMER, label: 'Outlet' }, sourceLabel: 'Pull Out #', loadedLabel: 'Qty Loaded', priceLabel: 'Unit Price',
}
// Rows are both outputs and raw materials; materials carry a negative quantity (their effect on stock).
const ASSEMBLY: DetailedReportConfig = {
  title: 'Assembly - Detailed', endpoint: '/reports/detailed/assemblies', transactionType: 'ASSEMBLY', key: 'assembly-detailed',
  loadedLabel: 'Qty Loaded',
}

const OUTLET_DELIVERY_RECEIPT: DetailedReportConfig = {
  title: 'Outlet Delivery Receipt - Detailed', endpoint: '/reports/detailed/outlet-delivery-receipts', transactionType: 'OUTLET_DELIVERY_RECEIPT', key: 'outlet-delivery-receipt-detailed',
  counterparty: { ...CUSTOMER, label: 'Outlet' }, agent: true, loadedLabel: 'Qty Returned', priceLabel: 'Unit Price',
}
const OUTLET_DELIVERY_RETURN: DetailedReportConfig = {
  title: 'Outlet Delivery Return - Detailed', endpoint: '/reports/detailed/outlet-delivery-returns', transactionType: 'OUTLET_DELIVERY_RETURN', key: 'outlet-delivery-return-detailed',
  counterparty: { ...CUSTOMER, label: 'Outlet' }, agent: true, sourceLabel: 'ODR #', loadedLabel: 'Qty Loaded', priceLabel: 'Unit Price',
}

export const InventoryAdjustmentDetailedPage = () => <TransactionDetailedReport config={INVENTORY_ADJUSTMENT} />
export const OutletReceiveDetailedPage = () => <TransactionDetailedReport config={OUTLET_RECEIVE} />
export const PurchaseOrderDetailedPage = () => <TransactionDetailedReport config={PURCHASE_ORDER} />
export const PurchaseInvoiceDetailedPage = () => <TransactionDetailedReport config={PURCHASE_INVOICE} />
export const PurchaseReceiveDetailedPage = () => <TransactionDetailedReport config={PURCHASE_RECEIVE} />
export const DeliveryReceiptDetailedPage = () => <TransactionDetailedReport config={DELIVERY_RECEIPT} />
export const OutletDeliveryReceiptDetailedPage = () => <TransactionDetailedReport config={OUTLET_DELIVERY_RECEIPT} />
export const OutletDeliveryReturnDetailedPage = () => <TransactionDetailedReport config={OUTLET_DELIVERY_RETURN} />
export const StockTransferDetailedPage = () => <TransactionDetailedReport config={STOCK_TRANSFER} />
export const OutletPullOutDetailedPage = () => <TransactionDetailedReport config={OUTLET_PULL_OUT} />
export const PullOutReceiveDetailedPage = () => <TransactionDetailedReport config={PULL_OUT_RECEIVE} />
export const AssemblyDetailedPage = () => <TransactionDetailedReport config={ASSEMBLY} />
