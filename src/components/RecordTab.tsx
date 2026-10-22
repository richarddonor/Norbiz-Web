import { useEffect, useRef, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useWorkspace, useTabInstance } from '@/context/WorkspaceContext'
import type { RecordStatus } from '@/hooks/useRecordTab'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/** Page-width frame for a record form inside its tab. Also names the tab, and makes
 * Esc close it (through the same dirty-guarded path as the tab's ×). */
export function RecordSheet({ title, status = 'ready', onRequestClose, className, children }: {
  title: string
  status?: RecordStatus
  onRequestClose: () => void
  className?: string
  children: ReactNode
}) {
  const tab = useTabInstance()
  const { setTabTitle } = useWorkspace()

  useEffect(() => {
    if (title) setTabTitle(tab.key, title)
  }, [title, tab.key, setTabTitle])

  const closeRef = useRef(onRequestClose)
  useEffect(() => {
    closeRef.current = onRequestClose
  })

  useEffect(() => {
    if (!tab.active) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // A modal (reset password, command palette, …) owns Escape while it's open.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      e.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tab.active])

  if (status === 'missing') {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-1 text-sm text-[hsl(var(--muted-foreground))]">
        <span className="font-medium text-[hsl(var(--foreground))]">This record could not be found.</span>
        It may have been deleted, or it belongs to a company you're not currently working in.
      </div>
    )
  }
  if (status === 'loading') {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }
  // Fills the tab's height (and stretches the form inside it) so a short form's
  // RECORD_ACTIONS bar still lands at the bottom of the tab instead of mid-page.
  return (
    <div className={cn('mx-auto flex min-h-full w-full max-w-4xl flex-col [&>*]:flex [&>*]:flex-1 [&>*]:flex-col', className)}>
      {children}
    </div>
  )
}

/** Class for a record form's action-button bar — anchored to the bottom of the tab
 * (pinned while the form scrolls, pushed down when it's short), so Save/Post is always
 * one click (or Enter) away and nothing scrolls past it. */
export const RECORD_ACTIONS =
  'sticky bottom-0 z-20 mt-auto flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))]/85 py-3 backdrop-blur'

/** A Close/Cancel button with the Esc hint — RecordSheet (and a Dialog) already wires Esc
 * to the same close path. Pass the page's dirty-guarded `requestClose`. */
export function CloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: 'Close' | 'Cancel' }) {
  return (
    <Button type="button" variant="outline" onClick={onClick}>
      {label}
      <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">Esc</kbd>
    </Button>
  )
}
