import { memo, useEffect, useMemo, useRef } from 'react'
import { X, XSquare, Home } from 'lucide-react'
import { useWorkspace, TabInstanceContext, MAIN_TAB, type WorkspaceTab, type TabInstance } from '@/context/WorkspaceContext'
import { findNavItem, findRecordBase } from '@/lib/nav'
import { PageRoutes } from '@/routes'
import { cn } from '@/lib/utils'

function tabMeta(tab: WorkspaceTab) {
  if (tab.key === MAIN_TAB) {
    const item = findNavItem(tab.location.pathname)
    return { icon: item?.icon ?? Home, title: item?.label ?? 'Home' }
  }
  return { icon: findRecordBase(tab.location.pathname)?.icon ?? Home, title: tab.title }
}

/** Alt+1…9 jumps to a tab (Alt+1 is always the module/list tab), Alt+W closes the
 * current record tab, Alt+Shift+W closes every record tab. Matched on `e.code` so it works on macOS, where Option+digit
 * produces a symbol in `e.key`. Deliberately not Ctrl+W/Ctrl+Tab — browsers reserve those. */
function useTabShortcuts() {
  const { tabs, activeKey, activate, requestCloseTab, requestCloseAllTabs } = useWorkspace()
  const latest = useRef({ tabs, activeKey, activate, requestCloseTab, requestCloseAllTabs })
  useEffect(() => {
    latest.current = { tabs, activeKey, activate, requestCloseTab, requestCloseAllTabs }
  })

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const { tabs, activeKey, activate, requestCloseTab, requestCloseAllTabs } = latest.current
      if (e.code === 'KeyW' && e.shiftKey) {
        if (tabs.length > 1) {
          e.preventDefault()
          requestCloseAllTabs()
        }
        return
      }
      const digit = /^Digit([1-9])$/.exec(e.code)
      if (digit) {
        const tab = tabs[Number(digit[1]) - 1]
        if (tab) {
          e.preventDefault()
          activate(tab.key)
        }
      } else if (e.code === 'KeyW' && activeKey !== MAIN_TAB) {
        e.preventDefault()
        requestCloseTab(activeKey)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

export function WorkspaceTabBar() {
  const { tabs, activeKey, activate, requestCloseTab, requestCloseAllTabs } = useWorkspace()
  useTabShortcuts()

  // Only the module tab — no strip needed until a record is opened.
  if (tabs.length === 1) return null

  return (
    <div className="flex shrink-0 items-end border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div
        role="tablist"
        aria-label="Open records"
        className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-4 pt-1.5"
      >
        {tabs.map((tab, i) => {
          const { icon: Icon, title } = tabMeta(tab)
          const active = tab.key === activeKey
          const closable = tab.key !== MAIN_TAB
          return (
            <div
              key={tab.key}
              role="tab"
              aria-selected={active}
              tabIndex={-1}
              title={`${title}${i < 9 ? `  (Alt+${i + 1})` : ''}`}
              onClick={() => activate(tab.key)}
              onAuxClick={e => { if (e.button === 1 && closable) { e.preventDefault(); requestCloseTab(tab.key) } }}
              className={cn(
                'group relative -mb-px flex h-9 max-w-56 shrink-0 cursor-pointer select-none items-center gap-2 rounded-t-lg border border-b-0 px-3 text-sm transition-colors',
                active
                  ? 'border-[hsl(var(--border))] bg-[hsl(var(--background))] font-medium text-[hsl(var(--foreground))]'
                  : 'border-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]'
              )}
            >
              {active && <span className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-[hsl(var(--primary))]" aria-hidden />}
              <Icon className={cn('h-4 w-4 shrink-0', active && 'text-[hsl(var(--primary))]')} />
              <span className="truncate">{title}</span>
              {closable && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Close ${title}`}
                  onClick={e => { e.stopPropagation(); requestCloseTab(tab.key) }}
                  className="-mr-1 rounded p-0.5 opacity-60 hover:bg-[hsl(var(--foreground))]/10 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        tabIndex={-1}
        title="Close all record tabs  (Alt+Shift+W)"
        onClick={requestCloseAllTabs}
        className="mb-1 mr-3 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]"
      >
        <XSquare className="h-3.5 w-3.5" />
        Close all
      </button>
    </div>
  )
}

const FOCUSABLE = 'input:not([readonly]):not([disabled]), select, textarea, button[role="combobox"], button:not([disabled])'

/** One tab's page, kept mounted while hidden so its unsaved form state, scroll position
 * and list filters are all still there when the user switches back. */
const TabPanel = memo(function TabPanel({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const isRecord = tab.key !== MAIN_TAB
  const value = useMemo<TabInstance>(
    () => ({ key: tab.key, isRecord, active, location: tab.location }),
    [tab.key, isRecord, active, tab.location]
  )
  const ref = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)
  const wasActive = useRef(active)

  // Put the cursor back where it was when returning to a record tab; on the list tab,
  // leave focus on the page itself so ↑↓/Enter row navigation works immediately.
  useEffect(() => {
    const becameActive = active && !wasActive.current
    wasActive.current = active
    if (!becameActive) return
    requestAnimationFrame(() => {
      if (!isRecord) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        return
      }
      const target = lastFocused.current?.isConnected ? lastFocused.current : ref.current?.querySelector<HTMLElement>(FOCUSABLE)
      target?.focus()
    })
  }, [active, isRecord])

  return (
    <TabInstanceContext.Provider value={value}>
      <div
        ref={ref}
        role="tabpanel"
        hidden={!active}
        onFocus={e => { lastFocused.current = e.target as HTMLElement }}
        // Record tabs drop the bottom padding so the form's action bar sits flush against
        // the bottom edge — nothing scrolls past it.
        className={cn('absolute inset-0 overflow-y-auto p-6', isRecord && 'pb-0')}
      >
        <PageRoutes location={tab.location} />
      </div>
    </TabInstanceContext.Provider>
  )
})

export function WorkspacePanels() {
  const { tabs, activeKey } = useWorkspace()
  return (
    <div className="relative flex-1 min-h-0 bg-[hsl(var(--background))]">
      {tabs.filter(t => t.mounted).map(tab => (
        <TabPanel key={tab.key} tab={tab} active={tab.key === activeKey} />
      ))}
    </div>
  )
}
