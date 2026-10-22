import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Check, ImageUp, Play, Trash2, TriangleAlert } from 'lucide-react'
import { apiFetch, apiUpload, mutationErrorMessage } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTabInstance } from '@/context/WorkspaceContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { applyTheme, logoSrc } from '@/theme/applyTheme'
import { contrastRatio, hexToRgb } from '@/theme/color'
import { playClose, playOpen } from '@/theme/motion'
import { CUSTOM_PRESET, THEME_PRESETS, themeHex } from '@/theme/presets'
import { DEFAULT_THEME, type CompanyTheme } from '@/theme/types'

const RADIUS_OPTIONS = [
  { value: 'SHARP', label: 'Sharp', hint: 'Crisp, ledger-like corners' },
  { value: 'SOFT', label: 'Soft', hint: 'The default' },
  { value: 'ROUND', label: 'Round', hint: 'Friendly, pill-like' },
] as const
const SIDEBAR_OPTIONS = [
  { value: 'LIGHT', label: 'Light', hint: 'Plain white' },
  { value: 'TINTED', label: 'Tinted', hint: 'A wash of the brand colour' },
  { value: 'DARK', label: 'Dark', hint: 'Deep brand-hued panel' },
] as const
const SURFACE_OPTIONS = [
  { value: 'PLAIN', label: 'Plain', hint: 'Clean white forms' },
  { value: 'PAPER', label: 'Paper', hint: 'Warm off-white sheet' },
  { value: 'GRAIN', label: 'Grain', hint: 'Paper with a faint texture' },
] as const
const MOTION_OPTIONS = [
  { value: 'DOCUMENT', label: 'Document', hint: 'Pulled from a drawer, filed into its tab' },
  { value: 'SLIDE', label: 'Slide', hint: 'A quick slide and fade' },
  { value: 'NONE', label: 'None', hint: 'Forms appear instantly' },
] as const

function sameChoices(a: CompanyTheme, b: CompanyTheme) {
  return a.preset === b.preset && a.color === b.color && a.radius === b.radius
    && a.sidebar === b.sidebar && a.surface === b.surface && a.motion === b.motion
}

// The active company's look (docs/THEMING.md): brand colour, logo, corners, sidebar, form surface and form motion.
// Changes preview live across the whole app while this tab is shown, and revert unless saved.
export function CompanyThemePage() {
  const { activeCompany, refreshProfile, hasPermission } = useAuth()
  const { toast } = useToast()
  const tab = useTabInstance()
  const canManage = hasPermission('MANAGE_COMPANY_THEME')
  const saved = activeCompany?.theme ?? DEFAULT_THEME

  const [draft, setDraft] = useState<CompanyTheme>(saved)
  // Start over from the saved theme when the active company changes. (A save or logo upload keeps the draft:
  // after a save it already matches, and an upload shouldn't throw away unsaved colour choices.)
  const [draftCompanyId, setDraftCompanyId] = useState(activeCompany?.id)
  if (activeCompany?.id !== draftCompanyId) {
    setDraftCompanyId(activeCompany?.id)
    setDraft(saved)
  }
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const sample = useRef<HTMLDivElement>(null)
  const playButton = useRef<HTMLButtonElement>(null)

  const companyName = activeCompany?.name
  const savedTheme = activeCompany?.theme ?? null
  useEffect(() => {
    if (!tab.active || !companyName) return
    applyTheme({ ...draft, logoUrl: savedTheme?.logoUrl ?? null }, companyName)
    return () => applyTheme(savedTheme, companyName)
  }, [draft, tab.active, companyName, savedTheme])

  if (!activeCompany) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">Select a company to edit its theme.</p>
  }
  const companyId = activeCompany.id

  const dirty = !sameChoices(draft, saved)
  const customHex = draft.preset === CUSTOM_PRESET ? draft.color ?? '' : ''
  const brandHex = themeHex(draft.preset, draft.color)
  const lowContrast = brandHex && hexToRgb(brandHex) && (
    Math.max(contrastRatio(brandHex, '#ffffff'), contrastRatio(brandHex, '#0f172a')) < 4.5
    || contrastRatio(brandHex, '#ffffff') < 3
  )
  const set = (patch: Partial<CompanyTheme>) => setDraft(d => ({ ...d, ...patch }))

  async function save() {
    if (draft.preset === CUSTOM_PRESET && !hexToRgb(draft.color ?? '')) return toast('Enter a colour as #rrggbb.', 'error')
    setSaving(true)
    try {
      await apiFetch(`/companies/${companyId}/theme`, { method: 'PUT', body: JSON.stringify(pickChoices(draft)) })
      await refreshProfile()
      toast('Theme saved.', 'success')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to save the theme.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function uploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 512 * 1024) return toast('The logo must be 512 KB or smaller.', 'error')
    setUploading(true)
    try {
      await apiUpload(`/companies/${companyId}/logo`, file)
      await refreshProfile()
      toast('Logo uploaded.', 'success')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to upload the logo.'), 'error')
    } finally {
      setUploading(false)
    }
  }

  async function removeLogo() {
    if (!window.confirm('Remove the company logo?')) return
    setUploading(true)
    try {
      await apiFetch(`/companies/${companyId}/logo`, { method: 'DELETE' })
      await refreshProfile()
      toast('Logo removed.', 'success')
    } catch (err) {
      toast(mutationErrorMessage(err, 'Failed to remove the logo.'), 'error')
    } finally {
      setUploading(false)
    }
  }

  async function previewMotion() {
    const el = sample.current
    if (!el) return
    const closed = playClose(el, playButton.current)
    if (closed) await closed
    el.getAnimations().forEach(a => a.cancel())
    await new Promise(resolve => window.setTimeout(resolve, 150))
    playOpen(el)
  }

  const logo = logoSrc(saved)

  return (
    <div className="max-w-3xl space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold">Company Theme</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          How Norbiz looks for everyone in <span className="font-medium text-[hsl(var(--foreground))]">{activeCompany.name}</span>.
          Changes preview live while this tab is open.
        </p>
      </div>

      <Section title="Brand colour" description="Buttons, highlights and the active tab. Neutral backgrounds take on a faint hint of it.">
        <div className="flex flex-wrap gap-2">
          <Swatch label="Default" hex="#1d4ed8" selected={draft.preset === null} onClick={() => set({ preset: null, color: null })} disabled={!canManage} />
          {THEME_PRESETS.map(p => (
            <Swatch key={p.key} label={p.label} hex={p.hex} selected={draft.preset === p.key} onClick={() => set({ preset: p.key, color: null })} disabled={!canManage} />
          ))}
          <Swatch label="Custom" hex={customHex || '#888888'} custom selected={draft.preset === CUSTOM_PRESET}
            onClick={() => set({ preset: CUSTOM_PRESET, color: draft.color ?? brandHex ?? '#1d4ed8' })} disabled={!canManage} />
        </div>
        {draft.preset === CUSTOM_PRESET && (
          <div className="mt-3 flex items-center gap-2">
            <input type="color" aria-label="Pick a colour" value={hexToRgb(customHex) ? customHex : '#1d4ed8'}
              onChange={e => set({ color: e.target.value })} disabled={!canManage}
              className="h-9 w-12 cursor-pointer rounded-md border border-[hsl(var(--input))] bg-transparent p-0.5" />
            <Input aria-label="Hex colour" value={customHex} maxLength={7} className="w-32 font-mono"
              onChange={e => set({ color: e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}` })} readOnly={!canManage} />
          </div>
        )}
        {lowContrast && (
          <p className="mt-3 flex items-center gap-2 text-sm text-[hsl(var(--destructive))]">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            This colour is hard to read as text or behind button labels. Pick a deeper shade.
          </p>
        )}
      </Section>

      <Section title="Logo" description="Shown in the sidebar, the browser tab and the sign-in page. PNG, JPEG or WEBP, up to 512 KB. Saved as soon as it's uploaded.">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-40 place-items-center rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background))]">
            {logo
              ? <img src={logo} alt={`${activeCompany.name} logo`} className="max-h-12 max-w-[9rem] object-contain" />
              : <span className="text-xs text-[hsl(var(--muted-foreground))]">No logo</span>}
          </div>
          {canManage && (
            <div className="flex gap-2">
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadLogo} />
              <Button type="button" variant="outline" loading={uploading} onClick={() => fileInput.current?.click()}>
                <ImageUp className="h-4 w-4" /> {logo ? 'Replace' : 'Upload'}
              </Button>
              {logo && (
                <Button type="button" variant="ghost" disabled={uploading} onClick={removeLogo}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Shape & surface">
        <Choice label="Corners" options={RADIUS_OPTIONS} value={draft.radius} onChange={radius => set({ radius })} disabled={!canManage} />
        <Choice label="Sidebar" options={SIDEBAR_OPTIONS} value={draft.sidebar} onChange={sidebar => set({ sidebar })} disabled={!canManage} />
        <Choice label="Form surface" options={SURFACE_OPTIONS} value={draft.surface} onChange={surface => set({ surface })} disabled={!canManage} />
      </Section>

      <Section title="Motion" description="How record forms open and close. Turned off automatically when the computer asks for reduced motion.">
        <Choice label="Form animation" options={MOTION_OPTIONS} value={draft.motion} onChange={motion => set({ motion })} disabled={!canManage} />
        <div className="mt-4 flex items-start gap-4">
          <div ref={sample} className="doc-sheet w-56 rounded-xl border border-[hsl(var(--rule))] bg-[hsl(var(--card))] p-3 text-xs shadow-sm">
            <div className="mb-2 flex justify-between font-semibold"><span>Purchase Order</span><span className="text-[hsl(var(--primary))]">PO-0001</span></div>
            <div className="space-y-1.5">
              <div className="h-2 w-3/4 rounded bg-[hsl(var(--secondary))]" />
              <div className="h-2 w-1/2 rounded bg-[hsl(var(--secondary))]" />
              <div className="h-2 w-2/3 rounded bg-[hsl(var(--secondary))]" />
            </div>
          </div>
          <Button ref={playButton} type="button" variant="outline" onClick={previewMotion} disabled={draft.motion === 'NONE'}>
            <Play className="h-4 w-4" /> Preview close &amp; open
          </Button>
        </div>
      </Section>

      {canManage && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(saved)}>Discard changes</Button>
          <Button type="button" loading={saving} disabled={!dirty} onClick={save}>Save theme</Button>
        </div>
      )}
    </div>
  )
}

function pickChoices(t: CompanyTheme) {
  return { preset: t.preset, color: t.color, radius: t.radius, sidebar: t.sidebar, surface: t.surface, motion: t.motion }
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))]">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function Swatch({ label, hex, selected, custom, disabled, onClick }: {
  label: string; hex: string; selected: boolean; custom?: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected} title={label}
      className={cn(
        'flex w-[5.5rem] flex-col items-center gap-1.5 rounded-lg border p-2 text-xs transition-colors disabled:cursor-not-allowed',
        selected ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary))]',
      )}>
      <span className="grid h-8 w-8 place-items-center rounded-full text-white shadow-inner"
        style={{ background: custom && !selected ? 'conic-gradient(#e11d48, #f59e0b, #10b981, #0ea5e9, #8b5cf6, #e11d48)' : hex }}>
        {selected && <Check className="h-4 w-4" />}
      </span>
      {label}
    </button>
  )
}

function Choice<V extends string>({ label, options, value, onChange, disabled }: {
  label: string
  options: readonly { value: V; label: string; hint: string }[]
  value: V
  onChange: (value: V) => void
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {options.map(o => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed',
              value === o.value ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary))]',
            )}>
            <div className="text-sm font-medium">{o.label}</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))]">{o.hint}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
