import { getGen2PresalePublicOffer } from '@/lib/gen2-presale/config'
import { sumConfirmedPresaleSold } from '@/lib/gen2-presale/db'
import { getGen2PresaleSettings } from '@/lib/db/gen2-presale-settings'
import { getOptionalUnitLamportsQuote } from '@/lib/gen2-presale/pricing'
import type { Gen2PresaleStats } from '@/lib/gen2-presale/types'

/** Shared builder for public Gen2 presale stats (API route + SSR pages). */
export async function buildGen2PresalePublicStats(): Promise<Gen2PresaleStats> {
  const offer = getGen2PresalePublicOffer()

  const [sold, settings] = await Promise.all([sumConfirmedPresaleSold(), getGen2PresaleSettings()])
  const presale_supply = offer.presaleSupply
  const remaining = Math.max(0, presale_supply - sold)
  const percent_sold = presale_supply > 0 ? (sold / presale_supply) * 100 : 0

  const quote = await getOptionalUnitLamportsQuote()

  return {
    presale_supply,
    sold,
    remaining,
    percent_sold,
    unit_price_usdc: offer.priceUsdc,
    unit_lamports: quote ? quote.unitLamports.toString() : null,
    sol_usd_price: quote ? quote.solUsdPrice : null,
    presale_live: settings.is_live,
  }
}
