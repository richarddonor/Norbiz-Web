import { RefundPage, type RefundConfig } from '@/components/accounting/RefundPage'

// Customer and supplier refunds share one page (components/accounting/RefundPage.tsx), configured per side.

const CUSTOMER_REFUNDS: RefundConfig = { side: 'customer', title: 'Customer Refunds', endpoint: '/customer-refunds' }
const SUPPLIER_REFUNDS: RefundConfig = { side: 'supplier', title: 'Supplier Refunds', endpoint: '/supplier-refunds' }

export const CustomerRefundsPage = () => <RefundPage config={CUSTOMER_REFUNDS} />
export const SupplierRefundsPage = () => <RefundPage config={SUPPLIER_REFUNDS} />
