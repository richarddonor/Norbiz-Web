/** Tested brand colors (white text passes WCAG AA on each). Keys are what the backend stores in `preset`. */
export const THEME_PRESETS = [
  { key: 'NORBIZ', label: 'Norbiz Blue', hex: '#1d4ed8' },
  { key: 'INDIGO', label: 'Indigo', hex: '#4338ca' },
  { key: 'TEAL', label: 'Teal', hex: '#0f766e' },
  { key: 'EMERALD', label: 'Emerald', hex: '#047857' },
  { key: 'OCHRE', label: 'Ochre', hex: '#b45309' },
  { key: 'CRIMSON', label: 'Crimson', hex: '#be123c' },
  { key: 'PLUM', label: 'Plum', hex: '#86198f' },
  { key: 'GRAPHITE', label: 'Graphite', hex: '#334155' },
] as const

export const CUSTOM_PRESET = 'CUSTOM'

/** The brand hex a theme resolves to, or null for the built-in default palette. */
export function themeHex(preset: string | null, color: string | null): string | null {
  if (preset === CUSTOM_PRESET) return color
  return THEME_PRESETS.find(p => p.key === preset)?.hex ?? null
}
