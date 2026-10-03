import type { ComponentType } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { navItems } from '@/lib/nav'
import type { TabLocation } from '@/context/WorkspaceContext'
import { DashboardPage } from '@/pages/DashboardPage'
import { UsersPage } from '@/pages/UsersPage'
import { RolesPage } from '@/pages/RolesPage'
import { ItemsPage } from '@/pages/ItemsPage'
import { ItemCategoriesPage } from '@/pages/ItemCategoriesPage'
import { ItemGroupsPage } from '@/pages/ItemGroupsPage'
import { ItemSkusPage } from '@/pages/ItemSkusPage'
import { BrandsPage } from '@/pages/BrandsPage'
import { WarehousesPage } from '@/pages/WarehousesPage'
import { EmployeesPage } from '@/pages/EmployeesPage'
import { CustomersPage } from '@/pages/CustomersPage'
import { SuppliersPage } from '@/pages/SuppliersPage'
import { InventoryAdjustmentsPage } from '@/pages/InventoryAdjustmentsPage'
import { PurchaseOrdersPage } from '@/pages/PurchaseOrdersPage'
import { PurchaseInvoicesPage } from '@/pages/PurchaseInvoicesPage'
import { PurchaseReceivesPage } from '@/pages/PurchaseReceivesPage'
import { InventoryBalancePage } from '@/pages/InventoryBalancePage'
import { InventoryLedgerPage } from '@/pages/InventoryLedgerPage'
import { DocumentTemplatesPage } from '@/pages/DocumentTemplatesPage'
import { DocumentTemplateDesignerPage } from '@/pages/DocumentTemplateDesignerPage'
import { TransactionActionsPage } from '@/pages/TransactionActionsPage'

// Maps each nav path (defined once in src/lib/nav.ts) to its page component.
const pageComponents: Record<string, ComponentType> = {
  '/dashboard': DashboardPage,
  '/users': UsersPage,
  '/roles': RolesPage,
  '/items': ItemsPage,
  '/item-categories': ItemCategoriesPage,
  '/item-groups': ItemGroupsPage,
  '/item-skus': ItemSkusPage,
  '/brands': BrandsPage,
  '/warehouses': WarehousesPage,
  '/employees': EmployeesPage,
  '/customers': CustomersPage,
  '/suppliers': SuppliersPage,
  '/inventory-adjustments': InventoryAdjustmentsPage,
  '/purchase-orders': PurchaseOrdersPage,
  '/purchase-invoices': PurchaseInvoicesPage,
  '/purchase-receives': PurchaseReceivesPage,
  '/reports/inventory-balance': InventoryBalancePage,
  '/reports/inventory-ledger': InventoryLedgerPage,
  '/document-templates': DocumentTemplatesPage,
  '/transaction-actions': TransactionActionsPage,
}

/** Every authenticated page, matched against one workspace tab's own location — each
 * tab renders its own `<PageRoutes>`, so a record tab and the list behind it are two
 * independent instances of the same page component. A module with a `recordLabel`
 * also mounts at `<to>/*` (`/new`, `/<id>`), where the page renders its record form
 * instead of its list (see `useRecordTab`). */
export function PageRoutes({ location }: { location: TabLocation }) {
  return (
    <Routes location={{ ...location, hash: '', key: location.pathname }}>
      {navItems.flatMap(({ to, permission, recordLabel }) => {
        const Page = pageComponents[to]
        const element = permission
          ? <ProtectedRoute requiredPermissions={[permission]}><Page /></ProtectedRoute>
          : <Page />
        const routes = [<Route key={to} path={to} element={element} />]
        if (recordLabel) routes.push(<Route key={`${to}/*`} path={`${to}/*`} element={element} />)
        return routes
      })}
      <Route
        path="/document-templates/:id/design"
        element={
          <ProtectedRoute requiredPermissions={['MANAGE_DOCUMENT_TEMPLATES']}>
            <DocumentTemplateDesignerPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
