import { Label } from '@/components/ui/label'

interface TagOption {
  value: string
  label: string
}

interface Props {
  label: string
  options: readonly TagOption[]
  selected: Set<string>
  onToggle: (value: string) => void
  readOnly: boolean
}

/** Checkbox group for entity tags (e.g. Item tags, Employee tags) — a fixed,
 * backend-defined enum rendered as toggleable chips-in-a-box, same shape as
 * the Roles/Companies selectors on the Users page. */
export function TagCheckboxes({ label, options, selected, onToggle, readOnly }: Props) {
  if (readOnly) {
    const chosen = options.filter(o => selected.has(o.value))
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 py-2 text-sm min-h-[2.5rem]">
          {chosen.length > 0 ? chosen.map(o => o.label).join(', ') : '—'}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-3 rounded-md border border-[hsl(var(--border))] p-3">
        {options.map(o => (
          <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={selected.has(o.value)}
              onChange={() => onToggle(o.value)}
              className="accent-[hsl(var(--primary))]"
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}
