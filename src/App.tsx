import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { AuthProvider } from '@/context/AuthProvider'
import { ToastContextProvider } from '@/context/ToastContextProvider'
import { AppLayout } from '@/components/AppLayout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { LoginPage } from '@/pages/LoginPage'

function AppRoutes() {
  const { isAuthenticated, awaitingCompanySelection } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated && !awaitingCompanySelection ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      {/* Everything else is the tabbed workspace — AppLayout renders each open tab's
          page through `PageRoutes` (src/routes.tsx), which holds the per-page routes. */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      />
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
