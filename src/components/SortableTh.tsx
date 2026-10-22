import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ListSorting } from '@/hooks/useListSort'
import { cn } from '@/lib/utils'

interface Props {
  sorting: ListSorting
  column: string
  className?: string
  children: ReactNode
}

/** A list header cell that sorts by its column on click (asc → desc → default order). A column
 * that isn't `sortable` renders as a plain `<th>`. */
export function SortableTh({ sorting, column, className, children }: Props) {
  if (!sorting.isSortable(column)) return <th className={className}>{children}</th>
  const dir = sorting.sort?.key === column ? sorting.sort.dir : null
  const right = className?.includes('text-right')
  const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown

  return (
    <th className={className} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button
        type="button"
        onClick={() => sorting.cycle(column)}
        title={dir === 'asc' ? 'Sorted ascending — click for descending' : dir === 'desc' ? 'Sorted descending — click for the default order' : 'Sort by this column'}
        className={cn(
          'group/sort inline-flex items-center gap-1 rounded font-medium hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
          right && 'flex-row-reverse',
        )}
      >
        {children}
        <Icon className={cn('w-3.5 h-3.5 shrink-0', dir ? 'text-[hsl(var(--primary))]' : 'opacity-0 group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50')} />
      </button>
    </th>
  )
}
