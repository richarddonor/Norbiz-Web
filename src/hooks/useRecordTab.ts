import { useEffect, useRef, useState } from 'react'
import { useWorkspace, useTabInstance } from '@/context/WorkspaceContext'
import { findRecordBase } from '@/lib/nav'

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
   * or a tab restored from a previous session that predates its stored payload. Also
   * re-loads a viewed record whenever its tab becomes active: the list row it was opened
   * with may be a summary (no lines), and other documents change it while the tab sits
   * open (a deposit clears a payment's cash). */
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
  const { openRecord, closeTab, registerCloseHandler, activeKey } = useWorkspace()
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

  // Refresh a viewed record from the server when its tab is shown (including right after it
  // is first seeded). Skipped while editing so an in-progress form is never clobbered.
  const active = tab.isRecord && activeKey === tab.key
  useEffect(() => {
    if (!active || status !== 'ready' || recordId === null || recordId === 'new') return
    const { fetchRecord: fetcher } = latest.current
    if (!fetcher || latest.current.mode !== 'view') return
    let cancelled = false
    fetcher(recordId)
      .then(record => { if (!cancelled && latest.current.mode === 'view') latest.current.onOpen.view(record) })
      .catch(() => { /* keep showing what we have */ })
    return () => { cancelled = true }
  }, [active, status, recordId])

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
