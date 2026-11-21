export function formatNumber(value: number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  const maximumFractionDigits = digits ?? (abs >= 100 ? 0 : abs >= 10 ? 1 : 2)
  return value.toLocaleString(undefined, { maximumFractionDigits })
}

export function formatMoney(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  })
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatRelative(value: string | null): string {
  if (!value) return 'never'
  const diff = Date.now() - Date.parse(value)
  const future = diff < 0
  const minutes = Math.round(Math.abs(diff) / 60000)
  const text =
    minutes < 1
      ? 'moments'
      : minutes < 60
        ? `${minutes} min`
        : minutes < 60 * 24
          ? `${Math.round(minutes / 60)} h`
          : `${Math.round(minutes / 1440)} d`
  if (text === 'moments') return future ? 'in a moment' : 'just now'
  return future ? `in ${text}` : `${text} ago`
}
