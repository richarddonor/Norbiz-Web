import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '@/lib/api'
import { TemplateRenderer } from '@/components/TemplateRenderer'
import { emptyLayout, type TemplateLayout } from '@/lib/documentTemplate'

interface DocumentTemplateResponse {
  id: number
  layout: string
}

/** Fetches the company's default template for a document type and prints a record
 * through the shared TemplateRenderer, via a portal kept off-screen except in @media print. */
export function useDocumentPrint() {
  const [printState, setPrintState] = useState<{ layout: TemplateLayout; data: Record<string, unknown> } | null>(null)

  const print = useCallback(async (companyId: number, documentType: string, data: Record<string, unknown>) => {
    const template = await apiFetch<DocumentTemplateResponse>(
      `/document-templates/default?companyId=${companyId}&documentType=${encodeURIComponent(documentType)}`
    )
    let layout: TemplateLayout
    try {
      layout = template.layout ? JSON.parse(template.layout) : emptyLayout()
    } catch {
      layout = emptyLayout()
    }
    setPrintState({ layout, data })
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
  }, [])

  const printPortal = printState
    ? createPortal(
        <div id="document-print-root">
          <TemplateRenderer layout={printState.layout} mode="print" data={printState.data} />
        </div>,
        document.body
      )
    : null

  return { print, printPortal }
}
