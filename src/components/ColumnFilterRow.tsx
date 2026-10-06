import type { ColumnDef } from '@/components/ColumnsMenu'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { cn } from '@/lib/utils'

interface Props {
  columns: readonly ColumnDef[]
  isVisible: (key: string) => boolean
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** returns false to render an empty (alignment-preserving) cell instead of an input — e.g. an image thumbnail column */
  filterable?: (key: string) => boolean
  /** Shows the filters but locks them — e.g. a drill-down report tab, whose filters are fixed. */
  disabled?: boolean
  /** The column a `ScrollTable` pins left (`PINNED_TH`), so its filter cell stays with it. */
  pinnedKey?: string
  /** Adds the empty cell under a row-actions column. Tables without one pass false. */
  actions?: boolean
}

/** A floating filter row rendered under the table header — one small text
 * input (or, for `type: 'date'` columns, a from/to range picker with quick
 * presets; or for `type: 'boolean'` columns, a True/False/(blank) select)
 * per currently-visible column, combined (AND) with the global search box. */
export function ColumnFilterRow({ columns, isVisible, values, onChange, filterable, disabled, pinnedKey, actions = true }: Props) {
  return (
    <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/40">
      {columns.filter(col => isVisible(col.key)).map(col => (
        <th
          key={col.key}
          className={cn(
            'px-4 py-1.5 font-normal',
            // Same ::before repaint as the actions cell below.
            col.key === pinnedKey && 'sticky left-0 z-10 bg-[hsl(var(--card))] shadow-[1px_0_0_hsl(var(--border))] before:absolute before:inset-0 before:-z-10 before:bg-[hsl(var(--secondary))]/40',
          )}
        >
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
                disabled={disabled}
              />
            ) : col.type === 'boolean' ? (
              <SearchableSelect
                value={values[col.key] ?? ''}
                onChange={v => onChange(col.key, v)}
                options={[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]}
                placeholder="All"
                disabled={disabled}
                className="h-7 px-1 text-xs"
              />
            ) : (
              <input
                value={values[col.key] ?? ''}
                onChange={e => onChange(col.key, e.target.value)}
                placeholder={`Filter ${col.label}…`}
                disabled={disabled}
                className="w-full h-7 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-xs placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50"
              />
            )
          )}
        </th>
      ))}
      {/* Pinned like the row-actions column above/below it (a no-op when the table doesn't
          scroll); the ::before repaints the row's tint over the opaque card background. */}
      {actions && <th className="sticky right-0 px-4 py-1.5 bg-[hsl(var(--card))] before:absolute before:inset-0 before:bg-[hsl(var(--secondary))]/40" />}
    </tr>
  )
}
