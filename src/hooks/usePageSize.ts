import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'

// Rows per page is a user preference kept separately for each list/report page
// (`/me/preferences/list.pageSize:<listKey>`), so it follows the user across browsers.
// A per-user localStorage copy lets lists fetch the right size before the preference request answers.

/** Choices offered by the "Rows" selector. Capped well below the backend's 1000
 * `max-page-size`: tables don't virtualize rows, and "everything" is what Export and
 * Search all are for. A fixed set also keeps the backend's per-size cache keys few. */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const
export const DEFAULT_PAGE_SIZE = 50
export const MAX_VIEW_PAGE_SIZE = 200

const PREFERENCE_PREFIX = 'list.pageSize'

interface UserPreference {
  key: string
  value: string
}

function normalize(value: unknown): number {
  const n = Number(value)
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE
}

function preferenceKey(listKey: string) {
  return `${PREFERENCE_PREFIX}:${listKey}`
}

function storeKey(username: string | null, listKey: string) {
  return `${preferenceKey(listKey)}:${username ?? ''}`
}

function readCache(key: string): number {
  try {
    return normalize(localStorage.getItem(key))
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}

function writeCache(key: string, size: number) {
  try {
    localStorage.setItem(key, String(size))
  } catch { /* not cached */ }
}

// One store shared by every mounted list, keyed by user + list, so two instances of the same
// list (e.g. the list tab behind a record tab) stay in sync and each preference is fetched once.
const current = new Map<string, number>()
const loaded = new Set<string>()
const listeners = new Set<() => void>()

function setCurrent(key: string, size: number) {
  current.set(key, size)
  listeners.forEach(l => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The user's rows-per-page for one list/report page (`listKey`, letters/digits/`.`/`-`/`_`),
 * and a setter that saves it as their preference for that page only. */
export function usePageSize(listKey: string): [number, (size: number) => void] {
  const { username } = useAuth()
  const { toast } = useToast()
  const key = storeKey(username, listKey)
  const size = useSyncExternalStore(subscribe, () => current.get(key) ?? readCache(key))

  useEffect(() => {
    if (loaded.has(key)) return
    loaded.add(key)
    apiFetch<UserPreference | null>(`/me/preferences/${encodeURIComponent(preferenceKey(listKey))}`)
      .then(pref => {
        if (!pref) return
        const next = normalize(JSON.parse(pref.value))
        writeCache(key, next)
        setCurrent(key, next)
      })
      .catch(() => { loaded.delete(key) })
  }, [key, listKey])

  const update = useCallback((next: number) => {
    const value = normalize(next)
    setCurrent(key, value)
    writeCache(key, value)
    apiFetch<UserPreference>(`/me/preferences/${encodeURIComponent(preferenceKey(listKey))}`, {
      method: 'PUT',
      body: JSON.stringify({ value: JSON.stringify(value) }),
    }).catch(() => toast('Failed to save your rows-per-page setting.', 'error'))
  }, [key, listKey, toast])

  return [size, update]
}
