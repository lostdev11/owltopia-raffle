/**
 * NFT perches covered by admin support playbook / wallet diagnostics / heal mint scans:
 * Owltopia coins + Gen 1 owl tiers + Gen 2 owl tiers.
 */
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { getStakingPoolBySlug } from '@/lib/db/staking-pools'
import { fetchWalletNftsInCollectionDas } from '@/lib/helius/fetch-wallet-nfts-in-collection'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import {
  GEN1_OWL_STAKING_POOL_SLUGS,
  GEN2_OWL_STAKING_POOL_SLUGS,
  isGen1OwlStakingPoolSlug,
  isGen2OwlStakingPoolSlug,
} from '@/lib/nesting/gen1-staking-pools'
import { resolveWalletOwlNestCollectionCandidates } from '@/lib/nesting/owl-nest-collection'
import { OWL_NEST_365_SLUG } from '@/lib/nesting/owl-nest-365-stats'

export const SUPPORT_NEST_POOL_SLUGS = [
  OWL_NEST_365_SLUG,
  ...GEN1_OWL_STAKING_POOL_SLUGS,
  ...GEN2_OWL_STAKING_POOL_SLUGS,
] as const

export type SupportNestFamilyKey = 'owl-nest-coins' | 'gen1-owl' | 'gen2-owl'

export function supportNestFamilyForPoolSlug(slug: string | null | undefined): SupportNestFamilyKey | null {
  const s = slug?.trim().toLowerCase()
  if (!s) return null
  if (s === OWL_NEST_365_SLUG) return 'owl-nest-coins'
  if (isGen1OwlStakingPoolSlug(s)) return 'gen1-owl'
  if (isGen2OwlStakingPoolSlug(s)) return 'gen2-owl'
  return null
}

export function supportNestFamilyLabel(family: SupportNestFamilyKey): string {
  if (family === 'owl-nest-coins') return 'Owltopia coins'
  if (family === 'gen1-owl') return 'Gen 1 owls'
  return 'Gen 2 owls'
}

/** Load coin + Gen 1 + Gen 2 nest pool rows (skips missing slugs). */
export async function loadSupportNestPools(): Promise<StakingPoolRow[]> {
  const pools: StakingPoolRow[] = []
  for (const slug of SUPPORT_NEST_POOL_SLUGS) {
    const pool = await getStakingPoolBySlug(slug)
    if (pool && pool.asset_type === 'nft') pools.push(pool)
  }
  return pools
}

/** Deduped collection addresses to DAS-scan for support mint ownership. */
export function listSupportNestCollectionCandidates(pools: StakingPoolRow[]): string[] {
  const out: string[] = []
  for (const pool of pools) {
    for (const addr of resolveWalletOwlNestCollectionCandidates(pool)) {
      if (!out.includes(addr)) out.push(addr)
    }
  }
  return out
}

/**
 * NFT mints in `wallet` across Owltopia coin + Gen 1 + Gen 2 nest collections
 * (Helius DAS; empty when indexer unavailable or pools missing).
 */
export async function listSupportNestMintAddressesInWallet(wallet: string): Promise<{
  mints: string[]
  /** Same mints with nest family for inventory / diagnostics. */
  mint_assets: Array<{ mint: string; family: SupportNestFamilyKey }>
  skipped_reason?: 'helius_unconfigured' | 'no_pools' | 'no_mints_in_wallet'
  mint_counts_by_family: Record<SupportNestFamilyKey, number>
}> {
  const emptyCounts: Record<SupportNestFamilyKey, number> = {
    'owl-nest-coins': 0,
    'gen1-owl': 0,
    'gen2-owl': 0,
  }
  const holder = wallet.trim()
  if (!holder) {
    return {
      mints: [],
      mint_assets: [],
      skipped_reason: 'no_mints_in_wallet',
      mint_counts_by_family: emptyCounts,
    }
  }

  const heliusRpcUrl = getHeliusMainnetRpcUrl()
  if (!heliusRpcUrl) {
    return {
      mints: [],
      mint_assets: [],
      skipped_reason: 'helius_unconfigured',
      mint_counts_by_family: emptyCounts,
    }
  }

  const pools = await loadSupportNestPools()
  if (pools.length === 0) {
    return {
      mints: [],
      mint_assets: [],
      skipped_reason: 'no_pools',
      mint_counts_by_family: emptyCounts,
    }
  }

  /** collection address → nest family (first pool that claims it wins). */
  const collectionToFamily = new Map<string, SupportNestFamilyKey>()
  for (const pool of pools) {
    const family = supportNestFamilyForPoolSlug(pool.slug)
    if (!family) continue
    for (const candidate of resolveWalletOwlNestCollectionCandidates(pool)) {
      if (!collectionToFamily.has(candidate)) {
        collectionToFamily.set(candidate, family)
      }
    }
  }

  const itemsByMint = new Map<string, SupportNestFamilyKey>()
  for (const [collection, family] of collectionToFamily) {
    const batch = await fetchWalletNftsInCollectionDas(heliusRpcUrl, holder, collection)
    for (const item of batch) {
      const id = item.id?.trim()
      if (!id || item.burnt === true) continue
      if (!itemsByMint.has(id)) itemsByMint.set(id, family)
    }
  }

  const mint_counts_by_family = { ...emptyCounts }
  for (const family of itemsByMint.values()) {
    mint_counts_by_family[family] += 1
  }

  const mint_assets = [...itemsByMint.entries()].map(([mint, family]) => ({ mint, family }))
  const mints = mint_assets.map((a) => a.mint)
  return {
    mints,
    mint_assets,
    skipped_reason: mints.length === 0 ? 'no_mints_in_wallet' : undefined,
    mint_counts_by_family,
  }
}
