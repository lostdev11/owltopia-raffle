import type { OwlCenterPresaleStats } from '@/lib/owl-center-presale/types'

type StatsSlice = Pick<OwlCenterPresaleStats, 'remaining' | 'sold_sync_unavailable'>

export function isOwlCenterPresaleSoldOut(stats: StatsSlice | null | undefined): boolean {
  if (!stats || stats.sold_sync_unavailable) return false
  return stats.remaining <= 0
}

type PurchaseSlice = Pick<OwlCenterPresaleStats, 'presale_live' | 'presale_enabled' | 'remaining' | 'sold_sync_unavailable'>

export function canPurchaseOwlCenterPresaleSpots(stats: PurchaseSlice | null | undefined): boolean {
  if (!stats?.presale_enabled || !stats?.presale_live) return false
  return !isOwlCenterPresaleSoldOut(stats)
}

export function deriveOwlCenterPresaleAvailabilityFlags(stats: {
  presale_live: boolean
  presale_enabled: boolean
  remaining: number
  sold_sync_unavailable?: boolean
}): { presale_sold_out: boolean; purchases_open: boolean } {
  const presale_sold_out = isOwlCenterPresaleSoldOut(stats)
  const purchases_open = stats.presale_enabled && stats.presale_live && !presale_sold_out
  return { presale_sold_out, purchases_open }
}

export function buildOwlCenterPresaleStatsPayload(params: {
  tenant: {
    id: string
    slug: string
    display_name: string
    headline: string | null
    description: string | null
    unit_price_usdc: number
    presale_supply: number
    max_spots_per_purchase: number
    max_credits_per_wallet: number
    is_enabled: boolean
    is_live: boolean
    theme: OwlCenterPresaleStats['theme']
    preview_images: OwlCenterPresaleStats['preview_images']
  }
  sold: number
  unitLamports: string | null
  solUsdPrice: number | null
  soldSyncUnavailable?: boolean
}): OwlCenterPresaleStats {
  const { tenant, sold, unitLamports, solUsdPrice, soldSyncUnavailable } = params
  const presale_supply = tenant.presale_supply
  const remaining = Math.max(0, presale_supply - sold)
  const percent_sold = presale_supply > 0 ? (sold / presale_supply) * 100 : 0
  const availabilityBase = {
    presale_live: tenant.is_live,
    presale_enabled: tenant.is_enabled,
    remaining,
    sold_sync_unavailable: soldSyncUnavailable,
  }
  const { presale_sold_out, purchases_open } = deriveOwlCenterPresaleAvailabilityFlags(availabilityBase)

  return {
    tenant_id: tenant.id,
    slug: tenant.slug,
    display_name: tenant.display_name,
    headline: tenant.headline,
    description: tenant.description,
    theme: tenant.theme,
    preview_images: tenant.preview_images,
    presale_supply,
    sold,
    remaining,
    percent_sold,
    unit_price_usdc: tenant.unit_price_usdc,
    unit_lamports: unitLamports,
    sol_usd_price: solUsdPrice,
    presale_live: tenant.is_live,
    presale_enabled: tenant.is_enabled,
    presale_sold_out,
    purchases_open,
    max_spots_per_purchase: tenant.max_spots_per_purchase,
    max_credits_per_wallet: tenant.max_credits_per_wallet,
    sold_sync_unavailable: soldSyncUnavailable,
  }
}
