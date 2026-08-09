import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_NFT_VALUE_BANDS,
  PACK_PRICE_SOL,
  PACK_RTP_BPS,
  PACK_SOL_TIERS,
  PACK_TARGET_EV_SOL,
  owlTiersWithPrice,
  type PackPrizeCategory,
} from '@/lib/packs/config'

export type EvSimulatorResult = {
  packPriceSol: number
  targetEvSol: number
  targetRtpBps: number
  estimatedEvSol: number
  estimatedRtpBps: number
  categoryEv: Record<PackPrizeCategory, number>
  owlSolPrice: number | null
  notes: string[]
}

function weightedAverage(weights: number[], values: number[]): number {
  const totalW = weights.reduce((a, b) => a + b, 0)
  if (totalW <= 0) return 0
  let sum = 0
  for (let i = 0; i < weights.length; i++) {
    sum += (weights[i]! / totalW) * values[i]!
  }
  return sum
}

/**
 * Estimate EV for the MVP pack given optional live OWL/SOL price and
 * optional average NFT fair value per band (defaults to band midpoint).
 */
export function simulatePackEv(options?: {
  owlSolPrice?: number | null
  nftBandAvgFairValues?: number[]
}): EvSimulatorResult {
  const owlSolPrice = options?.owlSolPrice ?? null
  const owlTiers = owlTiersWithPrice(owlSolPrice)
  const owlEv = weightedAverage(
    owlTiers.map((t) => t.weight),
    owlTiers.map((t) => t.fairValueSol)
  )
  const solEv = weightedAverage(
    PACK_SOL_TIERS.map((t) => t.weight),
    PACK_SOL_TIERS.map((t) => t.amountSol)
  )

  const nftAvgs =
    options?.nftBandAvgFairValues ??
    PACK_NFT_VALUE_BANDS.map((b) => (b.minFairValueSol + b.maxFairValueSol) / 2)
  const nftEv = weightedAverage(
    PACK_NFT_VALUE_BANDS.map((b) => b.weight),
    nftAvgs
  )

  const catTotal =
    PACK_CATEGORY_WEIGHTS_BPS.owl +
    PACK_CATEGORY_WEIGHTS_BPS.sol +
    PACK_CATEGORY_WEIGHTS_BPS.nft

  const categoryEv: Record<PackPrizeCategory, number> = {
    owl: (PACK_CATEGORY_WEIGHTS_BPS.owl / catTotal) * owlEv,
    sol: (PACK_CATEGORY_WEIGHTS_BPS.sol / catTotal) * solEv,
    nft: (PACK_CATEGORY_WEIGHTS_BPS.nft / catTotal) * nftEv,
  }

  const estimatedEvSol = categoryEv.owl + categoryEv.sol + categoryEv.nft
  const estimatedRtpBps = Math.round((estimatedEvSol / PACK_PRICE_SOL) * 10_000)

  const notes: string[] = []
  if (!owlSolPrice) {
    notes.push('Using static OWL fairValueSol from config — set owl_sol_price for live EV.')
  }
  const drift = Math.abs(estimatedEvSol - PACK_TARGET_EV_SOL)
  if (drift > 0.01) {
    notes.push(
      `EV ${estimatedEvSol.toFixed(4)} SOL is more than 0.01 from target ${PACK_TARGET_EV_SOL} — retune tier weights.`
    )
  } else {
    notes.push('EV is within 0.01 SOL of the 80% RTP target.')
  }

  return {
    packPriceSol: PACK_PRICE_SOL,
    targetEvSol: PACK_TARGET_EV_SOL,
    targetRtpBps: PACK_RTP_BPS,
    estimatedEvSol,
    estimatedRtpBps,
    categoryEv,
    owlSolPrice,
    notes,
  }
}
