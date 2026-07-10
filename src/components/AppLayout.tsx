import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { ChevronDown, ChevronRight, LogOut, CircleUser, Search } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { navItems } from '@/lib/nav'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { CommandPalette } from '@/components/CommandPalette'
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp'
import { useHotkeys } from '@/hooks/useHotkeys'

export type FocusZone = 'content' | 'sidebar'

export interface LayoutOutletContext {
  zone: FocusZone
}

/** List pages read this to know whether the sidebar currently owns arrow-key
 * input, so they can suspend their own row navigation while it does. */
export function useContentFocus() {
  return useOutletContext<LayoutOutletContext>()
}

interface SidebarEntry {
  key: string
  type: 'link' | 'group'
  label: string
  to?: string
}

export function AppLayout() {
  const { logout, hasPermission, displayName, username } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [zone, setZone] = useState<FocusZone>('content')
  const [rawSidebarIndex, setRawSidebarIndex] = useState(0)

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
  ])

  const topLevelItems = useMemo(() => navItems.filter(item => !item.group), [])
  const groups = useMemo(() => {
    const order: string[] = []
    for (const item of navItems) {
      if (item.group && !order.includes(item.group)) order.push(item.group)
    }
    return order.map(group => {
      const visible = navItems.filter(item => item.group === group && (!item.permission || hasPermission(item.permission)))
      const directItems = visible.filter(item => !item.subGroup)
      const subGroupOrder: string[] = []
      for (const item of visible) {
        if (item.subGroup && !subGroupOrder.includes(item.subGroup)) subGroupOrder.push(item.subGroup)
      }
      const subGroups = subGroupOrder
        .map(subGroup => ({ subGroup, items: visible.filter(item => item.subGroup === subGroup) }))
        .filter(sg => sg.items.length > 0)
      return { group, directItems, subGroups }
    }).filter(g => g.directItems.length > 0 || g.subGroups.length > 0)
  }, [hasPermission])

  function isGroupOpen(key: string) {
    return openGroups[key] ?? true
  }

  // Flattened, visible sidebar entries in visual order — used for ↑↓ traversal.
  const sidebarEntries = useMemo(() => {
    const entries: SidebarEntry[] = topLevelItems.map(item => ({ key: item.to, type: 'link', label: item.label, to: item.to }))
    for (const { group, directItems, subGroups } of groups) {
      entries.push({ key: `group:${group}`, type: 'group', label: group })
      if (openGroups[group] ?? true) {
        for (const item of directItems) {
          entries.push({ key: item.to, type: 'link', label: item.label, to: item.to })
        }
        for (const { subGroup, items } of subGroups) {
          const subKey = `${group}::${subGroup}`
          entries.push({ key: `group:${subKey}`, type: 'group', label: subGroup })
          if (openGroups[subKey] ?? true) {
            for (const item of items) {
              entries.push({ key: item.to, type: 'link', label: item.label, to: item.to })
            }
          }
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
        const idx = sidebarEntries.findIndex(e => e.type === 'link' && e.to === pathname)
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
      isActive
        ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
        : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]',
      focused && 'ring-2 ring-inset ring-[hsl(var(--primary))]'
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
      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="px-4 py-5 border-b border-[hsl(var(--border))]">
          <span className="text-xl font-bold text-[hsl(var(--primary))]">Norbiz</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {topLevelItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClass(to)}>
              <Icon className="w-5 h-5 shrink-0" />
              {label}
            </NavLink>
          ))}

          {groups.map(({ group, directItems, subGroups }) => (
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
                  {directItems.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} className={navLinkClass(to)}>
                      <Icon className="w-5 h-5 shrink-0" />
                      {label}
                    </NavLink>
                  ))}

                  {subGroups.map(({ subGroup, items }) => {
                    const subKey = `${group}::${subGroup}`
                    return (
                      <div key={subKey} className="pt-1">
                        <button
                          onClick={() => setOpenGroups(prev => ({ ...prev, [subKey]: !isGroupOpen(subKey) }))}
                          className={groupHeaderClass(subKey)}
                        >
                          <span className="flex-1 text-left">{subGroup}</span>
                          {isGroupOpen(subKey) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>

                        {isGroupOpen(subKey) && (
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
                    )
                  })}
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
      </aside>

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
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
              <CircleUser className="w-5 h-5" />
              <span>{displayName ?? username}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 bg-[hsl(var(--background))]">
          <Outlet context={{ zone } satisfies LayoutOutletContext} />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeyboardShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
