import {
  PACK_DEFAULT_OWL_SOL_PRICE,
  PACK_NFT_EV_DEFAULT_BAND_AVGS,
  PACK_NFT_VALUE_BANDS,
  PACK_PRICE_SOL,
  PACK_RTP_BPS,
  isPackNftFairValueSol,
  packNftValueBandsForMinFair,
  resolveOwlSolPrice,
  type PackPaymentCurrency,
  type PackRegularCategory,
} from '@/lib/packs/config'
import { packJackpotContributionForPrice, PACK_JACKPOT_CONTRIBUTION_SOL } from '@/lib/packs/jackpot'
import {
  isOwlCheckoutProductSlug,
  PACKS_PRODUCT_SLUG_MAIN,
  PACKS_PRODUCT_SLUG_OWL,
  packNftMinFairSolForProductSlug,
  packOwlCheckoutTicketSolEquiv,
  resolvePackCashLadders,
  resolvePackCategoryWeightsBps,
} from '@/lib/packs/product-pools'
import { buildWeightedNftPool } from '@/lib/packs/nft-weights'

export type EvSimulatorResult = {
  packPriceSol: number
  targetEvSol: number
  targetRtpBps: number
  estimatedEvSol: number
  estimatedRtpBps: number
  categoryEv: Record<PackRegularCategory, number>
  jackpotEvSol: number
  owlSolPrice: number | null
  notes: string[]
  paymentCurrency?: PackPaymentCurrency
  productShelfSlug?: string
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

function evForProductShelf(input: {
  productShelfSlug: string
  packPriceSol: number
  targetRtpBps: number
  owlSolPrice: number
  nftEv: number
  jackpotEvSol: number
  notes: string[]
  paymentCurrency?: PackPaymentCurrency
}): EvSimulatorResult {
  const ladders = resolvePackCashLadders(input.productShelfSlug, input.owlSolPrice)
  const owlEv = weightedAverage(
    ladders.owlTiers.map((t) => t.weight),
    ladders.owlTiers.map((t) => t.fairValueSol)
  )
  const solEv = weightedAverage(
    ladders.solTiers.map((t) => t.weight),
    ladders.solTiers.map((t) => t.amountSol)
  )

  const categoryWeights = resolvePackCategoryWeightsBps(input.productShelfSlug)
  const catTotal =
    categoryWeights.owl + categoryWeights.sol + categoryWeights.nft

  const categoryEv: Record<PackRegularCategory, number> = {
    owl: (categoryWeights.owl / catTotal) * owlEv,
    sol: (categoryWeights.sol / catTotal) * solEv,
    nft: (categoryWeights.nft / catTotal) * input.nftEv,
  }

  const estimatedEvSol =
    categoryEv.owl + categoryEv.sol + categoryEv.nft + input.jackpotEvSol
  const targetEvSol = (input.packPriceSol * input.targetRtpBps) / 10_000
  const estimatedRtpBps = Math.round((estimatedEvSol / input.packPriceSol) * 10_000)

  const drift = Math.abs(estimatedEvSol - targetEvSol)
  if (drift > 0.01) {
    input.notes.push(
      `Typical prize value (${estimatedEvSol.toFixed(4)} SOL) is more than 0.01 SOL off the ${targetEvSol.toFixed(4)} SOL target (${input.targetRtpBps / 100}% RTP).`
    )
  } else {
    input.notes.push(
      `Typical prize value is close to the ${input.targetRtpBps / 100}% target (within 0.01 SOL).`
    )
  }

  return {
    packPriceSol: input.packPriceSol,
    targetEvSol,
    targetRtpBps: input.targetRtpBps,
    estimatedEvSol,
    estimatedRtpBps,
    categoryEv,
    jackpotEvSol: input.jackpotEvSol,
    owlSolPrice: input.owlSolPrice,
    notes: input.notes,
    paymentCurrency: input.paymentCurrency,
    productShelfSlug: input.productShelfSlug,
  }
}

/**
 * Estimate EV for the MVP pack given optional live OWL/SOL price and
 * optional average NFT fair value per band (defaults to band midpoint).
 */
export function simulatePackEv(options?: {
  owlSolPrice?: number | null
  nftBandAvgFairValues?: number[]
  paymentCurrency?: PackPaymentCurrency
  paymentFeeSol?: number | null
  productShelfSlug?: string
}): EvSimulatorResult {
  const paymentCurrency = options?.paymentCurrency ?? 'SOL'
  const productShelfSlug =
    options?.productShelfSlug ??
    (paymentCurrency === 'OWL' ? PACKS_PRODUCT_SLUG_OWL : PACKS_PRODUCT_SLUG_MAIN)
  const owlSolPrice = resolveOwlSolPrice(options?.owlSolPrice)

  const nftAvgs =
    options?.nftBandAvgFairValues ??
    [...PACK_NFT_EV_DEFAULT_BAND_AVGS]
  const nftEv = weightedAverage(
    PACK_NFT_VALUE_BANDS.map((b) => b.weight),
    nftAvgs
  )

  const packPriceSol =
    paymentCurrency === 'OWL'
      ? packOwlCheckoutTicketSolEquiv({
          owlSolPrice,
          paymentFeeSol: options?.paymentFeeSol ?? null,
        })
      : PACK_PRICE_SOL

  const jackpotEvSol =
    paymentCurrency === 'OWL'
      ? packJackpotContributionForPrice(packPriceSol)
      : PACK_JACKPOT_CONTRIBUTION_SOL

  const notes: string[] = []
  notes.push(
    `Jackpot slice (${jackpotEvSol} SOL/open) included in EV at steady-state pool equilibrium.`
  )
  notes.push(
    isOwlCheckoutProductSlug(productShelfSlug)
      ? `$OWL shelf ${productShelfSlug}: 70% OWL / 30% NFT (no SOL cash).`
      : `Main shelf ${productShelfSlug}: 30% OWL / 30% SOL / 40% NFT.`
  )
  if (paymentCurrency === 'OWL') {
    notes.push(`$OWL checkout ticket SOL-equiv ≈ ${packPriceSol} SOL (20 $OWL + fee).`)
  }
  if (!options?.owlSolPrice) {
    notes.push(
      `OWL prize value uses default rate (${PACK_DEFAULT_OWL_SOL_PRICE} SOL per OWL). Override in Admin → Packs if needed.`
    )
  }

  return evForProductShelf({
    productShelfSlug,
    packPriceSol,
    targetRtpBps: PACK_RTP_BPS,
    owlSolPrice,
    nftEv,
    jackpotEvSol,
    notes,
    paymentCurrency,
  })
}

export type PackNftBandLabel = 'common' | 'mid' | 'high' | 'premium'

const BAND_LABELS: PackNftBandLabel[] = ['common', 'mid', 'high']

export function packNftFairValueInRange(
  value: number,
  productSlug?: string | null
): boolean {
  return isPackNftFairValueSol(value, packNftMinFairSolForProductSlug(productSlug))
}

/** First matching band (inclusive). Above 0.5 SOL → premium. */
export function packNftBandLabel(
  fairValueSol: number,
  productSlug?: string | null
): PackNftBandLabel | null {
  if (!packNftFairValueInRange(fairValueSol, productSlug)) return null
  const bands = packNftValueBandsForMinFair(packNftMinFairSolForProductSlug(productSlug))
  if (fairValueSol > bands[bands.length - 1]!.maxFairValueSol) {
    return 'premium'
  }
  const idx = bands.findIndex(
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
  draftFloors: number[] = [],
  productSlug?: string | null
): { averages: number[]; notes: string[] } {
  const bands = packNftValueBandsForMinFair(packNftMinFairSolForProductSlug(productSlug))
  const inRange = (v: number) => packNftFairValueInRange(v, productSlug)
  const available = rows
    .filter((r) => (r.status ?? 'available') === 'available')
    .map((r) => Number(r.fair_value_sol))
    .filter(inRange)
  const extras = draftFloors.filter(inRange)
  const values = [...available, ...extras]

  const notes: string[] = []
  const averages = bands.map((b, i) => {
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
  paymentCurrency?: PackPaymentCurrency
  paymentFeeSol?: number | null
  productShelfSlug?: string
}): EvSimulatorResult {
  const productShelfSlug =
    options.productShelfSlug ??
    (options.paymentCurrency === 'OWL' ? PACKS_PRODUCT_SLUG_OWL : PACKS_PRODUCT_SLUG_MAIN)
  const minFairSol = packNftMinFairSolForProductSlug(productShelfSlug)
  const draftFloors = options.draftFloors ?? []
  const inRange = (v: number) => packNftFairValueInRange(v, productShelfSlug)
  const available = options.inventory
    .filter((r) => (r.status ?? 'available') === 'available')
    .map((r) => Number(r.fair_value_sol))
    .filter(inRange)
  const values = [...available, ...draftFloors.filter(inRange)]

  const notes: string[] = []
  if (values.length === 0) {
    notes.push('No prize NFTs in inventory yet — NFT EV uses band midpoints until you deposit.')
    const { averages, notes: bandNotes } = nftBandAveragesFromInventory(
      options.inventory,
      draftFloors,
      productShelfSlug
    )
    const ev = simulatePackEv({
      owlSolPrice: options.owlSolPrice,
      nftBandAvgFairValues: averages,
      paymentCurrency: options.paymentCurrency,
      paymentFeeSol: options.paymentFeeSol,
      productShelfSlug: options.productShelfSlug,
    })
    return { ...ev, notes: [...ev.notes, ...notes, ...bandNotes] }
  }

  // Per-NFT inverse-FP weights: EV = Σ (w_i / Σw) * fair_i (pool max FP rescales odds)
  const weighted = buildWeightedNftPool(
    values.map((fair_value_sol, i) => ({
      id: `ev-${i}`,
      mint_address: `ev-${i}`,
      fair_value_sol,
    })),
    { minFairSol }
  )
  const nftEv = weightedAverage(
    weighted.map((row) => row.weight),
    weighted.map((row) => row.fair_value_sol)
  )
  const maxFp = weighted.length > 0 ? Math.max(...weighted.map((row) => row.fair_value_sol)) : 0
  notes.push(
    `NFT EV uses per-mint floor weights (${values.length} NFT${values.length === 1 ? '' : 's'}; higher FP = rarer${maxFp > PACK_NFT_VALUE_BANDS[2]!.maxFairValueSol ? `; pool max ${maxFp} SOL` : ''}).`
  )

  const paymentCurrency = options.paymentCurrency ?? 'SOL'
  const owlSolPrice = resolveOwlSolPrice(options.owlSolPrice)
  const packPriceSol =
    paymentCurrency === 'OWL'
      ? packOwlCheckoutTicketSolEquiv({
          owlSolPrice,
          paymentFeeSol: options.paymentFeeSol ?? null,
        })
      : PACK_PRICE_SOL
  const jackpotEvSol =
    paymentCurrency === 'OWL'
      ? packJackpotContributionForPrice(packPriceSol)
      : PACK_JACKPOT_CONTRIBUTION_SOL

  notes.push(
    isOwlCheckoutProductSlug(productShelfSlug)
      ? `$OWL shelf: 70% OWL / 30% NFT; EV from this inventory.`
      : `Main shelf: 30/30/40 category mix; EV from this inventory.`
  )
  if (!options.owlSolPrice) {
    notes.push(
      `OWL prize value uses default rate (${PACK_DEFAULT_OWL_SOL_PRICE} SOL per OWL). Override in Admin → Packs if needed.`
    )
  }

  const ev = evForProductShelf({
    productShelfSlug,
    packPriceSol,
    targetRtpBps: PACK_RTP_BPS,
    owlSolPrice,
    nftEv,
    jackpotEvSol,
    notes: [
      `Jackpot slice (${jackpotEvSol} SOL/open) at steady-state pool equilibrium.`,
    ],
    paymentCurrency,
  })
  return { ...ev, notes: [...ev.notes, ...notes] }
}
