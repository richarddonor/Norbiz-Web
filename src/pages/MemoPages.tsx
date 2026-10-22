import { MemoPage, type MemoConfig } from '@/components/accounting/MemoPage'

// Customer and supplier memos share one page (components/accounting/MemoPage.tsx), configured per side.

const CUSTOMER: MemoConfig = {
  side: 'customer',
  title: 'Customer Memos',
  endpoint: '/customer-memos',
  transactionType: 'CUSTOMER_MEMO',
  permission: 'CUSTOMER_MEMO',
  applyingType: 'CREDIT',
  typeLabels: { DEBIT: 'Customer Debit Memo', CREDIT: 'Customer Credit Memo' },
  reasons: [
    { value: 'SALES_RETURN', label: 'Sales Return' },
    { value: 'REBATE', label: 'Rebate' },
    { value: 'PRICE_ADJUSTMENT', label: 'Price Adjustment' },
    { value: 'BILLING', label: 'Billing' },
    { value: 'OPENING_BALANCE', label: 'Opening Balance' },
    { value: 'OTHER', label: 'Other' },
  ],
}

const SUPPLIER: MemoConfig = {
  side: 'supplier',
  title: 'Supplier Memos',
  endpoint: '/supplier-memos',
  transactionType: 'SUPPLIER_MEMO',
  permission: 'SUPPLIER_MEMO',
  // A supplier debit memo (we debit the supplier, e.g. a purchase return) lowers what we owe.
  applyingType: 'DEBIT',
  typeLabels: { DEBIT: 'Supplier Debit Memo', CREDIT: 'Supplier Credit Memo' },
  reasons: [
    { value: 'PURCHASE_RETURN', label: 'Purchase Return' },
    { value: 'REBATE', label: 'Rebate' },
    { value: 'PRICE_ADJUSTMENT', label: 'Price Adjustment' },
    { value: 'BILLING', label: 'Billing' },
    { value: 'OPENING_BALANCE', label: 'Opening Balance' },
    { value: 'OTHER', label: 'Other' },
  ],
}

export const CustomerMemosPage = () => <MemoPage config={CUSTOMER} />
export const SupplierMemosPage = () => <MemoPage config={SUPPLIER} />
