import { useRef } from 'react'

/** Stable JSON snapshot for dirty-comparison — `Set`s (used by multi-select-style form
 * fields like tags/permissions) don't serialize meaningfully via plain JSON.stringify. */
function snapshotKey(value: unknown): string {
  return JSON.stringify(value, (_key, val) => (val instanceof Set ? Array.from(val).sort() : val))
}

/** Guards a record form's close paths (Cancel button, Escape, the tab's ×, Alt+W) behind
 * a confirm — but only when the user has actually changed something since the
 * dialog opened, per "always ask if they've started entering data" rather than every time.
 * Call `markClean(snapshot)` wherever the form's fields are (re)initialized — `openCreate`,
 * `openEdit`, and `openView` — with the same shape of value passed to `guardedClose`. View
 * mode's fields are read-only, but still call `markClean` there so a stale dirty baseline
 * from a previous create/edit session can't leak into it. */
export function useDirtyGuard() {
  const baselineRef = useRef<string | null>(null)

  function markClean(snapshot: unknown) {
    baselineRef.current = snapshotKey(snapshot)
  }

  function guardedClose(snapshot: unknown, doClose: () => void) {
    if (baselineRef.current !== null && snapshotKey(snapshot) !== baselineRef.current) {
      if (!window.confirm('Discard unsaved changes?')) return
    }
    doClose()
  }

  return { markClean, guardedClose }
}
