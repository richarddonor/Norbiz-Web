export interface DateRange {
  from: string
  to: string
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(d: Date): Date {
  // Monday-start week.
  const day = d.getDay() // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day
  return addDays(d, diff)
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1)
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate())
}

export interface DateRangePreset {
  label: string
  range: () => DateRange
}

/** Commonly used date-range presets for filtering date columns. */
export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { label: 'Today', range: () => { const t = new Date(); return { from: ymd(t), to: ymd(t) } } },
  { label: 'Current Week', range: () => { const t = new Date(); return { from: ymd(startOfWeek(t)), to: ymd(t) } } },
  { label: 'Current Month', range: () => { const t = new Date(); return { from: ymd(startOfMonth(t)), to: ymd(t) } } },
  { label: 'Last 30 Days', range: () => { const t = new Date(); return { from: ymd(addDays(t, -29)), to: ymd(t) } } },
  { label: 'Last 3 Months', range: () => { const t = new Date(); return { from: ymd(addMonths(t, -3)), to: ymd(t) } } },
  { label: 'Current Year', range: () => { const t = new Date(); return { from: ymd(startOfYear(t)), to: ymd(t) } } },
]
