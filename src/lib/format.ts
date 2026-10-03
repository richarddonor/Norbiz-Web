function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Default currency is Philippine peso — thousands-separated, 2 decimals, no currency sign. */
export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const num = typeof amount === 'string' ? Number(amount) : amount
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${formatDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Stock quantities: thousands-separated, up to 4 decimals (the backend's scale), no trailing zeros. */
export function formatQuantity(qty: number | string | null | undefined): string {
  if (qty === null || qty === undefined || qty === '') return '—'
  const num = typeof qty === 'string' ? Number(qty) : qty
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-PH', { maximumFractionDigits: 4 })
}
