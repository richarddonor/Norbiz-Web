/** A company's UI theme as the backend stores it (GET/PUT /companies/{id}/theme, docs/THEMING.md). */
export interface CompanyTheme {
  /** A key from THEME_PRESETS, 'CUSTOM' (use `color`), or null for the default Norbiz blue. */
  preset: string | null
  color: string | null
  radius: 'SHARP' | 'SOFT' | 'ROUND'
  sidebar: 'LIGHT' | 'TINTED' | 'DARK'
  surface: 'PLAIN' | 'PAPER' | 'GRAIN'
  motion: 'DOCUMENT' | 'SLIDE' | 'NONE'
  /** Relative to the API base (`/company-logos/…?v=…`), or null. */
  logoUrl: string | null
}

export const DEFAULT_THEME: CompanyTheme = {
  preset: null,
  color: null,
  radius: 'SOFT',
  sidebar: 'LIGHT',
  surface: 'PLAIN',
  motion: 'DOCUMENT',
  logoUrl: null,
}
