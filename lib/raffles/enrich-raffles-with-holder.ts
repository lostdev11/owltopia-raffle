import type { Raffle } from '@/lib/types'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { devSaveApiCredits } from '@/lib/dev-budget'

/** Limit parallel Helius DAS calls so listing many unique creators does not trigger 429s. */
const HOLDER_LOOKUP_CONCURRENCY = devSaveApiCredits() ? 2 : 3

export type EnrichRafflesWithCreatorHolderOptions = {
  /**
   * Stop scheduling new Helius lookups after this many ms from the start of enrichment.
   * Creators not yet resolved get `creator_is_holder: false` (badge may be missing until refresh).
   * List endpoints should set this so the route stays under serverless maxDuration (e.g. Vercel 10s).
   */
  budgetMs?: number
  /**
   * `list` (default): quick DAS search only per creator (safe for large lists).
   * `full`: full wallet scan when needed — use on single-raffle detail pages only.
   */
  holderLookupMode?: 'list' | 'full'
}

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  shouldContinue?: () => boolean
): Promise<void> {
  if (items.length === 0) return
  const c = Math.max(1, Math.min(concurrency, items.length))
  let i = 0
  const ok = shouldContinue ?? (() => true)
  const worker = async () => {
    while (i < items.length) {
      if (!ok()) break
      const idx = i++
      if (idx >= items.length) break
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
  raffles: Raffle[],
  options?: EnrichRafflesWithCreatorHolderOptions
): Promise<(Raffle & { creator_is_holder: boolean })[]> {
  if (!raffles.length) return []

  const wallets = new Set<string>()
  for (const r of raffles) {
    const w = (r.creator_wallet || r.created_by || '').trim()
    if (w) wallets.add(w)
  }

  const budgetMs = options?.budgetMs
  const deadline = budgetMs != null ? Date.now() + budgetMs : Number.POSITIVE_INFINITY
  const shouldContinue = budgetMs != null ? () => Date.now() < deadline : undefined
  const listDisplayOnly = options?.holderLookupMode !== 'full'

  const holderByWallet = new Map<string, boolean>()
  await forEachWithConcurrency(
    Array.from(wallets),
    HOLDER_LOOKUP_CONCURRENCY,
    async (wallet) => {
      try {
        const tier = await getCreatorFeeTier(
          wallet,
          listDisplayOnly ? { listDisplayOnly: true } : undefined
        )
        holderByWallet.set(wallet, tier.reason === 'holder')
      } catch {
        holderByWallet.set(wallet, false)
      }
    },
    shouldContinue
  )

  return raffles.map((r) => {
    const w = (r.creator_wallet || r.created_by || '').trim()
    return {
      ...r,
      creator_is_holder: holderByWallet.get(w) ?? false,
    }
  })
}
