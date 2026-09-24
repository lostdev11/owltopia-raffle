import {
  PACK_DEFAULT_OWL_SOL_PRICE,
  PACK_NFT_EV_DEFAULT_BAND_AVGS,
  PACK_NFT_VALUE_BANDS,
  PACK_PRICE_SOL,
  PACK_RTP_BPS,
  isPackNftFairValueSol,
  owlTiersWithPrice,
  resolveOwlSolPrice,
  type PackPaymentCurrency,
  type PackRegularCategory,
} from '@/lib/packs/config'
import { packJackpotContributionForPrice, PACK_JACKPOT_CONTRIBUTION_SOL } from '@/lib/packs/jackpot'
import {
  PACK_ODDS_PROFILE_SOL,
  owlTiersForProfile,
  packOwlCheckoutTicketSolEquiv,
  resolvePackOddsProfile,
  type PackOddsProfile,
} from '@/lib/packs/odds-profiles'
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
  oddsProfileId?: PackOddsProfile['id']
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

function evFromProfile(input: {
  profile: PackOddsProfile
  packPriceSol: number
  targetRtpBps: number
  owlSolPrice: number
  nftEv: number
  jackpotEvSol: number
  notes: string[]
  paymentCurrency?: PackPaymentCurrency
}): EvSimulatorResult {
  const owlTiers =
    input.profile.id === 'sol'
      ? owlTiersWithPrice(input.owlSolPrice)
      : owlTiersForProfile(input.profile, input.owlSolPrice)
  const owlEv = weightedAverage(
    owlTiers.map((t) => t.weight),
    owlTiers.map((t) => t.fairValueSol)
  )
  const solEv = weightedAverage(
    input.profile.solTiers.map((t) => t.weight),
    input.profile.solTiers.map((t) => t.amountSol)
  )

  const weights = input.profile.categoryWeightsBps
  const catTotal = weights.owl + weights.sol + weights.nft

  const categoryEv: Record<PackRegularCategory, number> = {
    owl: (weights.owl / catTotal) * owlEv,
    sol: (weights.sol / catTotal) * solEv,
    nft: (weights.nft / catTotal) * input.nftEv,
  }

  const estimatedEvSol =
    categoryEv.owl + categoryEv.sol + categoryEv.nft + input.jackpotEvSol
  const targetEvSol = (input.packPriceSol * input.targetRtpBps) / 10_000
  const estimatedRtpBps = Math.round((estimatedEvSol / input.packPriceSol) * 10_000)

  const drift = Math.abs(estimatedEvSol - targetEvSol)
  if (drift > 0.01) {
    input.notes.push(
      `Typical prize value (${estimatedEvSol.toFixed(4)} SOL) is more than 0.01 SOL off the ${targetEvSol.toFixed(4)} SOL target (${input.targetRtpBps / 100}% RTP). Adjust prize weights.`
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
    oddsProfileId: input.profile.id,
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
}): EvSimulatorResult {
  const paymentCurrency = options?.paymentCurrency ?? 'SOL'
  const profile = resolvePackOddsProfile(paymentCurrency)
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
  if (paymentCurrency === 'OWL') {
    notes.push(
      `$OWL checkout uses draft odds profile (${profile.id}); ticket SOL-equiv ≈ ${packPriceSol} SOL (20 $OWL + fee).`
    )
  }
  if (!options?.owlSolPrice) {
    notes.push(
      `OWL prize value uses default rate (${PACK_DEFAULT_OWL_SOL_PRICE} SOL per OWL; 10 OWL = 0.1 SOL). Override in Admin → Packs if needed.`
    )
  }

  return evFromProfile({
    profile,
    packPriceSol,
    targetRtpBps: PACK_RTP_BPS,
    owlSolPrice,
    nftEv,
    jackpotEvSol,
    notes,
    paymentCurrency,
  })
}

/** SOL-path EV using explicit profile (defaults to production SOL ladders). */
export function simulatePackEvWithProfile(options: {
  profile?: PackOddsProfile
  owlSolPrice?: number | null
  nftEv: number
  packPriceSol?: number
  jackpotEvSol?: number
}): EvSimulatorResult {
  const profile = options.profile ?? PACK_ODDS_PROFILE_SOL
  const owlSolPrice = resolveOwlSolPrice(options?.owlSolPrice)
  const packPriceSol = options.packPriceSol ?? PACK_PRICE_SOL
  const jackpotEvSol = options.jackpotEvSol ?? PACK_JACKPOT_CONTRIBUTION_SOL
  const notes: string[] = [
    `Odds profile: ${profile.id}. Jackpot slice ${jackpotEvSol} SOL/open.`,
  ]
  return evFromProfile({
    profile,
    packPriceSol,
    targetRtpBps: PACK_RTP_BPS,
    owlSolPrice,
    nftEv: options.nftEv,
    jackpotEvSol,
    notes,
    paymentCurrency: profile.id === 'owl' ? 'OWL' : 'SOL',
  })
}

export type PackNftBandLabel = 'common' | 'mid' | 'high' | 'premium'

const BAND_LABELS: PackNftBandLabel[] = ['common', 'mid', 'high']

export function packNftFairValueInRange(value: number): boolean {
  return isPackNftFairValueSol(value)
}

/** First matching band (inclusive). Above 0.5 SOL → premium. */
export function packNftBandLabel(fairValueSol: number): PackNftBandLabel | null {
  if (!packNftFairValueInRange(fairValueSol)) return null
  if (fairValueSol > PACK_NFT_VALUE_BANDS[PACK_NFT_VALUE_BANDS.length - 1]!.maxFairValueSol) {
    return 'premium'
  }
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
  paymentCurrency?: PackPaymentCurrency
  paymentFeeSol?: number | null
}): EvSimulatorResult {
  const draftFloors = options.draftFloors ?? []
  const available = options.inventory
    .filter((r) => (r.status ?? 'available') === 'available')
    .map((r) => Number(r.fair_value_sol))
    .filter((v) => packNftFairValueInRange(v))
  const values = [...available, ...draftFloors.filter((v) => packNftFairValueInRange(v))]

  const notes: string[] = []
  if (values.length === 0) {
    notes.push('No prize NFTs in inventory yet — NFT EV uses band midpoints until you deposit.')
    const { averages, notes: bandNotes } = nftBandAveragesFromInventory(options.inventory, draftFloors)
    const ev = simulatePackEv({
      owlSolPrice: options.owlSolPrice,
      nftBandAvgFairValues: averages,
      paymentCurrency: options.paymentCurrency,
      paymentFeeSol: options.paymentFeeSol,
    })
    return { ...ev, notes: [...ev.notes, ...notes, ...bandNotes] }
  }

  // Per-NFT inverse-FP weights: EV = Σ (w_i / Σw) * fair_i (pool max FP rescales odds)
  const weighted = buildWeightedNftPool(
    values.map((fair_value_sol, i) => ({
      id: `ev-${i}`,
      mint_address: `ev-${i}`,
      fair_value_sol,
    }))
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
  const profile = resolvePackOddsProfile(paymentCurrency)
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

  if (paymentCurrency === 'OWL') {
    notes.push(
      `$OWL checkout uses draft odds profile; ticket SOL-equiv ≈ ${packPriceSol} SOL (20 $OWL + fee).`
    )
  }
  if (!options.owlSolPrice) {
    notes.push(
      `OWL prize value uses default rate (${PACK_DEFAULT_OWL_SOL_PRICE} SOL per OWL; 10 OWL = 0.1 SOL). Override in Admin → Packs if needed.`
    )
  }

  const ev = simulatePackEvWithProfile({
    profile,
    owlSolPrice: options.owlSolPrice,
    nftEv,
    packPriceSol,
    jackpotEvSol,
  })
  return { ...ev, notes: [...ev.notes, ...notes] }
}
