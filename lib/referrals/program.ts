import { BAMBOO_TICKET_CURRENCY } from '@/lib/raffles/bamboo-ticket-currency'

const EXCLUDED_TICKET_CURRENCIES = new Set(['OWL', BAMBOO_TICKET_CURRENCY])

/** Referral links, attribution, and rewards apply only to standard ticket raffles. */
export function raffleTicketCurrencySupportsReferralProgram(
  currency: string | null | undefined
): boolean {
  const c = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  if (!c) return false
  return !EXCLUDED_TICKET_CURRENCIES.has(c)
}

export function raffleSupportsReferralProgram(raffle: {
  currency?: string | null
}): boolean {
  return raffleTicketCurrencySupportsReferralProgram(raffle.currency)
}

/** Free-entry redemption target raffles (same exclusion as referral program). */
export function raffleEligibleForReferralFreeEntry(raffle: {
  currency?: string | null
  is_active?: boolean | null
  end_time?: string
  purchases_blocked_at?: string | null
}): boolean {
  if (!raffleSupportsReferralProgram(raffle)) return false
  if (raffle.is_active === false) return false
  if (raffle.purchases_blocked_at) return false
  const endMs = raffle.end_time ? new Date(raffle.end_time).getTime() : NaN
  if (!Number.isFinite(endMs) || endMs <= Date.now()) return false
  return true
}
