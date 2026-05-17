/** Display SOL floor without noisy trailing zeros (e.g. 0.0001). */
export function formatLeaderboardMinSol(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0.0001'
  if (n >= 0.01) return String(n)
  const s = n.toFixed(6)
  return s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

export type LeaderboardTableCopyMeta = {
  kind: 'all' | 'month' | 'year'
  label: string
  leaderboardRules?: 'legacy' | 'threshold'
  minTicketPriceSol?: number
}

export function leaderboardTableDescriptions(meta: LeaderboardTableCopyMeta | null): {
  rafflesEntered: string
  ticketsPurchased: string
  rafflesCreated: string
  rafflesWon: string
  ticketsSold: string
} {
  const scope = meta == null || meta.kind === 'all' ? 'all time (UTC)' : meta.label
  const minSol = formatLeaderboardMinSol(meta?.minTicketPriceSol ?? 0.0001)

  const antiAbuseLegacy = `Raffles priced at or below the floor do not count (must be above ${minSol} SOL; USDC/OWL use the same ratio as referral dust rules). Entries exclude complimentary, refunded, or zero-amount rows. Tickets purchased: capped per wallet per raffle. Tickets sold: needs enough distinct paying buyers besides the creator.`

  const thresholdExtra =
    meta?.leaderboardRules === 'threshold'
      ? ' Only raffles that reached their ticket draw goal are included; cancelled and draft raffles do not count.'
      : ''

  const antiAbuse = antiAbuseLegacy + thresholdExtra

  const entered =
    meta == null || meta.kind === 'all'
      ? `Users with the most distinct raffles participated in (paid, confirmed entries). ${antiAbuse} Display names are set in My Dashboard.`
      : `Users with the most distinct raffles participated in during this period (${scope}). ${antiAbuse} Display names are set in My Dashboard.`

  const purchased =
    meta == null || meta.kind === 'all'
      ? `Players who have bought the most tickets across all raffles (paid, confirmed entries). ${antiAbuse}`
      : `Players who bought the most tickets in this period (${scope}), ranked by confirmation time. ${antiAbuse}`

  const created =
    meta == null || meta.kind === 'all'
      ? 'Creators who have launched the most raffles.'
      : `Creators who launched the most raffles in this period (${scope}).`

  const won =
    meta == null || meta.kind === 'all'
      ? 'Players who have won the most completed raffles on Owl Raffle.'
      : `Players with the most wins recorded in this period (${scope}), by winner selection time.`

  const sold =
    meta == null || meta.kind === 'all'
      ? `Creators whose raffles have sold the most paid tickets from non-creator buyers, only when enough distinct buyers participated. ${antiAbuse}`
      : `Creators whose raffles sold the most eligible tickets in this period (${scope}). ${antiAbuse}`

  return {
    rafflesEntered: entered,
    ticketsPurchased: purchased,
    rafflesCreated: created,
    rafflesWon: won,
    ticketsSold: sold,
  }
}
