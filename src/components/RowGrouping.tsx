import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ChevronRight, ListTree, ChevronsDownUp, ChevronsUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import { SEARCH_ALL_LIMIT, type AllRowsStatus, type ListTotals } from '@/hooks/usePagedList'
import type { GroupDisplayRow, GroupedView, RowGrouping } from '@/hooks/useRowGrouping'
import type { ColumnDef } from '@/components/ColumnsMenu'
import { formatCurrency, formatQuantity } from '@/lib/format'
import { cn } from '@/lib/utils'

interface MenuProps {
  grouping: RowGrouping
  view: GroupedView<unknown>
  /** `usePagedList`'s `allRows` */
  status: AllRowsStatus
}

/** Toolbar dropdown that picks the grouped columns. Columns nest in the order they're
 * checked; the badge on each shows its level. Sits just after `ColumnsMenu`. */
export function GroupByMenu({ grouping, view, status }: MenuProps) {
  const { columns, groupBy, active, toggleColumn, clear } = grouping
  const groupable = columns.filter(c => c.groupable !== false)

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={active ? 'secondary' : 'outline'}>
            <ListTree className="w-4 h-4" />
            Group by
            {active && (
              <span className="rounded bg-[hsl(var(--primary))] px-1.5 text-[10px] font-semibold text-[hsl(var(--primary-foreground))]">
                {groupBy.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="flex flex-col overflow-y-hidden">
          <DropdownMenuLabel>Group rows by (nested in pick order)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="min-h-0 overflow-y-auto">
            {groupable.map(col => {
              const level = groupBy.indexOf(col.key)
              return (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={level >= 0}
                  onCheckedChange={() => toggleColumn(col.key)}
                  onSelect={e => e.preventDefault()}
                >
                  <span className="flex-1">{col.label}</span>
                  {level >= 0 && <span className="ml-4 text-xs text-[hsl(var(--muted-foreground))]">{level + 1}</span>}
                </DropdownMenuCheckboxItem>
              )
            })}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!active} onSelect={e => { e.preventDefault(); view.expandAll() }}>
            <ChevronsUpDown className="w-4 h-4" />
            Expand all
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!active} onSelect={e => { e.preventDefault(); view.collapseAll() }}>
            <ChevronsDownUp className="w-4 h-4" />
            Collapse all
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!active} onSelect={clear}>
            <X className="w-4 h-4" />
            Clear grouping
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {status.active && (status.loading || status.tooMany !== null) && (
        <span className={cn('text-xs', status.tooMany !== null ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]')}>
          {status.tooMany !== null
            ? `${status.tooMany.toLocaleString()} rows match the column filters — narrow them to ${SEARCH_ALL_LIMIT.toLocaleString()} or fewer to group`
            : 'Loading all filtered rows…'}
        </span>
      )}
    </div>
  )
}

/** Lays one full-width row out under the table's columns: a leading cell spanning the columns
 * before the first `total` column (or every column when none is visible), then one cell per
 * remaining column — its `values` entry for `total` columns, blank otherwise — then a filler under
 * any trailing non-column header cells (e.g. row actions), sized from the header row. */
function ColumnAlignedCells({ columns, values, lead, cellClassName }: {
  /** visible columns, in table order */
  columns: readonly ColumnDef[]
  values: Record<string, ReactNode>
  lead: ReactNode
  cellClassName: string
}) {
  const fillerRef = useRef<HTMLTableCellElement>(null)
  const firstTotal = columns.findIndex(c => c.total)
  const leadSpan = firstTotal > 0 ? firstTotal : Math.max(columns.length, 1)
  const rest = firstTotal > 0 ? columns.slice(firstTotal) : []

  // Written straight to the DOM before paint. No deps: the header's cell count changes whenever
  // the user toggles a column, which re-renders this row too.
  useLayoutEffect(() => {
    const cell = fillerRef.current
    const head = cell?.closest('table')?.tHead?.rows[0]
    if (!cell || !head) return
    const extra = Array.from(head.cells).reduce((n, c) => n + c.colSpan, 0) - columns.length
    cell.colSpan = Math.max(extra, 1)
    cell.hidden = extra <= 0
  })

  return (
    <>
      <td colSpan={leadSpan} className={cellClassName}>{lead}</td>
      {rest.map(col => (
        <td key={col.key} className={cn(cellClassName, col.total && 'text-right tabular-nums')}>
          {col.total ? values[col.key] : null}
        </td>
      ))}
      <td ref={fillerRef} className={cellClassName} />
    </>
  )
}

function formatTotal(kind: ColumnDef['total'], value: number | undefined): string {
  if (value === undefined) return ''
  return kind === 'currency' ? formatCurrency(value) : formatQuantity(value)
}

/** One group's header: its label pinned left while the table scrolls sideways, then the group's
 * subtotal under each visible `total` column. */
export function GroupHeaderRow({ row, columns, active, onClick }: {
  row: GroupDisplayRow
  /** visible columns, in table order */
  columns: readonly ColumnDef[]
  active: boolean
  onClick: (recursive: boolean) => void
}) {
  const values = Object.fromEntries(columns.filter(c => c.total).map(c => [c.key, formatTotal(c.total, row.sums[c.key])]))
  return (
    <tr
      onClick={e => onClick(e.shiftKey)}
      aria-expanded={row.expanded}
      title="Click to expand/collapse · Shift+click for every nested level"
      className={cn(
        'border-b border-[hsl(var(--border))] cursor-pointer select-none bg-[hsl(var(--secondary))]/50 hover:bg-[hsl(var(--secondary))] transition-colors',
        active && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]',
      )}
    >
      <ColumnAlignedCells
        columns={columns}
        values={values}
        cellClassName="py-1.5 px-4 font-medium"
        lead={
          <div className="sticky left-4 flex w-fit items-center gap-1.5 font-normal" style={{ paddingLeft: `${row.depth * 1.25}rem` }}>
            <ChevronRight className={cn('w-4 h-4 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform', row.expanded && 'rotate-90')} />
            <span className="text-[hsl(var(--muted-foreground))]">{row.columnLabel}:</span>
            <span className={cn('font-medium', row.value === '' && 'italic text-[hsl(var(--muted-foreground))]')}>
              {row.value === '' ? '(blank)' : row.value}
            </span>
            <span className="ml-1 rounded-full bg-[hsl(var(--background))] px-2 text-xs text-[hsl(var(--muted-foreground))]">
              {row.count.toLocaleString()}
            </span>
          </div>
        }
      />
    </tr>
  )
}

/** The list's grand-total footer (`<tfoot>`, sticky at the bottom of `ScrollTable`): the total of
 * every visible `total` column over all rows matching the filters, not just this page. Renders
 * nothing when no `total` column is visible. Pass `useGrandTotals(...)`; null shows a placeholder. */
export function GrandTotalRow({ columns, isVisible, totals }: {
  columns: readonly ColumnDef[]
  isVisible: (key: string) => boolean
  totals: ListTotals | null
}) {
  const visible = columns.filter(c => isVisible(c.key))
  if (!visible.some(c => c.total)) return null
  const tooMany = totals === 'too-many'
  const values = Object.fromEntries(visible.filter(c => c.total).map(c => [
    c.key,
    totals === null ? <span className="text-[hsl(var(--muted-foreground))]">…</span>
      : totals === 'too-many' ? '' : formatTotal(c.total, totals[c.key]),
  ]))
  return (
    <tfoot>
      <tr>
        <ColumnAlignedCells
          columns={visible}
          values={values}
          cellClassName="py-2 px-4 font-semibold"
          lead={
            <div className="sticky left-4 w-fit" title="Every row matching the filters, not just this page">
              Grand total
              {tooMany && (
                <span className="ml-2 font-normal text-xs text-[hsl(var(--muted-foreground))]">
                  over {SEARCH_ALL_LIMIT.toLocaleString()} rows match — narrow the filters to total them
                </span>
              )}
            </div>
          }
        />
      </tr>
    </tfoot>
  )
}
