import * as React from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { DocCellContext } from '@/components/ui/doc-cell-context'

/** Inner grid lines are a shade softer than the sheet's outer frame, so the form reads
 * as one document with light ruling rather than a spreadsheet of boxes. */
const RULE = 'border-[hsl(var(--rule-soft))]'
/** Field captions: small, sentence-case, muted — present but out of the way of the values. */
const LABEL = 'block text-[11px] font-medium leading-tight text-[hsl(var(--muted-foreground))]'
/** Section / column headings: small caps with tracking, a notch stronger than field captions. */
const CAPTION_TEXT = 'text-[10.5px] font-semibold uppercase leading-tight tracking-[0.08em] text-[hsl(var(--muted-foreground))]'
const CAPTION = cn('block', CAPTION_TEXT)
/** Required-field marker appended to a caption. Only shown while the field is editable. */
function RequiredMark() {
  return <span aria-hidden className="ml-0.5 text-[hsl(var(--destructive))]">*</span>
}
const FOCUS_BOX = 'transition-colors focus-within:bg-[hsl(var(--primary))]/[0.04] focus-within:shadow-[inset_0_0_0_1.5px_hsl(var(--primary))]'

/** The ruled frame of a paper-style form. Deliberately not `overflow-hidden` —
 * `SearchableSelect` dropdowns are absolutely positioned and would be clipped; the
 * `doc-sheet` class instead rounds the corner cells' own backgrounds (see index.css). */
export function DocSheet({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'doc-sheet relative rounded-xl border border-[hsl(var(--rule))] bg-[hsl(var(--card))] text-sm',
        'shadow-[0_1px_2px_hsl(220_40%_20%/0.04),0_12px_32px_-16px_hsl(220_40%_20%/0.18)]',
        className
      )}
      {...props}
    />
  )
}

/** One ruled row of cells sharing borders. `cols` is a CSS grid-template-columns
 * value (e.g. `'3fr 2fr'`); defaults to equal columns. */
export function DocRow({ cols, className, children }: { cols?: string; className?: string; children: React.ReactNode }) {
  const count = React.Children.toArray(children).length
  return (
    <div
      className={cn('doc-row grid border-t first:border-t-0', RULE, className)}
      style={{ gridTemplateColumns: cols ?? `repeat(${count}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}

interface DocCellProps {
  label?: React.ReactNode
  htmlFor?: string
  /** Number of `DocRow` columns this cell spans. */
  span?: number
  align?: 'left' | 'right'
  /** Marks the caption with a required asterisk. Pass it only while the field is editable
   * (e.g. `required={!ro}`), never in view mode. */
  required?: boolean
  className?: string
  children?: React.ReactNode
}

/** A single boxed field: small caption in the top-left corner, value/control below. */
export function DocCell({ label, htmlFor, span, align, required, className, children }: DocCellProps) {
  return (
    <div
      className={cn('min-w-0 border-l first:border-l-0 px-3 pt-2 pb-0.5', RULE, FOCUS_BOX, className)}
      style={span ? { gridColumn: `span ${span} / span ${span}` } : undefined}
    >
      {label && <Label htmlFor={htmlFor} className={LABEL}>{label}{required && <RequiredMark />}</Label>}
      <DocCellContext.Provider value={true}>
        <div className={cn(align === 'right' && 'text-right')}>{children}</div>
      </DocCellContext.Provider>
    </div>
  )
}

/** Read-only value written into a cell. Empty values render as an em dash. */
export function DocText({ className, children }: { className?: string; children?: React.ReactNode }) {
  const empty = children === null || children === undefined || children === ''
  return <div className={cn('min-h-8 py-1.5 leading-5 break-words', className)}>{empty ? '—' : children}</div>
}

interface DocCheckProps {
  id: string
  label: React.ReactNode
  checked: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
}

/** A "☐ Label" tick box, laid out inline the way status boxes appear on paper forms. */
export function DocCheck({ id, label, checked, disabled, onChange }: DocCheckProps) {
  return (
    <label htmlFor={id} className={cn('mr-5 inline-flex min-h-8 items-center gap-2', !disabled && 'cursor-pointer')}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange?.(e.target.checked)}
        className="h-4 w-4 rounded accent-[hsl(var(--primary))]"
      />
      {label}
    </label>
  )
}

interface DocHeaderProps {
  title: string
  /** Document/record number shown as "No. …". `undefined` hides the line entirely. */
  number?: React.ReactNode
  /** Header cells (Date, Sheet #, Code, Status, …) stacked under the title. */
  children?: React.ReactNode
  className?: string
}

/** The top-right title block of a document: title, number, then its header cells. */
export function DocHeader({ title, number, children, className }: DocHeaderProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col border-l first:border-l-0 bg-gradient-to-bl from-[hsl(var(--primary))]/[0.07] via-[hsl(var(--primary))]/[0.02] to-transparent',
        RULE,
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
        <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--primary))]">{title}</div>
        {number !== undefined && (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--rule-soft))] bg-[hsl(var(--card))] px-2 py-0.5 text-xs text-[hsl(var(--muted-foreground))]">
            No. <span className="font-mono text-[13px] font-medium text-[hsl(var(--foreground))]">{number}</span>
          </div>
        )}
      </div>
      {children && <div className={cn('mt-auto border-t', RULE)}>{children}</div>}
    </div>
  )
}

/** Muted placeholder for a number the backend hasn't assigned yet. */
export function PendingNumber() {
  return <span className="font-sans text-xs text-[hsl(var(--muted-foreground))]">Assigned on posting</span>
}

/** A caption spanning the full sheet width, introducing the section below it. */
export function DocSection({ title, action, className }: { title: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-8 items-center justify-between gap-2 border-t first:border-t-0 bg-[hsl(var(--secondary))]/50 px-3 py-1', RULE, className)}>
      <span className={cn(CAPTION, 'flex items-center gap-2 text-[hsl(var(--foreground))]/70')}>
        <span className="h-3 w-[3px] rounded-full bg-[hsl(var(--primary))]" aria-hidden />
        {title}
      </span>
      {action}
    </div>
  )
}

export interface DocColumn<T> {
  key: string
  label: React.ReactNode
  align?: 'left' | 'right' | 'center'
  /** CSS width for the column (e.g. `'8rem'`); unset columns share the remainder. */
  width?: string
  /** Display-only column in an editable grid (stock guides, computed amounts, source-fixed
   * values) — shaded so it reads as non-editable next to the input cells. */
  readOnly?: boolean
  /** Marks the column heading with a required asterisk (editable grids only). */
  required?: boolean
  render: (row: T, index: number) => React.ReactNode
}

interface DocLinesProps<T> {
  columns: (DocColumn<T> | false | null | undefined)[]
  rows: readonly T[]
  rowKey?: (row: T, index: number) => React.Key
  /** Value for the `#` column — pass the saved line's `lineNumber` in view mode (a split
   * Purchase Receive line repeats its number). Defaults to the row's position. */
  lineNumber?: (row: T, index: number) => React.ReactNode
  /** Pads with blank ruled rows up to this count, like a pre-printed grid (view mode). */
  minRows?: number
  /** Rendered as a final full-width row — e.g. the "Add Line" button. */
  footer?: React.ReactNode
  className?: string
}

const READ_ONLY_CELL = 'cursor-default bg-[hsl(var(--muted))]/70 text-[hsl(var(--muted-foreground))]'

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

/** Ruled line-item grid with a leading `#` column. Each cell provides `DocCellContext`,
 * so per-line `Input` / `SearchableSelect` controls render borderless inside it. */
export function DocLines<T>({ columns, rows, rowKey, lineNumber, minRows = 0, footer, className }: DocLinesProps<T>) {
  const cols = columns.filter((c): c is DocColumn<T> => !!c)
  const padding = Math.max(0, minRows - rows.length)
  const cell = cn('border-l first:border-l-0 border-t px-3', RULE)
  return (
    <div className={cn('border-t first:border-t-0', RULE, className)}>
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col style={{ width: '2.5rem' }} />
          {cols.map(c => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}
        </colgroup>
        <thead>
          <tr className="bg-[hsl(var(--secondary))]/50">
            <th className={cn('border-l first:border-l-0 px-2 py-2 text-center', RULE, CAPTION_TEXT)}>#</th>
            {cols.map(c => (
              <th key={c.key} className={cn('border-l px-3 py-2', RULE, CAPTION_TEXT, ALIGN[c.align ?? 'left'])}
                title={c.readOnly ? 'Read-only' : c.required ? 'Required' : undefined}>{c.label}{c.required && <RequiredMark />}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i} className="transition-colors hover:bg-[hsl(var(--secondary))]/30">
              <td className={cn(cell, 'h-10 px-2 text-center text-xs tabular-nums text-[hsl(var(--muted-foreground))]')}>{lineNumber ? lineNumber(row, i) : i + 1}</td>
              {cols.map(c => (
                <td key={c.key} className={cn(cell, FOCUS_BOX, ALIGN[c.align ?? 'left'], c.align === 'right' && 'tabular-nums',
                  c.readOnly && READ_ONLY_CELL)}>
                  <DocCellContext.Provider value={true}>{c.render(row, i)}</DocCellContext.Provider>
                </td>
              ))}
            </tr>
          ))}
          {Array.from({ length: padding }, (_, i) => (
            <tr key={`pad-${i}`} aria-hidden>
              <td className={cn(cell, 'h-10')} />
              {cols.map(c => <td key={c.key} className={cell} />)}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr>
              <td colSpan={cols.length + 1} className={cn(cell, 'py-1')}>{footer}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

export interface DocTotal {
  label: React.ReactNode
  value: React.ReactNode
  /** The grand-total line: bold with a double rule above it. */
  grand?: boolean
}

/** Right-hand totals block (Subtotal / Discount / … / Net Payable). */
export function DocTotals({ entries, className }: { entries: DocTotal[]; className?: string }) {
  return (
    <div className={cn('min-w-0 border-l first:border-l-0 px-3 py-2.5', RULE, className)}>
      {entries.map((e, i) => (
        <div
          key={i}
          className={cn(
            'flex items-baseline justify-between gap-4 py-1',
            e.grand && 'mt-1.5 rounded-lg bg-[hsl(var(--primary))]/[0.07] px-3 py-2 font-semibold'
          )}
        >
          <span className={e.grand ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'}>{e.label}</span>
          <span className={cn('tabular-nums', e.grand && 'text-base text-[hsl(var(--primary))]')}>{e.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Bottom sign-off strip: each value written on a rule with its caption underneath,
 * like "Prepared by ________" on a paper form. */
export function DocSignatures({ entries }: { entries: { label: string; value: React.ReactNode }[] }) {
  return (
    <DocRow>
      {entries.map(e => (
        <div key={e.label} className={cn('min-w-0 border-l first:border-l-0 px-4 pb-2 pt-5', RULE)}>
          <div className="min-h-5 truncate border-b border-[hsl(var(--rule))] pb-1 text-center">{e.value || '—'}</div>
          <div className={cn(LABEL, 'mt-1.5 text-center')}>{e.label}</div>
        </div>
      ))}
    </DocRow>
  )
}

/** Rubber-stamp overlay (e.g. "Voided") across the sheet. */
export function DocStamp({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">Status: {text}</span>
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[45%] z-10 -translate-x-1/2 -rotate-12 select-none rounded-sm border-4 border-double border-[hsl(var(--destructive))] px-4 py-1 text-3xl font-black uppercase tracking-[0.3em] text-[hsl(var(--destructive))] opacity-60"
      >
        {text}
      </div>
    </>
  )
}
