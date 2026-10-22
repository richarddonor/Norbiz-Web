import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, type CompanyInfo } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ChevronRight } from 'lucide-react'
import { loadStoredTheme, logoSrc } from '@/theme/applyTheme'
import { themeHex } from '@/theme/presets'

type Step = 'credentials' | 'company'

export function LoginPage() {
  const { login, selectCompany } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [step, setStep]           = useState<Step>('credentials')
  const [username, setUsername]   = useState('')
  const [password, setPassword]   = useState('')
  const [loading, setLoading]     = useState(false)
  const [companies, setCompanies] = useState<CompanyInfo[]>([])
  // The last company signed into on this browser (CompanyThemeSync already applied its colours).
  const [lastCompany] = useState(loadStoredTheme)
  const lastLogo = logoSrc(lastCompany?.theme)

  async function handleCredentials(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await login(username, password)
      if (result.requiresCompanySelection) {
        setCompanies(result.companies)
        setStep('company')
      } else {
        navigate('/dashboard', { replace: true })
      }
    } catch (err) {
      // 403 = valid credentials but the account isn't assigned to any company; show the backend's reason.
      toast(err instanceof ApiError && err.status === 403 && err.message ? err.message : 'Invalid username or password.', 'error')
    } finally {
      setLoading(false)
    }
  }

  function handleSelectCompany(company: CompanyInfo) {
    selectCompany(company.id)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {lastLogo && <img src={lastLogo} alt={lastCompany?.companyName ?? ''} className="mx-auto mb-2 h-12 max-w-[12rem] object-contain" />}
          <CardTitle className="text-2xl">Norbiz</CardTitle>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {step === 'credentials' ? 'Sign in to your account' : 'Select a company to continue'}
          </p>
        </CardHeader>

        <CardContent>
          {step === 'credentials' && (
            <form onSubmit={handleCredentials} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" loading={loading}>
                Sign in
              </Button>
            </form>
          )}

          {step === 'company' && (
            <div className="space-y-2">
              {companies.map(company => (
                <button
                  key={company.id}
                  onClick={() => handleSelectCompany(company)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary))] hover:border-[hsl(var(--primary))] transition-colors text-left"
                >
                  <CompanyBadge company={company} />
                  <span className="flex-1 text-sm font-medium">{company.name}</span>
                  <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                </button>
              ))}
              <button
                onClick={() => setStep('credentials')}
                className="w-full text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] pt-2 transition-colors"
              >
                ← Back to sign in
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** A company's logo, else its initial on its brand colour — so each company in the list is recognisable. */
function CompanyBadge({ company }: { company: CompanyInfo }) {
  const logo = logoSrc(company.theme)
  if (logo) return <img src={logo} alt="" className="h-7 w-7 shrink-0 rounded-md object-contain" />
  const color = company.theme ? themeHex(company.theme.preset, company.theme.color) : null
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[hsl(var(--primary))] text-sm font-bold text-white"
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden
    >
      {company.name.trim()[0]?.toUpperCase()}
    </span>
  )
}
