import { createContext, useContext } from 'react'
import { navItems } from '@/lib/nav'

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

/** Where the main tab starts: the first nav entry. */
export const HOME: TabLocation = { pathname: navItems[0].to, search: '', state: null }

export interface WorkspaceValue {
  tabs: WorkspaceTab[]
  activeKey: string
  /** Tabs playing their close animation (src/theme/motion.ts): no longer active, still on screen until it ends. */
  closingKeys: ReadonlySet<string>
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

export const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ctx
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
