import { ArrowDown, ArrowUp, Crown, Minus, Sparkles } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Sparkline, StatTile } from './charts'
import { compactNumber, periodOption, todayIso, useWidgetData } from './hooks'
import { PeriodPicker, SectionLabel, WidgetBody, type WidgetProps } from './widget-kit'

interface Agent {
  rank: number
  id: number
  name: string
  netSales: number
  grossSales: number
  returns: number
  documentCount: number
  previousNetSales: number
  previousRank: number | null
  dailyNet: number[]
}
interface Leaderboard { days: number; activeAgents: number; netSales: number; agents: Agent[] }

const PERIODS = [7, 30, 90]
const integer = (n: number) => Math.round(n).toLocaleString('en-PH')

function Movement({ rank, previousRank }: { rank: number; previousRank: number | null }) {
  if (previousRank == null) {
    return <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--viz-1)]" title="No sales in the prior period"><Sparkles className="h-3 w-3" />new</span>
  }
  const delta = previousRank - rank
  if (delta === 0) return <span className="inline-flex text-[hsl(var(--muted-foreground))]" title="Same rank as the prior period"><Minus className="h-3 w-3" /></span>
  return delta > 0
    ? <span className="dash-readout inline-flex items-center text-[10px]" title={`Up from #${previousRank}`}><ArrowUp className="h-3 w-3" />{delta}</span>
    : <span className="dash-readout inline-flex items-center text-[10px] text-[hsl(var(--muted-foreground))]" title={`Down from #${previousRank}`}><ArrowDown className="h-3 w-3" />{-delta}</span>
}

export function AgentLeaderboardWidget({ refreshKey, options, setOptions }: WidgetProps) {
  const days = periodOption(options, PERIODS, 30)
  const state = useWidgetData<Leaderboard>(`/dashboard/widgets/agent-leaderboard?days=${days}&asOf=${todayIso()}`, refreshKey)

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <PeriodPicker periods={PERIODS} value={days} onChange={p => setOptions({ ...options, days: p })} />
      </div>
      <WidgetBody state={state}>
        {d => {
          const top = d.agents[0]
          const topShare = top && Number(d.netSales) > 0 ? (Number(top.netSales) / Number(d.netSales)) * 100 : 0
          const max = Math.max(1, ...d.agents.map(a => Number(a.netSales)))
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3">
                <StatTile label="Net sales (all agents)" value={Number(d.netSales)} format={formatCurrency} hint="commission base" />
                <StatTile label="Active agents" value={d.activeAgents} format={integer} hint={`with sales in ${d.days} days`} />
                <StatTile label="Top agent share" value={topShare} format={n => `${n.toFixed(1)}%`} hint={top ? top.name : '—'} />
              </div>

              {d.agents.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No agent sales in this period.</p>
              ) : (
                <div>
                  <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">net sales · daily trend · returns</span>}>Leaderboard</SectionLabel>
                  <ol className="space-y-1.5">
                    {d.agents.map(a => {
                      const returnRate = Number(a.grossSales) > 0 ? (Number(a.returns) / Number(a.grossSales)) * 100 : 0
                      const change = Number(a.previousNetSales) !== 0
                        ? ((Number(a.netSales) - Number(a.previousNetSales)) / Math.abs(Number(a.previousNetSales))) * 100 : null
                      return (
                        <li key={a.id} className={cn('relative grid grid-cols-[2.25rem_1fr_auto] items-center gap-3 overflow-hidden rounded-xl border px-3 py-2 @md:grid-cols-[2.25rem_1fr_96px_auto]',
                          a.rank <= 3 ? 'bg-[hsl(var(--background))]/80' : 'bg-[hsl(var(--background))]/40')}
                          style={a.rank === 1 ? { boxShadow: '0 0 18px -6px rgb(var(--viz-glow) / 0.6)' } : undefined}>
                          {/* Faint bar behind the row: share of the leader's net. */}
                          <span aria-hidden className="dash-grow absolute inset-y-0 left-0 -z-0 bg-[var(--viz-1)] opacity-[0.07]" style={{ width: `${(Number(a.netSales) / max) * 100}%` }} />
                          <span className="relative flex flex-col items-center">
                            <span className={cn('dash-readout flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                              a.rank <= 3 ? 'border border-[var(--viz-1)] text-[var(--viz-1)]' : 'text-[hsl(var(--muted-foreground))]')}>
                              {a.rank === 1 ? <Crown className="h-3.5 w-3.5" aria-label="1st" /> : a.rank}
                            </span>
                            <Movement rank={a.rank} previousRank={a.previousRank} />
                          </span>
                          <span className="relative min-w-0">
                            <span className="block truncate text-sm font-medium">{a.name}</span>
                            <span className="block text-[11px] text-[hsl(var(--muted-foreground))]">
                              {integer(a.documentCount)} sales · {returnRate.toFixed(1)}% returned
                              {change != null && ` · ${change >= 0 ? '+' : ''}${change.toFixed(0)}% vs prior`}
                            </span>
                          </span>
                          <span className="relative hidden @md:block"><Sparkline values={a.dailyNet.map(Number)} /></span>
                          <span className="dash-readout relative text-right text-sm font-semibold" title={formatCurrency(a.netSales)}>{compactNumber(Number(a.netSales))}</span>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )}
            </div>
          )
        }}
      </WidgetBody>
    </div>
  )
}
