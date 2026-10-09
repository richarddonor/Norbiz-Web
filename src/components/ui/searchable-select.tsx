import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useInDocCell } from '@/components/ui/doc-cell-context'

export interface SearchableSelectOption {
  value: string
  label: string
}

interface Props {
  id?: string
  value: string
  onChange: (value: string) => void
  options: readonly SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  /** Called with the search text as the user types (and '' when the dropdown closes) — for
   * callers that fetch matching options from the server instead of passing every record. */
  onQueryChange?: (query: string) => void
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Quickbooks-style grid navigation: after committing a value, jump focus to the next
 * tabbable field in the same form instead of leaving it on the trigger — so Enter reads
 * as "confirm this field, move to the next one" the same way it does on every other input. */
function focusNextElement(current: HTMLElement) {
  const container = current.closest('form') ?? document.body
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(el => el.offsetParent !== null)
  const index = focusable.indexOf(current)
  if (index >= 0 && index < focusable.length - 1) focusable[index + 1]?.focus()
}

/** The visible box `el` is clipped to: the nearest scrolling ancestor, intersected with the viewport. */
function clippingRect(el: HTMLElement): { top: number; bottom: number } {
  let top = 0
  let bottom = window.innerHeight
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
      const rect = node.getBoundingClientRect()
      top = Math.max(top, rect.top)
      bottom = Math.min(bottom, rect.bottom)
      break
    }
  }
  return { top, bottom }
}

/** A text-searchable dropdown — the app-wide replacement for plain `<select>` elements
 * whenever the option list represents records (companies, warehouses, items, ...) rather
 * than a couple of fixed values. Keeps the same value/onChange contract as a native select
 * (string values — callers still do `Number(value)` conversions same as before), and always
 * exposes a blank/placeholder entry first, matching every existing `<option value="">…</option>`
 * convention, so clearing a selection works the same way. Native HTML5 `required` doesn't apply
 * to a non-native control — callers validate required fields explicitly in their submit handler
 * instead (this codebase already does that for several fields, e.g. "Select a company.").
 * Keyboard: focusing the trigger and typing opens the dropdown and starts filtering immediately
 * (no separate "open" keypress needed, matching native `<select>` typeahead); Enter always
 * confirms and advances focus to the next field in the form, whether or not anything changed. */
export function SearchableSelect({
  id, value, onChange, options, placeholder = 'Select…', searchPlaceholder = 'Type to search…',
  emptyText = 'No matches.', disabled, autoFocus, className, onQueryChange,
}: Props) {
  const inCell = useInDocCell()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value) ?? null

  useEffect(() => {
    onQueryChange?.(query)
    // onQueryChange is intentionally not a dependency — callers pass inline lambdas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    const matches = term ? options.filter(o => o.label.toLowerCase().includes(term)) : options
    return term ? matches : [{ value: '', label: placeholder }, ...matches]
  }, [options, query, placeholder])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
        setHighlight(0)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  // Scrolls only the option list itself — `scrollIntoView` would also scroll every ancestor
  // (e.g. the dialog), which on a bottom-of-form field parks the viewport right under the
  // blank placeholder entry and hides the real options below it.
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    const row = list?.children[highlight] as HTMLElement | undefined
    if (!list || !row) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
    }
  }, [highlight, open])

  // Opens upward when the panel wouldn't fit between the trigger and the bottom of its
  // clipping container (the dialog's scroll area, or the viewport) — e.g. the last line
  // of a transaction form. Measured once per open, with the full unfiltered list.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!open || !rootRef.current || !panel) return
    const trigger = rootRef.current.getBoundingClientRect()
    const clip = clippingRect(rootRef.current)
    const below = clip.bottom - trigger.bottom
    const above = trigger.top - clip.top
    const dropUp = below < panel.offsetHeight + 4 && above > below
    panel.style.top = dropUp ? 'auto' : '100%'
    panel.style.bottom = dropUp ? '100%' : 'auto'
    panel.style.marginTop = dropUp ? '0' : '0.25rem'
    panel.style.marginBottom = dropUp ? '0.25rem' : '0'
  }, [open])

  // `focusInput` is only set true from a mouse click on the trigger — a single discrete
  // gesture, safe to hand focus to the nested search box. Keyboard-driven opens (arrow/typing)
  // deliberately leave focus on the trigger button itself: moving focus into the input via
  // rAF while keys keep arriving (fast typing) races with React unmounting/remounting the
  // input and Radix's dialog focus-trap, which can strand focus on the dialog's own container.
  function openDropdown(focusInput = false) {
    if (disabled) return
    setOpen(true)
    setQuery('')
    setHighlight(0)
    if (focusInput) requestAnimationFrame(() => inputRef.current?.focus())
  }

  function closeDropdown() {
    setOpen(false)
    setQuery('')
    setHighlight(0)
  }

  function handleQueryChange(next: string) {
    setQuery(next)
    setHighlight(0)
  }

  function commit(opt: SearchableSelectOption | null, advanceFocus = false) {
    onChange(opt ? opt.value : '')
    closeDropdown()
    if (advanceFocus && triggerRef.current) {
      const trigger = triggerRef.current
      // Deferred past the current render/commit: focusing synchronously here races with
      // React unmounting the dropdown's own DOM (and Radix's dialog FocusScope reacting to
      // that mutation), which can strand focus on the dialog's container instead.
      requestAnimationFrame(() => focusNextElement(trigger))
    }
  }

  // List navigation/commit keys behave identically regardless of whether the trigger or the
  // search input currently holds focus. Returns true when it handled the key.
  function handleListNavKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, filtered.length - 1))
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
      return true
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[highlight]
      if (opt) commit(opt, true)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeDropdown()
      return true
    }
    if (e.key === 'Tab') {
      // No preventDefault — let the browser move focus to the next element natively;
      // the search input sits right after the trigger in DOM order, so this already
      // lands on the same "next field" focusNextElement would have picked.
      closeDropdown()
      return true
    }
    return false
  }

  // The search input handles character entry itself (native cursor/selection/paste) —
  // it only needs to opt into the shared list-navigation keys.
  function handleInputKeyDown(e: KeyboardEvent) {
    handleListNavKeyDown(e)
  }

  function handleTriggerKeyDown(e: KeyboardEvent) {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        openDropdown()
        return
      }
      if (e.key === 'Enter') {
        // Nothing pending to confirm on a closed trigger — Enter just advances,
        // same as every other field, instead of requiring an extra keypress to open first.
        e.preventDefault()
        const trigger = triggerRef.current
        if (trigger) requestAnimationFrame(() => focusNextElement(trigger))
        return
      }
      // Any other printable character starts a search immediately — focusing the
      // control is enough to type into it, no separate "open" step required first.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setOpen(true)
        setQuery(e.key)
        setHighlight(0)
      }
      return
    }
    // Open, focus still on the trigger — same nav keys as the input, plus manual
    // character accumulation since the button itself has no native text entry.
    if (handleListNavKeyDown(e)) return
    if (e.key === 'Backspace') {
      e.preventDefault()
      handleQueryChange(query.slice(0, -1))
      return
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      handleQueryChange(query + e.key)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => (open ? closeDropdown() : openDropdown(true))}
        onKeyDown={handleTriggerKeyDown}
        autoFocus={autoFocus}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50',
          inCell && 'h-8 rounded-none border-0 px-0 shadow-none focus-visible:ring-0',
          className
        )}
      >
        <span className={cn('truncate text-left', !selected && 'text-[hsl(var(--muted-foreground))]')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute top-full z-50 mt-1 w-full min-w-[12rem] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-md"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={searchPlaceholder}
            className="w-full h-8 px-2.5 text-sm border-b border-[hsl(var(--border))] bg-transparent focus-visible:outline-none"
          />
          <ul ref={listRef} className="relative max-h-56 overflow-y-auto py-1 text-sm">
            {filtered.length === 0 ? (
              <li className="px-3 py-1.5 text-[hsl(var(--muted-foreground))]">{emptyText}</li>
            ) : (
              filtered.map((opt, i) => (
                <li
                  key={opt.value || '__blank__'}
                  onMouseDown={e => { e.preventDefault(); commit(opt.value ? opt : null) }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer',
                    !opt.value && 'text-[hsl(var(--muted-foreground))]',
                    i === highlight && 'bg-[hsl(var(--secondary))]'
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.value && opt.value === value && <Check className="w-4 h-4 shrink-0" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
