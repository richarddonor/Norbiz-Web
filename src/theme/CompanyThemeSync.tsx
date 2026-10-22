import { useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { applyTheme, loadStoredTheme, storeTheme } from '@/theme/applyTheme'

/** Keeps the app's look in step with the active company's theme (docs/THEMING.md). Signed out, it shows the last
 * company's theme so the login page is already familiar. */
export function CompanyThemeSync() {
  const { activeCompany, isAuthenticated } = useAuth()

  useEffect(() => {
    if (activeCompany?.theme) {
      applyTheme(activeCompany.theme, activeCompany.name)
      storeTheme({ theme: activeCompany.theme, companyName: activeCompany.name })
    } else if (!isAuthenticated) {
      applyTheme(loadStoredTheme()?.theme ?? null)
    }
  }, [activeCompany, isAuthenticated])

  return null
}
