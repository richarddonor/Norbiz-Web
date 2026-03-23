import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/users', label: 'Users', icon: Users },
]

export function AppLayout() {
  const { logout } = useAuth()

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="px-4 py-5 border-b border-[hsl(var(--border))]">
          <span className="text-xl font-bold text-[hsl(var(--primary))]">Norbiz</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon }) => (
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
        <header className="h-14 shrink-0 flex items-center justify-end px-6 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]" />

        <main className="flex-1 overflow-y-auto p-6 bg-[hsl(var(--background))]">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
