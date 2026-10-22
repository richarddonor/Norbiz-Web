import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, loadStoredTheme } from '@/theme/applyTheme'

// Paint with the last company's theme straight away; CompanyThemeSync takes over once the profile loads.
applyTheme(loadStoredTheme()?.theme ?? null)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
