import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { AreaChart, HBarList, StatTile } from './charts'
import { compactNumber, periodOption, shortDay, todayIso, useWidgetData } from './hooks'
import { PeriodPicker, SectionLabel, WidgetBody, type WidgetProps } from './widget-kit'

interface DailyPoint { date: string; sales: number; returns: number; net: number }
interface Ranked { id: number; name: string; netSales: number }

interface OutletSales {
  days: number
  from: string
  asOf: string
  grossSales: number
  returns: number
  netSales: number
  documentCount: number
  previousNetSales: number
  daily: DailyPoint[]
  topOutlets: Ranked[]
  topAgents: Ranked[]
}

const PERIODS = [7, 30, 90]


export function OutletSalesWidget({ refreshKey, options, setOptions }: WidgetProps) {
  const days = periodOption(options, PERIODS, 30)
  const state = useWidgetData<OutletSales>(`/dashboard/widgets/outlet-sales?days=${days}&asOf=${todayIso()}`, refreshKey)

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <PeriodPicker periods={PERIODS} value={days} onChange={p => setOptions({ ...options, days: p })} />
      </div>
      <WidgetBody state={state}>
        {d => {
          const net = Number(d.netSales)
          const prev = Number(d.previousNetSales)
          const change = prev !== 0 ? ((net - prev) / Math.abs(prev)) * 100 : null
          const up = change != null && change >= 0
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
                <StatTile
                  label="Net sales"
                  value={net}
                  format={formatCurrency}
                  hint={change == null ? `no sales in the prior ${d.days} days` : (
                    <span className="inline-flex items-center gap-1">
                      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {up ? '+' : ''}{change.toFixed(1)}% vs prior {d.days} days
                    </span>
                  )}
                />
                <StatTile label="Gross sales" value={Number(d.grossSales)} format={formatCurrency} hint="outlet delivery receipts" />
                <StatTile label="Returns" value={Number(d.returns)} format={formatCurrency} hint="outlet delivery returns" />
                <StatTile label="Sales documents" value={d.documentCount} format={n => Math.round(n).toLocaleString('en-PH')} hint={`${shortDay(d.from)} – ${shortDay(d.asOf)}`} />
              </div>

              <div>
                <SectionLabel aside={
                  <span className="flex items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))]">
                    <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 rounded bg-[var(--viz-1)]" />Net sales</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[var(--viz-2)]" />Returns</span>
                  </span>
                }>Daily trend</SectionLabel>
                <AreaChart
                  primaryLabel="Net sales"
                  secondaryLabel="Returns"
                  format={formatCurrency}
                  points={d.daily.map(p => ({ label: shortDay(p.date), primary: Number(p.net), secondary: Number(p.returns) }))}
                />
              </div>

              <div className="grid gap-5 @2xl:grid-cols-2 [&>*]:min-w-0">
                <div>
                  <SectionLabel>Top outlets</SectionLabel>
                  {d.topOutlets.length
                    ? <HBarList format={compactNumber} data={d.topOutlets.map(o => ({ key: o.id, label: o.name, value: Math.max(0, Number(o.netSales)), detail: formatCurrency(o.netSales) }))} />
                    : <p className="text-xs text-[hsl(var(--muted-foreground))]">No outlet sales in this period.</p>}
                </div>
                <div>
                  <SectionLabel>Top agents</SectionLabel>
                  {d.topAgents.length
                    ? <HBarList format={compactNumber} data={d.topAgents.map(a => ({ key: a.id, label: a.name, value: Math.max(0, Number(a.netSales)), detail: formatCurrency(a.netSales) }))} />
                    : <p className="text-xs text-[hsl(var(--muted-foreground))]">No agent sales in this period.</p>}
                </div>
              </div>
            </div>
          )
        }}
      </WidgetBody>
    </div>
  )
}
