import { useState } from 'react'
import { useHotkeys } from '@/hooks/useHotkeys'

interface Options<T> {
  items: T[]
  onView: (item: T) => void
  onEdit?: (item: T) => void
  onDelete?: (item: T) => void
  canEdit?: boolean
  canDelete?: boolean
  /** disable row navigation, e.g. while a dialog is open */
  enabled?: boolean
}

/** Arrow-key row navigation for list/table pages: ↑↓ to move, Enter to view,
 * "e" to edit, Delete to delete — QuickBooks-style keyboard-first browsing. */
export function useListKeyboardNav<T>({ items, onView, onEdit, onDelete, canEdit, canDelete, enabled = true }: Options<T>) {
  const [rawIndex, setRawIndex] = useState(-1)
  // Clamp during render rather than via an effect — the index only ever needs
  // to be valid for the *current* items array, never stored out of range.
  const activeIndex = items.length === 0 ? -1 : Math.min(rawIndex, items.length - 1)

  useHotkeys([
    { key: 'ArrowDown', handler: () => setRawIndex(Math.min(activeIndex + 1, items.length - 1)) },
    { key: 'ArrowUp', handler: () => setRawIndex(Math.max(activeIndex - 1, 0)) },
    { key: 'Escape', handler: () => setRawIndex(-1) },
    {
      key: 'Enter',
      handler: () => { if (activeIndex >= 0 && items[activeIndex]) onView(items[activeIndex]) },
    },
    {
      key: 'e',
      handler: () => { if (canEdit && onEdit && activeIndex >= 0 && items[activeIndex]) onEdit(items[activeIndex]) },
    },
    {
      key: 'Delete',
      handler: () => { if (canDelete && onDelete && activeIndex >= 0 && items[activeIndex]) onDelete(items[activeIndex]) },
    },
  ], enabled && items.length > 0)

  return { activeIndex, setActiveIndex: setRawIndex }
}
