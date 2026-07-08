import { useState } from 'react'
import { Calendar } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu'
import { DATE_RANGE_PRESETS } from '@/lib/dateRanges'

interface Props {
  label: string
  from: string
  to: string
  onChange: (from: string, to: string) => void
}

/** A compact date-range filter: quick presets (Today, Current Week, …) plus
 * manual From/To date pickers, combined via AND with everything else. */
export function DateRangeFilter({ label, from, to, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const hasValue = !!(from || to)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-full h-7 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-xs text-left flex items-center gap-1.5 text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
        >
          <Calendar className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <span className={hasValue ? 'truncate' : 'truncate text-[hsl(var(--muted-foreground))]'}>
            {hasValue ? `${from || '…'} – ${to || '…'}` : `Filter ${label}…`}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 p-3">
        <div className="grid grid-cols-2 gap-1.5">
          {DATE_RANGE_PRESETS.map(preset => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                const r = preset.range()
                onChange(r.from, r.to)
                setOpen(false)
              }}
              className="text-xs px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary))] transition-colors text-left"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="border-t border-[hsl(var(--border))] mt-3 pt-3 space-y-2">
          <div className="space-y-1">
            <label className="text-xs text-[hsl(var(--muted-foreground))]">From</label>
            <input
              type="date"
              value={from}
              onChange={e => onChange(e.target.value, to)}
              className="w-full h-7 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-[hsl(var(--muted-foreground))]">To</label>
            <input
              type="date"
              value={to}
              onChange={e => onChange(from, e.target.value)}
              className="w-full h-7 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
            />
          </div>
        </div>
        {hasValue && (
          <button
            type="button"
            onClick={() => { onChange('', ''); setOpen(false) }}
            className="w-full text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors pt-2 mt-1 border-t border-[hsl(var(--border))]"
          >
            Clear
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
