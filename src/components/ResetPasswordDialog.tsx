import { useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
        <DialogHeader>
          <DialogTitle>Reset Password{username ? ` — ${username}` : ''}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="reset-new-password">New Password</Label>
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm-password">Confirm New Password</Label>
            <Input
              id="reset-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" loading={loading}>Reset Password</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
