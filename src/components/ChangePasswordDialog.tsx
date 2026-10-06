import { useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader } from '@/components/ui/doc-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function emptyForm() {
  return { currentPassword: '', newPassword: '', confirmPassword: '' }
}

export function ChangePasswordDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast()
  const [form, setForm] = useState(emptyForm())
  const [loading, setLoading] = useState(false)

  function close() {
    setForm(emptyForm())
    onOpenChange(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (form.newPassword !== form.confirmPassword) {
      toast('New password and confirmation do not match.', 'error')
      return
    }
    setLoading(true)
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      })
      toast('Password changed successfully.', 'success')
      close()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to change password.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader className="sr-only">
          <DialogTitle>Change Password</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <DocSheet>
            <DocRow>
              <DocHeader title="Change Password" />
            </DocRow>
            <DocRow>
              <DocCell label="Current Password" htmlFor="current-password" required>
                <Input
                  id="current-password"
                  type="password"
                  value={form.currentPassword}
                  onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
              </DocCell>
            </DocRow>
            <DocRow>
              <DocCell label="New Password" htmlFor="new-password" required>
                <Input
                  id="new-password"
                  type="password"
                  value={form.newPassword}
                  onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </DocCell>
            </DocRow>
            <DocRow>
              <DocCell label="Confirm New Password" htmlFor="confirm-password" required>
                <Input
                  id="confirm-password"
                  type="password"
                  value={form.confirmPassword}
                  onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </DocCell>
            </DocRow>
          </DocSheet>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" loading={loading}>Change Password</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
