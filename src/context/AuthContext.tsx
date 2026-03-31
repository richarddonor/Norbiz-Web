import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api'

interface AuthContextType {
  token: string | null
  username: string | null
  displayName: string | null
  roles: string[]
  permissions: string[]
  isAuthenticated: boolean
  hasPermission: (...required: string[]) => boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

function parseTokenClaims(token: string | null): {
  username: string | null
  displayName: string | null
  roles: string[]
  permissions: string[]
} {
  if (!token) return { username: null, displayName: null, roles: [], permissions: [] }
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return {
      username: payload.sub ?? null,
      displayName: payload.displayName ?? null,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    }
  } catch {
    return { username: null, displayName: null, roles: [], permissions: [] }
  }
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'))
  const { username, displayName, roles, permissions } = parseTokenClaims(token)

  const login = useCallback(async (u: string, password: string) => {
    const data = await apiFetch<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: u, password }),
    })
    localStorage.setItem('auth_token', data.token)
    setToken(data.token)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token')
    setToken(null)
  }, [])

  const hasPermission = useCallback((...required: string[]) => {
    return required.some(p => permissions.includes(p))
  }, [permissions])

  return (
    <AuthContext.Provider value={{ token, username, displayName, roles, permissions, isAuthenticated: !!token, hasPermission, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}