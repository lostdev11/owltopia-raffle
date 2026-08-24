import 'server-only'

import { getCoinArtUpgradeStats } from '@/lib/db/coin-art-upgrades'
import {
  COIN_ART_UPGRADE_COLLECTION_CAPACITY,
  type CoinArtUpgradePublicProgress,
} from '@/lib/coin-upgrade/public-progress-types'

export { COIN_ART_UPGRADE_COLLECTION_CAPACITY }
export type { CoinArtUpgradePublicProgress }

/** Community-wide coin art upgrade tally (all wallets). */
export async function getCoinArtUpgradePublicProgress(): Promise<CoinArtUpgradePublicProgress> {
  const stats = await getCoinArtUpgradeStats()
  const capacity = COIN_ART_UPGRADE_COLLECTION_CAPACITY
  const upgraded = stats.updated
  const upgrading = stats.pending
  const visible = stats.catalog_size > 0
  return {
    capacity,
    upgraded,
    upgrading,
    remaining: Math.max(0, capacity - upgraded),
    percent_upgraded: visible ? Math.min(100, (upgraded / capacity) * 100) : 0,
    visible,
  }
}
