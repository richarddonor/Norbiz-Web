import { useSyncExternalStore } from 'react'
import { apiUpload, ApiError } from '@/lib/api'
import type { ItemLookupOption } from '@/lib/lookups'

// Item photo recognition (`POST /lookups/items/recognize`, see ../Norbiz/docs/ITEM_RECOGNITION.md):
// the user's photo is matched against the company's item reference images and the closest items
// come back best first, as the same options the item dropdown returns.

const API_BASE = import.meta.env.VITE_API_BASE as string

/** Code the backend sends (503) when recognition is disabled or its embedder sidecar is down. */
export const ITEM_RECOGNITION_UNAVAILABLE = 'ITEM_RECOGNITION_UNAVAILABLE'

export interface ItemRecognitionMatch {
  item: ItemLookupOption
  /** cosine similarity 0..1 to the item's closest reference image */
  similarity: number
  /** that reference image, for showing next to the user's photo */
  imagePath: string
}

export function itemImageUrl(imagePath: string, ts?: number) {
  const base = `${API_BASE}/item-images/${imagePath}`
  return ts ? `${base}?v=${ts}` : base
}

export function isRecognitionUnavailable(err: unknown): boolean {
  return err instanceof ApiError && err.code === ITEM_RECOGNITION_UNAVAILABLE
}

// CLIP looks at a 224px crop, so a phone photo is shrunk before upload: it stays well under the
// backend's 5 MB limit and uploads fast on a mobile connection.
const MAX_SIDE = 1024

async function downscale(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // the browser can't decode it (e.g. HEIC) — let the backend try
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size < 1_000_000) { bitmap.close(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file
}

/**
 * The company's items that look most like `photo`, best first (empty when nothing is similar
 * enough). `params` are the item dropdown's own lookup params (e.g. `{ tag: 'INVENTORY' }`), so
 * only items the dropdown could offer come back. `limit` is 1–20 (backend cap). A 503 marks recognition
 * unavailable for the session.
 */
export async function recognizeItem(
  photo: File,
  companyId: number,
  params?: Record<string, string>,
  limit = 5,
): Promise<ItemRecognitionMatch[]> {
  const qs = new URLSearchParams({ ...params, companyId: String(companyId), limit: String(limit) })
  try {
    return await apiUpload<ItemRecognitionMatch[]>(`/lookups/items/recognize?${qs}`, await downscale(photo))
  } catch (err) {
    if (isRecognitionUnavailable(err)) markRecognitionUnavailable()
    throw err
  }
}

// Once the backend says recognition is unavailable, the camera buttons hide until the next page
// load and the user falls back to text search.
let available = true
const listeners = new Set<() => void>()

export function markRecognitionUnavailable() {
  if (!available) return
  available = false
  listeners.forEach(l => l())
}

export function useItemRecognitionAvailable(): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => available,
  )
}
