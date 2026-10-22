import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { CloseButton } from '@/components/RecordTab'
import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { DocSheet, DocRow, DocCell, DocHeader, DocText } from '@/components/ui/doc-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { todayIso } from '@/lib/accounting'

export interface CheckStatusInput {
  date: string
  reason: string
  remarks: string
}

interface Props {
  /** null = closed */
  action: { title: string; check: string; submitLabel: string; reasons?: { value: string; label: string }[] } | null
  onClose: () => void
  onSubmit: (input: CheckStatusInput) => Promise<void>
}

/** Date (+ reason and remarks) for clearing, bouncing or cancelling one check. */
export function CheckStatusDialog({ action, onClose, onSubmit }: Props) {
  const [date, setDate] = useState(todayIso())
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (action?.reasons && !reason) return
    setLoading(true)
    try {
      await onSubmit({ date, reason, remarks })
      setReason('')
      setRemarks('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={!!action} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader className="sr-only">
          <DialogTitle>{action?.title}</DialogTitle>
        </DialogHeader>
        {action && (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <DocSheet>
              <DocRow cols="3fr 2fr">
                <DocCell label="Check"><DocText className="font-semibold">{action.check}</DocText></DocCell>
                <DocHeader title={action.title} />
              </DocRow>
              <DocRow>
                <DocCell label="Date" htmlFor="check-status-date" required>
                  <Input id="check-status-date" type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus required />
                </DocCell>
                {action.reasons && (
                  <DocCell label="Reason" htmlFor="check-status-reason" required>
                    <SearchableSelect id="check-status-reason" value={reason} onChange={setReason} options={action.reasons} />
                  </DocCell>
                )}
              </DocRow>
              {action.reasons && (
                <DocRow>
                  <DocCell label="Remarks" htmlFor="check-status-remarks">
                    <Input id="check-status-remarks" value={remarks} maxLength={200} onChange={e => setRemarks(e.target.value)} />
                  </DocCell>
                </DocRow>
              )}
            </DocSheet>
            <div className="flex justify-end gap-2">
              <CloseButton onClick={onClose} label="Cancel" />
              <Button type="submit" loading={loading} disabled={!!action.reasons && !reason}>{action.submitLabel}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
