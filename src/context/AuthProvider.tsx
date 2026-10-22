import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { apiFetch, AUTH_EXPIRED_EVENT } from '@/lib/api'
import { AuthContext, type CompanyInfo, type LoginResult } from '@/context/AuthContext'

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

/** Token expiry as epoch ms (the JWT `exp` claim), or null if it can't be read. */
function parseTokenExpiry(token: string | null): number | null {
  if (!token) return null
  try {
    const exp = JSON.parse(atob(token.split('.')[1])).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

function storedToken(): string | null {
  const token = localStorage.getItem('auth_token')
  const expiry = parseTokenExpiry(token)
  if (token && expiry !== null && expiry <= Date.now()) {
    localStorage.removeItem('auth_token')
    return null
  }
  return token
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(storedToken)
  // The profile is kept with the token it was fetched for, so it's dropped (and profileLoading
  // is true again) as soon as the token changes, without resetting state in an effect.
  const [profile, setProfile] = useState<{ token: string; me: MeResponse } | null>(null)
  const me = token && profile?.token === token ? profile.me : null
  const [activeCompanyId, setActiveCompanyId] = useState<number | null>(() => {
    const stored = localStorage.getItem('active_company_id')
    return stored ? Number(stored) : null
  })
  const [awaitingCompanySelection, setAwaitingCompanySelection] = useState(false)

  // Fetch user profile whenever the token changes.
  // Validate that the stored activeCompanyId is still valid for this user.
  useEffect(() => {
    if (!token) return
    apiFetch<MeResponse>('/auth/me')
      .then(data => {
        setProfile({ token, me: data })
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
    setAwaitingCompanySelection(data.requiresCompanySelection)

    // Auto-select the company if only one (login is refused for users with none)
    if (!data.requiresCompanySelection && data.companies.length === 1) {
      setActiveCompanyId(data.companies[0].id)
      localStorage.setItem('active_company_id', String(data.companies[0].id))
    }

    return { requiresCompanySelection: data.requiresCompanySelection, companies: data.companies }
  }, [])

  const selectCompany = useCallback((companyId: number) => {
    setActiveCompanyId(companyId)
    localStorage.setItem('active_company_id', String(companyId))
    setAwaitingCompanySelection(false)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!token) return
    const data = await apiFetch<MeResponse>('/auth/me')
    setProfile({ token, me: data })
  }, [token])

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('active_company_id')
    // Saved workspace tabs (WorkspaceContext) are meant to survive a refresh, not a logout.
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith('workspace_tabs:'))
        .forEach(k => sessionStorage.removeItem(k))
    } catch {
      // Storage unavailable — nothing was saved.
    }
    setToken(null)
    setProfile(null)
    setActiveCompanyId(null)
    setAwaitingCompanySelection(false)
  }, [])

  // Back to the login screen once the token expires: on a timer at its `exp`, or as soon as
  // any request with it is rejected with 401 (e.g. the backend's TTL changed, or the tab slept
  // past the timer).
  useEffect(() => {
    if (!token) return
    const onExpired = () => logout()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    const expiry = parseTokenExpiry(token)
    const timer = expiry !== null ? window.setTimeout(logout, Math.max(0, expiry - Date.now())) : undefined
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
      window.clearTimeout(timer)
    }
  }, [token, logout])

  const hasPermission = useCallback((...required: string[]) => {
    return required.some(p => (me?.permissions ?? []).includes(p))
  }, [me])

  const companies = me?.companies ?? []
  const activeCompany = companies.find(c => c.id === activeCompanyId) ?? null
  const showCompanyColumn = companies.length > 1 || (me?.permissions ?? []).includes('MANAGE_SYSTEM')

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
      showCompanyColumn,
      isAuthenticated: !!token,
      awaitingCompanySelection,
      profileLoading: !!token && !me,
      hasPermission,
      login,
      selectCompany,
      refreshProfile,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
