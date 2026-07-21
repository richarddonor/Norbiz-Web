import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { fetchAllContent } from '@/hooks/usePagedList'

interface UserOption {
  username: string
  displayName: string | null
}

/** Every `Auditable` entity's createdBy/updatedBy/voidedBy is keyed by username (the
 * backend's `AuditorAwareImpl` stamps `Authentication.getName()`, not displayName — username
 * is the stable historical identifier). This resolves that username to the user's current
 * Display Name for a friendlier "Created by"/"Posted by" UI, wherever those fields are shown.
 * Falls back to the raw username when the lookup hasn't loaded yet, the user has no
 * displayName, the account no longer exists, or it's the synthetic "system" auditor.
 * Silently no-ops (permanent fallback to username) for callers without VIEW_USER. */
export function useUserDisplayNames() {
  const { hasPermission } = useAuth()
  const canViewUsers = hasPermission('VIEW_USER')
  const [map, setMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!canViewUsers) return
    fetchAllContent<UserOption>('/users')
      .then(users => {
        const next: Record<string, string> = {}
        for (const u of users) if (u.displayName) next[u.username] = u.displayName
        setMap(next)
      })
      .catch(() => {})
  }, [canViewUsers])

  return function displayName(username: string | null | undefined): string {
    if (!username) return '—'
    return map[username] ?? username
  }
}
