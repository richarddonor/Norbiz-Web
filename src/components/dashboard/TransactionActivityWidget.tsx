import { transactionTypeLabel } from '@/hooks/useTransactionActivity'
import { Heatmap, StatTile, type HeatCell } from './charts'
import { compactNumber, periodOption, todayIso, useWidgetData } from './hooks'
import { PeriodPicker, SectionLabel, WidgetBody, type WidgetProps } from './widget-kit'

interface TypeRow { transactionType: string; created: number; voided: number; counts: number[] }
interface Activity {
  days: number
  totalCreated: number
  totalVoided: number
  busiestDay: string | null
  busiestDayCount: number
  dates: string[]
  types: TypeRow[]
}

const PERIODS = [14, 28, 56]
// Sequential ramp, light → dark; empty days use the neutral empty step.
const RAMP = ['var(--viz-seq-1)', 'var(--viz-seq-2)', 'var(--viz-seq-3)', 'var(--viz-seq-4)', 'var(--viz-seq-5)']
const integer = (n: number) => Math.round(n).toLocaleString('en-PH')
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

// Dates here are plain calendar days ("2026-10-08"), not instants.
function dayLabel(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { ...opts, timeZone: 'UTC' })
}

export function TransactionActivityWidget({ refreshKey, options, setOptions }: WidgetProps) {
  const days = periodOption(options, PERIODS, 28)
  const state = useWidgetData<Activity>(
    `/dashboard/widgets/transaction-activity?days=${days}&asOf=${todayIso()}&tz=${encodeURIComponent(timeZone)}`, refreshKey)

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <PeriodPicker periods={PERIODS} value={days} onChange={p => setOptions({ ...options, days: p })} />
      </div>
      <WidgetBody state={state}>
        {d => {
          // Each row is shaded against its own busiest day, so low-volume types still show their rhythm.
          const top = d.types[0]
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
                <StatTile label="Documents posted" value={d.totalCreated} format={integer} hint={`in the last ${d.days} days`} />
                <StatTile label="Daily average" value={d.totalCreated / Math.max(1, d.dates.length)} format={n => n.toFixed(1)} hint="documents per day" />
                <StatTile label="Busiest day" value={d.busiestDayCount} format={integer}
                  hint={d.busiestDay ? dayLabel(d.busiestDay, { weekday: 'short', month: 'short', day: 'numeric' }) : '—'} />
                <StatTile label="Voided" value={d.totalVoided} format={integer}
                  hint={d.totalCreated ? `${((d.totalVoided / d.totalCreated) * 100).toFixed(1)}% of posted` : undefined} />
              </div>

              {d.types.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No transactions posted in this period.</p>
              ) : (
                <div>
                  <SectionLabel aside={
                    <span className="flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                      fewer <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-empty)' }} />
                      {RAMP.map(c => <span key={c} className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />)} more
                      <span className="ml-1">(per type)</span>
                    </span>
                  }>Posted per day{top ? ` · most active: ${transactionTypeLabel(top.transactionType)}` : ''}</SectionLabel>
                  <div className="overflow-x-auto">
                    <div className="min-w-[640px]">
                      <Heatmap
                        cellHeight={22}
                        rowLabelWidth={200}
                        columnLabelEvery={Math.ceil(d.dates.length / 14)}
                        rows={d.types.map(t => ({
                          key: t.transactionType,
                          label: `${transactionTypeLabel(t.transactionType)} · ${compactNumber(t.created)}`,
                          title: `${transactionTypeLabel(t.transactionType)}: ${integer(t.created)} posted, ${integer(t.voided)} voided`,
                        }))}
                        columns={d.dates.map(date => ({ key: date, label: dayLabel(date, { day: 'numeric' }), title: dayLabel(date, { weekday: 'short', month: 'short', day: 'numeric' }) }))}
                        cells={d.types.map(t => {
                          const max = Math.max(1, ...t.counts)
                          return t.counts.map((count, i): HeatCell => ({
                            color: count === 0 ? 'var(--viz-empty)' : RAMP[Math.min(RAMP.length - 1, Math.floor((count / max) * RAMP.length - 1e-9))],
                            tooltip: (
                              <>
                                <div className="font-medium">{transactionTypeLabel(t.transactionType)}</div>
                                <div className="text-[hsl(var(--muted-foreground))]">{dayLabel(d.dates[i], { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                                <div className="dash-readout mt-1">{integer(count)} posted</div>
                              </>
                            ),
                          }))
                        })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        }}
      </WidgetBody>
    </div>
  )
}
