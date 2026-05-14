import type { Raffle, RaffleCurrency } from '@/lib/types'

/** One raffle row may offer SOL and BAMBOO as ticket payment (separate per-ticket prices). */
export function raffleAcceptsSolAndBambooTickets(raffle: Raffle): boolean {
  const alt = (raffle.alternate_ticket_currency ?? '').trim().toUpperCase() as RaffleCurrency | ''
  if (!alt) return false
  const cur = raffle.currency
  const altPrice = Number(raffle.alternate_ticket_price)
  if (!Number.isFinite(altPrice) || altPrice <= 0) return false
  return (
    (cur === 'SOL' && alt === 'BAMBOO') ||
    (cur === 'BAMBOO' && alt === 'SOL')
  )
}

export function acceptedTicketPaymentCurrencies(raffle: Raffle): RaffleCurrency[] {
  const primary = raffle.currency
  const list: RaffleCurrency[] = [primary]
  if (raffleAcceptsSolAndBambooTickets(raffle) && raffle.alternate_ticket_currency) {
    list.push(normalizeAltCurrency(raffle.alternate_ticket_currency))
  }
  return list
}

function normalizeAltCurrency(s: string): RaffleCurrency {
  const u = s.trim().toUpperCase()
  if (u === 'SOL' || u === 'USDC' || u === 'OWL' || u === 'BAMBOO') return u
  return 'SOL'
}

export function ticketUnitPriceForCurrency(raffle: Raffle, currency: RaffleCurrency): number | null {
  if (currency === raffle.currency) {
    const n = Number(raffle.ticket_price)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  if (
    raffle.alternate_ticket_currency &&
    normalizeAltCurrency(raffle.alternate_ticket_currency) === currency
  ) {
    const n = Number(raffle.alternate_ticket_price)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

/**
 * Resolves which asset the buyer pays in. Omitted or empty → primary {@link Raffle.currency}.
 * Returns null if `requested` is not allowed for this raffle.
 */
export function resolveTicketPaymentCurrency(
  raffle: Raffle,
  requested: string | null | undefined
): RaffleCurrency | null {
  const raw = typeof requested === 'string' ? requested.trim().toUpperCase() : ''
  const primary = raffle.currency
  if (!raw || raw === primary) {
    return ticketUnitPriceForCurrency(raffle, primary) != null ? primary : null
  }
  const alt = raffle.alternate_ticket_currency?.trim().toUpperCase() as RaffleCurrency | undefined
  if (alt && raw === alt && ticketUnitPriceForCurrency(raffle, alt) != null) {
    return alt
  }
  return null
}

/** Human-readable ticket line for embeds and cards (includes SOL + BAMBOO when configured). */
export function formatRaffleTicketPriceSummary(raffle: Raffle): string {
  if (
    !raffleAcceptsSolAndBambooTickets(raffle) ||
    !raffle.alternate_ticket_currency ||
    raffle.alternate_ticket_price == null
  ) {
    return `${raffle.ticket_price} ${raffle.currency}`
  }
  const alt = raffle.alternate_ticket_currency
  const altP = Number(raffle.alternate_ticket_price)
  return `${raffle.ticket_price} ${raffle.currency} or ${altP} ${alt}`
}
