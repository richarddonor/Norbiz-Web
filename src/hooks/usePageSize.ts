import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'

// Rows per page on list/report pages is one user preference (`/me/preferences/list.pageSize`),
// shared by every list, so it follows the user across pages and browsers. A per-user
// localStorage copy lets lists fetch the right size before the preference request answers.

/** Choices offered by the "Rows" selector. Capped well below the backend's 1000
 * `max-page-size`: tables don't virtualize rows, and "everything" is what Export and
 * Search all are for. A fixed set also keeps the backend's per-size cache keys few. */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const
export const DEFAULT_PAGE_SIZE = 50
export const MAX_VIEW_PAGE_SIZE = 200

const PREFERENCE_KEY = 'list.pageSize'

interface UserPreference {
  key: string
  value: string
}

function normalize(value: unknown): number {
  const n = Number(value)
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE
}

function cacheKey(username: string | null) {
  return `${PREFERENCE_KEY}:${username ?? ''}`
}

function readCache(username: string | null): number {
  try {
    return normalize(localStorage.getItem(cacheKey(username)))
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}

function writeCache(username: string | null, size: number) {
  try {
    localStorage.setItem(cacheKey(username), String(size))
  } catch { /* not cached */ }
}

// One store for every mounted list, so changing the size on one page updates the others
// (e.g. the list tab behind a record tab) and the preference is fetched once per user.
let current: { username: string | null; size: number } | null = null
let loadedFor: string | null | undefined
const listeners = new Set<() => void>()

function setCurrent(username: string | null, size: number) {
  current = { username, size }
  listeners.forEach(l => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The user's rows-per-page for list/report pages, and a setter that saves it as their preference. */
export function usePageSize(): [number, (size: number) => void] {
  const { username } = useAuth()
  const { toast } = useToast()
  const size = useSyncExternalStore(subscribe, () => (current?.username === username ? current.size : readCache(username)))

  useEffect(() => {
    if (loadedFor === username) return
    loadedFor = username
    apiFetch<UserPreference | null>(`/me/preferences/${encodeURIComponent(PREFERENCE_KEY)}`)
      .then(pref => {
        if (!pref) return
        const next = normalize(JSON.parse(pref.value))
        writeCache(username, next)
        setCurrent(username, next)
      })
      .catch(() => { loadedFor = undefined })
  }, [username])

  const update = useCallback((next: number) => {
    const value = normalize(next)
    setCurrent(username, value)
    writeCache(username, value)
    apiFetch<UserPreference>(`/me/preferences/${encodeURIComponent(PREFERENCE_KEY)}`, {
      method: 'PUT',
      body: JSON.stringify({ value: JSON.stringify(value) }),
    }).catch(() => toast('Failed to save your rows-per-page setting.', 'error'))
  }, [username, toast])

  return [size, update]
}
