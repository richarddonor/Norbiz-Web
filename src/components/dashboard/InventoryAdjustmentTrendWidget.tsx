import { formatQuantity } from '@/lib/format'
import { DivergingBars, HBarList, StatTile } from './charts'
import { periodOption, shortDay, todayIso, useWidgetData } from './hooks'
import { PeriodPicker, SectionLabel, WidgetBody, type WidgetProps } from './widget-kit'

interface DailyPoint { date: string; added: number; removed: number; documents: number }
interface WarehouseTotal { id: number; name: string; added: number; removed: number }
interface ReasonCount { reason: string; documentCount: number }
interface AdjustmentTrend {
  days: number
  unitsAdded: number
  unitsRemoved: number
  documentCount: number
  daily: DailyPoint[]
  byWarehouse: WarehouseTotal[]
  topReasons: ReasonCount[]
}

const PERIODS = [7, 30, 90]
const integer = (n: number) => Math.round(n).toLocaleString('en-PH')
const qty = (n: number) => formatQuantity(Math.round(n))

export function InventoryAdjustmentTrendWidget({ refreshKey, options, setOptions }: WidgetProps) {
  const days = periodOption(options, PERIODS, 30)
  const state = useWidgetData<AdjustmentTrend>(`/dashboard/widgets/inventory-adjustment-trend?days=${days}&asOf=${todayIso()}`, refreshKey)

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <PeriodPicker periods={PERIODS} value={days} onChange={p => setOptions({ ...options, days: p })} />
      </div>
      <WidgetBody state={state}>
        {d => {
          const net = Number(d.unitsAdded) - Number(d.unitsRemoved)
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
                <StatTile label="Units added" value={Number(d.unitsAdded)} format={qty} hint="positive adjustment lines" />
                <StatTile label="Units removed" value={Number(d.unitsRemoved)} format={qty} hint="negative adjustment lines" />
                <StatTile label="Net change" value={net} format={n => `${n > 0 ? '+' : ''}${qty(n)}`} hint="added − removed" />
                <StatTile label="Adjustments" value={d.documentCount} format={integer} hint={`in the last ${d.days} days`} />
              </div>

              <div>
                <SectionLabel aside={
                  <span className="flex items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))]">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[var(--viz-1)]" />Added</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[var(--viz-2)]" />Removed</span>
                  </span>
                }>Daily movement</SectionLabel>
                <DivergingBars upLabel="Added" downLabel="Removed" format={qty}
                  points={d.daily.map(p => ({ label: shortDay(p.date), up: Number(p.added), down: Number(p.removed) }))} />
              </div>

              <div className="grid gap-5 @2xl:grid-cols-2 [&>*]:min-w-0">
                <div>
                  <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">+added / −removed</span>}>By warehouse</SectionLabel>
                  {d.byWarehouse.length ? (
                    <HBarList format={qty} data={d.byWarehouse.map(w => ({
                      key: w.id,
                      label: w.name,
                      value: Number(w.added) + Number(w.removed),
                      display: `+${qty(Number(w.added))} / −${qty(Number(w.removed))}`,
                    }))} />
                  ) : <p className="text-xs text-[hsl(var(--muted-foreground))]">No adjustments in this period.</p>}
                </div>
                <div>
                  <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">adjustments</span>}>Most common reasons</SectionLabel>
                  {d.topReasons.length ? (
                    <HBarList format={integer} color="var(--viz-seq-4)" data={d.topReasons.map(r => ({ key: r.reason, label: r.reason, value: r.documentCount }))} />
                  ) : <p className="text-xs text-[hsl(var(--muted-foreground))]">No reasons recorded in this period.</p>}
                </div>
              </div>
            </div>
          )
        }}
      </WidgetBody>
    </div>
  )
}
