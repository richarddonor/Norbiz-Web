import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, Users, KeyRound, Package, Tag, Layers, Barcode, Warehouse, Contact } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permission?: string
  group?: string
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
  { to: '/users', label: 'Users', icon: Users, permission: 'VIEW_USER', group: 'Access Control' },
  { to: '/roles', label: 'Roles', icon: KeyRound, permission: 'VIEW_ROLE', group: 'Access Control' },
]

export function findNavItem(pathname: string): NavItem | undefined {
  return navItems.find(item => item.to === pathname)
}
