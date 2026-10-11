import { ItemSelect } from '@/components/ItemSelect'

interface Props {
  value: string
  onChange: (value: string) => void
  companyId: number | '' | null | undefined
  /** extra `/lookups/items` params, e.g. `{ activeOnly: 'false' }` */
  params?: Record<string, string>
  placeholder?: string
  className?: string
  disabled?: boolean
  onError?: () => void
}

/** Item dropdown for list/report filter bars: a type-ahead `ItemSelect` showing "All items" when blank. */
export function ItemFilterSelect({ onChange, placeholder = 'All items', ...props }: Props) {
  return <ItemSelect {...props} placeholder={placeholder} onChange={v => onChange(v)} />
}
