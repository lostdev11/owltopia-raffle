import type { Gen2PresaleStats } from '@/lib/gen2-presale/types'

export const GEN2_OWL_CENTER_PATH = '/owl-center'

/** Shown when presale supply is exhausted (and sold count is trusted). */
export const GEN2_PRESALE_SOLD_OUT_HEADLINE = 'Gen2 presale sold out'

export const GEN2_PRESALE_SOLD_OUT_BODY =
  'All presale spots have been claimed. New purchases are closed — redeem your presale credits when Owl Center mint goes live.'

type StatsSlice = Pick<Gen2PresaleStats, 'remaining' | 'sold_sync_unavailable'>

/**
 * True when supply is exhausted. False while sold count is degraded (unknown remaining).
 * Server checkout still enforces supply atomically on create/confirm.
 */
export function isGen2PresaleSoldOut(stats: StatsSlice | null | undefined): boolean {
  if (!stats || stats.sold_sync_unavailable) return false
  return stats.remaining <= 0
}

type PurchaseSlice = Pick<Gen2PresaleStats, 'presale_live' | 'remaining' | 'sold_sync_unavailable'>

/** Whether the public buy flow should allow new presale spot purchases. */
export function canPurchaseGen2PresaleSpots(stats: PurchaseSlice | null | undefined): boolean {
  if (!stats?.presale_live) return false
  return !isGen2PresaleSoldOut(stats)
}

export function deriveGen2PresaleAvailabilityFlags(stats: {
  presale_live: boolean
  remaining: number
  sold_sync_unavailable?: boolean
}): { presale_sold_out: boolean; purchases_open: boolean } {
  const presale_sold_out = isGen2PresaleSoldOut(stats)
  const purchases_open = stats.presale_live && !presale_sold_out
  return { presale_sold_out, purchases_open }
}
