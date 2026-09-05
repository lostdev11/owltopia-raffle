import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { listGenOwlRevSharePeriods } from '@/lib/db/gen-owl-rev-share-periods'
import {
  computeGenOwlRevShareLiabilitySnapshot,
  evaluateGenOwlRevSharePoolCoverage,
  type GenOwlRevShareLiabilitySnapshot,
  type GenOwlRevSharePoolCoverage,
} from '@/lib/nesting/gen-owl-rev-share-liability'
import { getGenOwlRevSharePoolBalances } from '@/lib/nesting/gen-owl-rev-share-pool'
import { StakingUserError } from '@/lib/nesting/errors'

export type GenOwlRevShareLiabilityWithCoverage = {
  liability: GenOwlRevShareLiabilitySnapshot
  coverage: GenOwlRevSharePoolCoverage
  pool: {
    configured: boolean
    address: string | null
    sol: number | null
    usdc: number | null
  }
}

/**
 * Load claimed vs unclaimed liability across stacked months and compare to the live pool.
 */
export async function loadGenOwlRevShareLiabilityWithCoverage(params?: {
  periodLimit?: number
}): Promise<GenOwlRevShareLiabilityWithCoverage> {
  const db = getSupabaseAdmin()
  const [periods, claimsRes, balances] = await Promise.all([
    listGenOwlRevSharePeriods(params?.periodLimit ?? 36),
    db
      .from('gen_owl_rev_share_claims')
      .select(
        'period_month, amount_sol, amount_usdc, sol_transaction_signature, usdc_transaction_signature, group_key'
      )
      .limit(50000),
    getGenOwlRevSharePoolBalances(),
  ])

  const claims = (claimsRes.data ?? []).map((row) => ({
    period_month: String(row.period_month),
    amount_sol: Number(row.amount_sol) || 0,
    amount_usdc: Number(row.amount_usdc) || 0,
    sol_transaction_signature:
      row.sol_transaction_signature != null ? String(row.sol_transaction_signature) : null,
    usdc_transaction_signature:
      row.usdc_transaction_signature != null ? String(row.usdc_transaction_signature) : null,
    group_key: row.group_key != null ? String(row.group_key) : null,
  }))

  const liability = computeGenOwlRevShareLiabilitySnapshot({ periods, claims })
  const coverage = evaluateGenOwlRevSharePoolCoverage({
    hold_sol: balances.sol,
    hold_usdc: balances.usdc,
    required_sol: liability.open.required_sol,
    required_usdc: liability.open.required_usdc,
    unclaimed_nests: liability.open.unclaimed_nests,
    open_period_count: liability.open.open_period_count,
    configured: balances.configured,
  })

  return {
    liability,
    coverage,
    pool: {
      configured: balances.configured,
      address: balances.address,
      sol: balances.sol,
      usdc: balances.usdc,
    },
  }
}

/**
 * Refuse claims when the on-chain pool cannot cover ALL remaining stacked liability.
 * Prevents early claimers from draining a short pool and stranding late claimers.
 */
export async function assertGenOwlRevShareOutstandingLiabilityCovered(): Promise<GenOwlRevShareLiabilityWithCoverage> {
  const snapshot = await loadGenOwlRevShareLiabilityWithCoverage()
  if (!snapshot.coverage.ok) {
    throw new StakingUserError(
      snapshot.coverage.error ??
        'Rev share pool does not cover remaining unclaimed nests across open months. An admin must deposit the shortfall before claims can continue.',
      503,
      {
        pool_shortfall: true,
        outstanding_liability: true,
        need_sol: snapshot.coverage.required_sol,
        hold_sol: snapshot.coverage.hold_sol,
        need_usdc: snapshot.coverage.required_usdc,
        hold_usdc: snapshot.coverage.hold_usdc,
        shortfall_sol: snapshot.coverage.shortfall_sol,
        shortfall_usdc: snapshot.coverage.shortfall_usdc,
        unclaimed_nests: snapshot.coverage.unclaimed_nests,
        open_period_count: snapshot.coverage.open_period_count,
      }
    )
  }
  return snapshot
}
