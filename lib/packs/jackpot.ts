/**
 * Accumulating SOL jackpot — 0.02 SOL per pack (default) feeds the pool; rare full-pool wins.
 */

import { PACK_PRICE_SOL } from '@/lib/packs/config'

/** SOL contributed to the jackpot pool per pack open (20% of 0.1 SOL pack). */
export const PACK_JACKPOT_CONTRIBUTION_SOL = 0.02

/** Default win rate: 20 bps = 0.2% ≈ 1 in 500 opens. */
export const PACK_JACKPOT_WIN_ODDS_BPS = 20

/** Minimum pool balance (after this open's contribution) required to trigger a win. */
export const PACK_JACKPOT_MIN_PAYOUT_SOL = PACK_JACKPOT_CONTRIBUTION_SOL

export function packJackpotContributionForPrice(priceSol: number): number {
  if (!(priceSol > 0)) return PACK_JACKPOT_CONTRIBUTION_SOL
  return Math.round((priceSol * PACK_JACKPOT_CONTRIBUTION_SOL) / PACK_PRICE_SOL * 1e9) / 1e9
}

export function formatJackpotPoolSol(sol: number): string {
  if (sol >= 10) return sol.toFixed(2)
  if (sol >= 1) return sol.toFixed(3)
  return sol.toFixed(4)
}

export function jackpotWinPercentLabel(oddsBps: number): string {
  const pct = oddsBps / 100
  if (pct >= 1) return `${pct.toFixed(1)}%`
  if (pct >= 0.1) return `${pct.toFixed(2)}%`
  return `${pct.toFixed(3)}%`
}
