import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2, Type, Table as TableIcon, Minus, RectangleHorizontal } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { TemplateRenderer } from '@/components/TemplateRenderer'
import {
  emptyLayout, type TemplateLayout, type TemplateElement,
  type DocumentSchema,
} from '@/lib/documentTemplate'

interface DocumentTemplate {
  id: number
  companyId: number
  documentType: string
  name: string
  layout: string
  defaultTemplate: boolean
  active: boolean
}

function newId(): string {
  return crypto.randomUUID()
}

export function DocumentTemplateDesignerPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [template, setTemplate] = useState<DocumentTemplate | null>(null)
  const [layout, setLayout] = useState<TemplateLayout>(emptyLayout())
  const [schema, setSchema] = useState<DocumentSchema | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [gridSize, setGridSize] = useState(10)

  useEffect(() => {
    if (!id) return
    apiFetch<DocumentTemplate>(`/document-templates/${id}`)
      .then(t => {
        setTemplate(t)
        try {
          setLayout(t.layout ? JSON.parse(t.layout) : emptyLayout())
        } catch {
          setLayout(emptyLayout())
        }
        return apiFetch<DocumentSchema>(`/document-templates/schema?documentType=${encodeURIComponent(t.documentType)}`)
      })
      .then(setSchema)
      .catch(() => toast('Failed to load template.', 'error'))
      .finally(() => setLoading(false))
  }, [id])

  const selected = layout.elements.find(el => el.id === selectedId) ?? null

  const addTextElement = useCallback((binding: string) => {
    const el: TemplateElement = {
      id: newId(), type: 'text', x: 20, y: 20, width: 200, height: 24, binding, style: { fontSize: 12 },
    }
    setLayout(l => ({ ...l, elements: [...l.elements, el] }))
    setSelectedId(el.id)
  }, [])

  const addStaticElement = useCallback(() => {
    const el: TemplateElement = {
      id: newId(), type: 'static', x: 20, y: 20, width: 150, height: 24, text: 'Label', style: { fontSize: 12 },
    }
    setLayout(l => ({ ...l, elements: [...l.elements, el] }))
    setSelectedId(el.id)
  }, [])

  const addTableElement = useCallback((groupPath: string, groupLabel: string, fields: { path: string; label: string }[]) => {
    const el: TemplateElement = {
      id: newId(), type: 'table', x: 20, y: 100, width: 400, height: 200, binding: groupPath,
      columns: fields.map(f => ({ binding: f.path, label: f.label, width: Math.floor(400 / fields.length) })),
      style: { fontSize: 11 },
    }
    setLayout(l => ({ ...l, elements: [...l.elements, el] }))
    setSelectedId(el.id)
    void groupLabel
  }, [])

  const addLineElement = useCallback((orientation: 'horizontal' | 'vertical') => {
    const el: TemplateElement = orientation === 'horizontal'
      ? { id: newId(), type: 'line', orientation, x: 20, y: 20, width: 200, height: 1, style: { borderWidth: 1, borderColor: '#000000' } }
      : { id: newId(), type: 'line', orientation, x: 20, y: 20, width: 1, height: 100, style: { borderWidth: 1, borderColor: '#000000' } }
    setLayout(l => ({ ...l, elements: [...l.elements, el] }))
    setSelectedId(el.id)
  }, [])

  const addShapeElement = useCallback(() => {
    const el: TemplateElement = {
      id: newId(), type: 'shape', x: 20, y: 20, width: 150, height: 80,
      style: { borderWidth: 1, borderColor: '#000000', fillColor: 'transparent' },
    }
    setLayout(l => ({ ...l, elements: [...l.elements, el] }))
    setSelectedId(el.id)
  }, [])

  function updateElement(elId: string, patch: Partial<TemplateElement>) {
    setLayout(l => ({
      ...l,
      elements: l.elements.map(el => el.id === elId ? { ...el, ...patch } as TemplateElement : el),
    }))
  }

  function deleteSelected() {
    if (!selectedId) return
    setLayout(l => ({ ...l, elements: l.elements.filter(el => el.id !== selectedId) }))
    setSelectedId(null)
  }

  async function handleSave() {
    if (!template) return
    setSaving(true)
    try {
      await apiFetch(`/document-templates/${template.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          companyId: template.companyId,
          documentType: template.documentType,
          name: template.name,
          layout: JSON.stringify(layout),
          defaultTemplate: template.defaultTemplate,
          active: template.active,
        }),
      })
      toast('Layout saved.', 'success')
    } catch {
      toast('Failed to save layout.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Loading designer…</div>
  }
  if (!template || !schema) {
    return <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Template not found.</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-[hsl(var(--border))] mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/document-templates')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-lg font-bold leading-tight">{template.name}</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{template.documentType}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={layout.pageSize}
            onChange={e => setLayout(l => ({ ...l, pageSize: e.target.value as TemplateLayout['pageSize'] }))}
            className="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
          </select>
          <select
            value={layout.orientation}
            onChange={e => setLayout(l => ({ ...l, orientation: e.target.value as TemplateLayout['orientation'] }))}
            className="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm px-2">
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={e => setSnapToGrid(e.target.checked)}
              className="accent-[hsl(var(--primary))]"
            />
            Snap to grid
          </label>
          <Input
            type="number"
            min={2}
            value={gridSize}
            onChange={e => setGridSize(Math.max(2, Number(e.target.value) || 10))}
            disabled={!snapToGrid}
            className="w-16"
          />
          <Button onClick={handleSave} loading={saving}>Save Layout</Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-[220px_1fr_260px] gap-4 min-h-0">
        {/* Field palette */}
        <div className="overflow-y-auto space-y-4">
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-2">Fields</p>
            <div className="space-y-1">
              {schema.fields.map(f => (
                <button
                  key={f.path}
                  onClick={() => addTextElement(f.path)}
                  className="w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-md hover:bg-[hsl(var(--secondary))] transition-colors"
                >
                  <Type className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                  {f.label}
                </button>
              ))}
              <button
                onClick={addStaticElement}
                className="w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-md hover:bg-[hsl(var(--secondary))] transition-colors"
              >
                <Type className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                Static label…
              </button>
            </div>
          </div>
          {schema.repeatingGroups.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-2">Tables</p>
              <div className="space-y-1">
                {schema.repeatingGroups.map(g => (
                  <button
                    key={g.path}
                    onClick={() => addTableElement(g.path, g.label, g.fields)}
                    className="w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-md hover:bg-[hsl(var(--secondary))] transition-colors"
                  >
                    <TableIcon className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-2">Shapes</p>
            <div className="space-y-1">
              <button
                onClick={() => addLineElement('horizontal')}
                className="w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-md hover:bg-[hsl(var(--secondary))] transition-colors"
              >
                <Minus className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                Horizontal line
              </button>
              <button
                onClick={() => addLineElement('vertical')}
                className="w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-md hover:bg-[hsl(var(--secondary))] transition-colors"
              >
                <Minus className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] rotate-90" />
                Vertical line
              </button>
              <button
                onClick={addShapeElement}
                className="w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-md hover:bg-[hsl(var(--secondary))] transition-colors"
              >
                <RectangleHorizontal className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                Rectangle
              </button>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="overflow-auto bg-[hsl(var(--secondary))]/40 rounded-md p-6 flex justify-center">
          <div onClick={() => setSelectedId(null)}>
            <div onClick={e => e.stopPropagation()}>
              <TemplateRenderer
                layout={layout}
                mode="edit"
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChange={updateElement}
                gridSize={snapToGrid ? gridSize : undefined}
              />
            </div>
          </div>
        </div>

        {/* Properties panel */}
        <div className="overflow-y-auto space-y-4">
          <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Properties</p>
          {!selected ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Select an element to edit its properties.</p>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                {selected.type === 'text' && <>Bound to <code className="font-mono">{selected.binding}</code></>}
                {selected.type === 'table' && <>Repeating table: <code className="font-mono">{selected.binding}</code></>}
                {selected.type === 'static' && 'Static label'}
                {selected.type === 'line' && `${selected.orientation === 'horizontal' ? 'Horizontal' : 'Vertical'} line`}
                {selected.type === 'shape' && 'Rectangle'}
              </div>

              {selected.type === 'static' && (
                <div className="space-y-1.5">
                  <Label>Text</Label>
                  <Input value={selected.text} onChange={e => updateElement(selected.id, { text: e.target.value })} />
                </div>
              )}

              {(selected.type === 'text' || selected.type === 'static' || selected.type === 'table') && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label>Font size</Label>
                      <Input
                        type="number"
                        value={selected.style?.fontSize ?? 12}
                        onChange={e => updateElement(selected.id, { style: { ...selected.style, fontSize: Number(e.target.value) } })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Align</Label>
                      <select
                        value={selected.style?.align ?? 'left'}
                        onChange={e => updateElement(selected.id, { style: { ...selected.style, align: e.target.value as 'left' | 'center' | 'right' } })}
                        className="flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!selected.style?.bold}
                      onChange={e => updateElement(selected.id, { style: { ...selected.style, bold: e.target.checked } })}
                      className="accent-[hsl(var(--primary))]"
                    />
                    <Label className="cursor-pointer">Bold</Label>
                  </div>
                </>
              )}

              {(selected.type === 'line' || selected.type === 'shape') && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Thickness</Label>
                    <Input
                      type="number"
                      min={1}
                      value={selected.style?.borderWidth ?? 1}
                      onChange={e => updateElement(selected.id, { style: { ...selected.style, borderWidth: Math.max(1, Number(e.target.value)) } })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Color</Label>
                    <Input
                      type="color"
                      value={selected.style?.borderColor ?? '#000000'}
                      onChange={e => updateElement(selected.id, { style: { ...selected.style, borderColor: e.target.value } })}
                      className="h-9 p-1"
                    />
                  </div>
                </div>
              )}

              {selected.type === 'shape' && (
                <div className="space-y-1.5">
                  <Label>Fill color</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="color"
                      value={selected.style?.fillColor && selected.style.fillColor !== 'transparent' ? selected.style.fillColor : '#ffffff'}
                      onChange={e => updateElement(selected.id, { style: { ...selected.style, fillColor: e.target.value } })}
                      className="h-9 p-1 w-16"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateElement(selected.id, { style: { ...selected.style, fillColor: 'transparent' } })}
                    >
                      None
                    </Button>
                  </div>
                </div>
              )}

              {selected.type === 'table' && (
                <div className="space-y-1.5">
                  <Label>Column widths (px)</Label>
                  <div className="space-y-1.5">
                    {selected.columns.map((c, i) => (
                      <div key={c.binding} className="flex items-center gap-2">
                        <span className="flex-1 text-xs text-[hsl(var(--muted-foreground))] truncate">{c.label}</span>
                        <Input
                          type="number"
                          min={20}
                          value={c.width}
                          onChange={e => {
                            const width = Math.max(20, Number(e.target.value) || c.width)
                            const columns = selected.columns.map((col, idx) => idx === i ? { ...col, width } : col)
                            updateElement(selected.id, { columns })
                          }}
                          className="w-20"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button variant="outline" size="sm" onClick={deleteSelected} className="w-full">
                <Trash2 className="w-3.5 h-3.5 text-[hsl(var(--destructive))]" />
                Delete element
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
