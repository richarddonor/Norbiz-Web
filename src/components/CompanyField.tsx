import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { DocCell, DocRow } from '@/components/ui/doc-form'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useAuth } from '@/context/AuthContext'

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

/** Which Company a record belongs to — a plain read-only display when there's nothing to
 * choose (view/edit), or a required picker when creating a record. Only rendered when the
 * session spans more than one company (`showCompanyColumn`); most users belong to a single
 * company, where the field would always say the same thing, so it renders nothing and the
 * form's `companyId` state silently stays seeded from `activeCompanyId`. Place it via
 * `DocLetterhead` as the topmost, leftmost cell of the paper-style `DocSheet`. */
export function CompanyField({ id, readOnly, name, companies, value, onChange, autoFocus }: Props) {
  const { showCompanyColumn } = useAuth()
  if (!showCompanyColumn) return null
  return (
    <DocCell label="Company" htmlFor={id}>
      {readOnly ? (
        <Input id={id} value={name ?? '—'} readOnly autoFocus={autoFocus} className="text-base font-semibold" />
      ) : (
        <SearchableSelect
          id={id}
          value={value === '' || value === undefined ? '' : String(value)}
          onChange={v => onChange?.(v ? Number(v) : '')}
          options={(companies ?? []).map(c => ({ value: String(c.id), label: c.name }))}
          autoFocus={autoFocus}
        />
      )}
    </DocCell>
  )
}

/** Row 1 of a `DocSheet`: the `CompanyField` letterhead (top-left) beside the `DocHeader`
 * title block. In a single-company session the company cell is dropped entirely and the
 * header takes the full row, so hiding it leaves no empty gap. */
export function DocLetterhead({ company, children }: { company: ReactNode; children: ReactNode }) {
  const { showCompanyColumn } = useAuth()
  return showCompanyColumn
    ? <DocRow cols="3fr 2fr">{company}{children}</DocRow>
    : <DocRow>{children}</DocRow>
}
