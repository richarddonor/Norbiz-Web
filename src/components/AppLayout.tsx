import { createContext, useContext, useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, LogOut, CircleUser, Search, KeyRound, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { navItems, canAccess, findNavItem } from '@/lib/nav'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { CommandPalette } from '@/components/CommandPalette'
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp'
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useHotkeys } from '@/hooks/useHotkeys'
import { WorkspaceProvider, useTabInstance } from '@/context/WorkspaceContext'
import { WorkspaceTabBar, WorkspacePanels } from '@/components/WorkspaceTabs'

/** `'inactive'` means the page is in a workspace tab the user isn't looking at. */
export type FocusZone = 'content' | 'sidebar' | 'inactive'

const LayoutZoneContext = createContext<FocusZone>('content')

/** Pages read this to know whether they currently own keyboard input — not while the
 * sidebar has arrow-key focus, and not while their tab is hidden behind another one —
 * so they can suspend their hotkeys and row navigation otherwise. */
export function useContentFocus(): { zone: FocusZone } {
  const zone = useContext(LayoutZoneContext)
  const { active } = useTabInstance()
  return { zone: active ? zone : 'inactive' }
}

const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed'

/** The saved choice, else collapsed on a narrow window (where every column counts). */
function initialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (saved !== null) return saved === 'true'
  } catch { /* storage blocked: fall through to the default */ }
  return window.innerWidth < 1280
}

const SIDEBAR_ICON_BUTTON = 'grid h-8 w-8 shrink-0 place-items-center rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] transition-colors'

interface SidebarEntry {
  key: string
  type: 'link' | 'group'
  label: string
  to?: string
}

export function AppLayout() {
  return (
    <WorkspaceProvider>
      <Workspace />
    </WorkspaceProvider>
  )
}

function Workspace() {
  const { logout, hasPermission, displayName, username } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [zone, setZone] = useState<FocusZone>('content')
  const [rawSidebarIndex, setRawSidebarIndex] = useState(0)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)) } catch { /* not persisted */ }
  }

  // Reset to the content zone on every navigation (mouse or keyboard) —
  // adjusted during render rather than an effect, per this project's convention.
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setZone('content')
  }

  useHotkeys([
    { key: 'k', mod: true, allowInInputs: true, handler: () => setPaletteOpen(true) },
    { key: '?', handler: () => setShortcutsOpen(true) },
    { key: 'b', mod: true, allowInInputs: true, handler: toggleSidebar },
  ])

  const topLevelItems = useMemo(() => navItems.filter(item => !item.group), [])
  const groups = useMemo(() => {
    const order: string[] = []
    for (const item of navItems) {
      if (item.group && !order.includes(item.group)) order.push(item.group)
    }
    // Items with a `parent` (individual reports) are listed on that parent's page, not here.
    return order.map(group => ({
      group,
      items: navItems.filter(item => item.group === group && !item.parent && canAccess(item, hasPermission)),
    })).filter(g => g.items.length > 0)
  }, [hasPermission])

  // The sidebar link for the current page — its parent's when the page itself isn't listed.
  const sidebarPath = findNavItem(pathname)?.parent ?? pathname

  function isGroupOpen(key: string) {
    return openGroups[key] ?? true
  }

  // Flattened, visible sidebar entries in visual order — used for ↑↓ traversal.
  const sidebarEntries = useMemo(() => {
    const entries: SidebarEntry[] = topLevelItems.map(item => ({ key: item.to, type: 'link', label: item.label, to: item.to }))
    for (const { group, items } of groups) {
      entries.push({ key: `group:${group}`, type: 'group', label: group })
      if (openGroups[group] ?? true) {
        for (const item of items) {
          entries.push({ key: item.to, type: 'link', label: item.label, to: item.to })
        }
      }
    }
    return entries
  }, [topLevelItems, groups, openGroups])

  const sidebarActiveIndex = sidebarEntries.length === 0 ? -1 : Math.min(rawSidebarIndex, sidebarEntries.length - 1)

  useHotkeys([
    {
      key: 'ArrowLeft',
      handler: () => {
        const idx = sidebarEntries.findIndex(e => e.type === 'link' && e.to === sidebarPath)
        setRawSidebarIndex(idx >= 0 ? idx : 0)
        setZone('sidebar')
      },
    },
  ], zone === 'content')

  useHotkeys([
    { key: 'ArrowRight', handler: () => setZone('content') },
    { key: 'Escape', handler: () => setZone('content') },
    { key: 'ArrowDown', handler: () => setRawSidebarIndex(i => Math.min(i + 1, sidebarEntries.length - 1)) },
    { key: 'ArrowUp', handler: () => setRawSidebarIndex(i => Math.max(i - 1, 0)) },
    {
      key: 'Enter',
      handler: () => {
        const entry = sidebarEntries[sidebarActiveIndex]
        if (!entry) return
        if (entry.type === 'group') {
          const groupKey = entry.key.slice('group:'.length)
          setOpenGroups(prev => ({ ...prev, [groupKey]: !(prev[groupKey] ?? true) }))
        } else if (entry.to) {
          navigate(entry.to)
        }
      },
    },
  ], zone === 'sidebar')

  function navLinkClass(to: string) {
    const focused = zone === 'sidebar' && sidebarEntries[sidebarActiveIndex]?.key === to
    return ({ isActive }: { isActive: boolean }) => cn(
      'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
      isActive || to === sidebarPath
        ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
        : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]',
      focused && 'ring-2 ring-inset ring-[hsl(var(--primary))]'
    )
  }

  function railLinkClass(to: string) {
    return ({ isActive }: { isActive: boolean }) => cn(
      'grid h-9 w-9 shrink-0 place-items-center rounded-md transition-colors',
      isActive || to === sidebarPath
        ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
        : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]',
    )
  }

  function groupHeaderClass(groupKey: string) {
    const focused = zone === 'sidebar' && sidebarEntries[sidebarActiveIndex]?.key === `group:${groupKey}`
    return cn(
      'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] transition-colors',
      focused && 'ring-2 ring-inset ring-[hsl(var(--primary))]'
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar. Collapsed, it's an icon rail; arrow-key focus (←) opens the full panel
          over the content until focus leaves it, since keyboard users need the labels. */}
      <aside
        className={cn(
          'relative shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--card))] transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        {collapsed && zone !== 'sidebar' ? (
          <div className="flex h-full flex-col items-center">
            <div className="flex w-full justify-center py-5 border-b border-[hsl(var(--border))]">
              <button
                onClick={toggleSidebar}
                title="Expand sidebar (Ctrl+B)"
                aria-label="Expand sidebar"
                className="grid h-7 w-7 place-items-center rounded-lg bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))] hover:opacity-90"
              >
                N
              </button>
            </div>

            <nav aria-label="Main" className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-4">
              {topLevelItems.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} title={label} aria-label={label} className={railLinkClass(to)}>
                  <Icon className="w-5 h-5" />
                </NavLink>
              ))}
              {groups.map(({ group, items }) => (
                <div key={group} role="group" aria-label={group} className="flex w-full flex-col items-center gap-1">
                  <div className="my-1.5 h-px w-6 bg-[hsl(var(--border))]" aria-hidden />
                  {items.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} title={`${group} › ${label}`} aria-label={label} className={railLinkClass(to)}>
                      <Icon className="w-5 h-5" />
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>

            <div className="flex w-full flex-col items-center gap-1 px-2 py-4 border-t border-[hsl(var(--border))]">
              <button
                onClick={toggleSidebar}
                title="Expand sidebar (Ctrl+B)"
                aria-label="Expand sidebar"
                className={SIDEBAR_ICON_BUTTON}
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
              <button onClick={logout} title="Logout" aria-label="Logout" className={SIDEBAR_ICON_BUTTON}>
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'flex h-full flex-col bg-[hsl(var(--card))]',
              collapsed && 'absolute inset-y-0 left-0 z-40 w-60 border-r border-[hsl(var(--border))] shadow-xl',
            )}
          >
            <div className="flex items-center justify-between gap-2 px-4 py-5 border-b border-[hsl(var(--border))]">
              <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[hsl(var(--primary))] text-sm text-[hsl(var(--primary-foreground))]">N</span>
                Norbiz
              </span>
              {/* Over a collapsed rail (keyboard overlay) the same spot offers to keep it open. */}
              <button
                onClick={toggleSidebar}
                title={collapsed ? 'Keep sidebar open (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
                aria-label={collapsed ? 'Keep sidebar open' : 'Collapse sidebar'}
                className={SIDEBAR_ICON_BUTTON}
              >
                {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
              </button>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {topLevelItems.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={navLinkClass(to)}>
                  <Icon className="w-5 h-5 shrink-0" />
                  {label}
                </NavLink>
              ))}

              {groups.map(({ group, items }) => (
                <div key={group} className="pt-2">
                  <button
                    onClick={() => setOpenGroups(prev => ({ ...prev, [group]: !isGroupOpen(group) }))}
                    className={groupHeaderClass(group)}
                  >
                    <span className="flex-1 text-left">{group}</span>
                    {isGroupOpen(group) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  {isGroupOpen(group) && (
                    <div className="mt-1 ml-4 pl-3 space-y-1 border-l border-[hsl(var(--border))]">
                      {items.map(({ to, label, icon: Icon }) => (
                        <NavLink key={to} to={to} className={navLinkClass(to)}>
                          <Icon className="w-5 h-5 shrink-0" />
                          {label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>

            <div className="px-3 py-4 border-t border-[hsl(var(--border))]">
              <Button variant="ghost" className="w-full justify-start gap-3" onClick={logout}>
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        )}
      </aside>
      {/* Clicking away from the keyboard overlay closes it. */}
      {collapsed && zone === 'sidebar' && <div className="fixed inset-0 z-30" onClick={() => setZone('content')} aria-hidden />}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 shrink-0 flex items-center justify-between gap-4 px-6 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <Breadcrumbs />

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 px-3 h-8 rounded-md border border-[hsl(var(--border))] text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Search…</span>
              <kbd className="hidden sm:inline px-1 py-0.5 rounded border border-[hsl(var(--border))] text-[10px] font-mono">Ctrl K</kbd>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
                  <CircleUser className="w-5 h-5" />
                  <span>{displayName ?? username}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setChangePasswordOpen(true)}>
                  <KeyRound className="w-4 h-4" />
                  Change Password
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={logout}>
                  <LogOut className="w-4 h-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <WorkspaceTabBar />
        <main className="flex-1 min-h-0 flex flex-col">
          <LayoutZoneContext.Provider value={zone}>
            <WorkspacePanels />
          </LayoutZoneContext.Provider>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeyboardShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </div>
  )
}
