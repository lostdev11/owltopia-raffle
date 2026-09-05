/**
 * Claimed vs unclaimed Gen Owl rev-share liability across stacked months.
 *
 * Outstanding liability = deposited pool totals − successfully paid claims,
 * summed over every claim-open period. Late claimers stay protected when the
 * on-chain pool is required to cover this total (not just the current month).
 */

import type { GenOwlRevSharePeriodRow } from '@/lib/db/gen-owl-rev-share-periods'
import { claimsOpenForPeriod } from '@/lib/nesting/gen-owl-rev-share-month'
import { GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS } from '@/lib/nesting/gen-owl-rev-share-pool-affordability'

const LAMPORTS_PER_SOL = 1_000_000_000

export type GenOwlRevShareClaimPaymentInput = {
  period_month: string
  amount_sol: number
  amount_usdc: number
  sol_transaction_signature: string | null
  usdc_transaction_signature: string | null
  /** True when this row fully paid what it owed (used for nest counts). */
  group_key?: string | null
}

export type GenOwlRevSharePeriodLiability = {
  period_month: string
  claims_open: boolean
  finalized: boolean
  deposited_sol: number
  deposited_usdc: number
  paid_sol: number
  paid_usdc: number
  /** Deposited − paid (what the pool must still hold for this month). */
  unclaimed_sol: number
  unclaimed_usdc: number
  eligible_nests: number
  claimed_nests: number
  /** Eligible − claimed (nests that can still draw from this month). */
  unclaimed_nests: number
  claim_rate: number | null
}

export type GenOwlRevShareLiabilityTotals = {
  deposited_sol: number
  deposited_usdc: number
  paid_sol: number
  paid_usdc: number
  unclaimed_sol: number
  unclaimed_usdc: number
  eligible_nests: number
  claimed_nests: number
  unclaimed_nests: number
  /** Network-fee headroom reserved so late individual claims can still settle. */
  fee_reserve_sol: number
  /** unclaimed_sol + fee_reserve_sol — what the pool wallet should hold. */
  required_sol: number
  required_usdc: number
  open_period_count: number
  claim_rate: number | null
}

export type GenOwlRevShareLiabilitySnapshot = {
  periods: GenOwlRevSharePeriodLiability[]
  /** All claim-open periods with deposit/finalize activity (stacked months). */
  open: GenOwlRevShareLiabilityTotals
  /** Every period in the input set (including not-yet-open). */
  all: GenOwlRevShareLiabilityTotals
}

export function periodDepositedTotals(period: {
  gen1_total_sol?: number | null
  gen2_total_sol?: number | null
  gen1_total_usdc?: number | null
  gen2_total_usdc?: number | null
}): { sol: number; usdc: number } {
  return {
    sol: (Number(period.gen1_total_sol) || 0) + (Number(period.gen2_total_sol) || 0),
    usdc: (Number(period.gen1_total_usdc) || 0) + (Number(period.gen2_total_usdc) || 0),
  }
}

export function paidAmountsFromClaim(row: {
  amount_sol: number
  amount_usdc: number
  sol_transaction_signature: string | null
  usdc_transaction_signature: string | null
}): { paid_sol: number; paid_usdc: number; fully_paid: boolean } {
  const needSol = row.amount_sol > 0
  const needUsdc = row.amount_usdc > 0
  const hasSol = Boolean(row.sol_transaction_signature?.trim())
  const hasUsdc = Boolean(row.usdc_transaction_signature?.trim())
  const solOk = !needSol || hasSol
  const usdcOk = !needUsdc || hasUsdc
  return {
    paid_sol: needSol && hasSol ? row.amount_sol : 0,
    paid_usdc: needUsdc && hasUsdc ? row.amount_usdc : 0,
    fully_paid: (needSol || needUsdc) && solOk && usdcOk,
  }
}

function emptyTotals(): GenOwlRevShareLiabilityTotals {
  return {
    deposited_sol: 0,
    deposited_usdc: 0,
    paid_sol: 0,
    paid_usdc: 0,
    unclaimed_sol: 0,
    unclaimed_usdc: 0,
    eligible_nests: 0,
    claimed_nests: 0,
    unclaimed_nests: 0,
    fee_reserve_sol: 0,
    required_sol: 0,
    required_usdc: 0,
    open_period_count: 0,
    claim_rate: null,
  }
}

function finalizeTotals(t: GenOwlRevShareLiabilityTotals): GenOwlRevShareLiabilityTotals {
  const feeReserveSol =
    (t.unclaimed_nests * GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS) / LAMPORTS_PER_SOL
  const claimRate =
    t.eligible_nests > 0 ? Math.min(1, t.claimed_nests / t.eligible_nests) : null
  return {
    ...t,
    fee_reserve_sol: feeReserveSol,
    required_sol: t.unclaimed_sol + feeReserveSol,
    required_usdc: t.unclaimed_usdc,
    claim_rate: claimRate,
  }
}

function addPeriodToTotals(
  totals: GenOwlRevShareLiabilityTotals,
  period: GenOwlRevSharePeriodLiability
): void {
  totals.deposited_sol += period.deposited_sol
  totals.deposited_usdc += period.deposited_usdc
  totals.paid_sol += period.paid_sol
  totals.paid_usdc += period.paid_usdc
  totals.unclaimed_sol += period.unclaimed_sol
  totals.unclaimed_usdc += period.unclaimed_usdc
  totals.eligible_nests += period.eligible_nests
  totals.claimed_nests += period.claimed_nests
  totals.unclaimed_nests += period.unclaimed_nests
}

/**
 * Pure liability math from period rows + claim payment rows.
 * Counts claimed nests only when the claim is fully paid on-chain.
 */
export function computeGenOwlRevShareLiabilitySnapshot(params: {
  periods: GenOwlRevSharePeriodRow[]
  claims: GenOwlRevShareClaimPaymentInput[]
  now?: Date
}): GenOwlRevShareLiabilitySnapshot {
  const now = params.now ?? new Date()
  const claimsByPeriod = new Map<string, GenOwlRevShareClaimPaymentInput[]>()
  for (const claim of params.claims) {
    const key = claim.period_month.trim()
    const list = claimsByPeriod.get(key) ?? []
    list.push(claim)
    claimsByPeriod.set(key, list)
  }

  const periods: GenOwlRevSharePeriodLiability[] = params.periods.map((period) => {
    const periodMonth = period.period_month
    const deposited = periodDepositedTotals(period)
    const periodClaims = claimsByPeriod.get(periodMonth) ?? []
    let paidSol = 0
    let paidUsdc = 0
    let claimedNests = 0
    for (const claim of periodClaims) {
      const paid = paidAmountsFromClaim(claim)
      paidSol += paid.paid_sol
      paidUsdc += paid.paid_usdc
      if (paid.fully_paid) claimedNests += 1
    }
    const eligible =
      (Number(period.gen1_eligible_count) || 0) + (Number(period.gen2_eligible_count) || 0)
    const unclaimedNests = Math.max(0, eligible - claimedNests)
    const unclaimedSol = Math.max(0, deposited.sol - paidSol)
    const unclaimedUsdc = Math.max(0, deposited.usdc - paidUsdc)
    return {
      period_month: periodMonth,
      claims_open: claimsOpenForPeriod(periodMonth, now),
      finalized: Boolean(period.finalized_at),
      deposited_sol: deposited.sol,
      deposited_usdc: deposited.usdc,
      paid_sol: paidSol,
      paid_usdc: paidUsdc,
      unclaimed_sol: unclaimedSol,
      unclaimed_usdc: unclaimedUsdc,
      eligible_nests: eligible,
      claimed_nests: claimedNests,
      unclaimed_nests: unclaimedNests,
      claim_rate: eligible > 0 ? Math.min(1, claimedNests / eligible) : null,
    }
  })

  const all = emptyTotals()
  const open = emptyTotals()
  for (const period of periods) {
    addPeriodToTotals(all, period)
    // Stacked months that holders can still claim — include open windows only.
    if (period.claims_open && (period.deposited_sol > 0 || period.deposited_usdc > 0)) {
      addPeriodToTotals(open, period)
      open.open_period_count += 1
    }
  }

  return {
    periods,
    open: finalizeTotals(open),
    all: finalizeTotals(all),
  }
}

export type GenOwlRevSharePoolCoverage = {
  ok: boolean
  hold_sol: number | null
  hold_usdc: number | null
  required_sol: number
  required_usdc: number
  shortfall_sol: number
  shortfall_usdc: number
  unclaimed_nests: number
  open_period_count: number
  error: string | null
}

/**
 * Whether the on-chain pool covers outstanding stacked liability
 * (so users who wait months are not left with an empty wallet).
 */
export function evaluateGenOwlRevSharePoolCoverage(params: {
  hold_sol: number | null
  hold_usdc: number | null
  required_sol: number
  required_usdc: number
  unclaimed_nests: number
  open_period_count: number
  configured?: boolean
}): GenOwlRevSharePoolCoverage {
  const configured = params.configured !== false
  const requiredSol = Math.max(0, Number(params.required_sol) || 0)
  const requiredUsdc = Math.max(0, Number(params.required_usdc) || 0)
  const holdSol = params.hold_sol
  const holdUsdc = params.hold_usdc

  if (!configured) {
    return {
      ok: false,
      hold_sol: holdSol,
      hold_usdc: holdUsdc,
      required_sol: requiredSol,
      required_usdc: requiredUsdc,
      shortfall_sol: requiredSol,
      shortfall_usdc: requiredUsdc,
      unclaimed_nests: params.unclaimed_nests,
      open_period_count: params.open_period_count,
      error: 'Rev share pool is not configured.',
    }
  }

  // Nothing outstanding — coverage is fine even with a dusty wallet.
  if (requiredSol <= 0 && requiredUsdc <= 0) {
    return {
      ok: true,
      hold_sol: holdSol,
      hold_usdc: holdUsdc,
      required_sol: 0,
      required_usdc: 0,
      shortfall_sol: 0,
      shortfall_usdc: 0,
      unclaimed_nests: params.unclaimed_nests,
      open_period_count: params.open_period_count,
      error: null,
    }
  }

  let shortfallSol = 0
  let shortfallUsdc = 0
  const errors: string[] = []

  if (requiredSol > 0) {
    if (holdSol == null) {
      errors.push('Could not read rev-share pool SOL balance.')
    } else if (holdSol + 1e-12 < requiredSol) {
      shortfallSol = requiredSol - holdSol
      errors.push(
        `Rev share pool must hold about ${requiredSol.toFixed(5)} SOL for ` +
          `${params.unclaimed_nests} unclaimed nest(s) across ${params.open_period_count} open month(s), ` +
          `but only has ${holdSol.toFixed(5)} SOL (short ${shortfallSol.toFixed(5)}). ` +
          `Deposit the shortfall so holders who claim later are not left unpaid.`
      )
    }
  }

  if (requiredUsdc > 0) {
    if (holdUsdc == null) {
      errors.push('Could not read rev-share pool USDC balance.')
    } else if (holdUsdc + 1e-6 < requiredUsdc) {
      shortfallUsdc = requiredUsdc - holdUsdc
      errors.push(
        `Rev share pool must hold ${requiredUsdc} USDC for remaining unclaimed nests, ` +
          `but only has ${holdUsdc} USDC (short ${shortfallUsdc}).`
      )
    }
  }

  return {
    ok: errors.length === 0,
    hold_sol: holdSol,
    hold_usdc: holdUsdc,
    required_sol: requiredSol,
    required_usdc: requiredUsdc,
    shortfall_sol: shortfallSol,
    shortfall_usdc: shortfallUsdc,
    unclaimed_nests: params.unclaimed_nests,
    open_period_count: params.open_period_count,
    error: errors.length ? errors.join(' · ') : null,
  }
}
