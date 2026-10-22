import { useState } from 'react'
import { useHotkeys } from '@/hooks/useHotkeys'
import type { GroupedView } from '@/hooks/useRowGrouping'

interface Options<T> {
  items: T[]
  /** `useGroupedRows`'s view: the arrows then walk its rows (group headers included) and
   * `activeIndex` indexes `view.rows`, as rendered by `groupedRows`. */
  view?: GroupedView<T>
  onView: (item: T) => void
  onEdit?: (item: T) => void
  onDelete?: (item: T) => void
  canEdit?: boolean
  canDelete?: boolean
  /** disable row navigation, e.g. while a dialog is open */
  enabled?: boolean
}

/** Arrow-key row navigation for list/table pages: ↑↓ to move, Enter to view,
 * "e" to edit, Delete to delete — QuickBooks-style keyboard-first browsing.
 * On a group header (row grouping): Enter or → expands (Shift+Enter: every nested
 * level too), ← collapses; on an expanded group → steps into it, and on a row or a
 * collapsed group ← steps out to its parent group. */
export function useListKeyboardNav<T>({ items, view, onView, onEdit, onDelete, canEdit, canDelete, enabled = true }: Options<T>) {
  const [rawIndex, setRawIndex] = useState(-1)
  const count = view ? view.rows.length : items.length
  // Clamp during render rather than via an effect — the index only ever needs
  // to be valid for the *current* rows, never stored out of range.
  const activeIndex = count === 0 ? -1 : Math.min(rawIndex, count - 1)

  const activeRow = view?.rows[activeIndex]
  const group = activeRow?.type === 'group' ? activeRow : null
  const activeItem: T | undefined = view
    ? (activeRow?.type === 'item' ? activeRow.item : undefined)
    : items[activeIndex]

  function toParent() {
    const parentKey = activeRow?.parentKey
    if (!view || !parentKey) return
    for (let i = activeIndex - 1; i >= 0; i--) {
      const r = view.rows[i]
      if (r.type === 'group' && r.key === parentKey) return setRawIndex(i)
    }
  }

  useHotkeys([
    { key: 'ArrowDown', handler: () => setRawIndex(Math.min(activeIndex + 1, count - 1)) },
    { key: 'ArrowUp', handler: () => setRawIndex(Math.max(activeIndex - 1, 0)) },
    { key: 'Escape', handler: () => setRawIndex(-1) },
    {
      key: 'Enter',
      handler: e => {
        if (group) view!.toggle(group.key, e.shiftKey)
        else if (activeItem !== undefined) onView(activeItem)
      },
    },
    ...(view?.grouped ? [
      {
        key: 'ArrowRight',
        handler: () => {
          if (!group) return
          if (group.expanded) setRawIndex(activeIndex + 1)
          else view.toggle(group.key)
        },
      },
      {
        key: 'ArrowLeft',
        handler: () => {
          if (group?.expanded) view.toggle(group.key)
          else toParent()
        },
      },
    ] : []),
    {
      key: 'e',
      handler: () => { if (canEdit && onEdit && activeItem !== undefined) onEdit(activeItem) },
    },
    {
      key: 'Delete',
      handler: () => { if (canDelete && onDelete && activeItem !== undefined) onDelete(activeItem) },
    },
  ], enabled && count > 0)

  return { activeIndex, setActiveIndex: setRawIndex }
}
