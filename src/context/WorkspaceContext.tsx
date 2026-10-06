import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { navItems, findNavItem, findRecordBase, findReport } from '@/lib/nav'

/** What a record tab was asked to do when it was opened (or re-requested from the list).
 * Travels as the tab's `location.state`, so it also survives a browser refresh. */
export interface RecordRequest {
  mode?: string
  record?: unknown
  /** Changes on every open request, so an already-open tab can tell a fresh request
   * (e.g. the list's Edit button) from merely being switched back to. */
  nonce?: number
  /** Set by `openPage`: show this page in its own tab instead of the main tab. */
  ownTab?: boolean
  /** Set by `openPage` for a drill-down (a report opened with filters from another report):
   * it gets a tab of its own, keyed by its full URL, and its filters are locked. */
  drillDown?: boolean
}

export interface TabLocation {
  pathname: string
  search: string
  state: RecordRequest | null
}

export interface WorkspaceTab {
  /** `'main'` for the module page (list/report); the record's — or a page opened via
   * `openPage` — pathname otherwise. A drill-down report tab is keyed by its pathname plus
   * query, so the same report can be open several times with different (locked) filters. */
  key: string
  location: TabLocation
  title: string
  /** Record tabs mount lazily — a tab restored from the previous session only renders
   * (and fetches its data) once the user actually switches to it. */
  mounted: boolean
}

export const MAIN_TAB = 'main'

interface WorkspaceValue {
  tabs: WorkspaceTab[]
  activeKey: string
  activate: (key: string) => void
  /** Closes the tab unconditionally — call after a successful save, or from inside a
   * tab's own close handler once the user has confirmed discarding changes. */
  closeTab: (key: string) => void
  /** Closes the tab the way the user asked to (tab ×, Alt+W): routes through the tab's
   * registered close handler so unsaved changes are confirmed first. */
  requestCloseTab: (key: string) => void
  /** Requests closing every record tab, each through its own guarded close handler — a
   * tab with unsaved changes whose discard the user declines stays open. */
  requestCloseAllTabs: () => void
  setTabTitle: (key: string, title: string) => void
  registerCloseHandler: (key: string, handler: (() => void) | null) => void
  openRecord: (pathname: string, request: Omit<RecordRequest, 'nonce'>) => void
  /** Opens a page (list, report, dashboard…) in its own tab. Without a query, a tab already
   * showing the page — its own tab or the main tab — is just switched to, keeping its filters.
   * With a query it's a report drill-down: it opens in another tab of its own with those
   * filters locked — or switches to the drill-down tab already open for that exact query. */
  openPage: (to: string) => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}

function toTabLocation(loc: { pathname: string; search: string; state: unknown }): TabLocation {
  return { pathname: loc.pathname, search: loc.search, state: (loc.state as RecordRequest | null) ?? null }
}

function sameLocation(a: TabLocation, b: TabLocation) {
  return a === b || (a.pathname === b.pathname && a.search === b.search && a.state === b.state)
}

function defaultTitle(pathname: string, request: RecordRequest | null): string {
  const report = findReport(pathname)
  if (report) return request?.drillDown ? `${report.label} (Drill-down)` : report.label
  const base = findRecordBase(pathname)
  if (!base) return findNavItem(pathname)?.label ?? 'Record'
  const tail = pathname.slice(base.to.length + 1)
  if (tail === 'new') return `New ${base.recordLabel ?? base.label}`
  if (tail.endsWith('/design')) return 'Template Designer'
  const record = request?.record as Record<string, unknown> | undefined
  const name = record && (record.referenceNumber ?? record.name ?? record.code ?? record.username)
  return `${base.recordLabel ?? base.label} ${typeof name === 'string' ? name : `#${tail}`}`
}

interface StoredTabs {
  /** Where the module tab was, so a refresh on a record tab doesn't reset it to Home. */
  main?: { pathname: string; search: string }
  tabs: { key: string; location: TabLocation; title: string }[]
}

function storageKey(username: string | null) {
  return `workspace_tabs:${username ?? ''}`
}

const HOME: TabLocation = { pathname: navItems[0].to, search: '', state: null }

function loadStoredTabs(username: string | null): WorkspaceTab[] {
  let stored: StoredTabs = { tabs: [] }
  try {
    const raw = sessionStorage.getItem(storageKey(username))
    if (raw) stored = JSON.parse(raw) as StoredTabs
  } catch {
    // Unreadable storage — start with just the module tab.
  }
  const main = stored.main ? { ...stored.main, state: null } : HOME
  return [
    { key: MAIN_TAB, location: main, title: '', mounted: true },
    ...stored.tabs
      .filter(t => findRecordBase(t.location.pathname) || findNavItem(t.location.pathname))
      .map(t => ({ ...t, mounted: false })),
  ]
}

/** Owns the open workspace tabs and keeps them in step with the URL: the URL always
 * shows the active tab, so a sidebar click or the browser's Back button "just works" —
 * a record path opens/activates its tab, a page with a tab of its own (`openPage`)
 * activates that tab, and any other path is shown in the main tab. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { username } = useAuth()

  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => loadStoredTabs(username))
  const [activeKey, setActiveKey] = useState(MAIN_TAB)
  // Most-recently-activated first — closing a tab returns to whichever tab the user
  // was on before it, like a browser, rather than always jumping back to the list.
  const history = useRef<string[]>([MAIN_TAB])
  const closeHandlers = useRef(new Map<string, () => void>())
  // While `requestCloseAllTabs` runs, `closeTab` only collects keys so all the tabs are
  // removed (and the URL moved) once at the end, not one stale-state update per tab.
  const closingBatch = useRef<Set<string> | null>(null)

  // Sync tabs to the URL — adjusted during render (this project's convention for
  // derived state) rather than an effect, so the right panel shows on the first paint.
  const [syncedKey, setSyncedKey] = useState<string | null>(null)
  if (location.key !== syncedKey) {
    setSyncedKey(location.key)
    const loc = toTabLocation(location)
    const isRecord = !!findRecordBase(loc.pathname)
    const fullPath = loc.pathname + loc.search
    const active = tabs.find(t => t.key === activeKey)
    // A page gets its own tab when opened via `openPage`; once it has one, any other way of
    // reaching it (sidebar, Back) switches to that tab rather than duplicating it. A report
    // drill-down gets a further tab per query. A page rewriting its own URL (e.g. a report
    // saving its filters before drilling down) stays in the tab it's in.
    const pageKey = isRecord ? null
      : loc.state?.drillDown ? tabs.find(t => t.location.state?.nonce === loc.state?.nonce)?.key ?? fullPath
      : loc.state?.ownTab ? loc.pathname
      : active && active.location.pathname === loc.pathname ? active.key
      : tabs.some(t => t.key === fullPath) ? fullPath
      : tabs.some(t => t.key === loc.pathname) ? loc.pathname
      : null
    const isPageTab = pageKey !== null && pageKey !== MAIN_TAB
    const key = isRecord ? loc.pathname : pageKey ?? MAIN_TAB
    setTabs(prev => {
      const existing = prev.find(t => t.key === key)
      if (!existing) {
        return [...prev, { key, location: loc, title: defaultTitle(loc.pathname, loc.state), mounted: true }]
      }
      const freshRequest = isRecord && loc.state?.nonce !== undefined && loc.state.nonce !== existing.location.state?.nonce
      // A page tab follows its URL (filters it writes to the query), but keeps its request
      // nonce unless given a new one — a new nonce remounts the page (see TabPanel).
      const next = isPageTab
        ? { ...loc, state: loc.state?.nonce !== undefined ? loc.state : existing.location.state }
        : !isRecord || freshRequest ? loc : existing.location
      if (sameLocation(next, existing.location) && existing.mounted) return prev
      return prev.map(t => (t.key === key ? { ...t, location: next, mounted: true } : t))
    })
    setActiveKey(key)
  }

  useEffect(() => {
    history.current = [activeKey, ...history.current.filter(k => k !== activeKey)]
  }, [activeKey])

  useEffect(() => {
    try {
      const main = tabs.find(t => t.key === MAIN_TAB)!.location
      const stored: StoredTabs = {
        main: { pathname: main.pathname, search: main.search },
        // The record snapshot is deliberately dropped: a restored tab refetches the record,
        // so it never resurrects stale data (e.g. a PO that was voided since).
        tabs: tabs.filter(t => t.key !== MAIN_TAB).map(({ key, location, title }) => ({
          key,
          title,
          location: {
            ...location,
            state: location.state && { mode: location.state.mode, nonce: location.state.nonce, drillDown: location.state.drillDown },
          },
        })),
      }
      sessionStorage.setItem(storageKey(username), JSON.stringify(stored))
    } catch {
      // Storage full/unavailable — tabs just won't survive a refresh.
    }
  }, [tabs, username])

  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  })

  const goTo = useCallback((tab: WorkspaceTab) => {
    const { pathname, search, state } = tab.location
    navigate(pathname + search, { state })
  }, [navigate])

  const activate = useCallback((key: string) => {
    const tab = tabsRef.current.find(t => t.key === key)
    if (tab) goTo(tab)
  }, [goTo])

  const closeTab = useCallback((key: string) => {
    if (key === MAIN_TAB) return
    closeHandlers.current.delete(key)
    if (closingBatch.current) {
      closingBatch.current.add(key)
      return
    }
    const remaining = tabsRef.current.filter(t => t.key !== key)
    setTabs(remaining)
    if (key === activeKey) {
      const nextKey = history.current.find(k => k !== key && remaining.some(t => t.key === k)) ?? MAIN_TAB
      const next = remaining.find(t => t.key === nextKey)!
      goTo(next)
    }
  }, [activeKey, goTo])

  const requestCloseTab = useCallback((key: string) => {
    const handler = closeHandlers.current.get(key)
    if (handler) handler()
    else closeTab(key)
  }, [closeTab])

  const requestCloseAllTabs = useCallback(() => {
    const batch = new Set<string>()
    closingBatch.current = batch
    try {
      for (const tab of tabsRef.current) {
        if (tab.key !== MAIN_TAB) requestCloseTab(tab.key)
      }
    } finally {
      closingBatch.current = null
    }
    if (batch.size === 0) return
    const remaining = tabsRef.current.filter(t => !batch.has(t.key))
    setTabs(remaining)
    if (batch.has(activeKey)) {
      const nextKey = history.current.find(k => remaining.some(t => t.key === k)) ?? MAIN_TAB
      goTo(remaining.find(t => t.key === nextKey)!)
    }
  }, [activeKey, goTo, requestCloseTab])

  const setTabTitle = useCallback((key: string, title: string) => {
    setTabs(prev => (prev.some(t => t.key === key && t.title !== title)
      ? prev.map(t => (t.key === key ? { ...t, title } : t))
      : prev))
  }, [])

  const registerCloseHandler = useCallback((key: string, handler: (() => void) | null) => {
    if (handler) closeHandlers.current.set(key, handler)
    else closeHandlers.current.delete(key)
  }, [])

  const openRecord = useCallback((pathname: string, request: Omit<RecordRequest, 'nonce'>) => {
    navigate(pathname, { state: { ...request, nonce: Date.now() } satisfies RecordRequest })
  }, [navigate])

  const openPage = useCallback((to: string) => {
    const [pathname, search = ''] = to.split('?')
    const key = search ? `${pathname}?${search}` : pathname
    const open = tabsRef.current.find(t => t.key === key)
      ?? (search ? undefined : tabsRef.current.find(t => t.key === MAIN_TAB && t.location.pathname === pathname))
    if (open) activate(open.key)
    else navigate(to, { state: { ownTab: true, drillDown: !!search || undefined, nonce: Date.now() } satisfies RecordRequest })
  }, [activate, navigate])

  const value = useMemo<WorkspaceValue>(() => ({
    tabs, activeKey, activate, closeTab, requestCloseTab, requestCloseAllTabs, setTabTitle, registerCloseHandler, openRecord, openPage,
  }), [tabs, activeKey, activate, closeTab, requestCloseTab, requestCloseAllTabs, setTabTitle, registerCloseHandler, openRecord, openPage])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

/** Per-panel context: which tab a page instance is rendered in. */
export interface TabInstance {
  key: string
  isRecord: boolean
  active: boolean
  location: TabLocation
}

export const TabInstanceContext = createContext<TabInstance>({
  key: MAIN_TAB,
  isRecord: false,
  active: true,
  location: HOME,
})

export function useTabInstance() {
  return useContext(TabInstanceContext)
}

/** True when this page is a drill-down report tab — its filters came from another report and
 * are locked, so the tab keeps showing what it was opened for. */
export function useIsDrillDown() {
  return !!useTabInstance().location.state?.drillDown
}
