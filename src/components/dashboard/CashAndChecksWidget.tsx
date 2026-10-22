import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/format'
import { useTransactionDrillDown } from '@/hooks/useTransactionDrillDown'
import type { TransactionType } from '@/hooks/useTransactionActivity'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useAuth } from '@/context/AuthContext'
import { HBarList, StatTile } from './charts'
import { compactNumber, shortDay, todayIso, useWidgetData } from './hooks'
import { SectionLabel, WidgetBody, type WidgetProps } from './widget-kit'

interface Stat { count: number; amount: number }
interface Account {
  id: number
  name: string
  accountNumber: string
  bankName: string
  active: boolean
  bookBalance: number
  depositsInTransit: number
  outstandingDisbursements: number
  lastReconciled: string | null
}
interface Check {
  tenderId: number
  paymentId: number
  paymentReference: string
  partyName: string
  checkNumber: string | null
  checkDate: string | null
  daysFromCheckDate: number | null
  bankName: string | null
  amount: number
  status: string
  statusDate: string | null
}
interface CashAndChecks {
  bookBalance: number
  undepositedCash: Stat
  checksOnHand: Stat
  postDatedChecks: Stat
  depositedUncleared: Stat
  issuedOutstanding: Stat
  bounced: Stat
  bouncedWindowDays: number
  accounts: Account[]
  toDeposit: Check[]
  outstanding: Check[]
  recentlyBounced: Check[]
}

/** Banks usually refuse checks older than six months; flag them a month before. */
const STALE_CHECK_DAYS = 150

const integer = (n: number) => Math.round(n).toLocaleString('en-PH')
const plural = (n: number, one: string, many: string) => `${integer(n)} ${n === 1 ? one : many}`
const signed = (n: number) => (n < 0 ? '−' : '') + compactNumber(Math.abs(n))

function CheckList({ checks, type, empty, badge }: {
  checks: Check[]
  type: TransactionType
  empty: string
  badge: (c: Check) => { text: string; tone?: 'critical' | 'muted' }
}) {
  const { canOpen, open } = useTransactionDrillDown()
  if (!checks.length) return <p className="text-xs text-[hsl(var(--muted-foreground))]">{empty}</p>
  return (
    <ul className="divide-y rounded-xl border bg-[hsl(var(--background))]/60">
      {checks.map(c => {
        const b = badge(c)
        return (
          <li key={c.tenderId}>
            <button
              type="button"
              disabled={!canOpen(type)}
              onClick={() => open(type, c.paymentId)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors enabled:hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
            >
              <span className={'dash-readout w-16 shrink-0 rounded-md border px-1.5 py-0.5 text-center font-semibold '
                + (b.tone === 'critical' ? 'border-[var(--viz-critical)] text-[var(--viz-critical)]' : b.tone === 'muted' ? 'text-[hsl(var(--muted-foreground))]' : '')}>
                {b.text}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.checkNumber ?? '—'} · {c.partyName}</span>
                <span className="block truncate text-[hsl(var(--muted-foreground))]">
                  {[c.checkDate && formatDate(c.checkDate), c.bankName, c.paymentReference].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="dash-readout shrink-0">{formatCurrency(c.amount)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function age(c: Check): { text: string; tone?: 'critical' | 'muted' } {
  const d = c.daysFromCheckDate
  if (d == null) return { text: '—', tone: 'muted' }
  if (d < 0) return { text: `PDC ${-d}d`, tone: 'muted' }
  return { text: `${d}d`, tone: d > STALE_CHECK_DAYS ? 'critical' : undefined }
}

export function CashAndChecksWidget({ refreshKey }: WidgetProps) {
  const state = useWidgetData<CashAndChecks>(`/dashboard/widgets/cash-and-checks?asOf=${todayIso()}`, refreshKey)
  const { openPage } = useWorkspace()
  const { hasPermission } = useAuth()

  return (
    <WidgetBody state={state}>
      {d => {
        const depositable = Number(d.undepositedCash.amount) + Number(d.checksOnHand.amount) - Number(d.postDatedChecks.amount)
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
              <StatTile label="Book balance" value={Number(d.bookBalance)} format={formatCurrency}
                hint={`across ${plural(d.accounts.length, 'bank account', 'bank accounts')}`} />
              <StatTile label="Ready to deposit" value={depositable} format={formatCurrency}
                hint={Number(d.postDatedChecks.count) > 0
                  ? `+ ${formatCurrency(d.postDatedChecks.amount)} in ${plural(d.postDatedChecks.count, 'post-dated check', 'post-dated checks')}`
                  : `${formatCurrency(d.undepositedCash.amount)} cash, ${plural(d.checksOnHand.count, 'check', 'checks')}`} />
              <StatTile label="Deposits not cleared" value={Number(d.depositedUncleared.amount)} format={formatCurrency}
                hint={plural(d.depositedUncleared.count, 'deposited check', 'deposited checks')} />
              <StatTile label="Issued, not cleared" value={Number(d.issuedOutstanding.amount)} format={formatCurrency}
                hint={plural(d.issuedOutstanding.count, 'check to suppliers', 'checks to suppliers')} />
            </div>

            {d.bounced.count > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-[var(--viz-critical)]/50 px-3 py-2 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--viz-critical)]" />
                <span>
                  <span className="dash-readout font-semibold text-[var(--viz-critical)]">{plural(d.bounced.count, 'check', 'checks')}</span>{' '}
                  bounced in the last {d.bouncedWindowDays} days ({formatCurrency(d.bounced.amount)}). Their invoices are open again until replaced.
                </span>
              </div>
            )}

            <div>
              <SectionLabel
                aside={hasPermission('VIEW_BANK_BOOK') && (
                  <button type="button" onClick={() => openPage('/reports/bank-book')}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--primary))] hover:underline">
                    Bank Book <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              >
                Bank accounts
              </SectionLabel>
              {d.accounts.length ? (
                <HBarList
                  format={compactNumber}
                  data={d.accounts.map(a => ({
                    key: a.id,
                    label: `${a.name} · ${a.bankName}${a.active ? '' : ' (inactive)'}`,
                    value: Math.max(0, Number(a.bookBalance)),
                    display: signed(Number(a.bookBalance)),
                    detail: [
                      a.accountNumber,
                      Number(a.depositsInTransit) !== 0 && `${formatCurrency(a.depositsInTransit)} deposits in transit`,
                      Number(a.outstandingDisbursements) !== 0 && `${formatCurrency(Math.abs(Number(a.outstandingDisbursements)))} outstanding`,
                      a.lastReconciled ? `reconciled to ${formatDate(a.lastReconciled)}` : 'never reconciled',
                    ].filter(Boolean).join(' · '),
                  }))}
                />
              ) : <p className="text-xs text-[hsl(var(--muted-foreground))]">No bank accounts yet.</p>}
            </div>

            <div className="grid gap-5 @2xl:grid-cols-2 [&>*]:min-w-0">
              <div>
                <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">by check date</span>}>Checks on hand</SectionLabel>
                <CheckList checks={d.toDeposit} type="CUSTOMER_PAYMENT" empty="No checks waiting to be deposited." badge={age} />
              </div>
              <div>
                <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">oldest first</span>}>Our checks outstanding</SectionLabel>
                <CheckList checks={d.outstanding} type="SUPPLIER_PAYMENT" empty="Every check we issued has cleared." badge={age} />
              </div>
            </div>

            {d.recentlyBounced.length > 0 && (
              <div>
                <SectionLabel>Recently bounced</SectionLabel>
                <CheckList checks={d.recentlyBounced} type="CUSTOMER_PAYMENT" empty=""
                  badge={c => ({ text: c.statusDate ? shortDay(c.statusDate) : '—', tone: 'critical' })} />
              </div>
            )}
          </div>
        )
      }}
    </WidgetBody>
  )
}
