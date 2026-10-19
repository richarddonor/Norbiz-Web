import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Camera, ImageOff, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/context/ToastContext'
import { ApiError } from '@/lib/api'
import { isRecognitionUnavailable, itemImageUrl, recognizeItem, type ItemRecognitionMatch } from '@/lib/itemRecognition'
import type { ItemLookupOption } from '@/lib/lookups'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: number
  /** the item dropdown's lookup params (e.g. `{ tag: 'INVENTORY' }`) */
  params?: Record<string, string>
  onPick: (item: ItemLookupOption) => void
  /** where focus goes when the dialog closes (Radix would otherwise restore it to the camera button) */
  onCloseAutoFocus?: (e: Event) => void
}

/**
 * "Find by photo" for the item dropdown: the user takes/chooses/pastes/drops a photo, the backend
 * suggests the closest items, and the user picks one (↑/↓ + Enter, or click). Suggestions only —
 * near-identical variants don't separate reliably, so it never auto-selects.
 */
export function ItemRecognitionDialog({ open, onOpenChange, companyId, params, onPick, onCloseAutoFocus }: Props) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const chooseRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const requestRef = useRef(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [matches, setMatches] = useState<ItemRecognitionMatch[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Each open starts fresh; closing drops any in-flight request.
  useEffect(() => {
    if (open) return
    requestRef.current++
    setMatches(null)
    setLoading(false)
    setPreview(null)
  }, [open])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  // Results arrive asynchronously, so focus moves to the best match once they render.
  useEffect(() => {
    if (matches?.length) listRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    else if (matches) chooseRef.current?.focus()
  }, [matches])

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast('Choose an image file.', 'error'); return }
    const request = ++requestRef.current
    setPreview(URL.createObjectURL(file))
    setMatches(null)
    setLoading(true)
    try {
      const found = await recognizeItem(file, companyId, params)
      if (request === requestRef.current) setMatches(found)
    } catch (err) {
      if (request !== requestRef.current) return
      if (isRecognitionUnavailable(err)) {
        toast('Photo search is unavailable right now. Search by item code or name instead.', 'error')
        onOpenChange(false)
        return
      }
      toast(err instanceof ApiError && err.status === 400 && err.message ? err.message : 'Photo search failed.', 'error')
      setMatches(null)
      chooseRef.current?.focus()
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }

  function handleListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0)
    buttons[next]?.focus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        onCloseAutoFocus={onCloseAutoFocus}
        // The dialog is portalled but React still bubbles its events to the form around the
        // dropdown, whose own shortcuts (Ctrl+Enter = Add Line) mustn't fire from in here.
        onKeyDown={e => e.stopPropagation()}
        onPaste={e => {
          const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'))
          if (file) { e.preventDefault(); handleFile(file) }
        }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
      >
        <DialogHeader>
          <DialogTitle>Find item by photo</DialogTitle>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <div className={cn(
            'flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--secondary))] sm:w-40',
            dragging && 'border-[hsl(var(--ring))]',
          )}>
            {preview
              ? <img src={preview} alt="Your photo" className="h-full w-full object-contain" />
              : <Camera className="h-8 w-8 text-[hsl(var(--muted-foreground))]" />}
          </div>

          <div className="min-w-0 flex-1">
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <Loader2 className="h-4 w-4 animate-spin" /> Looking for similar items…
              </p>
            ) : matches === null ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Take or choose a photo of the item. You can also paste one (Ctrl+V) or drop it here.
              </p>
            ) : matches.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                No similar items found. Only items with an image can be found by photo. Try another photo, or search by code or name.
              </p>
            ) : (
              <ul ref={listRef} onKeyDown={handleListKeyDown} className="space-y-1">
                {matches.map(m => (
                  <li key={m.item.id}>
                    <button
                      type="button"
                      onClick={() => onPick(m.item)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[hsl(var(--secondary))] focus-visible:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    >
                      {m.imagePath
                        ? <img src={itemImageUrl(m.imagePath)} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                        : <ImageOff className="h-10 w-10 shrink-0 p-2 text-[hsl(var(--muted-foreground))]" />}
                      <span className="min-w-0 flex-1 truncate">{m.item.code} — {m.item.name}</span>
                      <span className="shrink-0 tabular-nums text-xs text-[hsl(var(--muted-foreground))]">
                        {Math.round(m.similarity * 100)}%
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button ref={chooseRef} type="button" autoFocus disabled={loading} onClick={() => inputRef.current?.click()}>
            <Camera className="h-4 w-4" />
            {preview ? 'Try another photo' : 'Take or choose photo'}
          </Button>
        </div>
        {/* No `capture`: phones then offer both the camera and the gallery. */}
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
      </DialogContent>
    </Dialog>
  )
}
