import { OWLTOPIA_COLLECTION_ADDRESS } from '@/lib/config/raffles'
import { getAdminRole } from '@/lib/db/admins'
import { getStakingPoolBySlug, updateStakingPool } from '@/lib/db/staking-pools'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { StakingUserError } from '@/lib/nesting/errors'
import { getGen2CollectionMint } from '@/lib/solana/network'

/** Slugs seeded in migration 184 — original Gen 1 owl lock tiers. */
export const GEN1_OWL_STAKING_POOL_SLUGS = ['gen1-owl-90d', 'gen1-owl-180d'] as const

/** Slugs seeded in migration 185 — Gen 2 owl lock tiers. */
export const GEN2_OWL_STAKING_POOL_SLUGS = ['gen2-owl-90d', 'gen2-owl-180d'] as const

export type Gen1OwlStakingPoolSlug = (typeof GEN1_OWL_STAKING_POOL_SLUGS)[number]
export type Gen2OwlStakingPoolSlug = (typeof GEN2_OWL_STAKING_POOL_SLUGS)[number]

export function isGen1OwlStakingPoolSlug(slug: string | null | undefined): slug is Gen1OwlStakingPoolSlug {
  const s = slug?.trim().toLowerCase()
  return GEN1_OWL_STAKING_POOL_SLUGS.includes(s as Gen1OwlStakingPoolSlug)
}

export function isGen2OwlStakingPoolSlug(slug: string | null | undefined): slug is Gen2OwlStakingPoolSlug {
  const s = slug?.trim().toLowerCase()
  return GEN2_OWL_STAKING_POOL_SLUGS.includes(s as Gen2OwlStakingPoolSlug)
}

/** User-facing NFT label for nest picker / stake copy (Gen 1 / Gen 2 owls vs Owltopia Coins). */
export function nestingNftAssetLabels(pool: Pick<StakingPoolRow, 'slug'> | null | undefined): {
  singular: string
  plural: string
} {
  if (isGen1OwlStakingPoolSlug(pool?.slug)) {
    return { singular: 'Gen 1 owl', plural: 'Gen 1 owls' }
  }
  if (isGen2OwlStakingPoolSlug(pool?.slug)) {
    return { singular: 'Gen 2 owl', plural: 'Gen 2 owls' }
  }
  return { singular: 'Owltopia coin', plural: 'Owltopia coins' }
}

export function resolveGen1OwlCollectionAddress(): string | null {
  const addr = OWLTOPIA_COLLECTION_ADDRESS?.trim()
  if (!addr || addr === 'REPLACE_WITH_COLLECTION') return null
  return addr
}

export function resolveGen2OwlCollectionAddress(): string | null {
  const addr = getGen2CollectionMint()?.trim()
  if (!addr) return null
  return addr
}

async function bindStakingPoolCollection(
  slugs: readonly string[],
  resolveCollection: () => string | null
): Promise<void> {
  const collection = resolveCollection()
  if (!collection) return

  try {
    for (const slug of slugs) {
      const pool = await getStakingPoolBySlug(slug)
      if (!pool || pool.asset_type !== 'nft') continue

      const needsCollection = pool.collection_key?.trim() !== collection
      const needsOnchain =
        pool.adapter_mode !== 'onchain_enabled' ||
        pool.is_onchain_enabled !== true ||
        pool.lock_enforcement_source !== 'hybrid'

      if (!needsCollection && !needsOnchain) continue

      await updateStakingPool(pool.id, {
        ...(needsCollection ? { collection_key: collection } : {}),
        ...(needsOnchain
          ? {
              adapter_mode: 'onchain_enabled',
              is_onchain_enabled: true,
              requires_onchain_sync: false,
              lock_enforcement_source: 'hybrid',
            }
          : {}),
      })
    }
  } catch (e) {
    console.error('[nesting] bindStakingPoolCollection:', slugs.join(','), e)
  }
}

/** Bind Gen 1 pool rows to OWLTOPIA_COLLECTION_ADDRESS when configured in env. */
export async function ensureGen1StakingPoolsReady(): Promise<void> {
  await bindStakingPoolCollection(GEN1_OWL_STAKING_POOL_SLUGS, resolveGen1OwlCollectionAddress)
}

/** Bind Gen 2 pool rows to NEXT_PUBLIC_GEN2_COLLECTION_MINT when configured in env. */
export async function ensureGen2StakingPoolsReady(): Promise<void> {
  await bindStakingPoolCollection(GEN2_OWL_STAKING_POOL_SLUGS, resolveGen2OwlCollectionAddress)
}

export async function ensureTieredOwlStakingPoolsReady(): Promise<void> {
  await ensureGen1StakingPoolsReady()
  await ensureGen2StakingPoolsReady()
}

export function stakingPoolIsAdminOnly(pool: Pick<StakingPoolRow, 'admin_only'>): boolean {
  return pool.admin_only === true
}

/** Reject non-admins from admin-preview pools (stake / unstake / claim guards). */
export async function assertAdminOnlyStakingPoolAccess(
  pool: Pick<StakingPoolRow, 'admin_only' | 'name'>,
  wallet: string
): Promise<void> {
  if (!stakingPoolIsAdminOnly(pool)) return
  const role = await getAdminRole(wallet.trim())
  if (!role) {
    const label = pool.name?.trim() || 'This perch'
    throw new StakingUserError(`${label} is in admin preview and is not open to the public yet.`, 403)
  }
}
