import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  /** `reload()` from `usePagedList` — re-queries the backend with the list's
   * current page and column filters (the defaults if none were changed). */
  onReload: () => void
  /** the list's fetch-in-flight flag — spins the icon while the request runs */
  loading?: boolean
}

/** Toolbar "Reload" button for list and report pages (hotkey `R`, wired by each page). */
export function ReloadButton({ onReload, loading }: Props) {
  return (
    <Button variant="outline" onClick={onReload} disabled={loading} title="Reload from server (R)">
      <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
      Reload
      <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">R</kbd>
    </Button>
  )
}
