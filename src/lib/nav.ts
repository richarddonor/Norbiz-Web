import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, KeyRound, Package, Tag, Layers, Boxes, Barcode, Warehouse, Contact,
  Store, Truck, ClipboardList, Scale, ScrollText, LayoutTemplate, ShoppingCart, Receipt, PackageCheck, ListChecks,
  PackageOpen, PackagePlus, FileSpreadsheet, HandCoins, Undo2, ArrowRightLeft, PackageMinus, PackageX, Hammer,
  CircleHelp, ListTree, ArchiveX, ReceiptText, Wallet, NotebookPen, RotateCcw, FileText, BadgeCheck, Banknote, Send,
  Landmark, CreditCard, GitCompareArrows, Settings, Palette, Calculator, Hourglass, BookOpen, Coins,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Gates the route, sidebar and command palette. An array means any one of them (OR). */
  permission?: string | string[]
  group?: string
  /** Path of the page that lists this item instead of the sidebar (a report's category page).
   * Breadcrumbs show that page as this item's parent, and its sidebar link stays highlighted. */
  parent?: string
  /** One-line summary shown on the parent page. */
  description?: string
  /** Singular noun for one record of this module ("Brand", "Purchase Order"). Setting it
   * means the page opens its records in workspace tabs at `<to>/new` and `<to>/<id>`. */
  recordLabel?: string
}

// Reports, grouped into categories. The sidebar shows one link per category under "Reports";
// each category page lists the reports in it the user can open. A category is gated by the
// union of its reports' permissions, so it (and "Reports" itself) disappears when the user
// can't open any of them. Add a report here, plus its `routes.tsx` entry.
export const reportCategories = [
  { to: '/reports/inventory', label: 'Inventory', icon: Warehouse },
  { to: '/reports/purchases', label: 'Purchases', icon: ShoppingCart },
  { to: '/reports/sales', label: 'Sales', icon: PackageOpen },
  { to: '/reports/accounting', label: 'Accounting', icon: Calculator },
] as const

const reports: (NavItem & { parent: (typeof reportCategories)[number]['to'] })[] = [
  { to: '/reports/inventory-balance', label: 'Inventory Balance', icon: Scale, permission: 'VIEW_INVENTORY_REPORT', parent: '/reports/inventory', description: 'On-hand quantity per item and warehouse.' },
  { to: '/reports/inventory-ledger', label: 'Inventory Ledger', icon: ScrollText, permission: 'VIEW_INVENTORY_REPORT', parent: '/reports/inventory', description: 'Every stock movement with running balances.' },
  // "<Transaction> - Detailed" reports — one per transaction type, each with its own permission.
  { to: '/reports/inventory-adjustment-detailed', label: 'Inventory Adjustment - Detailed', icon: FileSpreadsheet, permission: 'VIEW_INVENTORY_ADJUSTMENT_DETAILED_REPORT', parent: '/reports/inventory', description: 'Inventory adjustments, one row per line item.' },
  { to: '/reports/outlet-receipt-detailed', label: 'Outlet Receipt - Detailed', icon: FileSpreadsheet, permission: 'VIEW_OUTLET_RECEIPT_DETAILED_REPORT', parent: '/reports/inventory', description: 'Outlet receipts, one row per line item.' },
  { to: '/reports/purchase-order-detailed', label: 'Purchase Order - Detailed', icon: FileSpreadsheet, permission: 'VIEW_PURCHASE_ORDER_DETAILED_REPORT', parent: '/reports/purchases', description: 'Purchase orders, one row per line item.' },
  { to: '/reports/purchase-invoice-detailed', label: 'Purchase Invoice - Detailed', icon: FileSpreadsheet, permission: 'VIEW_PURCHASE_INVOICE_DETAILED_REPORT', parent: '/reports/purchases', description: 'Purchase invoices, one row per line item.' },
  { to: '/reports/purchase-receipt-detailed', label: 'Purchase Receipt - Detailed', icon: FileSpreadsheet, permission: 'VIEW_PURCHASE_RECEIPT_DETAILED_REPORT', parent: '/reports/purchases', description: 'Purchase receipts, one row per line item.' },
  { to: '/reports/delivery-receipt-detailed', label: 'Delivery Receipt - Detailed', icon: FileSpreadsheet, permission: 'VIEW_DELIVERY_RECEIPT_DETAILED_REPORT', parent: '/reports/sales', description: 'Delivery receipts, one row per line item.' },
  { to: '/reports/outlet-delivery-receipt-detailed', label: 'Outlet Delivery Receipt - Detailed', icon: FileSpreadsheet, permission: 'VIEW_OUTLET_DELIVERY_RECEIPT_DETAILED_REPORT', parent: '/reports/sales', description: 'Outlet sales, one row per line item, with the agent.' },
  { to: '/reports/stock-transfer-detailed', label: 'Stock Transfer - Detailed', icon: FileSpreadsheet, permission: 'VIEW_STOCK_TRANSFER_DETAILED_REPORT', parent: '/reports/sales', description: 'Stock set aside for delivery, one row per line item.' },
  { to: '/reports/outlet-pull-out-detailed', label: 'Outlet Pull-out - Detailed', icon: FileSpreadsheet, permission: 'VIEW_OUTLET_PULL_OUT_DETAILED_REPORT', parent: '/reports/sales', description: 'Stock pulled out of outlets, one row per line item.' },
  { to: '/reports/pull-out-receipt-detailed', label: 'Pull-out Receipt - Detailed', icon: FileSpreadsheet, permission: 'VIEW_PULL_OUT_RECEIPT_DETAILED_REPORT', parent: '/reports/sales', description: 'Pulled-out stock received at the main warehouse, one row per line item.' },
  { to: '/reports/assembly-detailed', label: 'Assembly - Detailed', icon: FileSpreadsheet, permission: 'VIEW_ASSEMBLY_DETAILED_REPORT', parent: '/reports/inventory', description: 'Assemblies, one row per output or raw material.' },
  { to: '/reports/sales-invoice-detailed', label: 'Sales Invoice - Detailed', icon: FileSpreadsheet, permission: 'VIEW_SALES_INVOICE_DETAILED_REPORT', parent: '/reports/sales', description: 'Sales invoices, one row per line item.' },
  // AR/AP (../Norbiz/docs/ACCOUNTING.md "Reports")
  { to: '/reports/ar-aging', label: 'Accounts Receivable Aging', icon: Hourglass, permission: 'VIEW_AR_REPORT', parent: '/reports/accounting', description: 'What customers owe, by how overdue, as of a date.' },
  { to: '/reports/ap-aging', label: 'Accounts Payable Aging', icon: Hourglass, permission: 'VIEW_AP_REPORT', parent: '/reports/accounting', description: 'What we owe suppliers, by how overdue, as of a date.' },
  { to: '/reports/customer-ledger', label: 'Customer Ledger', icon: BookOpen, permission: 'VIEW_AR_REPORT', parent: '/reports/accounting', description: 'A customer\'s charges, payments and credits with a running balance.' },
  { to: '/reports/supplier-ledger', label: 'Supplier Ledger', icon: BookOpen, permission: 'VIEW_AP_REPORT', parent: '/reports/accounting', description: 'A supplier\'s payables, payments and credits with a running balance.' },
  { to: '/reports/open-receivables', label: 'Open Receivables', icon: Coins, permission: 'VIEW_AR_REPORT', parent: '/reports/accounting', description: 'Every receivable and customer credit with its balance.' },
  { to: '/reports/open-payables', label: 'Open Payables', icon: Coins, permission: 'VIEW_AP_REPORT', parent: '/reports/accounting', description: 'Every payable and supplier credit with its balance.' },
  { to: '/reports/bank-book', label: 'Bank Book', icon: Landmark, permission: 'VIEW_BANK_BOOK', parent: '/reports/accounting', description: 'A bank account\'s entries with a running balance.' },
  { to: '/reports/customer-memo-detailed', label: 'Customer Memo - Detailed', icon: FileSpreadsheet, permission: 'VIEW_CUSTOMER_MEMO_DETAILED_REPORT', parent: '/reports/accounting', description: 'Customer memos, one row per line.' },
  { to: '/reports/supplier-memo-detailed', label: 'Supplier Memo - Detailed', icon: FileSpreadsheet, permission: 'VIEW_SUPPLIER_MEMO_DETAILED_REPORT', parent: '/reports/accounting', description: 'Supplier memos, one row per line.' },
  { to: '/reports/customer-payment-detailed', label: 'Customer Payment - Detailed', icon: FileSpreadsheet, permission: 'VIEW_CUSTOMER_PAYMENT_DETAILED_REPORT', parent: '/reports/accounting', description: 'Customer payments, one row per tender.' },
  { to: '/reports/supplier-payment-detailed', label: 'Supplier Payment - Detailed', icon: FileSpreadsheet, permission: 'VIEW_SUPPLIER_PAYMENT_DETAILED_REPORT', parent: '/reports/accounting', description: 'Supplier payments, one row per tender.' },
  { to: '/reports/customer-refund-detailed', label: 'Customer Refund - Detailed', icon: FileSpreadsheet, permission: 'VIEW_CUSTOMER_REFUND_DETAILED_REPORT', parent: '/reports/accounting', description: 'Customer refunds, one row per refunded credit.' },
  { to: '/reports/supplier-refund-detailed', label: 'Supplier Refund - Detailed', icon: FileSpreadsheet, permission: 'VIEW_SUPPLIER_REFUND_DETAILED_REPORT', parent: '/reports/accounting', description: 'Supplier refunds, one row per refunded credit.' },
  { to: '/reports/deposit-detailed', label: 'Deposit - Detailed', icon: FileSpreadsheet, permission: 'VIEW_DEPOSIT_DETAILED_REPORT', parent: '/reports/accounting', description: 'Deposits, one row per deposited item.' },
  { to: '/reports/bank-reconciliation-detailed', label: 'Bank Reconciliation - Detailed', icon: FileSpreadsheet, permission: 'VIEW_BANK_RECONCILIATION_DETAILED_REPORT', parent: '/reports/accounting', description: 'Bank reconciliations, one row per cleared item or adjustment.' },
  { to: '/reports/statement-of-account-detailed', label: 'Statement of Account - Detailed', icon: FileSpreadsheet, permission: 'VIEW_STATEMENT_OF_ACCOUNT_DETAILED_REPORT', parent: '/reports/accounting', description: 'Statements of account, one row per open item.' },
  { to: '/reports/outlet-delivery-return-detailed', label: 'Outlet Delivery Return - Detailed', icon: FileSpreadsheet, permission: 'VIEW_OUTLET_DELIVERY_RETURN_DETAILED_REPORT', parent: '/reports/sales', description: 'Outlet sales returns, one row per line item, with the agent.' },
]

function reportNavItems(): NavItem[] {
  const categories = reportCategories.map(category => ({
    ...category,
    group: 'Reports',
    permission: reports.filter(r => r.parent === category.to).flatMap(r => permissionsOf(r)),
  }))
  return [...categories, ...reports.map(r => ({ ...r, group: 'Reports' }))]
}

/** The permissions that open `item` (any one suffices); empty when it's ungated. */
export function permissionsOf(item: NavItem): string[] {
  return item.permission === undefined ? [] : [item.permission].flat()
}

/** Whether the user can open `item` — pass `useAuth().hasPermission`. */
export function canAccess(item: NavItem, hasPermission: (...required: string[]) => boolean): boolean {
  const perms = permissionsOf(item)
  return item.permission === undefined || (perms.length > 0 && hasPermission(...perms))
}

// Single source of truth for sidebar nav, routing, and breadcrumbs.
export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/items', label: 'Items', icon: Package, permission: 'VIEW_ITEM', group: 'Catalog', recordLabel: 'Item' },
  { to: '/item-categories', label: 'Item Categories', icon: Layers, permission: 'VIEW_ITEM_CATEGORY', group: 'Catalog', recordLabel: 'Item Category' },
  { to: '/item-groups', label: 'Item Groups', icon: Boxes, permission: 'VIEW_ITEM_GROUP', group: 'Catalog', recordLabel: 'Item Group' },
  { to: '/item-skus', label: 'Item SKUs', icon: Barcode, permission: 'VIEW_ITEM', group: 'Catalog', recordLabel: 'Item SKU' },
  { to: '/brands', label: 'Brands', icon: Tag, permission: 'VIEW_BRAND', group: 'Catalog', recordLabel: 'Brand' },
  { to: '/bills-of-materials', label: 'Bills of Materials', icon: ListTree, permission: 'VIEW_BILL_OF_MATERIAL', group: 'Catalog', recordLabel: 'Bill of Materials' },
  { to: '/warehouses', label: 'Warehouses', icon: Warehouse, permission: 'VIEW_WAREHOUSE', group: 'Catalog', recordLabel: 'Warehouse' },
  { to: '/employees', label: 'Employees', icon: Contact, permission: 'VIEW_EMPLOYEE', group: 'People', recordLabel: 'Employee' },
  { to: '/customers', label: 'Customers', icon: Store, permission: 'VIEW_CUSTOMER', group: 'People', recordLabel: 'Customer' },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'VIEW_SUPPLIER', group: 'People', recordLabel: 'Supplier' },
  { to: '/inventory-adjustments', label: 'Inventory Adjustment', icon: ClipboardList, permission: 'VIEW_INVENTORY_ADJUSTMENT', group: 'Inventory', recordLabel: 'Inventory Adjustment' },
  { to: '/assemblies', label: 'Assemblies', icon: Hammer, permission: 'VIEW_ASSEMBLY', group: 'Inventory', recordLabel: 'Assembly' },
  { to: '/stock-transfers', label: 'Stock Transfers', icon: ArrowRightLeft, permission: 'VIEW_STOCK_TRANSFER', group: 'Sales', recordLabel: 'Stock Transfer' },
  { to: '/delivery-receipts', label: 'Delivery Receipts', icon: PackageOpen, permission: 'VIEW_DELIVERY_RECEIPT', group: 'Sales', recordLabel: 'Delivery Receipt' },
  { to: '/outlet-receipts', label: 'Outlet Receipts', icon: PackagePlus, permission: 'VIEW_OUTLET_RECEIPT', group: 'Outlet', recordLabel: 'Outlet Receipt' },
  { to: '/outlet-delivery-receipts', label: 'Outlet Delivery Receipts', icon: HandCoins, permission: 'VIEW_OUTLET_DELIVERY_RECEIPT', group: 'Outlet', recordLabel: 'Outlet Delivery Receipt' },
  { to: '/outlet-delivery-returns', label: 'Outlet Delivery Returns', icon: Undo2, permission: 'VIEW_OUTLET_DELIVERY_RETURN', group: 'Outlet', recordLabel: 'Outlet Delivery Return' },
  { to: '/outlet-pull-outs', label: 'Outlet Pull-outs', icon: PackageMinus, permission: 'VIEW_OUTLET_PULL_OUT', group: 'Outlet', recordLabel: 'Outlet Pull-out' },
  { to: '/pull-out-receipts', label: 'Pull-out Receipts', icon: PackageX, permission: 'VIEW_PULL_OUT_RECEIPT', group: 'Outlet', recordLabel: 'Pull-out Receipt' },
  { to: '/pull-out-reasons', label: 'Pull-out Reasons', icon: CircleHelp, permission: 'VIEW_PULL_OUT_REASON', group: 'Outlet', recordLabel: 'Pull-out Reason' },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, permission: 'VIEW_PURCHASE_ORDER', group: 'Purchases', recordLabel: 'Purchase Order' },
  { to: '/purchase-invoices', label: 'Purchase Invoices', icon: Receipt, permission: 'VIEW_PURCHASE_INVOICE', group: 'Purchases', recordLabel: 'Purchase Invoice' },
  { to: '/purchase-receipts', label: 'Purchase Receipts', icon: PackageCheck, permission: 'VIEW_PURCHASE_RECEIPT', group: 'Purchases', recordLabel: 'Purchase Receipt' },
  { to: '/sales-invoices', label: 'Sales Invoices', icon: ReceiptText, permission: 'VIEW_SALES_INVOICE', group: 'Receivables', recordLabel: 'Sales Invoice' },
  { to: '/customer-payments', label: 'Customer Payments', icon: Wallet, permission: 'VIEW_CUSTOMER_PAYMENT', group: 'Receivables', recordLabel: 'Customer Payment' },
  { to: '/customer-memos', label: 'Customer Memos', icon: NotebookPen, permission: 'VIEW_CUSTOMER_MEMO', group: 'Receivables', recordLabel: 'Customer Memo' },
  { to: '/customer-refunds', label: 'Customer Refunds', icon: RotateCcw, permission: 'VIEW_CUSTOMER_REFUND', group: 'Receivables', recordLabel: 'Customer Refund' },
  { to: '/statements-of-account', label: 'Statements of Account', icon: FileText, permission: 'VIEW_STATEMENT_OF_ACCOUNT', group: 'Receivables', recordLabel: 'Statement of Account' },
  { to: '/received-checks', label: 'Received Checks', icon: BadgeCheck, permission: ['VIEW_CUSTOMER_PAYMENT', 'UPDATE_RECEIVED_CHECK_STATUS', 'CREATE_DEPOSIT'], group: 'Receivables' },
  { to: '/supplier-payments', label: 'Supplier Payments', icon: Banknote, permission: 'VIEW_SUPPLIER_PAYMENT', group: 'Payables', recordLabel: 'Supplier Payment' },
  { to: '/supplier-memos', label: 'Supplier Memos', icon: NotebookPen, permission: 'VIEW_SUPPLIER_MEMO', group: 'Payables', recordLabel: 'Supplier Memo' },
  { to: '/supplier-refunds', label: 'Supplier Refunds', icon: RotateCcw, permission: 'VIEW_SUPPLIER_REFUND', group: 'Payables', recordLabel: 'Supplier Refund' },
  { to: '/issued-checks', label: 'Issued Checks', icon: Send, permission: ['VIEW_SUPPLIER_PAYMENT', 'UPDATE_ISSUED_CHECK_STATUS'], group: 'Payables' },
  { to: '/deposits', label: 'Deposits', icon: Landmark, permission: 'VIEW_DEPOSIT', group: 'Banking', recordLabel: 'Deposit' },
  { to: '/bank-reconciliations', label: 'Bank Reconciliations', icon: GitCompareArrows, permission: 'VIEW_BANK_RECONCILIATION', group: 'Banking', recordLabel: 'Bank Reconciliation' },
  { to: '/bank-accounts', label: 'Bank Accounts', icon: CreditCard, permission: 'VIEW_BANK_ACCOUNT', group: 'Banking', recordLabel: 'Bank Account' },
  { to: '/banks', label: 'Banks', icon: Landmark, permission: 'VIEW_BANK', group: 'Banking', recordLabel: 'Bank' },
  { to: '/accounting-settings', label: 'Accounting Settings', icon: Settings, group: 'Banking', permission: [
    'MANAGE_ACCOUNTING_SETTINGS', 'VIEW_SALES_INVOICE', 'VIEW_CUSTOMER_PAYMENT', 'VIEW_SUPPLIER_PAYMENT', 'VIEW_AR_REPORT', 'VIEW_AP_REPORT',
  ] },
  ...reportNavItems(),
  { to: '/users', label: 'Users', icon: Users, permission: 'VIEW_USER', group: 'Access Control', recordLabel: 'User' },
  { to: '/roles', label: 'Roles', icon: KeyRound, permission: 'VIEW_ROLE', group: 'Access Control', recordLabel: 'Role' },
  { to: '/document-templates', label: 'Document Templates', icon: LayoutTemplate, permission: 'MANAGE_DOCUMENT_TEMPLATES', group: 'Access Control', recordLabel: 'Document Template' },
  { to: '/company-theme', label: 'Company Theme', icon: Palette, permission: 'MANAGE_COMPANY_THEME', group: 'Access Control' },
  { to: '/transaction-actions', label: 'Transaction Actions', icon: ListChecks, permission: 'MANAGE_TRANSACTION_ACTIONS', group: 'Access Control', recordLabel: 'Transaction Action' },
  // Any master-data VIEW_ permission opens it; the page offers only the types the user can view.
  { to: '/deleted-records', label: 'Deleted Records', icon: ArchiveX, group: 'Access Control', recordLabel: 'Deleted Record', permission: [
    'VIEW_BRAND', 'VIEW_ITEM_CATEGORY', 'VIEW_ITEM_GROUP', 'VIEW_ITEM', 'VIEW_EMPLOYEE', 'VIEW_WAREHOUSE',
    'VIEW_SUPPLIER', 'VIEW_CUSTOMER', 'VIEW_USER', 'VIEW_PULL_OUT_REASON', 'VIEW_BILL_OF_MATERIAL', 'VIEW_BANK', 'VIEW_BANK_ACCOUNT',
  ] },
]

export function findNavItem(pathname: string): NavItem | undefined {
  return navItems.find(item => item.to === pathname)
}

/** The module a record path (`/brands/12`, `/purchase-orders/new`,
 * `/document-templates/3/design`) belongs to — `undefined` for module pages themselves. */
export function findRecordBase(pathname: string): NavItem | undefined {
  return navItems.find(item => item.recordLabel && pathname.startsWith(item.to + '/'))
}

/** The report at `pathname` (`/reports/inventory-balance`) — `undefined` for anything else,
 * including report category pages. Opened from its category page, a report gets its own
 * workspace tab (`useWorkspace().openPage`). */
export function findReport(pathname: string): NavItem | undefined {
  const item = findNavItem(pathname)
  return item?.parent ? item : undefined
}

/** Items listed on the page at `to` instead of in the sidebar (a report category's reports). */
export function childNavItems(to: string): NavItem[] {
  return navItems.filter(item => item.parent === to)
}
