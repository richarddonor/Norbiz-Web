import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useTabInstance, useWorkspace } from '@/context/WorkspaceContext'
import { useContentFocus } from '@/components/AppLayout'
import { Card } from '@/components/ui/card'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { canAccess, childNavItems, findNavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'

/** A report category (`/reports/inventory`, …): lists the category's reports the user can
 * open. One component serves every category — it reads which one from its tab's path.
 * ↑↓ moves through the list, Enter opens the highlighted report in its own workspace tab. */
export function ReportCategoryPage() {
  const { location } = useTabInstance()
  const { hasPermission } = useAuth()
  const { zone } = useContentFocus()
  const { openPage } = useWorkspace()

  const category = findNavItem(location.pathname)
  const reports = useMemo(
    // Alphabetical regardless of their order in nav.ts, so new reports slot in automatically.
    () => childNavItems(location.pathname)
      .filter(item => canAccess(item, hasPermission))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [location.pathname, hasPermission],
  )

  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: reports,
    onView: report => openPage(report.to),
    enabled: zone === 'content',
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{category?.label} Reports</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
          Select a report to open it. Use ↑↓ and Enter to choose with the keyboard.
        </p>
      </div>

      <Card className="divide-y divide-[hsl(var(--border))] overflow-hidden">
        {reports.map((report, i) => {
          const Icon = report.icon
          return (
            <button
              key={report.to}
              type="button"
              onClick={() => openPage(report.to)}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                'w-full flex items-center gap-4 px-4 py-3 text-left transition-colors',
                i === activeIndex ? 'bg-[hsl(var(--primary))]/10' : 'hover:bg-[hsl(var(--secondary))]',
              )}
            >
              <span className="p-2 rounded-lg bg-[hsl(var(--primary))]/10 shrink-0">
                <Icon className="w-5 h-5 text-[hsl(var(--primary))]" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">{report.label}</span>
                {report.description && (
                  <span className="block text-sm text-[hsl(var(--muted-foreground))] truncate">{report.description}</span>
                )}
              </span>
              <ChevronRight className="w-4 h-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            </button>
          )
        })}
      </Card>
    </div>
  )
}
