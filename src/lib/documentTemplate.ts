// Shared shape for a printable document template's layout JSON — this repo owns
// this shape entirely; the backend stores/returns it as an opaque string.

export interface TemplateElementStyle {
  fontSize?: number
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  borderWidth?: number
  borderColor?: string
  fillColor?: string
}

export interface TemplateTextElement {
  id: string
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  binding: string
  /** Schema field type captured when dropped from the palette — drives default alignment
   * and value formatting (currency/user) at print time. Absent on elements placed before
   * this existed; `reconcileFieldTypes` backfills it from the document's schema. */
  fieldType?: DocumentFieldSchema['type']
  style?: TemplateElementStyle
}

export interface TemplateStaticElement {
  id: string
  type: 'static'
  x: number
  y: number
  width: number
  height: number
  text: string
  style?: TemplateElementStyle
}

export interface TemplateTableColumn {
  binding: string
  label: string
  width: number
  /** Same purpose as `TemplateTextElement.fieldType` — per-column, since a table's columns
   * can mix types (e.g. itemName vs. costPrice). */
  fieldType?: DocumentFieldSchema['type']
}

export interface TemplateTableElement {
  id: string
  type: 'table'
  x: number
  y: number
  width: number
  height: number
  binding: string
  columns: TemplateTableColumn[]
  style?: TemplateElementStyle
}

export interface TemplateLineElement {
  id: string
  type: 'line'
  x: number
  y: number
  width: number
  height: number
  orientation: 'horizontal' | 'vertical'
  style?: TemplateElementStyle
}

export interface TemplateShapeElement {
  id: string
  type: 'shape'
  x: number
  y: number
  width: number
  height: number
  style?: TemplateElementStyle
}

export type TemplateElement =
  | TemplateTextElement
  | TemplateStaticElement
  | TemplateTableElement
  | TemplateLineElement
  | TemplateShapeElement

export interface TemplateLayout {
  pageSize: 'A4' | 'Letter'
  orientation: 'portrait' | 'landscape'
  elements: TemplateElement[]
}

export function emptyLayout(): TemplateLayout {
  return { pageSize: 'A4', orientation: 'portrait', elements: [] }
}

// CSS pixel dimensions at 96dpi.
export const PAGE_SIZES: Record<TemplateLayout['pageSize'], { width: number; height: number }> = {
  A4: { width: 794, height: 1123 },
  Letter: { width: 816, height: 1056 },
}

export function pageDimensions(layout: TemplateLayout): { width: number; height: number } {
  const base = PAGE_SIZES[layout.pageSize]
  return layout.orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : base
}

export interface DocumentFieldSchema {
  path: string
  label: string
  type: 'string' | 'number' | 'date' | 'currency' | 'user'
}

export interface DocumentRepeatingGroupSchema {
  path: string
  label: string
  fields: DocumentFieldSchema[]
}

export interface DocumentSchema {
  documentType: string
  fields: DocumentFieldSchema[]
  repeatingGroups: DocumentRepeatingGroupSchema[]
}

// Resolves a dotted path (e.g. "companyName") against a plain data record.
// Repeating-group paths (e.g. "lines") are resolved separately by the table renderer.
export function resolveField(data: Record<string, unknown>, path: string): string {
  const value = path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, data)
  if (value === undefined || value === null) return ''
  return String(value)
}

/** Amounts and numbers are right-aligned by convention; an explicit `style.align` always wins. */
export function defaultAlign(fieldType: DocumentFieldSchema['type'] | undefined): 'left' | 'right' {
  return fieldType === 'number' || fieldType === 'currency' ? 'right' : 'left'
}

/** Backfills `fieldType` on text elements / table columns that predate this convention, by
 * matching their `binding` path against the document's schema (header fields for text elements,
 * the matching repeating group's fields for table columns). Elements that already carry a
 * `fieldType` (or don't match any schema field) are left untouched — this never overrides an
 * explicit designer choice. Returns a new layout; does not mutate the input. */
export function reconcileFieldTypes(layout: TemplateLayout, schema: DocumentSchema): TemplateLayout {
  const fieldTypeByPath = new Map(schema.fields.map(f => [f.path, f.type]))
  const groupFieldTypeByPath = new Map(
    schema.repeatingGroups.map(g => [g.path, new Map(g.fields.map(f => [f.path, f.type]))])
  )

  return {
    ...layout,
    elements: layout.elements.map(el => {
      if (el.type === 'text' && !el.fieldType) {
        const fieldType = fieldTypeByPath.get(el.binding)
        return fieldType ? { ...el, fieldType } : el
      }
      if (el.type === 'table') {
        const columnTypes = groupFieldTypeByPath.get(el.binding)
        if (!columnTypes) return el
        return {
          ...el,
          columns: el.columns.map(col => (col.fieldType ? col : { ...col, fieldType: columnTypes.get(col.binding) })),
        }
      }
      return el
    }),
  }
}
