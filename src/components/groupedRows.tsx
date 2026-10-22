import type { ReactNode } from 'react'
import { GroupHeaderRow } from '@/components/RowGrouping'
import type { GroupedView } from '@/hooks/useRowGrouping'

interface RowOptions {
  /** the page's `useColumnVisibility` check — group headers line their subtotals up under the visible columns */
  isVisible: (key: string) => boolean
  activeIndex: number
  /** selects the row — the page's `setActiveIndex` */
  onActivate: (index: number) => void
}

/** Renders `view.rows`: group header rows from here, item rows from `renderItem` (the page's
 * existing row markup). Indexes match `useListKeyboardNav({ …, view })`'s `activeIndex`. */
export function groupedRows<T>(view: GroupedView<T>, { isVisible, activeIndex, onActivate }: RowOptions, renderItem: (item: T, index: number) => ReactNode) {
  const columns = view.columns.filter(c => isVisible(c.key))
  return view.rows.map((row, i) =>
    row.type === 'group' ? (
      <GroupHeaderRow
        key={row.key}
        row={row}
        columns={columns}
        active={i === activeIndex}
        onClick={recursive => { onActivate(i); view.toggle(row.key, recursive) }}
      />
    ) : (
      renderItem(row.item, i)
    ),
  )
}
