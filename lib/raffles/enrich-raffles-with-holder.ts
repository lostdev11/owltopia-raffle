import type { Raffle } from '@/lib/types'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { devSaveApiCredits } from '@/lib/dev-budget'

/** Limit parallel Helius DAS calls so listing many unique creators does not trigger 429s. */
const HOLDER_LOOKUP_CONCURRENCY = devSaveApiCredits() ? 2 : 3

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  const c = Math.max(1, Math.min(concurrency, items.length))
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: c }, () => worker()))
}

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
  await forEachWithConcurrency(Array.from(wallets), HOLDER_LOOKUP_CONCURRENCY, async (wallet) => {
    try {
      const tier = await getCreatorFeeTier(wallet)
      holderByWallet.set(wallet, tier.reason === 'holder')
    } catch {
      holderByWallet.set(wallet, false)
    }
  })

  return raffles.map((r) => {
    const w = (r.creator_wallet || r.created_by || '').trim()
    return {
      ...r,
      creator_is_holder: holderByWallet.get(w) ?? false,
    }
  })
}
