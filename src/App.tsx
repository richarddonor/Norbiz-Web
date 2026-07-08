import type { ComponentType } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { ToastContextProvider } from '@/context/ToastContext'
import { AppLayout } from '@/components/AppLayout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { navItems } from '@/lib/nav'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { UsersPage } from '@/pages/UsersPage'
import { RolesPage } from '@/pages/RolesPage'
import { ItemsPage } from '@/pages/ItemsPage'
import { ItemCategoriesPage } from '@/pages/ItemCategoriesPage'
import { ItemSkusPage } from '@/pages/ItemSkusPage'
import { BrandsPage } from '@/pages/BrandsPage'
import { WarehousesPage } from '@/pages/WarehousesPage'
import { EmployeesPage } from '@/pages/EmployeesPage'

// Maps each nav path (defined once in src/lib/nav.ts) to its page component.
const pageComponents: Record<string, ComponentType> = {
  '/dashboard': DashboardPage,
  '/users': UsersPage,
  '/roles': RolesPage,
  '/items': ItemsPage,
  '/item-categories': ItemCategoriesPage,
  '/item-skus': ItemSkusPage,
  '/brands': BrandsPage,
  '/warehouses': WarehousesPage,
  '/employees': EmployeesPage,
}

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
        {navItems.map(({ to, permission }) => {
          const Page = pageComponents[to]
          const element = permission
            ? <ProtectedRoute requiredPermissions={[permission]}><Page /></ProtectedRoute>
            : <Page />
          return <Route key={to} path={to} element={element} />
        })}
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
