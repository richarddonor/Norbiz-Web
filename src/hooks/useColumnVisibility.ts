import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'

// Saved column layouts live on the backend as user preferences (`/me/preferences/columns:<key>`,
// value = JSON array of hidden column keys), so they follow the user across browsers. A per-user
// localStorage copy lets the page render with the right columns before the request answers.

interface UserPreference {
  key: string
  value: string
}

function cacheKey(username: string | null, key: string) {
  return `columns:${username ?? ''}:${key}`
}

function readCache(username: string | null, key: string): string[] | null {
  try {
    // Falls back to the pre-backend key (per-browser, not per-user) so old layouts carry over.
    const raw = localStorage.getItem(cacheKey(username, key)) ?? localStorage.getItem(`columns:${key}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(username: string | null, key: string, hidden: Set<string>) {
  try {
    localStorage.setItem(cacheKey(username, key), JSON.stringify(Array.from(hidden)))
    localStorage.removeItem(`columns:${key}`)
  } catch { /* not cached */ }
}

function putLayout(key: string, hidden: Set<string>) {
  return apiFetch<UserPreference>(`/me/preferences/${encodeURIComponent(`columns:${key}`)}`, {
    method: 'PUT',
    body: JSON.stringify({ value: JSON.stringify(Array.from(hidden)) }),
  })
}

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && Array.from(a).every(k => b.has(k))
}

/** Which columns a list page shows. Toggling only changes the current view; `menu.onSave` makes
 * it the user's saved layout, which the page opens with next time. Spread `menu` onto
 * `ColumnsMenu`. */
export function useColumnVisibility(storageKey: string) {
  const { username } = useAuth()
  const { toast } = useToast()
  const [saved, setSaved] = useState<Set<string>>(() => new Set(readCache(username, storageKey)))
  const [hidden, setHidden] = useState<Set<string>>(saved)
  const [saving, setSaving] = useState(false)
  const dirty = !sameSet(hidden, saved)

  useEffect(() => {
    let cancelled = false
    apiFetch<UserPreference | null>(`/me/preferences/${encodeURIComponent(`columns:${storageKey}`)}`)
      .then(pref => {
        if (cancelled) return
        if (!pref) {
          // Nothing on the server yet: push a layout saved in this browser before layouts
          // moved to the backend, so it isn't lost on the next device.
          const local = readCache(username, storageKey)
          if (local?.length) putLayout(storageKey, new Set(local)).catch(() => { /* retried on next load */ })
          return
        }
        const next = new Set<string>(JSON.parse(pref.value))
        writeCache(username, storageKey, next)
        // Adopt it unless the user already started changing the view while it loaded.
        setHidden(prev => (sameSet(prev, saved) ? next : prev))
        setSaved(next)
      })
      .catch(() => { if (!cancelled) toast('Failed to load your saved column layout.', 'error') })
    return () => { cancelled = true }
    // `saved` is only read to compare against the pre-load state; re-running on it would refetch after every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, storageKey, toast])

  const isVisible = useCallback((key: string) => !hidden.has(key), [hidden])

  function toggle(key: string) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      await putLayout(storageKey, hidden)
      writeCache(username, storageKey, hidden)
      setSaved(hidden)
      toast('Column layout saved.', 'success')
    } catch {
      toast('Failed to save column layout.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return {
    isVisible,
    toggle,
    menu: {
      isVisible,
      onToggle: toggle,
      dirty,
      saving,
      onSave: save,
      onRevert: () => setHidden(saved),
      onShowAll: () => setHidden(new Set()),
    },
  }
}
