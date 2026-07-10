import { Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
}

export function ColumnsMenu({ columns, isVisible, onToggle }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Columns3 className="w-4 h-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
