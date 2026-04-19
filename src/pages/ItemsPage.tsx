import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, ImageOff, Eye } from 'lucide-react'
import { apiFetch, apiUpload } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const API_BASE = import.meta.env.VITE_API_BASE as string

type FormMode = 'view' | 'create' | 'edit'

const PRICE_TYPES = ['UNIT_PRICE', 'COST_PRICE', 'FOCAL_PRICE', 'MARKDOWN_PRICE'] as const
type PriceType = typeof PRICE_TYPES[number]

const PRICE_LABELS: Record<PriceType, string> = {
  UNIT_PRICE: 'Unit Price',
  COST_PRICE: 'Cost Price',
  FOCAL_PRICE: 'Focal Price',
  MARKDOWN_PRICE: 'Mark Down Price',
}

interface PriceEntry {
  priceType: PriceType
  amount: string
}

interface Item {
  id: number
  companyId: number
  companyName: string
  itemCode: string
  name: string
  imagePath: string | null
  active: boolean
  skus: string[]
  prices: PriceEntry[]
}

type ItemForm = {
  itemCode: string
  name: string
  skus: string
  prices: Record<PriceType, string>
}

function emptyPrices(): Record<PriceType, string> {
  return { UNIT_PRICE: '', COST_PRICE: '', FOCAL_PRICE: '', MARKDOWN_PRICE: '' }
}

function formToPayload(form: ItemForm, companyId: number) {
  return {
    companyId,
    itemCode: form.itemCode,
    name: form.name,
    skus: form.skus.split(',').map(s => s.trim()).filter(Boolean),
    prices: PRICE_TYPES
      .filter(t => form.prices[t] !== '')
      .map(t => ({ priceType: t, amount: Number(form.prices[t]) })),
  }
}

function itemToForm(item: Item): ItemForm {
  const prices = emptyPrices()
  for (const p of item.prices) {
    prices[p.priceType] = p.amount
  }
  return {
    itemCode: item.itemCode,
    name: item.name,
    skus: item.skus.join(', '),
    prices,
  }
}

function imageUrl(imagePath: string) {
  return `${API_BASE}/item-images/${imagePath}`
}

// ── Image display / picker ────────────────────────────────────────────────────
function ItemImage({
  currentPath,
  onFileSelected,
  readOnly,
}: {
  currentPath: string | null
  onFileSelected: (file: File | null) => void
  readOnly: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(
    currentPath ? imageUrl(currentPath) : null,
  )

  // Sync preview when the viewed item changes
  useEffect(() => {
    setPreview(currentPath ? imageUrl(currentPath) : null)
  }, [currentPath])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file) {
      setPreview(URL.createObjectURL(file))
      onFileSelected(file)
    }
  }

  const containerBase = 'flex items-center justify-center w-full h-40 rounded-md overflow-hidden'

  return (
    <div className="space-y-2">
      <Label>Image</Label>
      {readOnly ? (
        <div className={`${containerBase} border border-[hsl(var(--border))] bg-[hsl(var(--secondary))]`}>
          {preview
            ? <img src={preview} alt="Item" className="object-contain w-full h-full" />
            : <div className="flex flex-col items-center gap-1 text-[hsl(var(--muted-foreground))]">
                <ImageOff className="w-8 h-8" />
                <span className="text-xs">No image</span>
              </div>
          }
        </div>
      ) : (
        <>
          <div
            onClick={() => inputRef.current?.click()}
            className={`${containerBase} border-2 border-dashed border-[hsl(var(--border))] cursor-pointer hover:border-[hsl(var(--primary))] transition-colors`}
          >
            {preview
              ? <img src={preview} alt="Item" className="object-contain w-full h-full" />
              : <div className="flex flex-col items-center gap-1 text-[hsl(var(--muted-foreground))]">
                  <ImageOff className="w-8 h-8" />
                  <span className="text-xs">Click to upload</span>
                </div>
            }
          </div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />
        </>
      )}
    </div>
  )
}

// ── Form fields ───────────────────────────────────────────────────────────────
function ItemFormFields({
  form,
  setForm,
  currentImagePath,
  onFileSelected,
  mode,
}: {
  form: ItemForm
  setForm: React.Dispatch<React.SetStateAction<ItemForm>>
  currentImagePath: string | null
  onFileSelected: (f: File | null) => void
  mode: FormMode
}) {
  const ro = mode === 'view'
  return (
    <>
      <ItemImage currentPath={currentImagePath} onFileSelected={onFileSelected} readOnly={ro} />
      <div className="space-y-1.5">
        <Label htmlFor="form-code">Item Code</Label>
        <Input id="form-code" value={form.itemCode} readOnly={ro || mode === 'edit'}
          onChange={e => setForm(f => ({ ...f, itemCode: e.target.value }))} required={!ro} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="form-name">Name</Label>
        <Input id="form-name" value={form.name} readOnly={ro}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required={!ro} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="form-skus">
          SKU Codes{' '}
          {!ro && <span className="text-[hsl(var(--muted-foreground))] font-normal">(comma-separated)</span>}
        </Label>
        <Input id="form-skus" value={form.skus} readOnly={ro} placeholder={ro ? undefined : 'SKU-001, SKU-002'}
          onChange={e => setForm(f => ({ ...f, skus: e.target.value }))} />
      </div>
      <div className="space-y-1.5">
        <Label>Prices</Label>
        <div className="grid grid-cols-2 gap-3">
          {PRICE_TYPES.map(type => (
            <div key={type} className="space-y-1">
              <Label className="text-xs text-[hsl(var(--muted-foreground))]">{PRICE_LABELS[type]}</Label>
              <Input type="number" step="0.0001" min="0" readOnly={ro}
                value={form.prices[type]}
                onChange={e => setForm(f => ({ ...f, prices: { ...f.prices, [type]: e.target.value } }))} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function ItemsPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId } = useAuth()
  const [items, setItems] = useState<Item[]>([])

  const [open, setOpen]               = useState(false)
  const [mode, setMode]               = useState<FormMode>('view')
  const [activeItem, setActiveItem]   = useState<Item | null>(null)
  const [form, setForm]               = useState<ItemForm>({ itemCode: '', name: '', skus: '', prices: emptyPrices() })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    apiFetch<Item[]>('/items')
      .then(setItems)
      .catch(() => toast('Failed to load items.', 'error'))
  }, [])

  function openView(item: Item) {
    setActiveItem(item)
    setForm(itemToForm(item))
    setSelectedFile(null)
    setMode('view')
    setOpen(true)
  }

  function openEdit(item: Item) {
    setActiveItem(item)
    setForm(itemToForm(item))
    setSelectedFile(null)
    setMode('edit')
    setOpen(true)
  }

  function openCreate() {
    setActiveItem(null)
    setForm({ itemCode: '', name: '', skus: '', prices: emptyPrices() })
    setSelectedFile(null)
    setMode('create')
    setOpen(true)
  }

  function switchToEdit() {
    setMode('edit')
  }

  async function uploadImage(itemId: number, file: File): Promise<string | null> {
    try {
      const res = await apiUpload<{ imagePath: string }>(`/items/${itemId}/image`, file)
      return res.imagePath
    } catch {
      toast('Item saved, but image upload failed.', 'error')
      return null
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'create') {
        let created = await apiFetch<Item>('/items', {
          method: 'POST',
          body: JSON.stringify(formToPayload(form, activeCompanyId!)),
        })
        if (selectedFile) {
          const path = await uploadImage(created.id, selectedFile)
          if (path) created = { ...created, imagePath: path }
        }
        setItems(prev => [...prev, created])
        toast('Item created successfully.', 'success')
      } else {
        let updated = await apiFetch<Item>(`/items/${activeItem!.id}`, {
          method: 'PUT',
          body: JSON.stringify(formToPayload(form, activeCompanyId!)),
        })
        if (selectedFile) {
          const path = await uploadImage(updated.id, selectedFile)
          if (path) updated = { ...updated, imagePath: path }
        }
        setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
        toast('Item updated successfully.', 'success')
      }
      setOpen(false)
    } catch {
      toast(mode === 'create' ? 'Failed to create item.' : 'Failed to update item.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(item: Item) {
    if (!window.confirm(`Delete item "${item.name}"?`)) return
    try {
      await apiFetch(`/items/${item.id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(i => i.id !== item.id))
      toast('Item deleted.', 'success')
    } catch {
      toast('Failed to delete item.', 'error')
    }
  }

  const dialogTitle = mode === 'view' ? 'Item Details' : mode === 'create' ? 'New Item' : 'Edit Item'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Items</h1>
        {hasPermission('CREATE_ITEM') && (
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" />
            New Item
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" onFocusOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <ItemFormFields
              form={form}
              setForm={setForm}
              currentImagePath={activeItem?.imagePath ?? null}
              onFileSelected={setSelectedFile}
              mode={mode}
            />
            <div key={mode} className="flex justify-end gap-2 pt-2">
              {mode === 'view' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                  {hasPermission('UPDATE_ITEM') && (
                    <Button type="button" onClick={switchToEdit}>Edit</Button>
                  )}
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" loading={loading}>
                    {mode === 'create' ? 'Create' : 'Save'}
                  </Button>
                </>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="pt-6">
          {items.length === 0 ? (
            <p className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">No items to display.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-left py-2 px-4 font-medium w-12" />
                  <th className="text-left py-2 px-4 font-medium">Item Code</th>
                  <th className="text-left py-2 px-4 font-medium">Name</th>
                  <th className="text-left py-2 px-4 font-medium">Company</th>
                  <th className="text-left py-2 px-4 font-medium">SKUs</th>
                  <th className="text-right py-2 px-4 font-medium">Unit Price</th>
                  <th className="py-2 px-4" />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr
                    key={item.id}
                    onClick={() => openView(item)}
                    className="border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors"
                  >
                    <td className="py-2 px-4">
                      {item.imagePath ? (
                        <img src={imageUrl(item.imagePath)} alt={item.name}
                          className="w-10 h-10 object-cover rounded-md border border-[hsl(var(--border))]" />
                      ) : (
                        <div className="w-10 h-10 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] flex items-center justify-center">
                          <ImageOff className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-4 font-mono text-xs">{item.itemCode}</td>
                    <td className="py-2 px-4">{item.name}</td>
                    <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{item.companyName}</td>
                    <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">
                      {item.skus.length > 0 ? item.skus.join(', ') : '—'}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {item.prices.find(p => p.priceType === 'UNIT_PRICE')?.amount ?? '—'}
                    </td>
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(item)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {hasPermission('UPDATE_ITEM') && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {hasPermission('DELETE_ITEM') && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(item)}>
                            <Trash2 className="w-4 h-4 text-[hsl(var(--destructive))]" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}