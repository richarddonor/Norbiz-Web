import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react'
import { formatQuantity } from '@/lib/format'
import { Heatmap, StatTile, type HeatCell } from './charts'
import { periodOption, todayIso, useWidgetData } from './hooks'
import { PeriodPicker, SectionLabel, WidgetBody, type WidgetProps } from './widget-kit'

interface Ref { id: number; code: string; name: string }
interface Cell { outletId: number; itemId: number; onHand: number; soldQuantity: number; daysOfCover: number | null }
interface Alert { outletId: number; outletName: string; itemId: number; itemCode: string; itemName: string; onHand: number; soldQuantity: number; daysOfCover: number | null }
interface StockHealth {
  days: number
  pairsTracked: number
  stockOuts: number
  lowCover: number
  lowCoverDays: number
  outlets: Ref[]
  items: Ref[]
  cells: Cell[]
  alerts: Alert[]
}

const PERIODS = [14, 30, 60]
const HEALTHY_DAYS = 30
const integer = (n: number) => Math.round(n).toLocaleString('en-PH')

type Status = 'out' | 'low' | 'ok' | 'deep' | 'idle'

// Status colors are reserved for state and always shown with the legend's icon + label.
// Cells are tinted rather than solid so the on-hand figure in them stays readable in both themes.
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`
const STATUS: Record<Status, { color: string; fill: string; label: string; icon: typeof AlertOctagon }> = {
  out: { color: 'var(--viz-critical)', fill: tint('var(--viz-critical)', 55), label: 'Stock-out', icon: AlertOctagon },
  low: { color: 'var(--viz-warning)', fill: tint('var(--viz-warning)', 60), label: 'Low cover', icon: AlertTriangle },
  ok: { color: 'var(--viz-1)', fill: tint('var(--viz-1)', 22), label: 'Covered', icon: CheckCircle2 },
  deep: { color: 'var(--viz-1)', fill: tint('var(--viz-1)', 45), label: `${HEALTHY_DAYS}+ days`, icon: CheckCircle2 },
  idle: { color: 'var(--viz-empty)', fill: 'var(--viz-empty)', label: 'No sales', icon: CircleDashed },
}

function status(c: { onHand: number; soldQuantity: number; daysOfCover: number | null }, lowDays: number): Status {
  if (Number(c.soldQuantity) <= 0) return 'idle'
  if (Number(c.onHand) <= 0) return 'out'
  const cover = Number(c.daysOfCover)
  if (cover < lowDays) return 'low'
  return cover >= HEALTHY_DAYS ? 'deep' : 'ok'
}

export function OutletStockHealthWidget({ refreshKey, options, setOptions }: WidgetProps) {
  const days = periodOption(options, PERIODS, 30)
  const state = useWidgetData<StockHealth>(`/dashboard/widgets/outlet-stock-health?days=${days}&asOf=${todayIso()}`, refreshKey)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Days of cover = on hand ÷ daily units sold over the period</p>
        <PeriodPicker periods={PERIODS} value={days} onChange={p => setOptions({ ...options, days: p })} />
      </div>
      <WidgetBody state={state}>
        {d => {
          const byKey = new Map(d.cells.map(c => [`${c.outletId}:${c.itemId}`, c]))
          const healthy = d.pairsTracked - d.stockOuts - d.lowCover
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
                <StatTile label="Outlet × item pairs" value={d.pairsTracked} format={integer} hint={`sold in the last ${d.days} days`} />
                <StatTile label="Stock-outs" value={d.stockOuts} format={integer} tone={d.stockOuts > 0 ? 'critical' : undefined}
                  hint={<span className="inline-flex items-center gap-1"><AlertOctagon className="h-3 w-3" /> nothing left on hand</span>} />
                <StatTile label="Low cover" value={d.lowCover} format={integer}
                  hint={<span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> under {d.lowCoverDays} days</span>} />
                <StatTile label="Healthy" value={d.pairsTracked ? (healthy / d.pairsTracked) * 100 : 0} format={n => `${n.toFixed(0)}%`}
                  hint={`${integer(healthy)} pairs with ${d.lowCoverDays}+ days`} />
              </div>

              {d.outlets.length > 0 && (
                <div>
                  <SectionLabel aside={
                    <span className="flex flex-wrap items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))]">
                      {(Object.keys(STATUS) as Status[]).map(k => {
                        const Icon = STATUS[k].icon
                        return (
                          <span key={k} className="inline-flex items-center gap-1">
                            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: STATUS[k].fill }} />
                            <Icon className="h-3 w-3" />{k === 'low' ? `< ${d.lowCoverDays} days` : STATUS[k].label}
                          </span>
                        )
                      })}
                    </span>
                  }>Busiest outlets × best sellers</SectionLabel>
                  <div className="overflow-x-auto">
                    <div className="min-w-[640px]">
                      <Heatmap
                        rowLabelWidth={190}
                        rows={d.outlets.map(o => ({ key: o.id, label: o.name }))}
                        columns={d.items.map(i => ({ key: i.id, label: i.code, title: `${i.code} — ${i.name}` }))}
                        cells={d.outlets.map(o => d.items.map((i): HeatCell => {
                          const c = byKey.get(`${o.id}:${i.id}`) ?? { onHand: 0, soldQuantity: 0, daysOfCover: null }
                          const s = status(c, d.lowCoverDays)
                          return {
                            color: STATUS[s].fill,
                            text: formatQuantity(c.onHand),
                            tooltip: (
                              <>
                                <div className="font-medium">{o.name}</div>
                                <div className="mb-1 text-[hsl(var(--muted-foreground))]">{i.code} — {i.name}</div>
                                <div>On hand: <span className="dash-readout">{formatQuantity(c.onHand)}</span></div>
                                <div>Sold ({d.days}d): <span className="dash-readout">{formatQuantity(c.soldQuantity)}</span></div>
                                <div>Cover: <span className="dash-readout">{c.daysOfCover == null ? '—' : `${Number(c.daysOfCover).toFixed(1)} days`}</span> · {STATUS[s].label}</div>
                              </>
                            ),
                          }
                        }))}
                      />
                    </div>
                  </div>
                </div>
              )}

              {d.alerts.length > 0 && (
                <div>
                  <SectionLabel>Needs restocking</SectionLabel>
                  <ul className="grid gap-2 @2xl:grid-cols-2">
                    {d.alerts.map(a => {
                      const s = status(a, d.lowCoverDays)
                      const Icon = STATUS[s].icon
                      return (
                        <li key={`${a.outletId}:${a.itemId}`} className="flex items-center gap-3 rounded-xl border bg-[hsl(var(--background))]/60 px-3 py-2 text-xs">
                          <Icon className="h-4 w-4 shrink-0" style={{ color: STATUS[s].color }} aria-label={STATUS[s].label} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{a.itemCode} — {a.itemName}</span>
                            <span className="block truncate text-[hsl(var(--muted-foreground))]">{a.outletName}</span>
                          </span>
                          <span className="dash-readout shrink-0 text-right">
                            <span className="block">{formatQuantity(a.onHand)} left</span>
                            <span className="block text-[hsl(var(--muted-foreground))]">{formatQuantity(a.soldQuantity)} sold</span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          )
        }}
      </WidgetBody>
    </div>
  )
}
