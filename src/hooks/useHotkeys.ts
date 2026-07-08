import { useEffect, useRef } from 'react'

export interface HotkeyBinding {
  /** e.g. 'k', '/', 'n', 'Escape', '?' — matched against KeyboardEvent.key (case-insensitive) */
  key: string
  /** require Ctrl (Windows/Linux) or Cmd (Mac) to be held */
  mod?: boolean
  /** fire even while focus is inside an input/textarea/select */
  allowInInputs?: boolean
  handler: (e: KeyboardEvent) => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** Registers global keyboard shortcuts. Bindings are read from a ref so callers can
 * pass a fresh array/closures every render without re-attaching the listener. */
export function useHotkeys(bindings: HotkeyBinding[], enabled = true) {
  const bindingsRef = useRef(bindings)
  useEffect(() => {
    bindingsRef.current = bindings
  })

  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(e: KeyboardEvent) {
      const modPressed = e.ctrlKey || e.metaKey
      for (const binding of bindingsRef.current) {
        const keyMatches = e.key.toLowerCase() === binding.key.toLowerCase()
        const modMatches = binding.mod ? modPressed : !modPressed
        if (!keyMatches || !modMatches) continue
        if (!binding.allowInInputs && isTypingTarget(e.target)) continue
        e.preventDefault()
        binding.handler(e)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}
