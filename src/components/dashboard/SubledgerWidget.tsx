import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/format'
import { useTransactionDrillDown } from '@/hooks/useTransactionDrillDown'
import type { TransactionType } from '@/hooks/useTransactionActivity'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useAuth } from '@/context/AuthContext'
import { ColumnChart, HBarList, StatTile } from './charts'
import { compactNumber, periodOption, todayIso, useWidgetData } from './hooks'
import { PeriodPicker, SectionLabel, WidgetBody, type WidgetProps } from './widget-kit'

// One widget body for both sides of the AR/AP subledger (backend SubledgerSummaryResponse):
// Receivables Aging and Payables Due.

interface Bucket { key: string; label: string; minDays: number | null; maxDays: number | null; count: number; amount: number }
interface Party { id: number | null; name: string; chargeCount: number; outstanding: number; overdue: number; unappliedCredits: number }
interface Item {
  openItemId: number
  sourceType: string
  sourceId: number
  referenceNumber: string
  documentDate: string
  dueDate: string | null
  daysOverdue: number
  partyName: string
  amount: number
  balance: number
  pending: number
}
interface Subledger {
  outstanding: number
  overdue: number
  dueSoon: number
  dueSoonDays: number
  pendingClearance: number
  unappliedCredits: number
  chargeCount: number
  overdueCount: number
  partyCount: number
  oldestOverdueDays: number | null
  periodDays: number
  billed: number
  settled: number
  buckets: Bucket[]
  byParty: Party[]
  items: Item[]
}

export interface SubledgerConfig {
  endpoint: string
  /** ['customer', 'customers'] */
  party: [string, string]
  bucketsTitle: string
  /** One color per bucket, in the backend's bucket order. */
  bucketColors: string[]
  /** Third tile: what's paid but waiting on checks (AR) or what falls due this week (AP). */
  thirdTile: 'pending' | 'dueSoon'
  creditsLabel: string
  creditsHint: string
  settledLabel: string
  barsTitle: string
  itemsTitle: string
  report: { path: string; label: string; permission: string }
  /** Days overdue past this are flagged (red + icon). */
  staleDays: number
  emptyText: string
}

const PERIODS = [30, 90]

/** The transaction an open item's source points at (charges only; tender items aren't listed). */
const SOURCE_TYPES: Record<string, TransactionType> = {
  SALES_INVOICE: 'SALES_INVOICE',
  CUSTOMER_DEBIT_MEMO: 'CUSTOMER_MEMO',
  CUSTOMER_CREDIT_MEMO: 'CUSTOMER_MEMO',
  SALES_INVOICE_RETURN: 'SALES_INVOICE_RETURN',
  CUSTOMER_REFUND: 'CUSTOMER_REFUND',
  PURCHASE_INVOICE: 'PURCHASE_INVOICE',
  SUPPLIER_CREDIT_MEMO: 'SUPPLIER_MEMO',
  SUPPLIER_DEBIT_MEMO: 'SUPPLIER_MEMO',
  SUPPLIER_REFUND: 'SUPPLIER_REFUND',
}

const integer = (n: number) => Math.round(n).toLocaleString('en-PH')
const plural = (n: number, [one, many]: [string, string]) => `${integer(n)} ${n === 1 ? one : many}`

function dueText(days: number) {
  if (days > 0) return `${days}d overdue`
  if (days === 0) return 'due today'
  return `due in ${-days}d`
}

export function SubledgerWidget({ config, refreshKey, options, setOptions }: WidgetProps & { config: SubledgerConfig }) {
  const days = periodOption(options, PERIODS, 30)
  const state = useWidgetData<Subledger>(`${config.endpoint}?days=${days}&asOf=${todayIso()}`, refreshKey)
  const { canOpen, open } = useTransactionDrillDown()
  const { openPage } = useWorkspace()
  const { hasPermission } = useAuth()

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <PeriodPicker periods={PERIODS} value={days} onChange={p => setOptions({ ...options, days: p })} />
      </div>
      <WidgetBody state={state}>
        {d => {
          const outstanding = Number(d.outstanding)
          const overdue = Number(d.overdue)
          const billed = Number(d.billed)
          const settled = Number(d.settled)
          const overdueShare = outstanding > 0 ? Math.round((overdue / outstanding) * 100) : 0
          const stale = (d.oldestOverdueDays ?? 0) > config.staleDays
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
                <StatTile label="Outstanding" value={outstanding} format={formatCurrency}
                  hint={`${plural(d.chargeCount, ['open item', 'open items'])}, ${plural(d.partyCount, config.party)}`} />
                <StatTile label="Overdue" value={overdue} format={formatCurrency} tone={stale ? 'critical' : undefined}
                  hint={d.overdueCount === 0 ? 'nothing past due' : (
                    <span className="inline-flex items-center gap-1">
                      {stale && <AlertTriangle className="h-3 w-3" />}
                      {overdueShare}% · oldest {d.oldestOverdueDays}d
                    </span>
                  )} />
                {config.thirdTile === 'pending'
                  ? <StatTile label="Awaiting clearance" value={Number(d.pendingClearance)} format={formatCurrency} hint="paid by checks not yet cleared" />
                  : <StatTile label={`Due in ${d.dueSoonDays} days`} value={Number(d.dueSoon)} format={formatCurrency} hint="not yet overdue" />}
                <StatTile label={config.creditsLabel} value={Number(d.unappliedCredits)} format={formatCurrency} hint={config.creditsHint} />
              </div>

              <div>
                <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">last {d.periodDays} days</span>}>
                  Billed vs {config.settledLabel.toLowerCase()}
                </SectionLabel>
                <HBarList
                  format={formatCurrency}
                  data={[
                    { key: 'billed', label: 'Billed', value: billed, detail: 'invoices and charge memos' },
                    {
                      key: 'settled', label: config.settledLabel, value: settled,
                      display: `${formatCurrency(settled)}${billed > 0 ? ` · ${Math.round((settled / billed) * 100)}%` : ''}`,
                      detail: 'money paid; credits used and bounced/cancelled checks excluded',
                    },
                  ]}
                />
              </div>

              {d.chargeCount === 0 ? (
                <div className="flex h-24 items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">{config.emptyText}</div>
              ) : (
                <>
                  <div>
                    <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">balance by due date</span>}>
                      {config.bucketsTitle}
                    </SectionLabel>
                    <ColumnChart
                      format={compactNumber}
                      data={d.buckets.map((b, i) => ({
                        label: b.label,
                        value: Number(b.amount),
                        color: config.bucketColors[i] ?? 'var(--viz-other)',
                        tooltip: (
                          <>
                            <div className="mb-1 font-medium">{b.label}</div>
                            <div>{formatCurrency(b.amount)}</div>
                            <div className="text-[hsl(var(--muted-foreground))]">{plural(b.count, ['open item', 'open items'])}</div>
                          </>
                        ),
                      }))}
                    />
                  </div>

                  <div className="grid gap-5 @2xl:grid-cols-2 [&>*]:min-w-0">
                    <div>
                      <SectionLabel>{config.barsTitle}</SectionLabel>
                      <HBarList
                        format={compactNumber}
                        data={d.byParty.filter(p => p.id != null).map(p => ({
                          key: p.id!,
                          label: p.name,
                          value: Number(p.outstanding),
                          display: compactNumber(Number(p.outstanding)),
                          detail: [
                            plural(p.chargeCount, ['open item', 'open items']),
                            Number(p.overdue) > 0 && `${formatCurrency(p.overdue)} overdue`,
                            Number(p.unappliedCredits) > 0 && `${formatCurrency(p.unappliedCredits)} unapplied credit`,
                          ].filter(Boolean).join(', '),
                        }))}
                      />
                      {d.byParty.filter(p => p.id == null).map(p => (
                        <p key="others" className="mt-3 border-t pt-2 text-xs text-[hsl(var(--muted-foreground))]">
                          + {plural(d.partyCount - (d.byParty.length - 1), [`more ${config.party[0]}`, `more ${config.party[1]}`])}:{' '}
                          <span className="dash-readout text-[hsl(var(--foreground))]">{formatCurrency(p.outstanding)}</span>
                        </p>
                      ))}
                    </div>
                    <div>
                      <SectionLabel
                        aside={hasPermission(config.report.permission) && (
                          <button type="button" onClick={() => openPage(config.report.path)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--primary))] hover:underline">
                            {config.report.label} <ArrowUpRight className="h-3 w-3" />
                          </button>
                        )}
                      >
                        {config.itemsTitle}
                      </SectionLabel>
                      <ul className="divide-y rounded-xl border bg-[hsl(var(--background))]/60">
                        {d.items.map(item => {
                          const type = SOURCE_TYPES[item.sourceType] ?? null
                          const late = item.daysOverdue > config.staleDays
                          const detail = [
                            item.dueDate ? `due ${formatDate(item.dueDate)}` : formatDate(item.documentDate),
                            `${formatCurrency(item.balance)} of ${formatCurrency(item.amount)}`,
                            Number(item.pending) > 0 && `${formatCurrency(item.pending)} awaiting clearance`,
                          ].filter(Boolean).join(' · ')
                          return (
                            <li key={item.openItemId}>
                              <button
                                type="button"
                                disabled={!canOpen(type)}
                                onClick={() => type && open(type, item.sourceId)}
                                className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors enabled:hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
                              >
                                <span className={'dash-readout w-20 shrink-0 rounded-md border px-1.5 py-0.5 text-center font-semibold '
                                  + (late ? 'border-[var(--viz-critical)] text-[var(--viz-critical)]' : item.daysOverdue > 0 ? 'text-[var(--viz-serious)]' : '')}>
                                  {dueText(item.daysOverdue)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-medium">{item.referenceNumber} · {item.partyName}</span>
                                  <span className="block truncate text-[hsl(var(--muted-foreground))]">{detail}</span>
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          )
        }}
      </WidgetBody>
    </div>
  )
}
