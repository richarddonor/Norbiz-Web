import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { SEARCH_ALL_LIMIT, type SearchAllStatus } from '@/hooks/usePagedList'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  onChange: (value: string) => void
  /** `usePagedList`'s `searchAll` */
  status: SearchAllStatus
  className?: string
}

const HINT = 'Last resort: loads every row matching the column filters into the browser, then searches all of their fields. Filter by column first.'

/** The list/report Global Filter, deliberately low-key: a small muted link at the
 * end of the toolbar (no hotkey) that expands into a search box. A search pulls
 * every row matching the column filters (`usePagedList` search-all mode) and
 * rebuilds the pages from the matches, so column filters should do the
 * narrowing first. */
export function GlobalSearch({ value, onChange, status, className }: Props) {
  const [open, setOpen] = useState(false)
  const expanded = open || value !== ''

  function close() {
    onChange('')
    setOpen(false)
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={HINT}
        className={cn(
          'ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-[hsl(var(--muted-foreground))] opacity-70 hover:opacity-100 hover:underline focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
          className,
        )}
      >
        <Search className="w-3 h-3" />
        Search all rows…
      </button>
    )
  }

  return (
    <div className={cn('ml-auto flex items-center gap-2', className)}>
      <span
        className={cn(
          'text-xs',
          status.tooMany ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]',
        )}
      >
        {!status.active ? 'Filter by column first'
          : status.loading ? 'Loading all filtered rows…'
          : status.tooMany ? `${status.scanned.toLocaleString()} rows match the column filters — narrow them to ${SEARCH_ALL_LIMIT.toLocaleString()} or fewer`
          : `Searched ${status.scanned.toLocaleString()} filtered rows`}
      </span>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
        <input
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }}
          onBlur={() => { if (value === '') setOpen(false) }}
          placeholder="Search all rows…"
          title={HINT}
          className="h-8 w-52 rounded-md border border-dashed border-[hsl(var(--input))] bg-transparent pl-7 pr-7 text-xs placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
        />
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={close}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
