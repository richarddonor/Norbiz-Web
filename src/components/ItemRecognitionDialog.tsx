import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Camera, ImageOff, ImageUp, Loader2 } from 'lucide-react'
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
 * "Find by photo" for the item dropdown: the user takes a photo with the camera, or chooses/pastes/
 * drops one, the backend suggests the closest items, and the user picks one (↑/↓ + Enter, or
 * click). Suggestions only — near-identical variants don't separate reliably, so it never
 * auto-selects.
 *
 * "Take photo" shows a live camera preview (getUserMedia, so it works with a laptop webcam too).
 * Where that isn't available (no camera API, or an insecure origin) it falls back to a file input
 * with `capture`, which opens the camera app on phones and a file chooser elsewhere.
 */
export function ItemRecognitionDialog({ open, onOpenChange, companyId, params, onPick, onCloseAutoFocus }: Props) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const captureInputRef = useRef<HTMLInputElement>(null)
  const chooseRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const requestRef = useRef(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [matches, setMatches] = useState<ItemRecognitionMatch[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [camera, setCamera] = useState(false)
  // Best matches among items the dropdown's params (e.g. its tag) leave out, shown when nothing
  // the dropdown could offer matched, so the user learns why their item didn't come up.
  const [excluded, setExcluded] = useState<ItemRecognitionMatch[]>([])

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCamera(false)
  }

  // Each open starts fresh; closing drops any in-flight request and turns the camera off.
  useEffect(() => {
    if (open) return
    requestRef.current++
    setMatches(null)
    setExcluded([])
    setLoading(false)
    setPreview(null)
    stopCamera()
  }, [open])

  useEffect(() => () => streamRef.current?.getTracks().forEach(t => t.stop()), [])

  // The <video> only mounts once `camera` is on, so the stream is attached afterwards.
  useEffect(() => {
    if (camera && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current
  }, [camera])

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      captureInputRef.current?.click()
      return
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      setCamera(true)
    } catch (err) {
      const blocked = err instanceof DOMException && err.name === 'NotAllowedError'
      toast(blocked
        ? 'Camera access is blocked. Allow it in your browser, or choose a photo instead.'
        : 'No camera found. Choose a photo instead.', 'error')
      chooseRef.current?.focus()
    }
  }

  function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    stopCamera()
    canvas.toBlob(blob => {
      if (blob) handleFile(new File([blob], 'camera.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  // Results arrive asynchronously, so focus moves to the best match once they render.
  useEffect(() => {
    if (matches?.length) listRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    else if (matches) chooseRef.current?.focus()
  }, [matches])

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast('Choose an image file.', 'error'); return }
    stopCamera()
    const request = ++requestRef.current
    setPreview(URL.createObjectURL(file))
    setMatches(null)
    setExcluded([])
    setLoading(true)
    try {
      const found = await recognizeItem(file, companyId, params)
      // Nothing the dropdown offers matched: check whether its tag filter hid the item.
      const others = found.length === 0 && params?.tag
        ? await recognizeItem(file, companyId, withoutTag(params))
        : []
      if (request !== requestRef.current) return
      setMatches(found)
      setExcluded(others.slice(0, 3))
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
            'flex w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--secondary))]',
            camera ? 'h-72 sm:w-full' : 'h-40 sm:w-40',
            dragging && 'border-[hsl(var(--ring))]',
          )}>
            {camera
              ? <video ref={videoRef} autoPlay playsInline muted className="h-full w-full bg-black object-contain" />
              : preview
                ? <img src={preview} alt="Your photo" className="h-full w-full object-contain" />
                : <Camera className="h-8 w-8 text-[hsl(var(--muted-foreground))]" />}
          </div>

          {!camera && <div className="min-w-0 flex-1">
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <Loader2 className="h-4 w-4 animate-spin" /> Looking for similar items…
              </p>
            ) : matches === null ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Take or choose a photo of the item. You can also paste one (Ctrl+V) or drop it here.
              </p>
            ) : matches.length === 0 && excluded.length > 0 ? (
              <div className="space-y-2 text-sm text-[hsl(var(--muted-foreground))]">
                <p>
                  No {params?.tag?.toLowerCase()} items look like this photo. These do, but they aren't
                  tagged {params?.tag}, so they can't be picked here:
                </p>
                <ul className="space-y-1">
                  {excluded.map(m => (
                    <li key={m.item.id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate">{m.item.code} — {m.item.name}</span>
                      <span className="shrink-0 tabular-nums text-xs">{Math.round(m.similarity * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
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
          </div>}
        </div>

        {camera ? (
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { stopCamera(); requestAnimationFrame(() => chooseRef.current?.focus()) }}>Back</Button>
            <Button type="button" autoFocus onClick={capture}>
              <Camera className="h-4 w-4" />
              Capture
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" variant="outline" disabled={loading} onClick={() => inputRef.current?.click()}>
              <ImageUp className="h-4 w-4" />
              Choose photo
            </Button>
            <Button ref={chooseRef} type="button" autoFocus disabled={loading} onClick={startCamera}>
              <Camera className="h-4 w-4" />
              {preview ? 'Take another photo' : 'Take photo'}
            </Button>
          </div>
        )}
        {/* "Choose photo": no `capture`, so phones offer the gallery (and usually the camera too). */}
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
        {/* "Take photo" fallback when the camera API isn't available: opens the camera app on phones. */}
        <input ref={captureInputRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
      </DialogContent>
    </Dialog>
  )
}

function withoutTag(params: Record<string, string>): Record<string, string> {
  const rest = { ...params }
  delete rest.tag
  return rest
}
