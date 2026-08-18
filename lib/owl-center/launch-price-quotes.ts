import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { formatCreatorMintPriceLabel } from '@/lib/owl-center/platform-mint-fee'
import { launchHasPresaleProgram } from '@/lib/owl-center/launch-presale'
import { formatPhasePriceSol } from '@/lib/owl-center/format-phase-price-sol'
import { resolvePartnerAllowlistPhases } from '@/lib/owl-center/partner-allowlist-phases'
import { publicSimpleSolMintLamports, publicSimpleSolMintPrice } from '@/lib/owl-center/partner-mint-phase-schedule'
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
  /** Per allowlist phase when multi-phase is configured. */
  allowlist_phases: Array<{ label: string; price: string }>
}

/** Live SOL lamports quotes for mint-time prices (WL / public). Presale redemption is free when presale is on. */
export async function getLaunchPriceLamportsQuotes(launch: OwlCenterLaunchPublic): Promise<LaunchPriceQuotes> {
  const allowlists = resolvePartnerAllowlistPhases(launch)
  const wlUsdc =
    allowlists.find((p) => p.price_usdc != null && p.price_usdc > 0)?.price_usdc ?? launch.wl_price_usdc
  const publicUsdc = launch.public_price_usdc
  const solPublicLamports = publicSimpleSolMintLamports(launch)

  const [whitelist, pub] = await Promise.all([
    wlUsdc != null && (launch.creator_wl_enabled || launch.wl_supply > 0 || allowlists.length > 0)
      ? getOptionalLamportsQuoteForUsdc(wlUsdc)
      : Promise.resolve(null),
    publicUsdc != null ? getOptionalLamportsQuoteForUsdc(publicUsdc) : Promise.resolve(null),
  ])

  return {
    presale: null,
    whitelist: whitelist ? whitelist.unitLamports.toString() : null,
    public: pub ? pub.unitLamports.toString() : solPublicLamports,
  }
}

async function formatUsdcPhasePrice(price_usdc: number | null): Promise<string | null> {
  if (price_usdc == null) return null
  if (price_usdc <= 0) return 'Free'
  const q = await getOptionalLamportsQuoteForUsdc(price_usdc)
  if (q?.unitLamports != null) {
    return `${formatPhasePriceSol(q.unitLamports.toString())} ($${price_usdc} USDC)`
  }
  return `$${price_usdc} USDC`
}

/** Card-friendly price strings for Mint details section. */
export async function getLaunchMintPriceDisplay(launch: OwlCenterLaunchPublic): Promise<LaunchMintPriceDisplay> {
  const presale = launchHasPresaleProgram(launch) ? 'Free' : null
  const allowlists = resolvePartnerAllowlistPhases(launch)

  const allowlist_phases: Array<{ label: string; price: string }> = []
  for (const phase of allowlists) {
    const label = await formatUsdcPhasePrice(phase.price_usdc)
    allowlist_phases.push({
      label: phase.label,
      price: label ?? 'TBA',
    })
  }

  let whitelist: string | null = null
  if (allowlist_phases.length === 0 && (launch.creator_wl_enabled || launch.wl_supply > 0)) {
    if (launch.wl_price_usdc != null && launch.wl_price_usdc > 0) {
      whitelist = (await formatUsdcPhasePrice(launch.wl_price_usdc)) ?? `${launch.wl_price_usdc} USDC`
    } else if (launch.creator_wl_enabled || launch.wl_supply > 0) {
      whitelist = launch.wl_price_usdc === 0 ? 'Free' : 'TBA'
    }
  } else if (allowlist_phases.length === 1) {
    whitelist = allowlist_phases[0]!.price
  }

  let publicLabel: string | null = null
  const solPublic = publicSimpleSolMintPrice(launch)
  const showPublic =
    launch.public_supply > 0 ||
    allowlists.length > 0 ||
    launch.wl_supply > 0 ||
    solPublic != null ||
    launch.public_price_usdc != null
  if (showPublic) {
    if (solPublic != null) {
      publicLabel = formatCreatorMintPriceLabel(solPublic, 'SOL')
    } else if (launch.public_price_usdc != null) {
      if (launch.public_price_usdc <= 0) {
        publicLabel = 'Free'
      } else {
        publicLabel =
          (await formatUsdcPhasePrice(launch.public_price_usdc)) ?? `${launch.public_price_usdc} USDC`
      }
    } else if (launch.creator_mint_price != null) {
      publicLabel = formatCreatorMintPriceLabel(
        launch.creator_mint_price,
        launch.creator_mint_currency === 'USDC' ? 'USDC' : 'SOL'
      )
    } else {
      publicLabel = 'TBA'
    }
  }

  return {
    presale,
    whitelist,
    public: publicLabel,
    allowlist_phases: allowlist_phases.length > 1 ? allowlist_phases : [],
  }
}
