import { AlertTriangle, ArrowUpRight, Lock } from 'lucide-react'
import { formatCurrency, formatDate, formatQuantity } from '@/lib/format'
import { useTransactionDrillDown } from '@/hooks/useTransactionDrillDown'
import type { TransactionType } from '@/hooks/useTransactionActivity'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useAuth } from '@/context/AuthContext'
import { ColumnChart, HBarList, RadialGauge, SegmentBar, StatTile } from './charts'
import { compactNumber, todayIso, useWidgetData } from './hooks'
import { SectionLabel, WidgetBody, type WidgetProps } from './widget-kit'

// One widget body for every "documents still waiting on something" report (backend BacklogResponse):
// Pending Outlet Receives, Pending Purchase Orders, Pull-outs Awaiting Receive, Unpaid Purchase Invoices.

interface AgingBucket { label: string; minDays: number; documentCount: number; outstandingQuantity: number | null; outstandingAmount: number | null }
interface Slice { id: number | null; name: string; documentCount: number; quantity: number | null; amount: number | null }
interface BacklogDocument {
  id: number
  referenceNumber: string
  date: string
  ageDays: number
  counterpartyName: string
  group: string | null
  quantity: number | null
  outstandingQuantity: number | null
  outstandingAmount: number | null
}
interface Backlog {
  documentCount: number
  counterpartyCount: number
  outstandingQuantity: number | null
  outstandingAmount: number | null
  progressPercent: number | null
  oldestAgeDays: number | null
  aging: AgingBucket[]
  byCounterparty: Slice[]
  breakdown: Slice[]
  oldest: BacklogDocument[]
}

export interface BacklogConfig {
  endpoint: string
  /** ['receipt', 'receipts'] */
  document: [string, string]
  counterparty: [string, string]
  quantityHint?: string
  amountLabel: string
  amountHint: string
  progressLabel?: string
  progressCaption?: string
  breakdownTitle?: string
  barsTitle: string
  oldestTitle: string
  drillType: TransactionType
  listPage?: { path: string; label: string; permission: string }
  /** Ages past this are flagged (red + icon). */
  staleDays: number
  emptyText: string
}

// Older buckets get the deeper ramp step: aging is ordered magnitude, so one hue, light → dark.
const AGING_COLORS = ['var(--viz-seq-1)', 'var(--viz-seq-2)', 'var(--viz-seq-3)', 'var(--viz-seq-4)', 'var(--viz-seq-5)']

const integer = (n: number) => Math.round(n).toLocaleString('en-PH')
const plural = (n: number, [one, many]: [string, string]) => `${integer(n)} ${n === 1 ? one : many}`

/** The figure a slice's bar is sized by: quantity when there is one, else amount, else document count. */
function measure(s: Slice): { value: number; display: string } {
  if (s.quantity != null) return { value: Number(s.quantity), display: compactNumber(Number(s.quantity)) }
  if (s.amount != null) return { value: Number(s.amount), display: compactNumber(Number(s.amount)) }
  return { value: s.documentCount, display: integer(s.documentCount) }
}

export function BacklogWidget({ config, refreshKey }: WidgetProps & { config: BacklogConfig }) {
  const state = useWidgetData<Backlog>(`${config.endpoint}?asOf=${todayIso()}`, refreshKey)
  const { canOpen, open } = useTransactionDrillDown()
  const { openPage } = useWorkspace()
  const { hasPermission } = useAuth()
  const hasQuantity = state.data?.outstandingQuantity != null

  return (
    <WidgetBody state={state}>
      {d => d.documentCount === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
          <span className="dash-readout text-3xl font-semibold text-[var(--viz-1)]">0</span>
          <span className="text-sm text-[hsl(var(--muted-foreground))]">{config.emptyText}</span>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
            <StatTile label={`Pending ${config.document[1]}`} value={d.documentCount} format={integer}
              hint={`across ${plural(d.counterpartyCount, config.counterparty)}`} />
            {hasQuantity
              ? <StatTile label="Outstanding qty" value={Number(d.outstandingQuantity)} format={n => formatQuantity(Math.round(n))} hint={config.quantityHint} />
              : (() => {
                const stale = d.aging.filter(b => b.minDays > config.staleDays).reduce((a, b) => a + b.documentCount, 0)
                return <StatTile label={`Over ${config.staleDays} days`} value={stale} format={integer}
                  hint={`${d.documentCount ? Math.round((stale / d.documentCount) * 100) : 0}% of pending ${config.document[1]}`} />
              })()}
            {d.outstandingAmount != null
              ? <StatTile label={config.amountLabel} value={Number(d.outstandingAmount)} format={formatCurrency} hint={config.amountHint} />
              : (
                <div className="rounded-xl border bg-[hsl(var(--background))]/60 px-4 py-3">
                  <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">{config.amountLabel}</div>
                  <div className="dash-readout mt-1 text-2xl font-semibold text-[hsl(var(--muted-foreground))]">—</div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]"><Lock className="h-3 w-3" /> needs cost price access</div>
                </div>
              )}
            <StatTile
              label="Oldest pending"
              value={d.oldestAgeDays ?? 0}
              format={n => `${Math.round(n)}d`}
              tone={(d.oldestAgeDays ?? 0) > config.staleDays ? 'critical' : undefined}
              hint={(d.oldestAgeDays ?? 0) > config.staleDays
                ? <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> over {config.staleDays} days</span>
                : 'days old'}
            />
          </div>

          <div className="grid gap-5 @2xl:grid-cols-[1fr_auto] [&>*]:min-w-0">
            <div>
              <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">{config.document[1]} by age</span>}>Aging</SectionLabel>
              <ColumnChart
                format={integer}
                data={d.aging.map((b, i) => ({
                  label: b.label,
                  value: b.documentCount,
                  color: AGING_COLORS[i] ?? AGING_COLORS[AGING_COLORS.length - 1],
                  tooltip: (
                    <>
                      <div className="mb-1 font-medium">{b.label}</div>
                      <div>{plural(b.documentCount, config.document)}</div>
                      <div className="text-[hsl(var(--muted-foreground))]">
                        {[b.outstandingQuantity != null && `${formatQuantity(b.outstandingQuantity)} units`,
                          b.outstandingAmount != null && formatCurrency(b.outstandingAmount)].filter(Boolean).join(' · ')}
                      </div>
                    </>
                  ),
                }))}
              />
            </div>
            {d.progressPercent != null && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-[hsl(var(--background))]/60 px-6 py-3">
                <RadialGauge percent={Number(d.progressPercent)} label={config.progressLabel ?? 'done'} />
                {config.progressCaption && (
                  <p className="max-w-[160px] text-center text-[11px] text-[hsl(var(--muted-foreground))]">{config.progressCaption}</p>
                )}
              </div>
            )}
          </div>

          {d.breakdown.length > 0 && config.breakdownTitle && (
            <div>
              <SectionLabel>{config.breakdownTitle}</SectionLabel>
              <SegmentBar
                format={n => (hasQuantity ? compactNumber(n) : d.outstandingAmount != null ? compactNumber(n) : integer(n))}
                segments={d.breakdown.map(s => ({
                  key: s.name,
                  label: s.name,
                  value: measure(s).value,
                  other: s.name.startsWith('Others (') && s.id == null,
                  detail: plural(s.documentCount, config.document),
                }))}
              />
            </div>
          )}

          <div className="grid gap-5 @2xl:grid-cols-2 [&>*]:min-w-0">
            <div>
              <SectionLabel>{config.barsTitle}</SectionLabel>
              <HBarList
                format={compactNumber}
                data={d.byCounterparty.filter(s => s.id != null).map(s => ({
                  key: s.id!,
                  label: s.name,
                  value: measure(s).value,
                  display: measure(s).display,
                  detail: [plural(s.documentCount, config.document), s.amount != null && formatCurrency(s.amount)].filter(Boolean).join(', '),
                }))}
              />
              {/* The backend folds the long tail into one "Others" row; kept off the bar scale so it doesn't flatten the leaders. */}
              {d.byCounterparty.filter(s => s.id == null).map(s => (
                <p key="others" className="mt-3 border-t pt-2 text-xs text-[hsl(var(--muted-foreground))]">
                  + {plural(d.counterpartyCount - (d.byCounterparty.length - 1), [`more ${config.counterparty[0]}`, `more ${config.counterparty[1]}`])}:{' '}
                  <span className="dash-readout text-[hsl(var(--foreground))]">{measure(s).display}</span>
                  {s.quantity != null ? ' units' : ''} in {plural(s.documentCount, config.document)}
                </p>
              ))}
            </div>
            <div>
              <SectionLabel
                aside={config.listPage && hasPermission(config.listPage.permission) && (
                  <button type="button" onClick={() => openPage(config.listPage!.path)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--primary))] hover:underline">
                    {config.listPage.label} <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              >
                {config.oldestTitle}
              </SectionLabel>
              <ul className="divide-y rounded-xl border bg-[hsl(var(--background))]/60">
                {d.oldest.map(doc => {
                  const stale = doc.ageDays > config.staleDays
                  const share = doc.quantity && doc.outstandingQuantity != null ? 1 - doc.outstandingQuantity / doc.quantity : null
                  const detail = [
                    formatDate(doc.date),
                    doc.outstandingQuantity != null && doc.quantity != null
                      ? `${formatQuantity(doc.outstandingQuantity)} of ${formatQuantity(doc.quantity)} units left`
                      : doc.outstandingAmount != null ? formatCurrency(doc.outstandingAmount) : null,
                    doc.group,
                  ].filter(Boolean).join(' · ')
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        disabled={!canOpen(config.drillType)}
                        onClick={() => open(config.drillType, doc.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors enabled:hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
                      >
                        <span className={'dash-readout w-12 shrink-0 rounded-md border px-1.5 py-0.5 text-center font-semibold '
                          + (stale ? 'border-[var(--viz-critical)] text-[var(--viz-critical)]' : '')}
                          title={stale ? `Over ${config.staleDays} days` : undefined}>
                          {doc.ageDays}d
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{doc.referenceNumber} · {doc.counterpartyName}</span>
                          <span className="block truncate text-[hsl(var(--muted-foreground))]">{detail}</span>
                        </span>
                        {share != null && (
                          <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-[hsl(var(--secondary))]" title={`${Math.round(share * 100)}% done`}>
                            <span className="block h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${share * 100}%` }} />
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </WidgetBody>
  )
}
