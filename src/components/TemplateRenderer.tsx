import type { CSSProperties } from 'react'
import { Rnd } from 'react-rnd'
import type { TemplateElement, TemplateLayout } from '@/lib/documentTemplate'
import { pageDimensions, resolveField } from '@/lib/documentTemplate'
import { cn } from '@/lib/utils'

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

function elementStyle(el: TemplateElement): CSSProperties {
  return {
    fontSize: el.style?.fontSize ?? 12,
    fontWeight: el.style?.bold ? 700 : 400,
    textAlign: el.style?.align ?? 'left',
  }
}

function ElementContent({ el, data }: { el: TemplateElement; mode: 'edit' | 'print'; data?: Record<string, unknown> }) {
  if (el.type === 'static') {
    return <div style={elementStyle(el)}>{el.text || <span className="opacity-40">(empty label)</span>}</div>
  }

  if (el.type === 'text') {
    const value = data ? resolveField(data, el.binding) : `{{${el.binding}}}`
    return <div style={elementStyle(el)} className={cn(!data && 'opacity-60 italic')}>{value}</div>
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

  // table (rendered without grid/table chrome — just the repeated record data)
  const rows = data ? (Array.isArray(data[el.binding]) ? (data[el.binding] as Record<string, unknown>[]) : []) : null
  const previewRows: Record<string, unknown>[] = rows ?? [{}, {}]
  return (
    <div style={{ fontSize: el.style?.fontSize ?? 11 }}>
      {previewRows.map((row, i) => (
        <div key={i} className="flex gap-2">
          {el.columns.map(col => (
            <div key={col.binding} style={{ width: col.width }}>
              {data ? resolveField(row, col.binding) : <span className="opacity-40 italic">{`{{${col.binding}}}`}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Interprets a template layout and lays elements out absolutely — used both by the
 * designer (edit mode, wrapped in draggable/resizable Rnd boxes) and the print view
 * (read-only, real data substituted in). Keeping one renderer for both avoids the
 * positioning/binding logic drifting between the two. */
export function TemplateRenderer({ layout, mode, data, selectedId, onSelect, onChange, gridSize }: TemplateRendererProps) {
  const { width, height } = pageDimensions(layout)
  const snap = mode === 'edit' && gridSize && gridSize > 1 ? gridSize : undefined

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
              <ElementContent el={el} mode={mode} data={data} />
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
            onDragStop={(_e, d) => onChange?.(el.id, { x: d.x, y: d.y })}
            onResizeStop={(_e, _dir, ref, _delta, pos) =>
              onChange?.(el.id, { width: ref.offsetWidth, height: ref.offsetHeight, x: pos.x, y: pos.y })
            }
            className={cn(
              'border border-dashed border-transparent hover:border-[hsl(var(--muted-foreground))]',
              selectedId === el.id && '!border-solid !border-[hsl(var(--primary))]'
            )}
          >
            <div className="w-full h-full overflow-hidden">
              <ElementContent el={el} mode={mode} data={data} />
            </div>
          </Rnd>
        )
      })}
    </div>
  )
}
