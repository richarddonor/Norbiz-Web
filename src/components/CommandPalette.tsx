import { useMemo, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { navItems, canAccess, findNavItem } from '@/lib/nav'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const { openPage } = useWorkspace()
  const { hasPermission } = useAuth()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  // Reset search + selection when the palette opens, and re-clamp selection
  // to the top whenever the query changes — adjusted during render (React's
  // documented escape hatch) instead of effects, so there's no extra flash render.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }

  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    return navItems
      .filter(item => canAccess(item, hasPermission))
      .filter(item => item.label.toLowerCase().includes(term))
  }, [query, hasPermission])

  const [prevQuery, setPrevQuery] = useState(query)
  if (query !== prevQuery) {
    setPrevQuery(query)
    setActiveIndex(0)
  }

  // Each page opens in a workspace tab of its own (or switches to the one already showing it).
  function go(to: string) {
    openPage(to)
    onOpenChange(false)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[activeIndex]
      if (item) go(item.to)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 top-[20%] translate-y-0 max-w-md overflow-hidden">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-3">
          <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))] shrink-0" />
          <Input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a page…"
            className="border-0 shadow-none focus-visible:ring-0 h-11 px-0"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="text-center text-sm text-[hsl(var(--muted-foreground))] py-6">No matching pages.</p>
          ) : (
            results.map((item, i) => {
              const Icon = item.icon
              return (
                <button
                  key={item.to}
                  onClick={() => go(item.to)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left transition-colors',
                    i === activeIndex
                      ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                      : 'text-[hsl(var(--foreground))]'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.label}
                  {item.group && (
                    <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
                      {item.parent ? `${item.group} › ${findNavItem(item.parent)?.label}` : item.group}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-[hsl(var(--border))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-[hsl(var(--border))]">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-[hsl(var(--border))]">Enter</kbd> select</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-[hsl(var(--border))]">Esc</kbd> close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
