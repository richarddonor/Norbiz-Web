import { DocCell, DocCheck, DocText } from '@/components/ui/doc-form'

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
 * backend-defined enum rendered as a row of paper-form tick boxes inside one
 * `DocCell`. */
export function TagCheckboxes({ label, options, selected, onToggle, readOnly }: Props) {
  if (readOnly) {
    const chosen = options.filter(o => selected.has(o.value))
    return (
      <DocCell label={label}>
        <DocText>{chosen.map(o => o.label).join(', ')}</DocText>
      </DocCell>
    )
  }
  return (
    <DocCell label={label}>
      <div className="flex flex-wrap">
        {options.map(o => (
          <DocCheck
            key={o.value}
            id={`tag-${label}-${o.value}`}
            label={o.label}
            checked={selected.has(o.value)}
            onChange={() => onToggle(o.value)}
          />
        ))}
      </div>
    </DocCell>
  )
}
