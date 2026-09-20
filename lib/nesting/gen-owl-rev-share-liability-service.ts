import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { listGenOwlRevSharePeriods } from '@/lib/db/gen-owl-rev-share-periods'
import { sumGenOwlRevSharePoolPayouts } from '@/lib/db/gen-owl-rev-share-pool-payouts'
import {
  computeGenOwlRevShareLiabilitySnapshot,
  evaluateGenOwlRevSharePoolCoverage,
  type GenOwlRevShareLiabilitySnapshot,
  type GenOwlRevSharePoolCoverage,
} from '@/lib/nesting/gen-owl-rev-share-liability'
import {
  applyOrphanRevSharePoolPayoutsToRequired,
  orphanRevSharePoolPayouts,
} from '@/lib/nesting/gen-owl-rev-share-orphan-payouts'
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
  orphan_payouts: { sol: number; usdc: number }
}

async function listAllGenOwlRevShareClaimPayments(): Promise<
  Array<{
    period_month: string
    amount_sol: number
    amount_usdc: number
    sol_transaction_signature: string | null
    usdc_transaction_signature: string | null
    group_key: string | null
  }>
> {
  const db = getSupabaseAdmin()
  const pageSize = 1000
  const out: Array<{
    period_month: string
    amount_sol: number
    amount_usdc: number
    sol_transaction_signature: string | null
    usdc_transaction_signature: string | null
    group_key: string | null
  }> = []
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('gen_owl_rev_share_claims')
      .select(
        'period_month, amount_sol, amount_usdc, sol_transaction_signature, usdc_transaction_signature, group_key'
      )
      .order('claimed_at', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) {
      console.error('[gen-owl-rev-share-liability] list claims:', error.message)
      break
    }
    const rows = data ?? []
    for (const row of rows) {
      out.push({
        period_month: String(row.period_month),
        amount_sol: Number(row.amount_sol) || 0,
        amount_usdc: Number(row.amount_usdc) || 0,
        sol_transaction_signature:
          row.sol_transaction_signature != null ? String(row.sol_transaction_signature) : null,
        usdc_transaction_signature:
          row.usdc_transaction_signature != null ? String(row.usdc_transaction_signature) : null,
        group_key: row.group_key != null ? String(row.group_key) : null,
      })
    }
    if (rows.length < pageSize) break
    from += pageSize
  }
  return out
}

/**
 * Load claimed vs unclaimed liability across stacked months and compare to the live pool.
 */
export async function loadGenOwlRevShareLiabilityWithCoverage(params?: {
  periodLimit?: number
}): Promise<GenOwlRevShareLiabilityWithCoverage> {
  const [periods, claims, balances, ledger] = await Promise.all([
    listGenOwlRevSharePeriods(params?.periodLimit ?? 36),
    listAllGenOwlRevShareClaimPayments(),
    getGenOwlRevSharePoolBalances(),
    sumGenOwlRevSharePoolPayouts(),
  ])

  const liability = computeGenOwlRevShareLiabilitySnapshot({ periods, claims })
  const claimsCommittedSol = Math.max(0, liability.all.deposited_sol - liability.all.unclaimed_sol)
  const claimsCommittedUsdc = Math.max(0, liability.all.deposited_usdc - liability.all.unclaimed_usdc)
  const orphan = orphanRevSharePoolPayouts({
    ledger_sol: ledger.sol,
    ledger_usdc: ledger.usdc,
    claims_committed_sol: claimsCommittedSol,
    claims_committed_usdc: claimsCommittedUsdc,
  })
  const required = applyOrphanRevSharePoolPayoutsToRequired({
    required_sol: liability.open.required_sol,
    required_usdc: liability.open.required_usdc,
    orphan_sol: orphan.orphan_sol,
    orphan_usdc: orphan.orphan_usdc,
  })

  const coverage = evaluateGenOwlRevSharePoolCoverage({
    hold_sol: balances.sol,
    hold_usdc: balances.usdc,
    required_sol: required.required_sol,
    required_usdc: required.required_usdc,
    unclaimed_nests: liability.open.unclaimed_nests,
    open_period_count: liability.open.open_period_count,
    configured: balances.configured,
    pool_address: balances.address,
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
    orphan_payouts: { sol: orphan.orphan_sol, usdc: orphan.orphan_usdc },
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
