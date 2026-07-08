import { useEffect, useState } from 'react'

function readHidden(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(`columns:${storageKey}`)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

/** Persists which columns a user has hidden on a given list page, per-browser via localStorage. */
export function useColumnVisibility(storageKey: string) {
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(storageKey))

  useEffect(() => {
    localStorage.setItem(`columns:${storageKey}`, JSON.stringify(Array.from(hidden)))
  }, [storageKey, hidden])

  function toggle(key: string) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function isVisible(key: string) {
    return !hidden.has(key)
  }

  return { isVisible, toggle }
}
