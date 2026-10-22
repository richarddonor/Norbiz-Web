import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText } from '@/components/ui/doc-form'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useCompanyOptions } from '@/components/accounting/useCompanyOptions'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { formatDate, formatDateTime } from '@/lib/format'

interface AccountingSettings {
  companyId: number
  configured: boolean
  startDate: string | null
  checkClearingDays: number
  updatedAt: string | null
  updatedBy: string | null
}

// Per-company AR/AP settings (docs/ACCOUNTING.md "Start date"). Sales/Purchase Invoices dated on/after the start date
// are tracked as receivables/payables; older balances come in as OPENING_BALANCE memos. Nothing in AR/AP posts until
// it is set, and it can't move once anything has been applied.
export function AccountingSettingsPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId } = useAuth()
  const companies = useCompanyOptions(true)
  const resolveDisplayName = useUserDisplayNames()
  const canManage = hasPermission('MANAGE_ACCOUNTING_SETTINGS')
  const [companyId, setCompanyId] = useState<number | ''>(activeCompanyId ?? '')
  const [settings, setSettings] = useState<AccountingSettings | null>(null)
  const [startDate, setStartDate] = useState('')
  const [clearingDays, setClearingDays] = useState('3')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    apiFetch<AccountingSettings>(`/accounting/settings?companyId=${companyId}`)
      .then(s => {
        setSettings(s)
        setStartDate(s.startDate?.slice(0, 10) ?? '')
        setClearingDays(String(s.checkClearingDays))
      })
      .catch(err => toast(mutationErrorMessage(err, 'Failed to load accounting settings.'), 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!companyId) return toast('Select a company.', 'error')
    if (!startDate) return toast('Enter the accounting start date.', 'error')
    const moving = settings?.configured && settings.startDate?.slice(0, 10) !== startDate
    const message = settings?.configured
      ? (moving ? `Move the accounting start date to ${startDate}? Purchase invoices are re-tracked from the new date.` : 'Save accounting settings?')
      : `Start accounting on ${startDate}? Purchase invoices posted on/after it become payables; enter older balances as Opening Balance memos.`
    if (!window.confirm(message)) return
    setLoading(true)
    try {
      const saved = await apiFetch<AccountingSettings>('/accounting/settings', {
        method: 'PUT',
        body: JSON.stringify({ companyId, startDate, checkClearingDays: clearingDays.trim() !== '' ? Number(clearingDays) : null }),
      })
      setSettings(saved)
      toast('Accounting settings saved.', 'success')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to save accounting settings.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Accounting Settings</h1>
      <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
        <DocSheet>
          <DocRow cols="3fr 2fr">
            <DocCell label="Company" htmlFor="acct-settings-company" required>
              <SearchableSelect id="acct-settings-company" value={companyId === '' ? '' : String(companyId)} onChange={v => setCompanyId(v ? Number(v) : '')}
                options={companies.map(c => ({ value: String(c.id), label: c.name }))} />
            </DocCell>
            <DocHeader title="Accounting Settings" />
          </DocRow>
          <DocRow>
            <DocCell label="Accounting Start Date" htmlFor="acct-settings-start" required={canManage}>
              <Input id="acct-settings-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} readOnly={!canManage} />
            </DocCell>
            <DocCell label="Check Clearing Days" htmlFor="acct-settings-clearing">
              <Input id="acct-settings-clearing" type="number" min="0" max="60" value={clearingDays} onChange={e => setClearingDays(e.target.value)} readOnly={!canManage} />
            </DocCell>
          </DocRow>
          <DocRow>
            <DocCell label="Status">
              <DocText>
                {!settings ? '' : settings.configured
                  ? `Tracking receivables and payables from ${formatDate(settings.startDate)}.`
                  : 'Not configured — no receivable/payable documents can be posted yet.'}
              </DocText>
            </DocCell>
            {settings?.configured && (
              <DocCell label="Last updated">
                <DocText>{resolveDisplayName(settings.updatedBy)} {formatDateTime(settings.updatedAt)}</DocText>
              </DocCell>
            )}
          </DocRow>
        </DocSheet>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Sales and Purchase Invoices dated on or after the start date are tracked as receivables and payables. Enter balances from before it as
          customer/supplier memos with the reason Opening Balance, dated before the start date. The date can no longer change once a payment, memo
          or application has been posted.
        </p>
        {canManage && (
          <div className="flex justify-end">
            <Button type="submit" loading={loading}>Save</Button>
          </div>
        )}
      </form>
    </div>
  )
}
