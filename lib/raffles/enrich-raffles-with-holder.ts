import type { Raffle } from '@/lib/types'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { getActivePartnerCommunityCreatorRows } from '@/lib/raffles/partner-communities'
import { devSaveApiCredits } from '@/lib/dev-budget'
import { getWalletsWithAdminRole } from '@/lib/db/admins'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'

/** Limit parallel Helius DAS calls so listing many unique creators does not trigger 429s. */
const HOLDER_LOOKUP_CONCURRENCY = devSaveApiCredits() ? 2 : 3

export type EnrichRafflesWithCreatorHolderOptions = {
  /**
   * Stop scheduling new Helius lookups after this many ms from the start of enrichment.
   * Creators not yet resolved get `creator_is_holder: false` (badge may be missing until refresh).
   * List endpoints should set this so the route stays under serverless maxDuration (e.g. Vercel Pro 60s).
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
): Promise<
  (Raffle & {
    creator_is_holder: boolean
    creator_is_partner: boolean
    creator_partner_display_name: string | null
    description_urls_clickable: boolean
  })[]
> {
  if (!raffles.length) return []

  const wallets = new Set<string>()
  for (const r of raffles) {
    const w = (r.creator_wallet || r.created_by || '').trim()
    if (w) wallets.add(w)
  }

  const partnerRows = await getActivePartnerCommunityCreatorRows()
  const partnerWallets = new Set(partnerRows.map((r) => r.creator_wallet))
  const partnerTableLabelByWallet = new Map(
    partnerRows.map((r) => [r.creator_wallet, r.display_label] as const)
  )
  const partnerProfileNames =
    partnerRows.length > 0
      ? await getDisplayNamesByWallets(partnerRows.map((r) => r.creator_wallet))
      : {}
  const adminWallets = await getWalletsWithAdminRole(Array.from(wallets))

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
        const isHolder = tier.reason === 'holder'
        holderByWallet.set(wallet, isHolder)
      } catch {
        holderByWallet.set(wallet, false)
      }
    },
    shouldContinue
  )

  return raffles.map((r) => {
    const w = (r.creator_wallet || r.created_by || '').trim()
    const isPartner = w ? partnerWallets.has(w) : false
    const profileName = w ? (partnerProfileNames[w]?.trim() ?? '') : ''
    const tableLabel = w ? partnerTableLabelByWallet.get(w) : null
    let creator_partner_display_name: string | null = null
    if (isPartner) {
      if (profileName) creator_partner_display_name = profileName
      else if (tableLabel?.trim()) creator_partner_display_name = tableLabel.trim()
    }
    return {
      ...r,
      creator_is_holder: holderByWallet.get(w) ?? false,
      creator_is_partner: isPartner,
      creator_partner_display_name,
      description_urls_clickable: w ? adminWallets.has(w) : false,
    }
  })
}
