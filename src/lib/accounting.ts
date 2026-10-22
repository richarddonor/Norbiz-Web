// AR/AP subledger shapes and labels shared by the accounting pages — see ../Norbiz/docs/ACCOUNTING.md.
import type { TransactionOrigin } from '@/lib/transactionOrigin'

export type AccountSide = 'RECEIVABLE' | 'PAYABLE'
export type OpenItemDirection = 'CHARGE' | 'CREDIT'
export type OpenItemStatus = 'OPEN' | 'CLOSED' | 'VOIDED'
export type OpenItemSourceType = 'SALES_INVOICE' | 'CUSTOMER_DEBIT_MEMO' | 'CUSTOMER_CREDIT_MEMO' | 'CUSTOMER_PAYMENT_TENDER'
  | 'CUSTOMER_REFUND' | 'PURCHASE_INVOICE' | 'SUPPLIER_CREDIT_MEMO' | 'SUPPLIER_DEBIT_MEMO' | 'SUPPLIER_PAYMENT_TENDER' | 'SUPPLIER_REFUND'
export type ReceivedPaymentMode = 'CASH' | 'CHECK' | 'BANK_TRANSFER' | 'CREDIT_CARD' | 'OTHERS'
export type IssuedPaymentMode = 'CASH' | 'CHECK' | 'BANK_TRANSFER' | 'OTHERS'
export type ReceivedCheckStatus = 'ON_HAND' | 'DEPOSITED' | 'CLEARED' | 'BOUNCED' | 'REPLACED'
export type IssuedCheckStatus = 'ISSUED' | 'CLEARED' | 'CANCELLED'
export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'

/** A receivable/payable (CHARGE) or a credit (CREDIT) — backend `OpenItemResponse`. */
export interface OpenItem {
  id: number
  companyId: number
  side: AccountSide
  customerId: number | null
  customerName: string | null
  supplierId: number | null
  supplierName: string | null
  direction: OpenItemDirection
  sourceType: OpenItemSourceType
  sourceId: number
  referenceNumber: string
  documentDate: string
  dueDate: string | null
  amount: string
  appliedAmount: string
  pendingAmount: string
  bouncedAmount: string
  balance: string
  status: OpenItemStatus
  cleared: boolean
}

/** One application of a credit to a charge — backend `AllocationResponse`. */
export interface Allocation {
  id: number
  creditItemId: number
  creditSourceType: OpenItemSourceType
  creditReferenceNumber: string
  chargeItemId: number
  chargeSourceType: OpenItemSourceType
  chargeReferenceNumber: string
  amount: string
  allocationDate: string
  sourceType: string
  sourceId: number
  pending: boolean
  reversed: boolean
  reversedDate: string | null
  reversalReason: 'VOIDED' | 'BOUNCED' | 'CANCELLED' | null
}

/** Fields every accounting document carries. */
export interface AccountingDocument {
  id: number
  companyId: number
  companyName: string
  referenceNumber: string
  sheetNumber: string | null
  remarks: string | null
  createdAt: string | null
  createdBy: string | null
  voided: boolean
  voidedAt: string | null
  voidedBy: string | null
  origin: TransactionOrigin
}

export interface ReceivedTender {
  id: number
  paymentId: number
  paymentReferenceNumber: string
  paymentDate: string
  companyId: number
  customerId: number
  customerName: string
  lineNumber: number
  mode: ReceivedPaymentMode
  amount: string
  checkNumber: string | null
  checkDate: string | null
  bankId: number | null
  bankName: string | null
  depositBankAccountId: number | null
  depositBankAccountName: string | null
  officialReceiptNumber: string | null
  provisionalReceiptNumber: string | null
  status: ReceivedCheckStatus
  statusDate: string | null
  bounceReason: string | null
  depositId: number | null
  depositReferenceNumber: string | null
  replacesTenderId: number | null
  replacedAmount: string
  openItemId: number | null
  appliedAmount: string | null
  unappliedAmount: string | null
  paymentVoided: boolean
}

export interface IssuedTender {
  id: number
  paymentId: number
  paymentReferenceNumber: string
  voucherNumber: string | null
  paymentDate: string
  companyId: number
  supplierId: number
  supplierName: string
  lineNumber: number
  mode: IssuedPaymentMode
  amount: string
  bankAccountId: number | null
  bankAccountName: string | null
  checkNumber: string | null
  checkDate: string | null
  status: IssuedCheckStatus
  statusDate: string | null
  cancelReason: string | null
  replacesTenderId: number | null
  openItemId: number | null
  appliedAmount: string | null
  unappliedAmount: string | null
  paymentVoided: boolean
}

export interface BankAccountLookupOption {
  id: number
  companyId: number
  accountNumber: string
  name: string
  active: boolean
  bankId: number
  bankName: string
}

const SOURCE_LABELS: Record<OpenItemSourceType, string> = {
  SALES_INVOICE: 'Sales Invoice',
  CUSTOMER_DEBIT_MEMO: 'Debit Memo',
  CUSTOMER_CREDIT_MEMO: 'Credit Memo',
  CUSTOMER_PAYMENT_TENDER: 'Payment',
  CUSTOMER_REFUND: 'Refund',
  PURCHASE_INVOICE: 'Purchase Invoice',
  SUPPLIER_CREDIT_MEMO: 'Supplier Credit Memo',
  SUPPLIER_DEBIT_MEMO: 'Supplier Debit Memo',
  SUPPLIER_PAYMENT_TENDER: 'Payment',
  SUPPLIER_REFUND: 'Refund',
}

export function sourceTypeLabel(type: OpenItemSourceType): string {
  return SOURCE_LABELS[type] ?? type
}

export const RECEIVED_MODES: { value: ReceivedPaymentMode; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CHECK', label: 'Check' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CREDIT_CARD', label: 'Credit Card' },
  { value: 'OTHERS', label: 'Others' },
]

export const ISSUED_MODES: { value: IssuedPaymentMode; label: string }[] = [
  { value: 'CHECK', label: 'Check' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'OTHERS', label: 'Others' },
]

export function modeLabel(mode: string): string {
  return [...RECEIVED_MODES, ...ISSUED_MODES].find(m => m.value === mode)?.label ?? mode
}

const STATUS_LABELS: Record<string, string> = {
  ON_HAND: 'On hand', DEPOSITED: 'Deposited', CLEARED: 'Cleared', BOUNCED: 'Bounced', REPLACED: 'Replaced',
  ISSUED: 'Outstanding', CANCELLED: 'Cancelled',
  UNPAID: 'Unpaid', PARTIALLY_PAID: 'Partially paid', PAID: 'Paid',
  OPEN: 'Open', CLOSED: 'Closed', VOIDED: 'Voided',
}

export function statusLabel(status: string | null | undefined): string {
  return status ? STATUS_LABELS[status] ?? status : ''
}

export const BOUNCE_REASONS: { value: string; label: string }[] = [
  { value: 'DAIF', label: 'DAIF — Drawn Against Insufficient Funds' },
  { value: 'DAUD', label: 'DAUD — Drawn Against Uncollected Deposit' },
  { value: 'STOP_PAYMENT', label: 'Stop Payment' },
  { value: 'ACCOUNT_CLOSED', label: 'Account Closed' },
  { value: 'GARNISHED', label: 'Garnished Account' },
  { value: 'SIGNATURE_DIFFERS', label: 'Signature / Amount Differs' },
  { value: 'OTHER', label: 'Other' },
]

export const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: 'STOP_PAYMENT', label: 'Stop Payment' },
  { value: 'STALE', label: 'Stale Check' },
  { value: 'RETURNED_UNPAID', label: 'Returned Unpaid' },
  { value: 'OTHER', label: 'Other' },
]

/** "Check #1234" / "Cash" — how a tender reads in a list or a picker. */
export function tenderLabel(t: { mode: string; checkNumber: string | null }): string {
  return t.mode === 'CHECK' && t.checkNumber ? `Check #${t.checkNumber}` : modeLabel(t.mode)
}

/** Today as yyyy-MM-dd (the user's local date). */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Sums decimal strings/numbers, ignoring blanks. */
export function sum(values: (string | number | null | undefined)[]): number {
  return values.reduce<number>((total, v) => {
    const n = Number(v)
    return total + (v === null || v === undefined || v === '' || !Number.isFinite(n) ? 0 : n)
  }, 0)
}

/** Rounds to cents (the backend keeps open items to 2 decimals). */
export function cents(n: number): number {
  return Math.round(n * 100) / 100
}

const REASON_LABELS: Record<string, string> = {
  SALES_RETURN: 'Sales Return', PURCHASE_RETURN: 'Purchase Return', REBATE: 'Rebate', PRICE_ADJUSTMENT: 'Price Adjustment',
  BILLING: 'Billing', OPENING_BALANCE: 'Opening Balance', OTHER: 'Other',
}

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason
}
