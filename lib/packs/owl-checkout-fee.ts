/**
 * $OWL pack checkout fee: $1 USD notional → SOL lamports (Jupiter SOL/USD).
 */
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { PACK_OWL_USD_FEE, PACK_PRICE_OWL } from '@/lib/packs/config'

export type PackOwlFeeQuote = {
  usdFee: number
  priceOwl: number
  feeLamports: bigint
  feeSol: number
  solUsdPrice: number
}

export async function packOwlUsdFeeLamports(
  usdFee: number = PACK_OWL_USD_FEE
): Promise<{ lamports: bigint; solUsdPrice: number } | null> {
  if (!(usdFee > 0)) return { lamports: 0n, solUsdPrice: 0 }
  const quote = await getOptionalLamportsQuoteForUsdc(usdFee)
  if (!quote) return null
  return { lamports: quote.unitLamports, solUsdPrice: quote.solUsdPrice }
}

export async function quotePackOwlCheckoutFee(): Promise<PackOwlFeeQuote | null> {
  const quoted = await packOwlUsdFeeLamports(PACK_OWL_USD_FEE)
  if (!quoted) return null
  const feeSol = Number(quoted.lamports) / LAMPORTS_PER_SOL
  return {
    usdFee: PACK_OWL_USD_FEE,
    priceOwl: PACK_PRICE_OWL,
    feeLamports: quoted.lamports,
    feeSol,
    solUsdPrice: quoted.solUsdPrice,
  }
}
