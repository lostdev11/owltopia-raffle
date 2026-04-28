/** Client-safe display helpers for Owl Nesting UI. */

export function formatRewardRate(rate: number, unit: string): string {
  const r = Number(rate)
  if (!Number.isFinite(r)) return '—'
  const label =
    unit === 'hourly' ? '/ hr' : unit === 'weekly' ? '/ wk' : '/ day'
  return `${r}${label}`
}

export function shortenAddress(addr: string, chars = 4): string {
  const a = addr.trim()
  if (a.length <= chars * 2 + 1) return a
  return `${a.slice(0, chars)}…${a.slice(-chars)}`
}
