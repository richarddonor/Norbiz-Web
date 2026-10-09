import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowDown, ArrowUp, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** One pinned widget in the user's layout. `options` are widget-owned settings (e.g. a period). */
export interface LayoutItem {
  key: string
  wide: boolean
  options?: Record<string, unknown>
}

/** What every widget body receives. */
export interface WidgetProps {
  /** Bumped by the frame's Refresh button. */
  refreshKey: number
  options: Record<string, unknown>
  setOptions: (options: Record<string, unknown>) => void
}

/** Loading / error / content switch with a scanning skeleton. */
export function WidgetBody<T>({ state, children }: { state: { data: T | null; error: string | null; loading: boolean }; children: (data: T) => ReactNode }) {
  if (state.error && !state.data) {
    return <div className="flex h-40 items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">Couldn't load this widget: {state.error}</div>
  }
  if (!state.data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-[74px] animate-pulse rounded-xl bg-[hsl(var(--secondary))]" />)}
        </div>
        <div className="h-48 animate-pulse rounded-xl bg-[hsl(var(--secondary))]" />
      </div>
    )
  }
  return <div className={cn('transition-opacity', state.loading && 'opacity-60')}>{children(state.data)}</div>
}

function FrameButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-30"
    >
      {children}
    </button>
  )
}

/** The panel around a widget: title bar with move / resize / refresh / remove controls. */
export function WidgetFrame({
  title, category, icon: Icon, wide, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onToggleWide, onRefresh, onRemove, children,
}: {
  title: string
  category: string
  icon: LucideIcon
  wide: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleWide: () => void
  onRefresh: () => void
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <section className={cn('dash-panel @container p-5', wide && 'xl:col-span-2')} aria-label={title}>
      <header className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-[hsl(var(--background))]"
          style={{ boxShadow: '0 0 14px rgb(var(--viz-glow) / 0.25)' }}>
          <Icon className="h-4.5 w-4.5 text-[var(--viz-1)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            <span className="dash-live-dot" aria-hidden /> {category} · Live
          </div>
          <h2 className="truncate text-base font-semibold">{title}</h2>
        </div>
        <div className="flex items-center">
          <FrameButton label="Move up" onClick={onMoveUp} disabled={!canMoveUp}><ArrowUp className="h-4 w-4" /></FrameButton>
          <FrameButton label="Move down" onClick={onMoveDown} disabled={!canMoveDown}><ArrowDown className="h-4 w-4" /></FrameButton>
          <FrameButton label={wide ? 'Make half width' : 'Make full width'} onClick={onToggleWide}>
            {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </FrameButton>
          <FrameButton label="Refresh" onClick={onRefresh}><RefreshCw className="h-4 w-4" /></FrameButton>
          <FrameButton label="Remove from dashboard" onClick={onRemove}><X className="h-4 w-4" /></FrameButton>
        </div>
      </header>
      {children}
    </section>
  )
}

/** Small section label inside a widget. */
export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">{children}</h3>
      {aside}
    </div>
  )
}


/** Period chips (e.g. 7D / 30D / 90D) for widgets with a time window; the choice is a widget option. */
export function PeriodPicker({ periods, value, onChange }: { periods: readonly number[]; value: number; onChange: (days: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border bg-[hsl(var(--background))]/60 p-0.5">
      {periods.map(p => (
        <button key={p} type="button" role="radio" aria-checked={p === value} onClick={() => onChange(p)}
          className={cn('dash-readout rounded-md px-2.5 py-1 text-xs transition-colors',
            p === value ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]')}>
          {p}D
        </button>
      ))}
    </div>
  )
}
