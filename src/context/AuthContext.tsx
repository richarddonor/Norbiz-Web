import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api'

export interface CompanyInfo {
  id: number
  name: string
}

interface LoginResult {
  requiresCompanySelection: boolean
  companies: CompanyInfo[]
}

interface AuthContextType {
  token: string | null
  username: string | null
  displayName: string | null
  roles: string[]
  permissions: string[]
  companies: CompanyInfo[]
  activeCompanyId: number | null
  activeCompany: CompanyInfo | null
  isAuthenticated: boolean
  hasPermission: (...required: string[]) => boolean
  login: (username: string, password: string) => Promise<LoginResult>
  selectCompany: (companyId: number) => void
  logout: () => void
}

interface MeResponse {
  username: string
  displayName: string | null
  roles: string[]
  permissions: string[]
  companies: CompanyInfo[]
}

function parseTokenUsername(token: string | null): string | null {
  if (!token) return null
  try {
    return JSON.parse(atob(token.split('.')[1])).sub ?? null
  } catch {
    return null
  }
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'))
  const [me, setMe] = useState<MeResponse | null>(null)
  const [activeCompanyId, setActiveCompanyId] = useState<number | null>(() => {
    const stored = localStorage.getItem('active_company_id')
    return stored ? Number(stored) : null
  })

  // Fetch user profile whenever the token changes.
  // Validate that the stored activeCompanyId is still valid for this user.
  useEffect(() => {
    if (!token) {
      setMe(null)
      return
    }
    apiFetch<MeResponse>('/auth/me')
      .then(data => {
        setMe(data)
        // Auto-select if only one company and none is active yet
        if (data.companies.length === 1 && !activeCompanyId) {
          const id = data.companies[0].id
          setActiveCompanyId(id)
          localStorage.setItem('active_company_id', String(id))
        }
        // Clear stored company if it's no longer in the user's list
        if (activeCompanyId && data.companies.length > 0) {
          const still_valid = data.companies.some(c => c.id === activeCompanyId)
          if (!still_valid) {
            setActiveCompanyId(null)
            localStorage.removeItem('active_company_id')
          }
        }
      })
      .catch(() => {
        localStorage.removeItem('auth_token')
        setToken(null)
      })
  }, [token])

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const data = await apiFetch<{ token: string; companies: CompanyInfo[]; requiresCompanySelection: boolean }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ username, password }) },
    )
    localStorage.setItem('auth_token', data.token)
    setToken(data.token)

    // Auto-select the company if only one (or none — platform admin)
    if (!data.requiresCompanySelection && data.companies.length === 1) {
      setActiveCompanyId(data.companies[0].id)
      localStorage.setItem('active_company_id', String(data.companies[0].id))
    } else if (data.companies.length === 0) {
      // Platform-level user with no company — clear any stale value
      setActiveCompanyId(null)
      localStorage.removeItem('active_company_id')
    }

    return { requiresCompanySelection: data.requiresCompanySelection, companies: data.companies }
  }, [])

  const selectCompany = useCallback((companyId: number) => {
    setActiveCompanyId(companyId)
    localStorage.setItem('active_company_id', String(companyId))
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('active_company_id')
    setToken(null)
    setMe(null)
    setActiveCompanyId(null)
  }, [])

  const hasPermission = useCallback((...required: string[]) => {
    return required.some(p => (me?.permissions ?? []).includes(p))
  }, [me])

  const companies = me?.companies ?? []
  const activeCompany = companies.find(c => c.id === activeCompanyId) ?? null

  return (
    <AuthContext.Provider value={{
      token,
      username: me?.username ?? parseTokenUsername(token),
      displayName: me?.displayName ?? null,
      roles: me?.roles ?? [],
      permissions: me?.permissions ?? [],
      companies,
      activeCompanyId,
      activeCompany,
      isAuthenticated: !!token,
      hasPermission,
      login,
      selectCompany,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}