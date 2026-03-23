import { useEffect, useState } from 'react'
import { LayoutDashboard, Users, Shield } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'

const stats = [
  { label: 'Total Users', value: '—', icon: Users },
  { label: 'Active Sessions', value: '—', icon: LayoutDashboard },
  { label: 'Roles', value: '3', icon: Shield },
]

export function DashboardPage() {
  const [greeting, setGreeting] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<string>('/greetings').then(setGreeting).catch(() => null)
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {greeting && <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">{greeting}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-lg bg-[hsl(var(--primary))]/10">
                  <Icon className="w-6 h-6 text-[hsl(var(--primary))]" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">{label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
