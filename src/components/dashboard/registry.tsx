import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Activity, ArrowLeftRight, CalendarRange, HandCoins, HeartPulse, Hourglass, Landmark, PackageMinus, ReceiptText, ShoppingCart, SlidersHorizontal, Trophy, Truck } from 'lucide-react'
import type { WidgetProps } from './widget-kit'
import { BacklogWidget, type BacklogConfig } from './BacklogWidget'
import { OutletSalesWidget } from './OutletSalesWidget'
import { StockInTransitWidget } from './StockInTransitWidget'
import { OutletStockHealthWidget } from './OutletStockHealthWidget'
import { InventoryAdjustmentTrendWidget } from './InventoryAdjustmentTrendWidget'
import { AgentLeaderboardWidget } from './AgentLeaderboardWidget'
import { TransactionActivityWidget } from './TransactionActivityWidget'
import { SubledgerWidget, type SubledgerConfig } from './SubledgerWidget'
import { CashAndChecksWidget } from './CashAndChecksWidget'

/** Frontend half of a dashboard widget. The key matches the backend `DashboardWidget` slug; the
 * name, category, description and permission come from `GET /dashboard/widgets`. */
export interface WidgetDefinition {
  icon: LucideIcon
  component: ComponentType<WidgetProps>
  /** Spans both columns until the user resizes it. */
  defaultWide: boolean
}

function backlog(config: BacklogConfig): ComponentType<WidgetProps> {
  const Backlog = (props: WidgetProps) => <BacklogWidget {...props} config={config} />
  return Backlog
}

function subledger(config: SubledgerConfig): ComponentType<WidgetProps> {
  const Subledger = (props: WidgetProps) => <SubledgerWidget {...props} config={config} />
  return Subledger
}

export const WIDGETS: Record<string, WidgetDefinition> = {
  'pending-outlet-receipts': {
    icon: Truck,
    defaultWide: true,
    component: backlog({
      endpoint: '/dashboard/widgets/pending-outlet-receipts',
      document: ['receipt', 'receipts'],
      counterparty: ['outlet', 'outlets'],
      quantityHint: 'units not yet received',
      amountLabel: 'Value in transit',
      amountHint: 'at selling price',
      progressLabel: 'received',
      progressCaption: "share of these receipts' quantity already received",
      barsTitle: 'Waiting by outlet',
      oldestTitle: 'Oldest in transit',
      drillType: 'DELIVERY_RECEIPT',
      listPage: { path: '/outlet-receipts', label: 'Outlet Receipts', permission: 'VIEW_OUTLET_RECEIPT' },
      staleDays: 30,
      emptyText: 'Nothing in transit — every outlet delivery has been received.',
    }),
  },
  'pending-purchase-orders': {
    icon: ShoppingCart,
    defaultWide: true,
    component: backlog({
      endpoint: '/dashboard/widgets/pending-purchase-orders',
      document: ['order', 'orders'],
      counterparty: ['supplier', 'suppliers'],
      quantityHint: 'units not yet received',
      amountLabel: 'Value outstanding',
      amountHint: 'at PO cost',
      progressLabel: 'received',
      progressCaption: "share of these orders' quantity already received",
      breakdownTitle: 'By destination warehouse',
      barsTitle: 'Owed by supplier',
      oldestTitle: 'Oldest open orders',
      drillType: 'PURCHASE_ORDER',
      listPage: { path: '/purchase-orders', label: 'Purchase Orders', permission: 'VIEW_PURCHASE_ORDER' },
      staleDays: 60,
      emptyText: 'No open purchase orders — everything ordered has been received or invoiced.',
    }),
  },
  'unpaid-purchase-invoices': {
    icon: ReceiptText,
    defaultWide: true,
    component: backlog({
      endpoint: '/dashboard/widgets/unpaid-purchase-invoices',
      document: ['invoice', 'invoices'],
      counterparty: ['supplier', 'suppliers'],
      amountLabel: 'Net payable',
      amountHint: 'after discounts, plus fees',
      breakdownTitle: 'By payment status',
      barsTitle: 'Owed to supplier',
      oldestTitle: 'Oldest unpaid',
      drillType: 'PURCHASE_INVOICE',
      listPage: { path: '/purchase-invoices', label: 'Purchase Invoices', permission: 'VIEW_PURCHASE_INVOICE' },
      staleDays: 90,
      emptyText: 'Every purchase invoice is paid.',
    }),
  },
  'pull-outs-awaiting-receipt': {
    icon: PackageMinus,
    defaultWide: true,
    component: backlog({
      endpoint: '/dashboard/widgets/pull-outs-awaiting-receipt',
      document: ['pull-out', 'pull-outs'],
      counterparty: ['outlet', 'outlets'],
      quantityHint: 'units on the way back',
      amountLabel: 'Value in transit',
      amountHint: 'at selling price',
      progressLabel: 'received',
      progressCaption: "share of these pull-outs' quantity already received",
      breakdownTitle: 'By reason',
      barsTitle: 'Coming back from',
      oldestTitle: 'Oldest awaiting receipt',
      drillType: 'OUTLET_PULL_OUT',
      listPage: { path: '/pull-out-receipts', label: 'Pull-out Receipts', permission: 'VIEW_PULL_OUT_RECEIPT' },
      staleDays: 30,
      emptyText: 'Nothing awaiting receipt — every pull-out is back at the main warehouse.',
    }),
  },
  'stock-in-transit': { icon: ArrowLeftRight, component: StockInTransitWidget, defaultWide: false },
  'outlet-stock-health': { icon: HeartPulse, component: OutletStockHealthWidget, defaultWide: true },
  'inventory-adjustment-trend': { icon: SlidersHorizontal, component: InventoryAdjustmentTrendWidget, defaultWide: false },
  'outlet-sales': { icon: Activity, component: OutletSalesWidget, defaultWide: true },
  'agent-leaderboard': { icon: Trophy, component: AgentLeaderboardWidget, defaultWide: false },
  'transaction-activity': { icon: CalendarRange, component: TransactionActivityWidget, defaultWide: true },
  'receivables-aging': {
    icon: Hourglass,
    defaultWide: true,
    component: subledger({
      endpoint: '/dashboard/widgets/receivables-aging',
      party: ['customer', 'customers'],
      bucketsTitle: 'Aging',
      // Current, then an ordinal ramp that ends in the critical color for 120+.
      bucketColors: ['var(--viz-seq-1)', 'var(--viz-seq-2)', 'var(--viz-seq-3)', 'var(--viz-seq-4)', 'var(--viz-seq-5)', 'var(--viz-critical)'],
      thirdTile: 'pending',
      creditsLabel: 'Unapplied credits',
      creditsHint: 'customer advances and credit memos',
      settledLabel: 'Collected',
      barsTitle: 'Owed by customer',
      itemsTitle: 'Most overdue',
      report: { path: '/reports/ar-aging', label: 'AR Aging', permission: 'VIEW_AR_REPORT' },
      staleDays: 90,
      emptyText: 'No open receivables — every customer is paid up.',
    }),
  },
  'payables-due': {
    icon: HandCoins,
    defaultWide: true,
    component: subledger({
      endpoint: '/dashboard/widgets/payables-due',
      party: ['supplier', 'suppliers'],
      bucketsTitle: 'Due schedule',
      // Overdue 31+, overdue 1-30, due this week, this month, later: urgency fades left to right.
      bucketColors: ['var(--viz-critical)', 'var(--viz-serious)', 'var(--viz-warning)', 'var(--viz-seq-2)', 'var(--viz-seq-1)'],
      thirdTile: 'dueSoon',
      creditsLabel: 'Supplier advances',
      creditsHint: 'advances and debit memos not yet applied',
      settledLabel: 'Paid',
      barsTitle: 'Owed to supplier',
      itemsTitle: 'Due first',
      report: { path: '/reports/ap-aging', label: 'AP Aging', permission: 'VIEW_AP_REPORT' },
      staleDays: 60,
      emptyText: 'No open payables — every supplier bill is settled.',
    }),
  },
  'cash-and-checks': { icon: Landmark, component: CashAndChecksWidget, defaultWide: true },
}
