import { useState, type CSSProperties } from 'react'
import { Rnd } from 'react-rnd'
import type { DocumentFieldSchema, TemplateElement, TemplateLayout } from '@/lib/documentTemplate'
import { defaultAlign, pageDimensions, resolveField } from '@/lib/documentTemplate'
import { formatCurrency } from '@/lib/format'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { cn } from '@/lib/utils'

/** How close (px) a dragged element's edge needs to be to a sibling's before it snaps —
 * lets the designer line labels up vertically the way the standard document layout expects. */
const SNAP_THRESHOLD = 4

interface TemplateRendererProps {
  layout: TemplateLayout
  mode: 'edit' | 'print'
  /** Real record data — required in print mode, optional in edit mode (shows binding placeholders when absent). */
  data?: Record<string, unknown>
  selectedId?: string | null
  onSelect?: (id: string) => void
  onChange?: (id: string, patch: Partial<TemplateElement>) => void
  /** Editing aid only (edit mode) — snaps drag/resize to this pixel size. Not part of the saved layout. */
  gridSize?: number
}

function elementStyle(el: TemplateElement, fallbackAlign: 'left' | 'right' = 'left'): CSSProperties {
  return {
    fontSize: el.style?.fontSize ?? 12,
    fontWeight: el.style?.bold ? 700 : 400,
    textAlign: el.style?.align ?? fallbackAlign,
  }
}

/** Applies the field's schema type to a resolved raw value — currency gets peso formatting,
 * `user` resolves the stamped username to the person's Display Name, everything else passes
 * through untouched. Never formats an empty/missing value (avoids e.g. "" -> "0.00"). */
function formatFieldValue(
  raw: string,
  fieldType: DocumentFieldSchema['type'] | undefined,
  resolveDisplayName: (username: string | null | undefined) => string
): string {
  if (raw === '') return ''
  if (fieldType === 'currency') return formatCurrency(raw)
  if (fieldType === 'user') return resolveDisplayName(raw)
  return raw
}

function ElementContent({
  el, data, resolveDisplayName,
}: {
  el: TemplateElement
  mode: 'edit' | 'print'
  data?: Record<string, unknown>
  resolveDisplayName: (username: string | null | undefined) => string
}) {
  if (el.type === 'static') {
    return <div style={elementStyle(el)}>{el.text || <span className="opacity-40">(empty label)</span>}</div>
  }

  if (el.type === 'text') {
    const raw = data ? resolveField(data, el.binding) : `{{${el.binding}}}`
    const value = data ? formatFieldValue(raw, el.fieldType, resolveDisplayName) : raw
    return (
      <div style={elementStyle(el, defaultAlign(el.fieldType))} className={cn(!data && 'opacity-60 italic')}>
        {value}
      </div>
    )
  }

  if (el.type === 'line') {
    const thickness = el.style?.borderWidth ?? 1
    const color = el.style?.borderColor ?? '#000000'
    return (
      <div
        className="w-full h-full"
        style={
          el.orientation === 'vertical'
            ? { borderLeft: `${thickness}px solid ${color}` }
            : { borderTop: `${thickness}px solid ${color}` }
        }
      />
    )
  }

  if (el.type === 'shape') {
    return (
      <div
        className="w-full h-full"
        style={{
          borderWidth: el.style?.borderWidth ?? 1,
          borderStyle: 'solid',
          borderColor: el.style?.borderColor ?? '#000000',
          backgroundColor: el.style?.fillColor ?? 'transparent',
        }}
      />
    )
  }

  // table (rendered without grid/table chrome — just the repeated record data, plus an
  // optional separator under each row when the table's style sets borderColor)
  const rows = data ? (Array.isArray(data[el.binding]) ? (data[el.binding] as Record<string, unknown>[]) : []) : null
  const previewRows: Record<string, unknown>[] = rows ?? [{}, {}]
  const rowSeparator = el.style?.borderColor
    ? { borderBottom: `${el.style.borderWidth ?? 1}px solid ${el.style.borderColor}` }
    : undefined
  return (
    <div style={{ fontSize: el.style?.fontSize ?? 11 }}>
      {previewRows.map((row, i) => (
        <div key={i} className="flex gap-2" style={rowSeparator}>
          {el.columns.map(col => {
            const raw = data ? resolveField(row, col.binding) : ''
            const value = data ? formatFieldValue(raw, col.fieldType, resolveDisplayName) : ''
            return (
              <div key={col.binding} style={{ width: col.width, textAlign: defaultAlign(col.fieldType) }}>
                {data ? value : <span className="opacity-40 italic">{`{{${col.binding}}}`}</span>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** While dragging, snaps x/y to the nearest sibling element's x/y within SNAP_THRESHOLD —
 * this is how the designer helps labels (and any other elements) line up vertically/horizontally
 * with each other, per the standard document layout convention. Returns the (possibly snapped)
 * position plus which axes snapped, for drawing guide lines. */
function computeSnap(elements: TemplateElement[], selfId: string, x: number, y: number) {
  let snapX: number | null = null
  let snapY: number | null = null
  for (const other of elements) {
    if (other.id === selfId) continue
    if (Math.abs(other.x - x) <= SNAP_THRESHOLD && (snapX === null || Math.abs(other.x - x) < Math.abs(snapX - x))) {
      snapX = other.x
    }
    if (Math.abs(other.y - y) <= SNAP_THRESHOLD && (snapY === null || Math.abs(other.y - y) < Math.abs(snapY - y))) {
      snapY = other.y
    }
  }
  return { x: snapX ?? x, y: snapY ?? y, snapX, snapY }
}

/** Interprets a template layout and lays elements out absolutely — used both by the
 * designer (edit mode, wrapped in draggable/resizable Rnd boxes) and the print view
 * (read-only, real data substituted in). Keeping one renderer for both avoids the
 * positioning/binding logic drifting between the two. */
export function TemplateRenderer({ layout, mode, data, selectedId, onSelect, onChange, gridSize }: TemplateRendererProps) {
  const { width, height } = pageDimensions(layout)
  const snap = mode === 'edit' && gridSize && gridSize > 1 ? gridSize : undefined
  const resolveDisplayName = useUserDisplayNames()
  const [guide, setGuide] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })

  return (
    <div
      className={cn('relative bg-white overflow-hidden', mode === 'edit' && 'border border-[hsl(var(--border))] shadow-sm')}
      style={{
        width,
        height,
        ...(snap
          ? {
              backgroundImage:
                'linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)',
              backgroundSize: `${snap}px ${snap}px`,
            }
          : {}),
      }}
    >
      {layout.elements.map(el => {
        if (mode === 'print') {
          return (
            <div key={el.id} style={{ position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height }}>
              <ElementContent el={el} mode={mode} data={data} resolveDisplayName={resolveDisplayName} />
            </div>
          )
        }
        return (
          <Rnd
            key={el.id}
            size={{ width: el.width, height: el.height }}
            position={{ x: el.x, y: el.y }}
            bounds="parent"
            grid={snap ? [snap, snap] : undefined}
            onClick={() => onSelect?.(el.id)}
            onDrag={(_e, d) => {
              const snapped = computeSnap(layout.elements, el.id, d.x, d.y)
              setGuide({ x: snapped.snapX, y: snapped.snapY })
              if (snapped.x !== d.x || snapped.y !== d.y) onChange?.(el.id, { x: snapped.x, y: snapped.y })
            }}
            onDragStop={(_e, d) => {
              const snapped = computeSnap(layout.elements, el.id, d.x, d.y)
              onChange?.(el.id, { x: snapped.x, y: snapped.y })
              setGuide({ x: null, y: null })
            }}
            onResizeStop={(_e, _dir, ref, _delta, pos) =>
              onChange?.(el.id, { width: ref.offsetWidth, height: ref.offsetHeight, x: pos.x, y: pos.y })
            }
            className={cn(
              'border border-dashed border-transparent hover:border-[hsl(var(--muted-foreground))]',
              selectedId === el.id && '!border-solid !border-[hsl(var(--primary))]'
            )}
          >
            <div className="w-full h-full overflow-hidden">
              <ElementContent el={el} mode={mode} data={data} resolveDisplayName={resolveDisplayName} />
            </div>
          </Rnd>
        )
      })}
      {mode === 'edit' && guide.x !== null && (
        <div className="absolute top-0 bottom-0 w-px bg-[hsl(var(--primary))] pointer-events-none z-10" style={{ left: guide.x }} />
      )}
      {mode === 'edit' && guide.y !== null && (
        <div className="absolute left-0 right-0 h-px bg-[hsl(var(--primary))] pointer-events-none z-10" style={{ top: guide.y }} />
      )}
    </div>
  )
}
