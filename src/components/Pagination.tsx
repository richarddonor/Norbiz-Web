import { Button } from '@/components/ui/button'

interface Props {
  page: number
  totalPages: number
  totalElements: number
  pageSize: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, totalPages, totalElements, pageSize, onPageChange }: Props) {
  const from = totalElements === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, totalElements)

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[hsl(var(--border))] text-sm">
      <span className="text-[hsl(var(--muted-foreground))]">
        {totalElements === 0 ? 'No records' : `${from}–${to} of ${totalElements}`}
      </span>
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
