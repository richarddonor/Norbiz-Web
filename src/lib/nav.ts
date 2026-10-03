import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, KeyRound, Package, Tag, Layers, Barcode, Warehouse, Contact,
  Store, Truck, ClipboardList, Scale, ScrollText, LayoutTemplate, ShoppingCart, Receipt, PackageCheck, ListChecks,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permission?: string
  group?: string
  /** Nests this item one level deeper within `group` (e.g. group "Reports", subGroup "Inventory") */
  subGroup?: string
  /** Singular noun for one record of this module ("Brand", "Purchase Order"). Setting it
   * means the page opens its records in workspace tabs at `<to>/new` and `<to>/<id>`. */
  recordLabel?: string
}

// Single source of truth for sidebar nav, routing, and breadcrumbs.
export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/items', label: 'Items', icon: Package, permission: 'VIEW_ITEM', group: 'Catalog', recordLabel: 'Item' },
  { to: '/item-categories', label: 'Item Categories', icon: Layers, permission: 'VIEW_ITEM_CATEGORY', group: 'Catalog', recordLabel: 'Item Category' },
  { to: '/item-skus', label: 'Item SKUs', icon: Barcode, permission: 'VIEW_ITEM', group: 'Catalog', recordLabel: 'Item SKU' },
  { to: '/brands', label: 'Brands', icon: Tag, permission: 'VIEW_BRAND', group: 'Catalog', recordLabel: 'Brand' },
  { to: '/warehouses', label: 'Warehouses', icon: Warehouse, permission: 'VIEW_WAREHOUSE', group: 'Catalog', recordLabel: 'Warehouse' },
  { to: '/employees', label: 'Employees', icon: Contact, permission: 'VIEW_EMPLOYEE', group: 'People', recordLabel: 'Employee' },
  { to: '/customers', label: 'Customers', icon: Store, permission: 'VIEW_CUSTOMER', group: 'People', recordLabel: 'Customer' },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'VIEW_SUPPLIER', group: 'People', recordLabel: 'Supplier' },
  { to: '/inventory-adjustments', label: 'Inventory Adjustment', icon: ClipboardList, permission: 'VIEW_INVENTORY_ADJUSTMENT', group: 'Inventory', recordLabel: 'Inventory Adjustment' },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, permission: 'VIEW_PURCHASE_ORDER', group: 'Purchases', recordLabel: 'Purchase Order' },
  { to: '/purchase-invoices', label: 'Purchase Invoices', icon: Receipt, permission: 'VIEW_PURCHASE_INVOICE', group: 'Purchases', recordLabel: 'Purchase Invoice' },
  { to: '/purchase-receives', label: 'Purchase Receives', icon: PackageCheck, permission: 'VIEW_PURCHASE_RECEIVE', group: 'Purchases', recordLabel: 'Purchase Receive' },
  { to: '/reports/inventory-balance', label: 'Inventory Balance', icon: Scale, permission: 'VIEW_INVENTORY_REPORT', group: 'Reports', subGroup: 'Inventory' },
  { to: '/reports/inventory-ledger', label: 'Inventory Ledger', icon: ScrollText, permission: 'VIEW_INVENTORY_REPORT', group: 'Reports', subGroup: 'Inventory' },
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
