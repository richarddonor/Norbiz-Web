import { useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocText } from '@/components/ui/doc-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: number | null
  username?: string
}

export function ResetPasswordDialog({ open, onOpenChange, userId, username }: Props) {
  const { toast } = useToast()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  function close() {
    setNewPassword('')
    setConfirmPassword('')
    onOpenChange(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    if (newPassword !== confirmPassword) {
      toast('New password and confirmation do not match.', 'error')
      return
    }
    setLoading(true)
    try {
      await apiFetch(`/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      })
      toast(`Password reset for "${username}".`, 'success')
      close()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reset password.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader className="sr-only">
          <DialogTitle>Reset Password{username ? ` — ${username}` : ''}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <DocSheet>
            <DocRow cols="3fr 2fr">
              <DocCell label="User">
                <DocText className="font-semibold">{username}</DocText>
              </DocCell>
              <DocHeader title="Password Reset" />
            </DocRow>
            <DocRow>
              <DocCell label="New Password" htmlFor="reset-new-password" required>
                <Input
                  id="reset-new-password"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  autoFocus
                  required
                />
              </DocCell>
            </DocRow>
            <DocRow>
              <DocCell label="Confirm New Password" htmlFor="reset-confirm-password" required>
                <Input
                  id="reset-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </DocCell>
            </DocRow>
          </DocSheet>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" loading={loading}>Reset Password</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
