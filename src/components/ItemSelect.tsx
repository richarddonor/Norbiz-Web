import { LookupSelect, type LookupSelectProps } from '@/components/LookupSelect'
import type { ItemLookupOption } from '@/lib/lookups'

const itemLabel = (item: { code: string | null; name: string }) => `${item.code} — ${item.name}`

/** Type-ahead item dropdown (`/lookups/items`) for forms and filter bars — never loads every item. */
export function ItemSelect(props: Omit<LookupSelectProps<ItemLookupOption>, 'path' | 'getLabel'>) {
  return <LookupSelect<ItemLookupOption> path="items" getLabel={itemLabel} searchPlaceholder="Type item code or name…" {...props} />
}
