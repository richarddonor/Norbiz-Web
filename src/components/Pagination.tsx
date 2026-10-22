import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { PAGE_SIZE_OPTIONS } from '@/hooks/usePageSize'

const PAGE_SIZE_SELECT_OPTIONS = PAGE_SIZE_OPTIONS.map(n => ({ value: String(n), label: String(n) }))

interface Props {
  page: number
  totalPages: number
  totalElements: number
  pageSize: number
  onPageChange: (page: number) => void
  /** shows a "Rows" selector when set — pass `usePagedList`'s `setPageSize` */
  onPageSizeChange?: (size: number) => void
  /** Replaces the page controls with this text — pass `useGroupedRows`'s `summary`, which is
   * set while the rows are grouped (every row is on one page then). */
  summary?: string
}

export function Pagination({ page, totalPages, totalElements, pageSize, onPageChange, onPageSizeChange, summary }: Props) {
  if (summary !== undefined) {
    return (
      <div className="flex items-center px-4 py-3 border-t border-[hsl(var(--border))] text-sm text-[hsl(var(--muted-foreground))]">
        {summary}
      </div>
    )
  }

  const from = totalElements === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, totalElements)

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[hsl(var(--border))] text-sm">
      <div className="flex items-center gap-3">
        <span className="text-[hsl(var(--muted-foreground))]">
          {totalElements === 0 ? 'No records' : `${from}–${to} of ${totalElements}`}
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-[hsl(var(--muted-foreground))]">Rows</span>
            <SearchableSelect
              value={String(pageSize)}
              onChange={v => { if (v) onPageSizeChange(Number(v)) }}
              options={PAGE_SIZE_SELECT_OPTIONS}
              placeholder={String(pageSize)}
              className="w-20"
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="text-[hsl(var(--muted-foreground))]">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
