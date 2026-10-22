import { PaymentPage, type PaymentConfig } from '@/components/accounting/PaymentPage'

// Customer and supplier payments share one page (components/accounting/PaymentPage.tsx), configured per side.

const CUSTOMER: PaymentConfig = { side: 'customer', title: 'Customer Payments', endpoint: '/customer-payments' }
const SUPPLIER: PaymentConfig = { side: 'supplier', title: 'Supplier Payments', endpoint: '/supplier-payments' }

export const CustomerPaymentsPage = () => <PaymentPage config={CUSTOMER} />
export const SupplierPaymentsPage = () => <PaymentPage config={SUPPLIER} />
