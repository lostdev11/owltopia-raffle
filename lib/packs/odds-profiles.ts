/**
 * Pack open odds profiles — same NFT inventory + jackpot pool, different ladders by checkout path.
 *
 * SOL checkout uses the production Gembird ladders (unchanged from launch).
 * OWL ($OWL pack) checkout uses draft defaults pending Gembird sign-off — retune here.
 */

import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_OWL_TIERS,
  PACK_PREMIUM_NFT_OVERALL_BPS,
  PACK_PRICE_OWL,
  PACK_SOL_TIERS,
  resolveOwlSolPrice,
  type PackOwlTier,
  type PackPaymentCurrency,
  type PackRegularCategory,
  type PackSolTier,
} from '@/lib/packs/config'

export type PackOddsProfile = {
  id: 'sol' | 'owl'
  categoryWeightsBps: Record<PackRegularCategory, number>
  owlTiers: PackOwlTier[]
  solTiers: PackSolTier[]
  /** Overall bps (of entire open) for premium_1pct NFT chase pool */
  premiumNftOverallBps: number
}

/** 0.1 SOL pack path — must stay aligned with legacy constants in config.ts */
export const PACK_ODDS_PROFILE_SOL: PackOddsProfile = {
  id: 'sol',
  categoryWeightsBps: { ...PACK_CATEGORY_WEIGHTS_BPS },
  owlTiers: PACK_OWL_TIERS,
  solTiers: PACK_SOL_TIERS,
  premiumNftOverallBps: PACK_PREMIUM_NFT_OVERALL_BPS,
}

/**
 * $OWL checkout path (draft — pending Gembird retune before public announce).
 * Higher cash share, lower NFT + premium chase vs SOL packs; smaller OWL/SOL ladders.
 */
export const PACK_ODDS_PROFILE_OWL: PackOddsProfile = {
  id: 'owl',
  categoryWeightsBps: {
    owl: 4000,
    sol: 4000,
    nft: 2000,
  },
  owlTiers: [
    { category: 'owl', amount: 4, weight: 960, fairValueSol: 0.04 },
    { category: 'owl', amount: 10, weight: 30, fairValueSol: 0.1 },
    { category: 'owl', amount: 20, weight: 10, fairValueSol: 0.2 },
  ],
  solTiers: [
    { category: 'sol', amountSol: 0.01, weight: 35 },
    { category: 'sol', amountSol: 0.02, weight: 20 },
    { category: 'sol', amountSol: 0.05, weight: 25 },
    { category: 'sol', amountSol: 0.08, weight: 15 },
    { category: 'sol', amountSol: 0.1, weight: 5 },
  ],
  premiumNftOverallBps: 50,
}

export function resolvePackOddsProfile(currency: PackPaymentCurrency): PackOddsProfile {
  return currency === 'OWL' ? PACK_ODDS_PROFILE_OWL : PACK_ODDS_PROFILE_SOL
}

export function owlTiersForProfile(
  profile: PackOddsProfile,
  owlSolPrice?: number | null
): PackOwlTier[] {
  const rate = resolveOwlSolPrice(owlSolPrice)
  return profile.owlTiers.map((t) => ({
    ...t,
    fairValueSol: t.amount * rate,
  }))
}

/** SOL-equivalent ticket price for $OWL checkout (OWL paid + SOL fee leg). */
export function packOwlCheckoutTicketSolEquiv(options: {
  owlSolPrice?: number | null
  paymentFeeSol?: number | null
  paymentOwlAmount?: number | null
}): number {
  const rate = resolveOwlSolPrice(options.owlSolPrice)
  const owlAmount =
    options.paymentOwlAmount != null && options.paymentOwlAmount > 0
      ? options.paymentOwlAmount
      : PACK_PRICE_OWL
  const fee =
    options.paymentFeeSol != null && options.paymentFeeSol >= 0
      ? options.paymentFeeSol
      : 0
  const raw = owlAmount * rate + fee
  return Math.round(raw * 1_000_000_000) / 1_000_000_000
}

export function premiumNftRollBpsWithinNftCategoryForProfile(
  profile: PackOddsProfile,
  overallBps: number = profile.premiumNftOverallBps
): number {
  const nftCategoryBps = profile.categoryWeightsBps.nft
  if (!(nftCategoryBps > 0)) return 0
  return Math.min(10_000, Math.round((overallBps * 10_000) / nftCategoryBps))
}
