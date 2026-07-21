import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'

interface CompanyOption {
  id: number
  name: string
}

interface Props {
  id: string
  /** Read-only display (view/edit modes, or create when the user belongs to only one company)
   * vs. an interactive picker (create mode when the user belongs to more than one company). */
  readOnly: boolean
  /** Resolved company name — used when `readOnly`. */
  name?: string | null
  /** Selectable companies — used when not `readOnly`. */
  companies?: CompanyOption[]
  value?: number | ''
  onChange?: (id: number | '') => void
  /** This field sits topmost-leftmost in every form, so it — not whatever field
   * used to be first — gets autoFocus whenever it's interactive. */
  autoFocus?: boolean
}

/** Master-data and transaction forms must always surface which Company a record
 * belongs to — as a plain read-only display when there's nothing to choose (view/edit,
 * or a single-company session), or as a required picker when creating a record and the
 * session spans more than one company. Always rendered as the topmost, leftmost field
 * in the form. */
export function CompanyField({ id, readOnly, name, companies, value, onChange, autoFocus }: Props) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Company</Label>
      {readOnly ? (
        <Input id={id} value={name ?? '—'} readOnly autoFocus={autoFocus} />
      ) : (
        <SearchableSelect
          id={id}
          value={value === '' || value === undefined ? '' : String(value)}
          onChange={v => onChange?.(v ? Number(v) : '')}
          options={(companies ?? []).map(c => ({ value: String(c.id), label: c.name }))}
          placeholder="Select a company…"
          autoFocus={autoFocus}
        />
      )}
    </div>
  )
}
