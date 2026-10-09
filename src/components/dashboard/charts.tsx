import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { compactNumber, useCountUp } from './hooks'

// Hand-rolled SVG charts for dashboard widgets (no chart library in this app). Colors come from the
// --viz-* tokens in index.css; text always uses the app's text tokens, never a series color.

const MUTED = 'hsl(var(--muted-foreground))'

/** Width of a container, tracked with ResizeObserver so SVG text stays crisp (no viewBox scaling). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function niceMax(max: number) {
  if (max <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(max)))
  const f = max / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}


function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Flip to the left of the pointer near the right edge.
  const left = x > width - 170 ? x - 172 : x + 12
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border bg-[hsl(var(--card))]/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
      style={{ left: Math.max(0, left), top: Math.max(0, y) }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

export interface AreaPoint {
  label: string
  primary: number
  secondary?: number
}

/**
 * Area line for the primary series (glow + gradient fill) with optional thin bars for a secondary
 * series on the same scale. Crosshair tooltip on hover.
 */
export function AreaChart({
  points, height = 200, primaryLabel, secondaryLabel, format,
}: {
  points: AreaPoint[]
  height?: number
  primaryLabel: string
  secondaryLabel?: string
  format: (n: number) => string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const gradientId = useId()
  const pad = { top: 12, right: 8, bottom: 22, left: 44 }
  const w = Math.max(0, width - pad.left - pad.right)
  const h = height - pad.top - pad.bottom

  const values = points.flatMap(p => [p.primary, p.secondary ?? 0])
  const max = niceMax(Math.max(0, ...values))
  const min = Math.min(0, ...points.map(p => p.primary))
  const span = max - min || 1
  const x = (i: number) => (points.length <= 1 ? w / 2 : (i / (points.length - 1)) * w)
  const y = (v: number) => h - ((v - min) / span) * h
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.primary).toFixed(1)}`).join(' ')
  const area = points.length ? `${line} L${x(points.length - 1).toFixed(1)},${y(min)} L${x(0).toFixed(1)},${y(min)} Z` : ''
  const ticks = [0, 0.5, 1].map(t => min + span * t)
  const barW = Math.max(2, Math.min(8, w / Math.max(1, points.length) - 3))
  const labelEvery = Math.ceil(points.length / Math.max(1, Math.floor(w / 64)))

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const bx = e.nativeEvent.offsetX - pad.left
    const i = points.length <= 1 ? 0 : Math.round((bx / w) * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, i)))
  }

  const hp = hover != null ? points[hover] : null
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${primaryLabel} over time`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <g transform={`translate(${pad.left},${pad.top})`}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeDasharray={t === 0 ? undefined : '2 4'} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={MUTED} className="dash-readout">
                  {compactNumber(t)}
                </text>
              </g>
            ))}
            {secondaryLabel && points.map((p, i) => (p.secondary ?? 0) > 0 && (
              <rect key={i} className="dash-rise" x={x(i) - barW / 2} y={y(p.secondary!)} width={barW}
                height={Math.max(0, y(min) - y(p.secondary!))} rx={2} fill="var(--viz-2)" opacity={0.85} />
            ))}
            <path d={area} fill={`url(#${gradientId})`} />
            <path d={line} pathLength={1} className="dash-draw" fill="none" stroke="var(--viz-1)" strokeWidth={2}
              strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgb(var(--viz-glow) / 0.55))' }} />
            {points.map((p, i) => i % labelEvery === 0 && (
              <text key={i} x={x(i)} y={h + 15} textAnchor="middle" fontSize={10} fill={MUTED}>{p.label}</text>
            ))}
            {hp && hover != null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke={MUTED} strokeOpacity={0.5} />
                <circle cx={x(hover)} cy={y(hp.primary)} r={4.5} fill="var(--viz-1)" stroke="hsl(var(--card))" strokeWidth={2} />
              </g>
            )}
            <rect x={0} y={0} width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </g>
        </svg>
      )}
      {hp && hover != null && (
        <Tooltip x={pad.left + x(hover)} y={pad.top} width={width}>
          <div className="mb-1 font-medium">{hp.label}</div>
          <Row color="var(--viz-1)" label={primaryLabel} value={format(hp.primary)} />
          {secondaryLabel && <Row color="var(--viz-2)" label={secondaryLabel} value={format(hp.secondary ?? 0)} />}
        </Tooltip>
      )}
    </div>
  )
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />{label}
      </span>
      <span className="dash-readout font-medium">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

export interface BarDatum {
  key: string | number
  label: string
  value: number
  /** Shown instead of format(value), e.g. a signed figure when the bar length uses its magnitude. */
  display?: string
  detail?: string
  onClick?: () => void
}

/** Horizontal bars, one series, value labelled at the end of each bar. */
export function HBarList({ data, format, color = 'var(--viz-1)' }: {
  data: BarDatum[]
  format: (n: number) => string
  color?: string
}) {
  const max = Math.max(0, ...data.map(d => d.value)) || 1
  return (
    <ul className="min-w-0 space-y-2.5">
      {data.map((d, i) => (
        <li key={d.key} title={d.detail ? `${d.label} — ${d.detail}` : d.label}>
          <button
            type="button"
            onClick={d.onClick}
            disabled={!d.onClick}
            className="group block w-full text-left disabled:cursor-default"
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-[hsl(var(--foreground))] group-enabled:group-hover:underline">{d.label}</span>
              <span className="dash-readout shrink-0 text-[hsl(var(--muted-foreground))]">{d.display ?? format(d.value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--secondary))]">
              <div
                className="dash-grow h-full rounded-full"
                style={{
                  width: `${Math.max(1.5, (d.value / max) * 100)}%`,
                  background: `linear-gradient(90deg, color-mix(in srgb, ${color} 55%, transparent), ${color})`,
                  boxShadow: `0 0 10px color-mix(in srgb, ${color} 55%, transparent)`,
                  animationDelay: `${i * 60}ms`,
                }}
              />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------------------------

export interface ColumnDatum {
  label: string
  value: number
  color: string
  tooltip: ReactNode
}

/** Vertical columns with a value cap label; per-column hover tooltip. */
export function ColumnChart({ data, height = 150, format }: { data: ColumnDatum[]; height?: number; format: (n: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { top: 16, bottom: 20 }
  const h = height - pad.top - pad.bottom
  const max = Math.max(0, ...data.map(d => d.value)) || 1
  const slot = data.length ? width / data.length : 0
  const barW = Math.min(44, slot * 0.6)
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Columns">
          <line x1={0} x2={width} y1={pad.top + h} y2={pad.top + h} stroke="var(--viz-grid)" />
          {data.map((d, i) => {
            const bh = d.value > 0 ? Math.max(3, (d.value / max) * h) : 0
            const cx = slot * i + slot / 2
            return (
              <g key={d.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={slot * i} y={0} width={slot} height={height} fill="transparent" />
                {bh > 0 && (
                  <rect className="dash-rise" x={cx - barW / 2} y={pad.top + h - bh} width={barW} height={bh} rx={4}
                    fill={d.color} opacity={hover == null || hover === i ? 1 : 0.45}
                    style={{ animationDelay: `${i * 70}ms` }} />
                )}
                <text x={cx} y={pad.top + h - bh - 5} textAnchor="middle" fontSize={11} fill="hsl(var(--foreground))" className="dash-readout">
                  {format(d.value)}
                </text>
                <text x={cx} y={height - 4} textAnchor="middle" fontSize={10} fill={MUTED}>{d.label}</text>
              </g>
            )
          })}
        </svg>
      )}
      {hover != null && (
        <Tooltip x={slot * hover + slot / 2} y={0} width={width}>{data[hover].tooltip}</Tooltip>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

/** Radial progress ring with a glowing arc and the value in the middle. */
export function RadialGauge({ percent, label, size = 120 }: { percent: number; label: string; size?: number }) {
  const stroke = 9
  const r = (size - stroke) / 2 - 4
  const c = 2 * Math.PI * r
  const shown = useCountUp(percent)
  const clamped = Math.max(0, Math.min(100, shown))
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${percent.toFixed(1)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r + 6} fill="none" stroke="var(--viz-grid)" strokeDasharray="1 5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--viz-1)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)}
          style={{ filter: 'drop-shadow(0 0 5px rgb(var(--viz-glow) / 0.7))' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="dash-readout text-xl font-semibold">{clamped.toFixed(1)}%</span>
        <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

/** Headline number tile: label, animated readout, optional hint line. */
export function StatTile({ label, value, format, hint, tone, className }: {
  label: string
  value: number
  format: (n: number) => string
  hint?: ReactNode
  tone?: 'critical'
  className?: string
}) {
  const shown = useCountUp(value)
  // Sized from the final figure (not the counting one) so the tile doesn't jump while it animates.
  const length = format(value).length
  const size = length > 13 ? 'text-lg' : length > 10 ? 'text-xl' : 'text-2xl'
  return (
    <div className={cn('min-w-0 rounded-xl border bg-[hsl(var(--background))]/60 px-4 py-3', className)}>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className={cn('dash-readout mt-1 truncate font-semibold', size, tone === 'critical' && 'text-[var(--viz-critical)]')} title={format(value)}>
        {format(shown)}
      </div>
      {hint && <div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{hint}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

/** Fixed categorical order; anything past slot 8 (or an "Others" slice) takes --viz-other. */
const CATEGORICAL = Array.from({ length: 8 }, (_, i) => `var(--viz-cat-${i + 1})`)

export interface Segment {
  key: string
  label: string
  value: number
  /** Folded remainder: drawn in the neutral "other" color. */
  other?: boolean
  detail?: string
}

/**
 * One 100% stacked bar with 2px gaps and a legend that always carries the values, so identity never
 * rests on color alone (several light-mode slots sit below 3:1 contrast).
 */
export function SegmentBar({ segments, format }: { segments: Segment[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1
  let slot = 0
  const colored = segments.map(s => ({ ...s, color: s.other || slot >= CATEGORICAL.length ? 'var(--viz-other)' : CATEGORICAL[slot++] }))
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {colored.filter(s => s.value > 0).map((s, i) => (
          <div key={s.key} className="dash-grow h-full first:rounded-l-full last:rounded-r-full transition-opacity"
            title={`${s.label}: ${format(s.value)}${s.detail ? ` — ${s.detail}` : ''}`}
            onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color, opacity: hover && hover !== s.key ? 0.4 : 1, animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 @md:grid-cols-2">
        {colored.map(s => (
          <li key={s.key} className={cn('flex items-center gap-2 text-xs transition-opacity', hover && hover !== s.key && 'opacity-50')}
            onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate" title={s.label}>{s.label}</span>
            <span className="dash-readout text-[hsl(var(--muted-foreground))]">{format(s.value)}</span>
            <span className="dash-readout w-10 text-right text-[hsl(var(--muted-foreground))]">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

export interface DivergingPoint {
  label: string
  up: number
  down: number
}

/** Daily bars above (up, series 1) and below (down, series 2) a zero line, same scale; hover tooltip. */
export function DivergingBars({ points, upLabel, downLabel, format, height = 190 }: {
  points: DivergingPoint[]
  upLabel: string
  downLabel: string
  format: (n: number) => string
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { top: 8, right: 4, bottom: 20, left: 44 }
  const w = Math.max(0, width - pad.left - pad.right)
  const h = height - pad.top - pad.bottom
  const max = niceMax(Math.max(0, ...points.flatMap(p => [p.up, p.down])))
  const mid = h / 2
  const scale = (v: number) => (v / max) * (h / 2)
  const slot = points.length ? w / points.length : 0
  const barW = Math.max(2, Math.min(14, slot - 2))
  const labelEvery = Math.ceil(points.length / Math.max(1, Math.floor(w / 64)))
  const hp = hover != null ? points[hover] : null
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${upLabel} and ${downLabel} per day`}>
          <g transform={`translate(${pad.left},${pad.top})`}>
            {[max, 0, max].map((t, i) => (
              <g key={i}>
                <line x1={0} x2={w} y1={i * mid} y2={i * mid} stroke="var(--viz-grid)" strokeDasharray={i === 1 ? undefined : '2 4'} />
                <text x={-8} y={i * mid} dy="0.32em" textAnchor="end" fontSize={10} fill={MUTED} className="dash-readout">
                  {i === 0 ? '+' : i === 2 ? '−' : ''}{compactNumber(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = slot * i + (slot - barW) / 2
              const dim = hover != null && hover !== i ? 0.4 : 1
              return (
                <g key={i} opacity={dim}>
                  {p.up > 0 && <rect className="dash-rise" x={x} y={mid - scale(p.up)} width={barW} height={Math.max(1, scale(p.up) - 1)} rx={2} fill="var(--viz-1)" />}
                  {p.down > 0 && <rect x={x} y={mid + 1} width={barW} height={Math.max(1, scale(p.down) - 1)} rx={2} fill="var(--viz-2)" />}
                </g>
              )
            })}
            {points.map((p, i) => i % labelEvery === 0 && (
              <text key={i} x={slot * i + slot / 2} y={h + 15} textAnchor="middle" fontSize={10} fill={MUTED}>{p.label}</text>
            ))}
            <rect x={0} y={0} width={w} height={h} fill="transparent"
              onPointerMove={e => setHover(Math.max(0, Math.min(points.length - 1, Math.floor((e.nativeEvent.offsetX - pad.left) / (slot || 1)))))}
              onPointerLeave={() => setHover(null)} />
          </g>
        </svg>
      )}
      {hp && hover != null && (
        <Tooltip x={pad.left + slot * hover + slot / 2} y={pad.top} width={width}>
          <div className="mb-1 font-medium">{hp.label}</div>
          <Row color="var(--viz-1)" label={upLabel} value={format(hp.up)} />
          <Row color="var(--viz-2)" label={downLabel} value={format(hp.down)} />
        </Tooltip>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

/** Tiny trend line for table rows; the last point gets a dot. Decorative — the row carries the numbers. */
export function Sparkline({ values, width = 96, height = 26 }: { values: number[]; width?: number; height?: number }) {
  const gradientId = useId()
  if (values.length < 2) return null
  const min = Math.min(0, ...values)
  const max = Math.max(...values, min + 1)
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2
  const y = (v: number) => height - 3 - ((v - min) / (max - min)) * (height - 6)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.3} />
          <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${x(values.length - 1)},${y(min)} L${x(0)},${y(min)} Z`} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="var(--viz-1)" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} fill="var(--viz-1)" />
    </svg>
  )
}

// ---------------------------------------------------------------------------------------------

export interface HeatCell {
  /** Fill (a token); text inside the cell stays in text tokens. */
  color: string
  text?: string
  tooltip: ReactNode
}

/** Row × column grid of colored cells with a hover tooltip; rows and columns are labelled. */
export function Heatmap({ rows, columns, cells, columnLabelEvery = 1, cellHeight = 26, rowLabelWidth = 150 }: {
  rows: { key: string | number; label: string; title?: string }[]
  columns: { key: string | number; label: string; title?: string }[]
  /** cells[row][column] */
  cells: HeatCell[][]
  columnLabelEvery?: number
  cellHeight?: number
  rowLabelWidth?: number
}) {
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null)
  const [ref, width] = useWidth<HTMLDivElement>()
  return (
    <div ref={ref} className="relative w-full">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `${rowLabelWidth}px repeat(${columns.length}, minmax(0, 1fr))` }}>
        <div />
        {columns.map((c, i) => (
          <div key={c.key} title={c.title ?? c.label}
            className="truncate pb-1 text-center text-[10px] text-[hsl(var(--muted-foreground))]">
            {i % columnLabelEvery === 0 ? c.label : ''}
          </div>
        ))}
        {rows.map((r, ri) => (
          <div key={r.key} className="contents">
            <div className="truncate pr-2 text-xs" title={r.title ?? r.label} style={{ height: cellHeight, lineHeight: `${cellHeight}px` }}>{r.label}</div>
            {cells[ri].map((cell, ci) => (
              <div key={ci}
                className={cn('dash-readout flex items-center justify-center rounded-[4px] text-[10px] transition-transform',
                  hover?.r === ri && hover?.c === ci && 'scale-110 ring-2 ring-[hsl(var(--ring))]')}
                style={{ background: cell.color, height: cellHeight }}
                onPointerEnter={e => {
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const host = ref.current!.getBoundingClientRect()
                  setHover({ r: ri, c: ci, x: box.left - host.left + box.width / 2, y: box.top - host.top + cellHeight })
                }}
                onPointerLeave={() => setHover(null)}>
                {cell.text}
              </div>
            ))}
          </div>
        ))}
      </div>
      {hover && <Tooltip x={hover.x} y={hover.y + 4} width={width}>{cells[hover.r][hover.c].tooltip}</Tooltip>}
    </div>
  )
}
