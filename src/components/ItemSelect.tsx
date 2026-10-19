import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { ItemRecognitionDialog } from '@/components/ItemRecognitionDialog'
import { LookupSelect, primeLookupOption, type LookupSelectProps } from '@/components/LookupSelect'
import { useInDocCell } from '@/components/ui/doc-cell-context'
import { focusNextElement } from '@/components/ui/searchable-select'
import { useItemRecognitionAvailable } from '@/lib/itemRecognition'
import type { ItemLookupOption } from '@/lib/lookups'
import { cn } from '@/lib/utils'

const itemLabel = (item: { code: string | null; name: string }) => `${item.code} — ${item.name}`

type Props = Omit<LookupSelectProps<ItemLookupOption>, 'path' | 'getLabel'> & {
  /** Show the find-by-photo camera button (Alt+P from the dropdown). Default true. */
  recognize?: boolean
}

/**
 * Type-ahead item dropdown (`/lookups/items`) for forms and filter bars — never loads every item.
 * Next to it, a camera button finds the item by photo (`ItemRecognitionDialog`). The button is
 * kept out of the tab order so it never interrupts Enter/Tab grid entry; Alt+P on the dropdown
 * opens it from the keyboard. It hides for the session once the backend reports recognition
 * unavailable.
 */
export function ItemSelect({ recognize = true, ...props }: Props) {
  const inCell = useInDocCell()
  const available = useItemRecognitionAvailable()
  const rootRef = useRef<HTMLDivElement>(null)
  const pickedRef = useRef(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const showCamera = recognize && available && !props.disabled && !!props.companyId

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-1"
      onKeyDown={e => {
        if (showCamera && e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') {
          e.preventDefault()
          setPhotoOpen(true)
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <LookupSelect<ItemLookupOption> path="items" getLabel={itemLabel} searchPlaceholder="Type item code or name…" {...props} />
      </div>
      {showCamera && (
        <>
          <button
            type="button"
            tabIndex={-1}
            title="Find by photo (Alt+P)"
            aria-label="Find item by photo"
            onClick={() => setPhotoOpen(true)}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]',
              inCell ? 'h-8 w-7' : 'h-9 w-9 border border-[hsl(var(--input))] shadow-sm',
            )}
          >
            <Camera className="h-4 w-4" />
          </button>
          <ItemRecognitionDialog
            open={photoOpen}
            onOpenChange={setPhotoOpen}
            companyId={Number(props.companyId)}
            params={props.params}
            onPick={item => {
              primeLookupOption('items', item)
              props.onChange(String(item.id), item)
              pickedRef.current = true
              setPhotoOpen(false)
            }}
            onCloseAutoFocus={e => {
              // Back on the dropdown; after a pick, move on to the next field like Enter does.
              e.preventDefault()
              const trigger = rootRef.current?.querySelector<HTMLButtonElement>('button')
              if (!trigger) return
              trigger.focus()
              if (pickedRef.current) requestAnimationFrame(() => focusNextElement(trigger))
              pickedRef.current = false
            }}
          />
        </>
      )}
    </div>
  )
}
