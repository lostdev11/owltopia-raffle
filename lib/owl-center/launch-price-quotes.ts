import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { formatCreatorMintPriceLabel } from '@/lib/owl-center/platform-mint-fee'
import { launchHasPresaleProgram } from '@/lib/owl-center/launch-presale'
import { formatPhasePriceSol } from '@/lib/owl-center/format-phase-price-sol'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export type LaunchPriceQuotes = {
  presale: string | null
  whitelist: string | null
  public: string | null
}

export type LaunchMintPriceDisplay = {
  presale: string | null
  whitelist: string | null
  public: string | null
}

/** Live SOL lamports quotes for mint-time prices (WL / public). Presale redemption is free when presale is on. */
export async function getLaunchPriceLamportsQuotes(launch: OwlCenterLaunchPublic): Promise<LaunchPriceQuotes> {
  const wlUsdc = launch.wl_price_usdc
  const publicUsdc = launch.public_price_usdc

  const [whitelist, pub] = await Promise.all([
    wlUsdc != null && (launch.creator_wl_enabled || launch.wl_supply > 0)
      ? getOptionalLamportsQuoteForUsdc(wlUsdc)
      : Promise.resolve(null),
    publicUsdc != null ? getOptionalLamportsQuoteForUsdc(publicUsdc) : Promise.resolve(null),
  ])

  return {
    presale: null,
    whitelist: whitelist ? whitelist.unitLamports.toString() : null,
    public: pub ? pub.unitLamports.toString() : null,
  }
}

/** Card-friendly price strings for Mint details section. */
export async function getLaunchMintPriceDisplay(launch: OwlCenterLaunchPublic): Promise<LaunchMintPriceDisplay> {
  const presale = launchHasPresaleProgram(launch) ? 'Free' : null

  let whitelist: string | null = null
  if (launch.creator_wl_enabled || launch.wl_supply > 0) {
    if (launch.wl_price_usdc != null && launch.wl_price_usdc > 0) {
      const q = await getOptionalLamportsQuoteForUsdc(launch.wl_price_usdc)
      whitelist = q ? formatPhasePriceSol(q.unitLamports.toString()) : `${launch.wl_price_usdc} USDC`
    } else if (launch.creator_wl_enabled || launch.wl_supply > 0) {
      whitelist = 'TBA'
    }
  }

  let publicLabel: string | null = null
  if (launch.public_supply > 0) {
    if (launch.public_price_usdc != null) {
      if (launch.public_price_usdc <= 0) {
        publicLabel = 'Free'
      } else {
        const q = await getOptionalLamportsQuoteForUsdc(launch.public_price_usdc)
        publicLabel =
          q?.unitLamports != null
            ? formatPhasePriceSol(q.unitLamports.toString())
            : `${launch.public_price_usdc} USDC`
      }
    } else if (launch.creator_mint_price != null) {
      publicLabel = formatCreatorMintPriceLabel(launch.creator_mint_price, launch.creator_mint_currency === 'USDC' ? 'USDC' : 'SOL')
    } else {
      publicLabel = 'TBA'
    }
  }

  return {
    presale,
    whitelist,
    public: publicLabel,
  }
}
