import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, KeyRound, ShieldCheck, ChevronDown, ChevronRight, LogOut, CircleUser, Package } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const topNavItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
]

const catalogItems = [
  { to: '/items', label: 'Items', icon: Package, permission: 'VIEW_ITEM' },
]

const accessControlItems = [
  { to: '/users', label: 'Users', icon: Users, permission: 'VIEW_USER' },
  { to: '/roles', label: 'Roles', icon: KeyRound, permission: 'VIEW_ROLE' },
]

export function AppLayout() {
  const { logout, hasPermission, displayName, username } = useAuth()
  const [accessControlOpen, setAccessControlOpen] = useState(true)

  const visibleCatalogItems = catalogItems.filter(item => hasPermission(item.permission))
  const visibleAccessControlItems = accessControlItems.filter(item => hasPermission(item.permission))

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="px-4 py-5 border-b border-[hsl(var(--border))]">
          <span className="text-xl font-bold text-[hsl(var(--primary))]">Norbiz</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {topNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]'
                )
              }
            >
              <Icon className="w-5 h-5 shrink-0" />
              {label}
            </NavLink>
          ))}

          {/* Catalog group */}
          {visibleCatalogItems.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => {}}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-[hsl(var(--muted-foreground))]"
              >
                <Package className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left">Catalog</span>
              </button>
              <div className="mt-1 ml-4 pl-3 space-y-1 border-l border-[hsl(var(--border))]">
                {visibleCatalogItems.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]'
                      )
                    }
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          )}

          {/* Access Control collapsible group — only shown if user has at least one item */}
          {visibleAccessControlItems.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setAccessControlOpen(open => !open)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                <ShieldCheck className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left">Access Control</span>
                {accessControlOpen
                  ? <ChevronDown className="w-4 h-4" />
                  : <ChevronRight className="w-4 h-4" />
                }
              </button>

              {accessControlOpen && (
                <div className="mt-1 ml-4 pl-3 space-y-1 border-l border-[hsl(var(--border))]">
                  {visibleAccessControlItems.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]'
                        )
                      }
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
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
        <header className="h-14 shrink-0 flex items-center justify-end px-6 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <CircleUser className="w-5 h-5" />
            <span>{displayName ?? username}</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 bg-[hsl(var(--background))]">
          <Outlet />
        </main>
      </div>
    </div>
  )
}