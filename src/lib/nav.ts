import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, KeyRound, Package, Tag, Layers, Barcode, Warehouse, Contact,
  Store, Truck, ClipboardList, Scale, ScrollText, LayoutTemplate,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permission?: string
  group?: string
  /** Nests this item one level deeper within `group` (e.g. group "Reports", subGroup "Inventory") */
  subGroup?: string
}

// Single source of truth for sidebar nav, routing, and breadcrumbs.
export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/items', label: 'Items', icon: Package, permission: 'VIEW_ITEM', group: 'Catalog' },
  { to: '/item-categories', label: 'Item Categories', icon: Layers, permission: 'VIEW_ITEM_CATEGORY', group: 'Catalog' },
  { to: '/item-skus', label: 'Item SKUs', icon: Barcode, permission: 'VIEW_ITEM', group: 'Catalog' },
  { to: '/brands', label: 'Brands', icon: Tag, permission: 'VIEW_BRAND', group: 'Catalog' },
  { to: '/warehouses', label: 'Warehouses', icon: Warehouse, permission: 'VIEW_WAREHOUSE', group: 'Catalog' },
  { to: '/employees', label: 'Employees', icon: Contact, permission: 'VIEW_EMPLOYEE', group: 'People' },
  { to: '/customers', label: 'Customers', icon: Store, permission: 'VIEW_CUSTOMER', group: 'People' },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'VIEW_SUPPLIER', group: 'People' },
  { to: '/inventory-adjustments', label: 'Inventory Adjustment', icon: ClipboardList, permission: 'VIEW_INVENTORY_ADJUSTMENT', group: 'Inventory' },
  { to: '/reports/inventory-balance', label: 'Inventory Balance', icon: Scale, permission: 'VIEW_INVENTORY_REPORT', group: 'Reports', subGroup: 'Inventory' },
  { to: '/reports/inventory-ledger', label: 'Inventory Ledger', icon: ScrollText, permission: 'VIEW_INVENTORY_REPORT', group: 'Reports', subGroup: 'Inventory' },
  { to: '/users', label: 'Users', icon: Users, permission: 'VIEW_USER', group: 'Access Control' },
  { to: '/roles', label: 'Roles', icon: KeyRound, permission: 'VIEW_ROLE', group: 'Access Control' },
  { to: '/document-templates', label: 'Document Templates', icon: LayoutTemplate, permission: 'MANAGE_DOCUMENT_TEMPLATES', group: 'Access Control' },
]

export function findNavItem(pathname: string): NavItem | undefined {
  return navItems.find(item => item.to === pathname)
}
