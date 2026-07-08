import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Shortcut {
  keys: string[]
  description: string
}

const globalShortcuts: Shortcut[] = [
  { keys: ['Ctrl', 'K'], description: 'Open command palette (jump to any page)' },
  { keys: ['?'], description: 'Show this shortcuts panel' },
]

const listPageShortcuts: Shortcut[] = [
  { keys: ['/'], description: 'Focus the search box' },
  { keys: ['N'], description: 'Create a new record' },
  { keys: ['↑', '↓'], description: 'Move between rows' },
  { keys: ['Enter'], description: 'Open the selected row' },
  { keys: ['E'], description: 'Edit the selected row' },
  { keys: ['Delete'], description: 'Delete the selected row' },
  { keys: ['Esc'], description: 'Close a dialog or clear row selection' },
]

function ShortcutRow({ keys, description }: Shortcut) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-[hsl(var(--muted-foreground))]">{description}</span>
      <span className="flex items-center gap-1 shrink-0">
        {keys.map(k => (
          <kbd key={k} className="px-1.5 py-0.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] text-xs font-mono">
            {k}
          </kbd>
        ))}
      </span>
    </div>
  )
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyboardShortcutsHelp({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <h3 className="text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))] mb-1">Global</h3>
            <div className="divide-y divide-[hsl(var(--border))]">
              {globalShortcuts.map(s => <ShortcutRow key={s.description} {...s} />)}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))] mb-1">On list pages</h3>
            <div className="divide-y divide-[hsl(var(--border))]">
              {listPageShortcuts.map(s => <ShortcutRow key={s.description} {...s} />)}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
