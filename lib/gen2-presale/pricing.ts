import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import type { Gen2PresaleEnvConfig } from '@/lib/gen2-presale/config'
import { getGen2PresalePublicOffer } from '@/lib/gen2-presale/config'
import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'

export type Gen2PriceBreakdown = {
  unitPriceUsdc: number
  solUsdPrice: number
  unitLamports: bigint
  totalLamports: bigint
  founderALamports: bigint
  founderBLamports: bigint
}

/** Integer lamports per spot from USDC-notional / SOL-USD (server-only). */
export function lamportsPerSpot(cfg: Gen2PresaleEnvConfig): bigint {
  const unitSol = cfg.priceUsdc / cfg.solUsdPrice
  return BigInt(Math.round(unitSol * LAMPORTS_PER_SOL))
}

/** Full breakdown for `quantity` spots; founder split uses floor + remainder to founder B to match total. */
export function computePurchaseLamports(cfg: Gen2PresaleEnvConfig, quantity: number): Gen2PriceBreakdown {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error('quantity must be a positive integer')
  }
  const unit = lamportsPerSpot(cfg)
  const totalLamports = unit * BigInt(quantity)

  const pctA = cfg.founderAPercent
  const pctB = cfg.founderBPercent
  const founderALamports = (totalLamports * BigInt(pctA)) / BigInt(100)
  const founderBLamports = totalLamports - founderALamports

  if (founderALamports + founderBLamports !== totalLamports) {
    throw new Error('internal: lamport split mismatch')
  }

  return {
    unitPriceUsdc: cfg.priceUsdc,
    solUsdPrice: cfg.solUsdPrice,
    unitLamports: unit,
    totalLamports,
    founderALamports,
    founderBLamports,
  }
}

/** Stats/display quote using live SOL/USD (Jupiter). Returns null if resolution fails. */
export async function getOptionalUnitLamportsQuote(): Promise<{
  unitLamports: bigint
  solUsdPrice: number
} | null> {
  try {
    const solUsd = await resolveGen2SolUsdPrice()
    const { priceUsdc } = getGen2PresalePublicOffer()
    const unitSol = priceUsdc / solUsd
    const unitLamports = BigInt(Math.round(unitSol * LAMPORTS_PER_SOL))
    return { unitLamports, solUsdPrice: solUsd }
  } catch {
    return null
  }
}
