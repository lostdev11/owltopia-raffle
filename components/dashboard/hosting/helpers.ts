export function formatHostingCurrencyTotals(by: Record<string, number>): string {
  const keys = Object.keys(by)
  if (keys.length === 0) return '—'
  return keys
    .map((cur) => `${by[cur]!.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
    .join(' · ')
}

export function myRaffleStatusLabel(status: string | null): string {
  const s = status ?? 'draft'
  if (s === 'successful_pending_claims') return 'Settled — claim proceeds'
  return s.replace(/_/g, ' ')
}

export type HostingStatusTone = 'live' | 'claim' | 'success' | 'warning' | 'muted'

export function hostingStatusTone(status: string | null): HostingStatusTone {
  const s = (status ?? 'draft').toLowerCase()
  if (s === 'live' || s === 'ready_to_draw') return 'live'
  if (s === 'successful_pending_claims') return 'claim'
  if (s === 'completed') return 'success'
  if (
    s === 'failed_refund_available' ||
    s === 'cancelled' ||
    s === 'pending_min_not_met' ||
    s === 'pending_cancellation'
  ) {
    return 'warning'
  }
  return 'muted'
}

export const HOSTING_STATUS_BADGE_CLASS: Record<HostingStatusTone, string> = {
  live: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25',
  claim: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/25',
  success: 'bg-muted text-muted-foreground ring-border/60',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/25',
  muted: 'bg-muted/80 text-muted-foreground ring-border/50',
}
