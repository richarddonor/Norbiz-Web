import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, LayoutGrid, Plus, RotateCcw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WIDGETS } from '@/components/dashboard/registry'
import { WidgetFrame, type LayoutItem } from '@/components/dashboard/widget-kit'
import { useDashboardLayout } from '@/components/dashboard/hooks'

/** A widget the user may pin (backend catalog, filtered by their VIEW_DASHBOARD_ permissions). */
interface CatalogEntry {
  key: string
  name: string
  category: string
  description: string
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function DashboardPage() {
  const { displayName, username, activeCompany } = useAuth()
  const { toast } = useToast()
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null)
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({})
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    apiFetch<CatalogEntry[]>('/dashboard/widgets')
      // Only widgets this build knows how to draw.
      .then(list => setCatalog(list.filter(w => w.key in WIDGETS)))
      .catch(() => { setCatalog([]); toast('Failed to load dashboard widgets.', 'error') })
  }, [toast])

  const defaults = useMemo<LayoutItem[] | null>(
    () => catalog && catalog.map(w => ({ key: w.key, wide: WIDGETS[w.key].defaultWide })),
    [catalog])
  const onSaveError = useCallback(() => toast('Failed to save your dashboard layout.', 'error'), [toast])
  const { layout, customized, save, reset } = useDashboardLayout(defaults, onSaveError)

  const byKey = useMemo(() => new Map((catalog ?? []).map(w => [w.key, w])), [catalog])
  // A widget whose permission was revoked stays in the saved layout but isn't drawn.
  const visible = (layout ?? []).filter(item => byKey.has(item.key))
  const pinned = new Set(visible.map(i => i.key))

  const update = (key: string, change: Partial<LayoutItem>) =>
    save((layout ?? []).map(i => (i.key === key ? { ...i, ...change } : i)))
  const remove = (key: string) => save((layout ?? []).filter(i => i.key !== key))
  const add = (key: string) => save([...(layout ?? []).filter(i => i.key !== key), { key, wide: WIDGETS[key].defaultWide }])
  const move = (key: string, delta: -1 | 1) => {
    const keys = visible.map(i => i.key)
    const from = keys.indexOf(key)
    const to = from + delta
    if (to < 0 || to >= keys.length) return
    ;[keys[from], keys[to]] = [keys[to], keys[from]]
    const items = new Map((layout ?? []).map(i => [i.key, i]))
    const hidden = (layout ?? []).filter(i => !byKey.has(i.key))
    save([...keys.map(k => items.get(k)!), ...hidden])
  }

  const categories = useMemo(() => {
    const groups = new Map<string, CatalogEntry[]>()
    for (const w of catalog ?? []) groups.set(w.category, [...(groups.get(w.category) ?? []), w])
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [catalog])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
            {activeCompany?.name ?? 'Dashboard'} · {new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="mt-1 text-2xl font-bold">
            {greeting()}, <span className="bg-gradient-to-r from-[var(--viz-1)] to-[hsl(var(--primary))] bg-clip-text text-transparent">{displayName ?? username}</span>
          </h1>
        </div>
        {catalog && catalog.length > 0 && (
          <div className="flex gap-2">
            {customized && (
              <Button variant="ghost" size="sm" onClick={reset} title="Show every widget you have access to, in the default order">
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <LayoutGrid className="h-4 w-4" /> Customize
            </Button>
          </div>
        )}
      </div>

      {catalog && catalog.length === 0 && (
        <div className="dash-panel p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No dashboard widgets are available to you yet. Ask an administrator for a <span className="font-mono">VIEW_DASHBOARD_*</span> permission.
        </div>
      )}

      {catalog && catalog.length > 0 && layout && visible.length === 0 && (
        <button type="button" onClick={() => setPickerOpen(true)}
          className="dash-panel flex w-full flex-col items-center gap-2 p-10 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
          <Plus className="h-6 w-6 text-[var(--viz-1)]" />
          Your dashboard is empty — add a widget.
        </button>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {visible.map((item, index) => {
          const def = WIDGETS[item.key]
          const entry = byKey.get(item.key)!
          const Body = def.component
          return (
            <WidgetFrame
              key={item.key}
              title={entry.name}
              category={entry.category}
              icon={def.icon}
              wide={item.wide}
              canMoveUp={index > 0}
              canMoveDown={index < visible.length - 1}
              onMoveUp={() => move(item.key, -1)}
              onMoveDown={() => move(item.key, 1)}
              onToggleWide={() => update(item.key, { wide: !item.wide })}
              onRefresh={() => setRefreshKeys(k => ({ ...k, [item.key]: (k[item.key] ?? 0) + 1 }))}
              onRemove={() => remove(item.key)}
            >
              <Body
                refreshKey={refreshKeys[item.key] ?? 0}
                options={item.options ?? {}}
                setOptions={options => update(item.key, { options })}
              />
            </WidgetFrame>
          )
        })}
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Customize dashboard</DialogTitle>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Pick the widgets you want to see. Your layout is saved to your account.
            </p>
          </DialogHeader>
          <div className="mt-4 max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            {categories.map(([category, widgets]) => (
              <div key={category}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">{category}</h3>
                <ul className="space-y-2">
                  {widgets.map(w => {
                    const Icon = WIDGETS[w.key].icon
                    const on = pinned.has(w.key)
                    return (
                      <li key={w.key} className="flex items-start gap-3 rounded-xl border p-3">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--viz-1)]" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{w.name}</div>
                          <div className="text-xs text-[hsl(var(--muted-foreground))]">{w.description}</div>
                        </div>
                        <Button size="sm" variant={on ? 'secondary' : 'default'} onClick={() => (on ? remove(w.key) : add(w.key))}>
                          {on ? <><Check className="h-4 w-4" /> Added</> : <><Plus className="h-4 w-4" /> Add</>}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
