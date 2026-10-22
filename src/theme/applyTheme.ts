import { contrastRatio, hexToHsl, hexToRgb } from '@/theme/color'
import { themeHex } from '@/theme/presets'
import { DEFAULT_THEME, type CompanyTheme } from '@/theme/types'

const API_BASE = import.meta.env.VITE_API_BASE as string
const STORAGE_KEY = 'last_company_theme'

/** Every variable applyTheme may set inline — cleared again when going back to the default palette. */
const BRAND_VARS = [
  '--primary', '--primary-foreground', '--ring', '--background', '--secondary', '--muted',
  '--border', '--input', '--rule', '--rule-soft', '--brand-h', '--brand-s',
] as const

export function logoSrc(theme: Pick<CompanyTheme, 'logoUrl'> | null | undefined): string | null {
  return theme?.logoUrl ? `${API_BASE}${theme.logoUrl}` : null
}

/** The theme's CSS variables: the brand color itself, plus a faint wash of its hue over the neutral surfaces. */
export function brandVariables(hex: string): Record<(typeof BRAND_VARS)[number], string> | null {
  const hsl = hexToHsl(hex)
  if (!hsl || !hexToRgb(hex)) return null
  const { h, s, l } = hsl
  const tint = (maxS: number, light: number) => `${h} ${Math.min(s, maxS)}% ${light}%`
  // White text unless the brand color is too light for it; then near-black.
  const fg = contrastRatio(hex, '#ffffff') >= 4.5 || contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#0f172a')
    ? '0 0% 100%' : '222 47% 11%'
  return {
    '--primary': `${h} ${s}% ${l}%`,
    '--primary-foreground': fg,
    '--ring': `${h} ${s}% ${l}%`,
    '--background': tint(25, 97),
    '--secondary': tint(22, 95),
    '--muted': tint(22, 95),
    '--border': tint(16, 90),
    '--input': tint(14, 85),
    '--rule': tint(14, 84),
    '--rule-soft': tint(16, 91),
    '--brand-h': String(h),
    '--brand-s': `${s}%`,
  }
}

/**
 * Applies a company theme to the whole app: colors as inline CSS variables on <html> (components read
 * `hsl(var(--primary))` etc.), and the shape/surface/motion choices as data attributes that index.css keys off.
 * Also sets the tab title and favicon. `theme` null = signed out / no company: the default Norbiz look.
 */
export function applyTheme(theme: CompanyTheme | null, companyName?: string | null) {
  const t = theme ?? DEFAULT_THEME
  const root = document.documentElement
  const hex = themeHex(t.preset, t.color)
  const vars = hex ? brandVariables(hex) : null
  for (const name of BRAND_VARS) {
    if (vars) root.style.setProperty(name, vars[name])
    else root.style.removeProperty(name)
  }
  root.dataset.radius = t.radius.toLowerCase()
  root.dataset.sidebar = t.sidebar.toLowerCase()
  root.dataset.surface = t.surface.toLowerCase()
  root.dataset.motion = t.motion.toLowerCase()

  document.title = companyName ? `${companyName} · Norbiz` : 'Norbiz'
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (icon) {
    const logo = logoSrc(t)
    icon.href = logo ?? '/favicon.svg'
    if (logo) icon.removeAttribute('type')
    else icon.type = 'image/svg+xml'
  }
}

export interface StoredTheme { theme: CompanyTheme; companyName: string }

/** The last signed-in company's theme, so the login page and the first paint already look like it. */
export function loadStoredTheme(): StoredTheme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredTheme) : null
  } catch {
    return null
  }
}

export function storeTheme(value: StoredTheme) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage blocked — the login page just shows the default look.
  }
}
