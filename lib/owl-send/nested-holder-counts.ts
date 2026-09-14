/**
 * Owl Send / Owl Swap holder fee discounts count actively nested Gen1/Gen2 NFTs only.
 * Holding in-wallet without nesting does not qualify.
 */

import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import {
  GEN1_OWL_STAKING_POOL_SLUGS,
  GEN2_OWL_STAKING_POOL_SLUGS,
  isGen1OwlStakingPoolSlug,
  isGen2OwlStakingPoolSlug,
} from '@/lib/nesting/gen1-staking-pools'
import {
  OWL_SEND_GEN1_COUNT_CAP,
  OWL_SEND_GEN2_COUNT_CAP,
} from '@/lib/owl-send/holder-discount'
import type { OwlSendHolderCounts } from '@/lib/owl-send/holder-counts'

/**
 * Count distinct Gen1 / Gen2 NFT mints with an active nest for this wallet.
 * Caps match the holder-discount ladder tops.
 */
export async function getOwlSendNestedHolderCounts(wallet: string): Promise<OwlSendHolderCounts> {
  const w = wallet.trim()
  if (!w) {
    return { gen1Count: 0, gen2Count: 0, checkAvailable: true }
  }

  try {
    const positions = await listStakingPositionsByWallet(w)
    const active = positions.filter(
      (p) => p.status === 'active' && Boolean(p.asset_identifier?.trim())
    )
    if (active.length === 0) {
      return { gen1Count: 0, gen2Count: 0, checkAvailable: true }
    }

    const poolIds = [...new Set(active.map((p) => p.pool_id))]
    const pools = await Promise.all(poolIds.map((id) => getStakingPoolById(id)))
    const slugByPoolId = new Map<string, string>()
    for (const pool of pools) {
      if (pool?.slug) slugByPoolId.set(pool.id, pool.slug.trim().toLowerCase())
    }

    const gen1Mints = new Set<string>()
    const gen2Mints = new Set<string>()
    for (const pos of active) {
      const mint = pos.asset_identifier?.trim()
      if (!mint) continue
      const slug = slugByPoolId.get(pos.pool_id)
      if (!slug) continue
      if (isGen1OwlStakingPoolSlug(slug) || GEN1_OWL_STAKING_POOL_SLUGS.includes(slug as never)) {
        if (gen1Mints.size < OWL_SEND_GEN1_COUNT_CAP) gen1Mints.add(mint)
      } else if (
        isGen2OwlStakingPoolSlug(slug) ||
        GEN2_OWL_STAKING_POOL_SLUGS.includes(slug as never)
      ) {
        if (gen2Mints.size < OWL_SEND_GEN2_COUNT_CAP) gen2Mints.add(mint)
      }
    }

    return {
      gen1Count: gen1Mints.size,
      gen2Count: gen2Mints.size,
      checkAvailable: true,
    }
  } catch (e) {
    console.error('[owl-send] nested holder counts:', e instanceof Error ? e.message : e)
    return { gen1Count: 0, gen2Count: 0, checkAvailable: false }
  }
}
