import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { ToastContextProvider } from '@/context/ToastContext'
import { AppLayout } from '@/components/AppLayout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { UsersPage } from '@/pages/UsersPage'
import { RolesPage } from '@/pages/RolesPage'
import { ItemsPage } from '@/pages/ItemsPage'

function AppRoutes() {
  const { isAuthenticated } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/users" element={
          <ProtectedRoute requiredPermissions={['VIEW_USER']}>
            <UsersPage />
          </ProtectedRoute>
        } />
        <Route path="/roles" element={
          <ProtectedRoute requiredPermissions={['VIEW_ROLE']}>
            <RolesPage />
          </ProtectedRoute>
        } />
        <Route path="/items" element={
          <ProtectedRoute requiredPermissions={['VIEW_ITEM']}>
            <ItemsPage />
          </ProtectedRoute>
        } />
      </Route>
      <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastContextProvider>
          <AppRoutes />
        </ToastContextProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
