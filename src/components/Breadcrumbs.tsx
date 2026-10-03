import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { findNavItem, findRecordBase } from '@/lib/nav'
import { useWorkspace } from '@/context/WorkspaceContext'

export function Breadcrumbs() {
  const { pathname } = useLocation()
  const { tabs } = useWorkspace()
  const recordBase = findRecordBase(pathname)
  const current = recordBase ?? findNavItem(pathname)
  const onDashboard = !current || current.to === '/dashboard'

  // The root crumb is a neutral Home anchor, not a literal "Dashboard" label —
  // nav groups (Catalog, Access Control) are siblings of Dashboard, not children of it.
  const crumbs: { label: string; to?: string; icon?: boolean }[] = [
    { label: 'Dashboard', to: '/dashboard', icon: true },
  ]
  if (!onDashboard && current) {
    if (current.group) crumbs.push({ label: current.group })
    if (current.subGroup) crumbs.push({ label: current.subGroup })
    crumbs.push({ label: current.label, to: current.to })
    // A record tab: the module crumb links back to the list tab, the record is the leaf.
    if (recordBase) crumbs.push({ label: tabs.find(t => t.key === pathname)?.title ?? recordBase.recordLabel ?? '' })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))] min-w-0">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={crumb.label} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
            {crumb.icon ? (
              isLast ? (
                <Home className="w-4 h-4 text-[hsl(var(--foreground))]" aria-label="Dashboard" />
              ) : (
                <Link to={crumb.to!} className="hover:text-[hsl(var(--foreground))] transition-colors" aria-label="Dashboard">
                  <Home className="w-4 h-4" />
                </Link>
              )
            ) : crumb.to && !isLast ? (
              <Link to={crumb.to} className="hover:text-[hsl(var(--foreground))] transition-colors truncate">
                {crumb.label}
              </Link>
            ) : (
              <span className={isLast ? 'text-[hsl(var(--foreground))] font-medium truncate' : 'truncate'}>
                {crumb.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
