import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useWorkspace, useTabInstance } from '@/context/WorkspaceContext'
import { findRecordBase } from '@/lib/nav'
import { cn } from '@/lib/utils'

type OpenMode = 'view' | 'edit' | 'create'
export type RecordStatus = 'loading' | 'ready' | 'missing'

interface Options<T> {
  /** The page's current form mode — lets an already-open view tab switch to edit when the
   * list's Edit action re-requests it, without ever clobbering an in-progress edit. */
  mode: string
  /** The page's existing `openView` / `openEdit` / `openCreate` functions — called inside the
   * record tab to seed the form, exactly as they used to be called to open the dialog. */
  onOpen: { view: (record: T) => void; edit?: (record: T) => void; create?: () => void }
  /** The page's guarded close (dirty check → `rec.close()`); used by the tab's ×, Alt+W and Esc. */
  onRequestClose: () => void
  /** Loads the record by id when the tab was opened without one in hand — a pasted URL,
   * or a tab restored from a previous session that predates its stored payload. */
  fetchRecord?: (id: string) => Promise<T>
}

/** True when this page instance is rendered inside a record tab rather than the list tab. */
export function useIsRecordTab() {
  return useTabInstance().isRecord
}

/** Turns a list page's view/create/edit dialog into workspace tabs. The *same* page
 * component is rendered twice: once in the main tab (list; `isRecordTab` false — its
 * `openView`/`openEdit`/`openCreate` should just call `rec.open(...)`), and once per open
 * record at `<module>/<id>` or `<module>/new` (`isRecordTab` true — this hook calls those
 * same open functions to seed the form, and `rec.close()` replaces `setOpen(false)`). */
export function useRecordTab<T>({ mode, onOpen, onRequestClose, fetchRecord }: Options<T>) {
  const tab = useTabInstance()
  const { openRecord, closeTab, registerCloseHandler } = useWorkspace()
  const base = findRecordBase(tab.location.pathname)
  const recordId = tab.isRecord && base ? tab.location.pathname.slice(base.to.length + 1) : null
  const [status, setStatus] = useState<RecordStatus>('loading')

  const latest = useRef({ mode, onOpen, onRequestClose, fetchRecord })
  useEffect(() => {
    latest.current = { mode, onOpen, onRequestClose, fetchRecord }
  })

  useEffect(() => {
    if (!tab.isRecord) return
    registerCloseHandler(tab.key, () => latest.current.onRequestClose())
    return () => registerCloseHandler(tab.key, null)
  }, [tab.isRecord, tab.key, registerCloseHandler])

  // Seed the form on first mount, then honour later requests (the list's Edit button
  // on a record whose tab is already open in view mode).
  const request = tab.location.state
  const handledNonce = useRef<number | undefined | null>(null)
  useEffect(() => {
    if (!tab.isRecord || recordId === null) return
    const nonce = request?.nonce
    const first = handledNonce.current === null
    if (!first && nonce === handledNonce.current) return
    handledNonce.current = nonce
    const { onOpen: handlers, fetchRecord: fetcher } = latest.current

    if (recordId === 'new') {
      if (first) {
        handlers.create?.()
        // Seeding the form from the tab's open request is inherently a mount-time effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStatus('ready')
      }
      return
    }
    const requestedMode = (request?.mode as OpenMode | undefined) ?? 'view'
    if (!first) {
      if (requestedMode === 'edit' && latest.current.mode === 'view' && request?.record) handlers.edit?.(request.record as T)
      return
    }
    const apply = (record: T) => {
      const open = requestedMode === 'edit' && handlers.edit ? handlers.edit : handlers.view
      open(record)
      setStatus('ready')
    }
    if (request?.record) apply(request.record as T)
    else if (fetcher) fetcher(recordId).then(apply).catch(() => setStatus('missing'))
    else setStatus('missing')
  }, [tab.isRecord, recordId, request])

  return {
    isRecordTab: tab.isRecord,
    /** `'loading'` until the form has been seeded — `RecordSheet` shows a spinner meanwhile. */
    status,
    open(openMode: OpenMode, record?: T & { id: number | string }) {
      // In the list tab, the module root is simply the list's own path.
      const root = base ? base.to : tab.location.pathname
      const path = openMode === 'create' || !record ? `${root}/new` : `${root}/${record.id}`
      openRecord(path, { mode: openMode, record })
    },
    /** Closes this record tab without asking — for after a successful save. */
    close() {
      if (tab.isRecord) closeTab(tab.key)
    },
  }
}

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
