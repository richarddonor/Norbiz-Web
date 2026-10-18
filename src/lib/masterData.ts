import type { MasterDataType } from '@/components/ChangeHistory'

/** Each master-data type's caption and the VIEW_ permission that opens its history.
 * Mirrors the backend's MasterDataType enum — add an entry when the backend adds a type. */
export const MASTER_DATA_TYPES: Record<MasterDataType, { label: string; permission: string }> = {
  BRAND: { label: 'Brand', permission: 'VIEW_BRAND' },
  ITEM_CATEGORY: { label: 'Item Category', permission: 'VIEW_ITEM_CATEGORY' },
  ITEM_GROUP: { label: 'Item Group', permission: 'VIEW_ITEM_GROUP' },
  ITEM: { label: 'Item', permission: 'VIEW_ITEM' },
  ITEM_SKU: { label: 'Item SKU', permission: 'VIEW_ITEM' },
  EMPLOYEE: { label: 'Employee', permission: 'VIEW_EMPLOYEE' },
  WAREHOUSE: { label: 'Warehouse', permission: 'VIEW_WAREHOUSE' },
  SUPPLIER: { label: 'Supplier', permission: 'VIEW_SUPPLIER' },
  CUSTOMER: { label: 'Customer', permission: 'VIEW_CUSTOMER' },
  USER: { label: 'User', permission: 'VIEW_USER' },
  PULL_OUT_REASON: { label: 'Pull-out Reason', permission: 'VIEW_PULL_OUT_REASON' },
  BILL_OF_MATERIAL: { label: 'Bill of Materials', permission: 'VIEW_BILL_OF_MATERIAL' },
}
