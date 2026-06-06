import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type LaunchPriceQuotes = {
  presale: string | null
  whitelist: string | null
  public: string | null
}

/** Live SOL lamports quotes for mint-time prices (WL / public). Presale redemption is free — buyers paid in advance. */
export async function getLaunchPriceLamportsQuotes(launch: OwlCenterLaunchPublic): Promise<LaunchPriceQuotes> {
  const wlUsdc = launch.wl_price_usdc ?? 30
  const publicUsdc = launch.public_price_usdc ?? 40

  const [whitelist, pub] = await Promise.all([
    getOptionalLamportsQuoteForUsdc(wlUsdc),
    getOptionalLamportsQuoteForUsdc(publicUsdc),
  ])

  return {
    presale: null,
    whitelist: whitelist ? whitelist.unitLamports.toString() : null,
    public: pub ? pub.unitLamports.toString() : null,
  }
}
