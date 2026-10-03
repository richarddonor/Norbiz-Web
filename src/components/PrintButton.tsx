import { useState } from 'react'
import { Printer } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { useDocumentPrint } from '@/hooks/useDocumentPrint'
import type { PageResponse } from '@/hooks/usePagedList'

interface PrintableTemplate {
  id: number
  name: string
  defaultTemplate: boolean
}

interface Props {
  /** The printed record's company — templates are looked up there, not under the active company. */
  companyId: number
  documentType: string
  data: Record<string, unknown>
  /** Called when there's no active template to print with, or the print fails. */
  onError: () => void
}

/** Print action for a transaction form. With one active template it prints straight away;
 * with several it opens a menu of the active ones (default first) to pick from. */
export function PrintButton({ companyId, documentType, data, onError }: Props) {
  const { print, printPortal } = useDocumentPrint()
  const [busy, setBusy] = useState(false)
  // Non-null while the template menu is open.
  const [options, setOptions] = useState<PrintableTemplate[] | null>(null)

  async function printWith(templateId: number) {
    setOptions(null)
    setBusy(true)
    try {
      await print(companyId, documentType, data, templateId)
    } catch {
      onError()
    } finally {
      setBusy(false)
    }
  }

  // Radix asks to open the menu on click/Enter; fetch first so a single template skips the menu.
  async function handleOpenRequest() {
    setBusy(true)
    let templates: PrintableTemplate[]
    try {
      const page = await apiFetch<PageResponse<PrintableTemplate>>(
        `/document-templates/printable?companyId=${companyId}&documentType=${encodeURIComponent(documentType)}`
      )
      templates = page.content
    } catch {
      setBusy(false)
      onError()
      return
    }
    setBusy(false)
    if (templates.length === 0) onError()
    else if (templates.length === 1) void printWith(templates[0].id)
    else setOptions(templates)
  }

  return (
    <>
      <DropdownMenu open={options !== null} onOpenChange={open => (open ? void handleOpenRequest() : setOptions(null))}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" loading={busy}>
            <Printer className="w-4 h-4" />
            Print
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Print with template</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options?.map(t => (
            <DropdownMenuItem key={t.id} onSelect={() => void printWith(t.id)}>
              <span className="flex-1">{t.name}</span>
              {t.defaultTemplate && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
                  Default
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {printPortal}
    </>
  )
}
