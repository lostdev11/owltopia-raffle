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

export type JackpotOpenAccountingRow = {
  status: string
  payment_signature: string | null
  jackpot_contribution_sol: number | null
  is_jackpot_win: boolean | null
  completed_at: string | null
  created_at: string
}

function roundSol9(sol: number): number {
  return Math.round(sol * 1_000_000_000) / 1_000_000_000
}

/**
 * Expected jackpot pool from open history since the last full-pool win.
 *
 * Counts:
 * - completed opens' recorded contributions (default rate if null)
 * - paid but unfinished opens that never recorded a contribution (e.g. VRF
 *   refund_needed after payment) — those purchases still funded the vault
 */
export function expectedJackpotPoolSol(input: {
  contributionSol?: number
  opens: JackpotOpenAccountingRow[]
}): {
  expectedPoolSol: number
  completedContribSol: number
  paidUnfinishedContribSol: number
  completedOpens: number
  paidUnfinishedOpens: number
  sinceJackpotWinAt: string | null
} {
  const rate =
    input.contributionSol != null && input.contributionSol > 0
      ? input.contributionSol
      : PACK_JACKPOT_CONTRIBUTION_SOL

  const wins = input.opens
    .filter((o) => o.is_jackpot_win === true && o.completed_at)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
  const sinceJackpotWinAt = wins[0]?.completed_at ?? null

  const inWindow = (o: JackpotOpenAccountingRow) => {
    if (!sinceJackpotWinAt) return true
    const t = o.completed_at || o.created_at
    return t > sinceJackpotWinAt
  }

  let completedContribSol = 0
  let paidUnfinishedContribSol = 0
  let completedOpens = 0
  let paidUnfinishedOpens = 0

  for (const o of input.opens) {
    if (!inWindow(o)) continue

    if (o.status === 'completed') {
      completedOpens += 1
      const c =
        o.jackpot_contribution_sol != null && Number(o.jackpot_contribution_sol) > 0
          ? Number(o.jackpot_contribution_sol)
          : rate
      completedContribSol += c
      continue
    }

    // Paid purchase that never finished an open — still owes a jackpot slice.
    if (o.payment_signature && o.status !== 'pending_payment') {
      if (o.jackpot_contribution_sol != null && Number(o.jackpot_contribution_sol) > 0) {
        // Contribution already applied during rolling before a later payout failure.
        paidUnfinishedOpens += 1
        paidUnfinishedContribSol += Number(o.jackpot_contribution_sol)
      } else {
        paidUnfinishedOpens += 1
        paidUnfinishedContribSol += rate
      }
    }
  }

  return {
    expectedPoolSol: roundSol9(completedContribSol + paidUnfinishedContribSol),
    completedContribSol: roundSol9(completedContribSol),
    paidUnfinishedContribSol: roundSol9(paidUnfinishedContribSol),
    completedOpens,
    paidUnfinishedOpens,
    sinceJackpotWinAt,
  }
}
