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
    notes.push(
      'OWL prize value is using a saved estimate. Set the OWL price in SOL on this page for a live calculation.'
    )
  }
  const drift = Math.abs(estimatedEvSol - PACK_TARGET_EV_SOL)
  if (drift > 0.01) {
    notes.push(
      `Typical prize value (${estimatedEvSol.toFixed(4)} SOL) is more than 0.01 SOL off the ${PACK_TARGET_EV_SOL} SOL target. Adjust prize weights.`
    )
  } else {
    notes.push('Typical prize value is close to the 80% target (within 0.01 SOL).')
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

export type PackNftBandLabel = 'common' | 'mid' | 'high'

const BAND_LABELS: PackNftBandLabel[] = ['common', 'mid', 'high']

export function packNftFairValueInRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0.05 && value <= 0.5
}

/** First matching band (inclusive). 0.1 lands in common; 0.25 lands in mid. */
export function packNftBandLabel(fairValueSol: number): PackNftBandLabel | null {
  if (!packNftFairValueInRange(fairValueSol)) return null
  const idx = PACK_NFT_VALUE_BANDS.findIndex(
    (b) => fairValueSol >= b.minFairValueSol && fairValueSol <= b.maxFairValueSol
  )
  return idx >= 0 ? (BAND_LABELS[idx] ?? null) : null
}

export type InventoryFairValueRow = {
  fair_value_sol: number
  status?: string
}

/**
 * Per-band average fair value from available inventory (plus optional draft floors).
 * Empty bands keep the config midpoint and emit a note.
 */
export function nftBandAveragesFromInventory(
  rows: InventoryFairValueRow[],
  draftFloors: number[] = []
): { averages: number[]; notes: string[] } {
  const available = rows
    .filter((r) => (r.status ?? 'available') === 'available')
    .map((r) => Number(r.fair_value_sol))
    .filter((v) => packNftFairValueInRange(v))
  const extras = draftFloors.filter((v) => packNftFairValueInRange(v))
  const values = [...available, ...extras]

  const notes: string[] = []
  const averages = PACK_NFT_VALUE_BANDS.map((b, i) => {
    const inBand = values.filter((v) => v >= b.minFairValueSol && v <= b.maxFairValueSol)
    if (inBand.length === 0) {
      notes.push(
        `No ${BAND_LABELS[i] ?? i}-tier NFTs (${b.minFairValueSol}–${b.maxFairValueSol} SOL) yet — using the middle of that range for the estimate.`
      )
      return (b.minFairValueSol + b.maxFairValueSol) / 2
    }
    return inBand.reduce((s, v) => s + v, 0) / inBand.length
  })

  return { averages, notes }
}

export function simulatePackEvFromInventory(options: {
  owlSolPrice?: number | null
  inventory: InventoryFairValueRow[]
  draftFloors?: number[]
}): EvSimulatorResult {
  const { averages, notes: bandNotes } = nftBandAveragesFromInventory(
    options.inventory,
    options.draftFloors
  )
  const ev = simulatePackEv({
    owlSolPrice: options.owlSolPrice,
    nftBandAvgFairValues: averages,
  })
  return { ...ev, notes: [...ev.notes, ...bandNotes] }
}
