import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, type CompanyInfo } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Building2, ChevronRight } from 'lucide-react'

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
    } catch {
      toast('Invalid username or password.', 'error')
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
                  <Building2 className="w-5 h-5 shrink-0 text-[hsl(var(--muted-foreground))]" />
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