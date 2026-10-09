import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { formatDate } from '@/lib/format'
import type { LayoutItem } from './widget-kit'

/** The user's local calendar day — the backend ages documents against it, not the server's UTC day. */
export function todayIso() {
  return formatDate(new Date().toISOString())
}

/** Fetches a widget's data; refetches when the URL, the active company or `refreshKey` changes.
 * `loading` is true while the latest request is in flight (stale data stays shown meanwhile). */
export function useWidgetData<T>(url: string, refreshKey: number) {
  const { activeCompanyId } = useAuth()
  const requestKey = `${url}|${activeCompanyId}|${refreshKey}`
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null }>({ key: '', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    apiFetch<T>(url)
      .then(d => { if (!cancelled) setResult({ key: requestKey, data: d, error: null }) })
      .catch(err => {
        if (!cancelled) setResult(prev => ({ key: requestKey, data: prev.data, error: err instanceof Error ? err.message : 'Failed to load' }))
      })
    return () => { cancelled = true }
  }, [url, requestKey])

  return { data: result.data, error: result.error, loading: result.key !== requestKey }
}

/** Counts up from 0 to `value` once, for the headline readouts. */
export function useCountUp(value: number, durationMs = 900) {
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (reduced) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      setShown(value * (1 - Math.pow(1 - t, 3)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, durationMs, reduced])
  return reduced ? value : shown
}

export function compactNumber(n: number) {
  return Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

// ---- Per-user layout ---------------------------------------------------------------------------

const PREF_KEY = 'dashboard.layout'

interface StoredLayout {
  version: 1
  widgets: LayoutItem[]
}

/**
 * The user's dashboard: which widgets are pinned, in what order, and how wide. Saved as the user's own
 * preference (`/me/preferences/dashboard.layout`) so it follows them across browsers and companies.
 * Until they customize it, every widget they're permitted to see is shown.
 */
export function useDashboardLayout(defaults: LayoutItem[] | null, onSaveError: () => void) {
  const [layout, setLayout] = useState<LayoutItem[] | null>(null)
  const [customized, setCustomized] = useState(false)

  useEffect(() => {
    if (!defaults) return
    let cancelled = false
    apiFetch<{ value: string } | null>(`/me/preferences/${PREF_KEY}`)
      .then(pref => {
        if (cancelled) return
        const stored = pref ? (JSON.parse(pref.value) as StoredLayout) : null
        if (stored?.widgets) {
          setLayout(stored.widgets)
          setCustomized(true)
        } else {
          setLayout(defaults)
        }
      })
      .catch(() => { if (!cancelled) setLayout(defaults) })
    return () => { cancelled = true }
  }, [defaults])

  const save = useCallback((next: LayoutItem[]) => {
    setLayout(next)
    setCustomized(true)
    const value: StoredLayout = { version: 1, widgets: next }
    apiFetch(`/me/preferences/${PREF_KEY}`, { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(value) }) })
      .catch(onSaveError)
  }, [onSaveError])

  const reset = useCallback(() => {
    setCustomized(false)
    setLayout(defaults ?? [])
    apiFetch(`/me/preferences/${PREF_KEY}`, { method: 'DELETE' }).catch(onSaveError)
  }, [defaults, onSaveError])

  return { layout, customized, save, reset }
}

/** Reads a numeric period option, falling back to the default when unset or not offered. */
export function periodOption(options: Record<string, unknown>, periods: readonly number[], fallback: number) {
  return periods.includes(options.days as number) ? (options.days as number) : fallback
}

/** "Oct 8" for a business date. They're UTC midnight, so read the day in UTC or it shifts in UTC+8. */
export function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
