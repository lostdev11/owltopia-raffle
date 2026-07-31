import type { Entry, OwlVisionScore, Raffle } from '@/lib/types'
import type { RaffleEntryListStats } from '@/lib/db/entry-summaries'
import { getRaffleProfitInfoFromRevenue, type RaffleProfitInfo } from '@/lib/raffle-profit'

/**
 * Compact list-poll stats. Prefer these over full Entry[] dumps on /raffles grids.
 */
export type { RaffleEntryListStats }

export function profitInfoFromEntryStats(
  raffle: Raffle,
  stats: RaffleEntryListStats
): RaffleProfitInfo {
  return getRaffleProfitInfoFromRevenue(raffle, stats.revenue)
}

export function owlVisionFromEntryStats(
  raffle: Raffle,
  stats: RaffleEntryListStats
): OwlVisionScore {
  const totalEntries = Math.max(0, Math.floor(stats.totalEntries))
  const confirmedEntries = Math.max(0, Math.floor(stats.confirmedEntries))
  const uniqueWallets = Math.max(0, Math.floor(stats.uniqueWallets))

  const verifiedRatio = totalEntries > 0 ? confirmedEntries / totalEntries : 0
  const verifiedScore = Math.max(0, Math.min(60, verifiedRatio * 60))
  const diversityRatio = confirmedEntries > 0 ? uniqueWallets / confirmedEntries : 0
  const diversityScore = Math.max(0, Math.min(30, diversityRatio * 30))
  const integrityScore = raffle.edited_after_entries ? 5 : 10
  const totalScore = Math.round(verifiedScore + diversityScore + integrityScore)

  return {
    score: Math.max(0, Math.min(100, totalScore)),
    verifiedRatio,
    diversityRatio,
    integrityScore,
    totalEntries,
    confirmedEntries,
    uniqueWallets,
    editedAfterEntries: raffle.edited_after_entries,
  }
}

/**
 * Minimal Entry stubs so existing card helpers (tickets sold, user entered) keep working
 * when we only have SQL aggregates. Not suitable for draw/admin logic.
 */
export function stubEntriesFromListStats(
  raffleId: string,
  stats: RaffleEntryListStats,
  viewerWallet?: string | null
): Entry[] {
  const now = new Date().toISOString()
  const stubs: Entry[] = []
  const tickets = Math.max(0, Math.floor(stats.ticketsSold))
  const wallet = viewerWallet?.trim() || null
  const viewerTickets = Math.max(0, Math.floor(stats.viewerConfirmedTickets))

  if (tickets > 0) {
    const otherTickets = Math.max(0, tickets - viewerTickets)
    if (otherTickets > 0) {
      stubs.push({
        id: `stub-tickets-${raffleId}`,
        raffle_id: raffleId,
        wallet_address: '__list_aggregate__',
        ticket_quantity: otherTickets,
        transaction_signature: null,
        status: 'confirmed',
        amount_paid: 0,
        currency: 'SOL',
        created_at: now,
        verified_at: now,
        restored_at: null,
        restored_by: null,
        refunded_at: null,
      })
    }
    if (wallet && viewerTickets > 0) {
      stubs.push({
        id: `stub-viewer-${raffleId}`,
        raffle_id: raffleId,
        wallet_address: wallet,
        ticket_quantity: viewerTickets,
        transaction_signature: null,
        status: 'confirmed',
        amount_paid: 0,
        currency: 'SOL',
        created_at: now,
        verified_at: now,
        restored_at: null,
        restored_by: null,
        refunded_at: null,
      })
    }
  }

  // Revenue stubs (ticket_quantity 0) so getRaffleRevenue still works if callers use entries.
  const rev = stats.revenue
  for (const [currency, amount] of [
    ['SOL', rev.sol],
    ['USDC', rev.usdc],
    ['OWL', rev.owl],
    ['BAMBOO', rev.bamboo],
  ] as const) {
    if (amount > 0) {
      stubs.push({
        id: `stub-rev-${currency}-${raffleId}`,
        raffle_id: raffleId,
        wallet_address: `__rev_${currency}__`,
        ticket_quantity: 0,
        transaction_signature: null,
        status: 'confirmed',
        amount_paid: amount,
        currency,
        created_at: now,
        verified_at: now,
        restored_at: null,
        restored_by: null,
        refunded_at: null,
      })
    }
  }

  return stubs
}
