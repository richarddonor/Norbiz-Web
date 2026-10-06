import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Pins a column to the left edge while the table scrolls sideways — put it on that
 * column's header `<th>`. The body cell uses `PINNED_TD`; the filter row takes `pinnedKey`. */
export const PINNED_TH = 'sticky left-0 z-10 bg-[hsl(var(--card))] shadow-[1px_0_0_hsl(var(--border))]'
/** Body-cell half of `PINNED_TH`. It inherits the row's background (so rows need an explicit
 * `bg-[hsl(var(--card))]` for hover/active to show through) and redraws the active row's ring,
 * which the opaque cell would otherwise cover. The row needs `group` and `data-active`. */
export const PINNED_TD = 'sticky left-0 z-10 bg-inherit shadow-[1px_0_0_hsl(var(--border))] group-data-active:shadow-[inset_0_1px_0_hsl(var(--primary)),inset_0_-1px_0_hsl(var(--primary)),1px_0_0_hsl(var(--border))]'

interface Props {
  /** The keyboard-selected row (`useListKeyboardNav`), kept in view as it moves. */
  activeIndex?: number
  className?: string
  children: ReactNode
}

/** A list/report table that scrolls inside its own box, both ways, with a sticky header
 * (column titles + filter row). Cells don't wrap. Put it in a height-bounded flex column —
 * page `flex h-full flex-col`, Card and CardContent `flex min-h-0 flex-col` — so it shrinks to
 * the viewport and both scrollbars stay on screen instead of below 50 rows of page. */
export function ScrollTable({ activeIndex = -1, className, children }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)

  // Scroll vertically only: a row is wider than the box, so scrollIntoView would also jump
  // sideways. The sticky header covers the top of the box, hence the offset.
  useEffect(() => {
    const box = boxRef.current
    const table = box?.querySelector('table')
    const row = table?.tBodies[0]?.rows[activeIndex]
    if (!box || !table || !row) return
    const headerHeight = table.tHead?.offsetHeight ?? 0
    if (row.offsetTop - headerHeight < box.scrollTop) box.scrollTop = row.offsetTop - headerHeight
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight
  }, [activeIndex])

  return (
    <div ref={boxRef} className={cn('min-h-0 overflow-auto', className)}>
      <table
        className={cn(
          'w-full text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap',
          // Collapsed borders don't travel with a sticky header, so its bottom edge is a shadow.
          '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20 [&_thead]:bg-[hsl(var(--card))] [&_thead]:shadow-[0_1px_0_hsl(var(--border))]',
        )}
      >
        {children}
      </table>
    </div>
  )
}
