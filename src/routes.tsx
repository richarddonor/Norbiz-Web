import type { ComponentType } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { navItems, reportCategories, permissionsOf } from '@/lib/nav'
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
import { PurchaseReceiptsPage } from '@/pages/PurchaseReceiptsPage'
import { DeliveryReceiptsPage } from '@/pages/DeliveryReceiptsPage'
import { OutletReceiptsPage } from '@/pages/OutletReceiptsPage'
import { OutletDeliveryReceiptsPage } from '@/pages/OutletDeliveryReceiptsPage'
import { OutletDeliveryReturnsPage } from '@/pages/OutletDeliveryReturnsPage'
import { StockTransfersPage } from '@/pages/StockTransfersPage'
import { OutletPullOutsPage } from '@/pages/OutletPullOutsPage'
import { PullOutReceiptsPage } from '@/pages/PullOutReceiptsPage'
import { PullOutReasonsPage } from '@/pages/PullOutReasonsPage'
import { AssembliesPage } from '@/pages/AssembliesPage'
import { BillsOfMaterialsPage } from '@/pages/BillsOfMaterialsPage'
import { ReportCategoryPage } from '@/pages/ReportCategoryPage'
import { InventoryBalancePage } from '@/pages/InventoryBalancePage'
import { InventoryLedgerPage } from '@/pages/InventoryLedgerPage'
import {
  InventoryAdjustmentDetailedPage, OutletReceiptDetailedPage, PurchaseOrderDetailedPage,
  PurchaseInvoiceDetailedPage, PurchaseReceiptDetailedPage, DeliveryReceiptDetailedPage,
  OutletDeliveryReceiptDetailedPage, OutletDeliveryReturnDetailedPage, StockTransferDetailedPage,
  OutletPullOutDetailedPage, PullOutReceiptDetailedPage, AssemblyDetailedPage,
} from '@/pages/TransactionDetailedReportPages'
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
  '/purchase-receipts': PurchaseReceiptsPage,
  '/delivery-receipts': DeliveryReceiptsPage,
  '/outlet-receipts': OutletReceiptsPage,
  '/outlet-delivery-receipts': OutletDeliveryReceiptsPage,
  '/outlet-delivery-returns': OutletDeliveryReturnsPage,
  '/stock-transfers': StockTransfersPage,
  '/outlet-pull-outs': OutletPullOutsPage,
  '/pull-out-receipts': PullOutReceiptsPage,
  '/pull-out-reasons': PullOutReasonsPage,
  '/assemblies': AssembliesPage,
  '/bills-of-materials': BillsOfMaterialsPage,
  ...Object.fromEntries(reportCategories.map(c => [c.to, ReportCategoryPage])),
  '/reports/inventory-balance': InventoryBalancePage,
  '/reports/inventory-ledger': InventoryLedgerPage,
  '/reports/inventory-adjustment-detailed': InventoryAdjustmentDetailedPage,
  '/reports/outlet-receipt-detailed': OutletReceiptDetailedPage,
  '/reports/purchase-order-detailed': PurchaseOrderDetailedPage,
  '/reports/purchase-invoice-detailed': PurchaseInvoiceDetailedPage,
  '/reports/purchase-receipt-detailed': PurchaseReceiptDetailedPage,
  '/reports/delivery-receipt-detailed': DeliveryReceiptDetailedPage,
  '/reports/outlet-delivery-receipt-detailed': OutletDeliveryReceiptDetailedPage,
  '/reports/outlet-delivery-return-detailed': OutletDeliveryReturnDetailedPage,
  '/reports/stock-transfer-detailed': StockTransferDetailedPage,
  '/reports/outlet-pull-out-detailed': OutletPullOutDetailedPage,
  '/reports/pull-out-receipt-detailed': PullOutReceiptDetailedPage,
  '/reports/assembly-detailed': AssemblyDetailedPage,
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
      {navItems.flatMap(item => {
        const { to, permission, recordLabel } = item
        const Page = pageComponents[to]
        const element = permission
          ? <ProtectedRoute requiredPermissions={permissionsOf(item)}><Page /></ProtectedRoute>
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
