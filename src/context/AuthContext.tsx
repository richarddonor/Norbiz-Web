import { createContext, useContext } from 'react'
import type { CompanyTheme } from '@/theme/types'

export interface CompanyInfo {
  id: number
  name: string
  /** The company's UI theme (docs/THEMING.md); applied by CompanyThemeSync. */
  theme?: CompanyTheme
}

export interface LoginResult {
  requiresCompanySelection: boolean
  companies: CompanyInfo[]
}

export interface AuthContextType {
  token: string | null
  username: string | null
  displayName: string | null
  roles: string[]
  permissions: string[]
  companies: CompanyInfo[]
  activeCompanyId: number | null
  activeCompany: CompanyInfo | null
  /** True when the user should see Company columns/fields throughout the app —
   * either they belong to more than one Company, or they're a platform-level
   * SUPER_ADMIN not scoped to a single one. False means every record they can
   * see belongs to the same Company, so the column would be redundant. */
  showCompanyColumn: boolean
  isAuthenticated: boolean
  /** True right after login when the user belongs to more than one Company and hasn't
   * picked one yet — the /login route must stay on the company-selection step instead
   * of auto-redirecting to /dashboard just because a token now exists. */
  awaitingCompanySelection: boolean
  /** True while a token exists but `/auth/me` hasn't answered yet — permissions are still
   * unknown, so permission-gated routes must wait rather than redirect (a hard refresh of
   * `/purchase-orders/12`, or a restored workspace tab, would otherwise bounce to /dashboard). */
  profileLoading: boolean
  hasPermission: (...required: string[]) => boolean
  login: (username: string, password: string) => Promise<LoginResult>
  selectCompany: (companyId: number) => void
  /** Re-fetches `/auth/me` — e.g. after the company theme changed. */
  refreshProfile: () => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}