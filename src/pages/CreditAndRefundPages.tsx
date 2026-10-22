import { CreditApplicationPage, type CreditApplicationConfig } from '@/components/accounting/CreditApplicationPage'
import { RefundPage, type RefundConfig } from '@/components/accounting/RefundPage'

// Credit applications and refunds share one page each per side (components/accounting/), configured here.

const CUSTOMER_APPLICATIONS: CreditApplicationConfig = { side: 'customer', title: 'Customer Credit Applications', endpoint: '/customer-credit-applications' }
const SUPPLIER_APPLICATIONS: CreditApplicationConfig = { side: 'supplier', title: 'Supplier Credit Applications', endpoint: '/supplier-credit-applications' }
const CUSTOMER_REFUNDS: RefundConfig = { side: 'customer', title: 'Customer Refunds', endpoint: '/customer-refunds' }
const SUPPLIER_REFUNDS: RefundConfig = { side: 'supplier', title: 'Supplier Refunds', endpoint: '/supplier-refunds' }

export const CustomerCreditApplicationsPage = () => <CreditApplicationPage config={CUSTOMER_APPLICATIONS} />
export const SupplierCreditApplicationsPage = () => <CreditApplicationPage config={SUPPLIER_APPLICATIONS} />
export const CustomerRefundsPage = () => <RefundPage config={CUSTOMER_REFUNDS} />
export const SupplierRefundsPage = () => <RefundPage config={SUPPLIER_REFUNDS} />
