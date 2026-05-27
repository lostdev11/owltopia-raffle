import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type LaunchPriceQuotes = {
  presale: string | null
  whitelist: string | null
  public: string | null
}

/** Live SOL lamports quotes for presale / WL / public list prices (USDC-notional on server). */
export async function getLaunchPriceLamportsQuotes(launch: OwlCenterLaunchPublic): Promise<LaunchPriceQuotes> {
  const presaleUsdc = launch.presale_price_usdc ?? 20
  const wlUsdc = launch.wl_price_usdc ?? 30
  const publicUsdc = launch.public_price_usdc ?? 40

  const [presale, whitelist, pub] = await Promise.all([
    getOptionalLamportsQuoteForUsdc(presaleUsdc),
    getOptionalLamportsQuoteForUsdc(wlUsdc),
    getOptionalLamportsQuoteForUsdc(publicUsdc),
  ])

  return {
    presale: presale ? presale.unitLamports.toString() : null,
    whitelist: whitelist ? whitelist.unitLamports.toString() : null,
    public: pub ? pub.unitLamports.toString() : null,
  }
}
