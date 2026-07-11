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
  type: 'string' | 'number' | 'date'
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
