import type { OwlVisionScore, Raffle, Entry } from './types'

/**
 * Calculate Owl Vision trust score (0-100)
 * 
 * Formula:
 * - Verified Payments Ratio: 0-60 points (confirmed_entries / total_entries)
 * - Wallet Diversity Ratio: 0-30 points (unique_wallets / confirmed_entries)
 * - Time Integrity: 10 points if not edited after entries, 5 if edited
 */
export function calculateOwlVisionScore(
  raffle: Raffle,
  entries: Entry[]
): OwlVisionScore {
  const totalEntries = entries.length
  const confirmedEntries = entries.filter(e => e.status === 'confirmed').length
  const uniqueWallets = new Set(
    entries.filter(e => e.status === 'confirmed').map(e => e.wallet_address)
  ).size

  // Verified Payments Ratio (0-60 points)
  const verifiedRatio = totalEntries > 0 ? confirmedEntries / totalEntries : 0
  const verifiedScore = Math.max(0, Math.min(60, verifiedRatio * 60))

  // Wallet Diversity Ratio (0-30 points)
  const diversityRatio = confirmedEntries > 0 ? uniqueWallets / confirmedEntries : 0
  const diversityScore = Math.max(0, Math.min(30, diversityRatio * 30))

  // Time Integrity (5 or 10 points)
  const integrityScore = raffle.edited_after_entries ? 5 : 10

  // Total score (rounded)
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
