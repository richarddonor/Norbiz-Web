import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, KeyRound, Package, Tag, Layers, Boxes, Barcode, Warehouse, Contact,
  Store, Truck, ClipboardList, Scale, ScrollText, LayoutTemplate, ShoppingCart, Receipt, PackageCheck, ListChecks,
  PackageOpen, PackagePlus, FileSpreadsheet,
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
] as const

const reports: (NavItem & { parent: (typeof reportCategories)[number]['to'] })[] = [
  { to: '/reports/inventory-balance', label: 'Inventory Balance', icon: Scale, permission: 'VIEW_INVENTORY_REPORT', parent: '/reports/inventory', description: 'On-hand quantity per item and warehouse.' },
  { to: '/reports/inventory-ledger', label: 'Inventory Ledger', icon: ScrollText, permission: 'VIEW_INVENTORY_REPORT', parent: '/reports/inventory', description: 'Every stock movement with running balances.' },
  // "<Transaction> - Detailed" reports — one per transaction type, each with its own permission.
  { to: '/reports/inventory-adjustment-detailed', label: 'Inventory Adjustment - Detailed', icon: FileSpreadsheet, permission: 'VIEW_INVENTORY_ADJUSTMENT_DETAILED_REPORT', parent: '/reports/inventory', description: 'Inventory adjustments, one row per line item.' },
  { to: '/reports/outlet-receive-detailed', label: 'Outlet Receive - Detailed', icon: FileSpreadsheet, permission: 'VIEW_OUTLET_RECEIVE_DETAILED_REPORT', parent: '/reports/inventory', description: 'Outlet receives, one row per line item.' },
  { to: '/reports/purchase-order-detailed', label: 'Purchase Order - Detailed', icon: FileSpreadsheet, permission: 'VIEW_PURCHASE_ORDER_DETAILED_REPORT', parent: '/reports/purchases', description: 'Purchase orders, one row per line item.' },
  { to: '/reports/purchase-invoice-detailed', label: 'Purchase Invoice - Detailed', icon: FileSpreadsheet, permission: 'VIEW_PURCHASE_INVOICE_DETAILED_REPORT', parent: '/reports/purchases', description: 'Purchase invoices, one row per line item.' },
  { to: '/reports/purchase-receive-detailed', label: 'Purchase Receive - Detailed', icon: FileSpreadsheet, permission: 'VIEW_PURCHASE_RECEIVE_DETAILED_REPORT', parent: '/reports/purchases', description: 'Purchase receives, one row per line item.' },
  { to: '/reports/delivery-receipt-detailed', label: 'Delivery Receipt - Detailed', icon: FileSpreadsheet, permission: 'VIEW_DELIVERY_RECEIPT_DETAILED_REPORT', parent: '/reports/sales', description: 'Delivery receipts, one row per line item.' },
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
  { to: '/warehouses', label: 'Warehouses', icon: Warehouse, permission: 'VIEW_WAREHOUSE', group: 'Catalog', recordLabel: 'Warehouse' },
  { to: '/employees', label: 'Employees', icon: Contact, permission: 'VIEW_EMPLOYEE', group: 'People', recordLabel: 'Employee' },
  { to: '/customers', label: 'Customers', icon: Store, permission: 'VIEW_CUSTOMER', group: 'People', recordLabel: 'Customer' },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'VIEW_SUPPLIER', group: 'People', recordLabel: 'Supplier' },
  { to: '/inventory-adjustments', label: 'Inventory Adjustment', icon: ClipboardList, permission: 'VIEW_INVENTORY_ADJUSTMENT', group: 'Inventory', recordLabel: 'Inventory Adjustment' },
  { to: '/outlet-receives', label: 'Outlet Receives', icon: PackagePlus, permission: 'VIEW_OUTLET_RECEIVE', group: 'Inventory', recordLabel: 'Outlet Receive' },
  { to: '/delivery-receipts', label: 'Delivery Receipts', icon: PackageOpen, permission: 'VIEW_DELIVERY_RECEIPT', group: 'Sales', recordLabel: 'Delivery Receipt' },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, permission: 'VIEW_PURCHASE_ORDER', group: 'Purchases', recordLabel: 'Purchase Order' },
  { to: '/purchase-invoices', label: 'Purchase Invoices', icon: Receipt, permission: 'VIEW_PURCHASE_INVOICE', group: 'Purchases', recordLabel: 'Purchase Invoice' },
  { to: '/purchase-receives', label: 'Purchase Receives', icon: PackageCheck, permission: 'VIEW_PURCHASE_RECEIVE', group: 'Purchases', recordLabel: 'Purchase Receive' },
  ...reportNavItems(),
  { to: '/users', label: 'Users', icon: Users, permission: 'VIEW_USER', group: 'Access Control', recordLabel: 'User' },
  { to: '/roles', label: 'Roles', icon: KeyRound, permission: 'VIEW_ROLE', group: 'Access Control', recordLabel: 'Role' },
  { to: '/document-templates', label: 'Document Templates', icon: LayoutTemplate, permission: 'MANAGE_DOCUMENT_TEMPLATES', group: 'Access Control', recordLabel: 'Document Template' },
  { to: '/transaction-actions', label: 'Transaction Actions', icon: ListChecks, permission: 'MANAGE_TRANSACTION_ACTIONS', group: 'Access Control', recordLabel: 'Transaction Action' },
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
