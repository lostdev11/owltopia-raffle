import type { Raffle } from '@/lib/types'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'

/**
 * Enriches raffles with creator_is_holder (Owltopia Owl NFT holder) for display on cards.
 * Batches lookups by unique creator wallet to avoid redundant getCreatorFeeTier calls.
 */
export async function enrichRafflesWithCreatorHolder(
  raffles: Raffle[]
): Promise<(Raffle & { creator_is_holder: boolean })[]> {
  if (!raffles.length) return []

  const wallets = new Set<string>()
  for (const r of raffles) {
    const w = (r.creator_wallet || r.created_by || '').trim()
    if (w) wallets.add(w)
  }

  const holderByWallet = new Map<string, boolean>()
  await Promise.all(
    Array.from(wallets).map(async (wallet) => {
      try {
        const tier = await getCreatorFeeTier(wallet)
        holderByWallet.set(wallet, tier.reason === 'holder')
      } catch {
        holderByWallet.set(wallet, false)
      }
    })
  )

  return raffles.map((r) => {
    const w = (r.creator_wallet || r.created_by || '').trim()
    return {
      ...r,
      creator_is_holder: holderByWallet.get(w) ?? false,
    }
  })
}
