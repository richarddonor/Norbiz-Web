import type { ColumnDef } from '@/components/ColumnsMenu'
import { DateRangeFilter } from '@/components/DateRangeFilter'

interface Props {
  columns: readonly ColumnDef[]
  isVisible: (key: string) => boolean
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** returns false to render an empty (alignment-preserving) cell instead of an input — e.g. an image thumbnail column */
  filterable?: (key: string) => boolean
}

/** A floating filter row rendered under the table header — one small text
 * input (or, for `type: 'date'` columns, a from/to range picker with quick
 * presets) per currently-visible column, combined (AND) with the global
 * search box. */
export function ColumnFilterRow({ columns, isVisible, values, onChange, filterable }: Props) {
  return (
    <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/40">
      {columns.filter(col => isVisible(col.key)).map(col => (
        <th key={col.key} className="px-4 py-1.5 font-normal">
          {(!filterable || filterable(col.key)) && (
            col.type === 'date' ? (
              <DateRangeFilter
                label={col.label}
                from={values[`${col.key}From`] ?? ''}
                to={values[`${col.key}To`] ?? ''}
                onChange={(from, to) => {
                  onChange(`${col.key}From`, from)
                  onChange(`${col.key}To`, to)
                }}
              />
            ) : (
              <input
                value={values[col.key] ?? ''}
                onChange={e => onChange(col.key, e.target.value)}
                placeholder={`Filter ${col.label}…`}
                className="w-full h-7 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-xs placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
              />
            )
          )}
        </th>
      ))}
      <th className="px-4 py-1.5" />
    </tr>
  )
}
