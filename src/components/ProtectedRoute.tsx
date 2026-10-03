import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  requiredPermissions?: string[]
}

export function ProtectedRoute({ children, requiredPermissions }: Props) {
  const { isAuthenticated, profileLoading, hasPermission } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (requiredPermissions && profileLoading) return null
  if (requiredPermissions && !hasPermission(...requiredPermissions)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}