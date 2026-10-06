import { Columns3, Save, RotateCcw, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'

export interface ColumnDef {
  key: string
  label: string
  /** 'date' renders a from/to range filter (with quick presets); 'boolean' renders
   * a True/False/(blank) select — both replace the default plain text filter */
  type?: 'text' | 'date' | 'boolean'
}

interface Props {
  columns: readonly ColumnDef[]
  isVisible: (key: string) => boolean
  onToggle: (key: string) => void
  /** the current view differs from the saved layout */
  dirty: boolean
  /** a save request is in flight */
  saving: boolean
  onSave: () => void
  onRevert: () => void
  onShowAll: () => void
}

/** Pass `useColumnVisibility(...).menu` as props: `<ColumnsMenu columns={COLUMNS} {...columnMenu} />`. */
export function ColumnsMenu({ columns, isVisible, onToggle, dirty, saving, onSave, onRevert, onShowAll }: Props) {
  const allVisible = columns.every(c => isVisible(c.key))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Columns3 className="w-4 h-4" />
          Columns
          {dirty && <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--primary))]" title="Unsaved column layout" />}
        </Button>
      </DropdownMenuTrigger>
      {/* The list scrolls on its own so the layout actions stay in view on long column sets. */}
      <DropdownMenuContent align="end" className="flex flex-col overflow-y-hidden">
        <DropdownMenuLabel className="flex items-center justify-between gap-4">
          Toggle columns
          {dirty && <span className="font-normal">Unsaved</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="min-h-0 overflow-y-auto">
          {columns.map(col => (
            <DropdownMenuCheckboxItem
              key={col.key}
              checked={isVisible(col.key)}
              onCheckedChange={() => onToggle(col.key)}
              onSelect={e => e.preventDefault()}
            >
              {col.label}
            </DropdownMenuCheckboxItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={allVisible} onSelect={e => { e.preventDefault(); onShowAll() }}>
          <Eye className="w-4 h-4" />
          Show all
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!dirty || saving} onSelect={e => { e.preventDefault(); onRevert() }}>
          <RotateCcw className="w-4 h-4" />
          Revert to saved
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!dirty || saving} onSelect={onSave}>
          <Save className="w-4 h-4" />
          Save layout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
