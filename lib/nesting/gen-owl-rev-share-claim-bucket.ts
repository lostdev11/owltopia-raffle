/**
 * Resolve Gen Owl rev-share claim buckets without overrunning the finalized 1/1 budget.
 *
 * Finalize freezes rates from a counted 1/1 set. Claim-time DAS/allowlist drift must not
 * pay extra nests at the 1/1 rate or the pool drains and late claimers get stranded.
 */

import type { GenOwlRevSharePeriodRow } from '@/lib/db/gen-owl-rev-share-periods'
import {
  getGenOwlRevShareEligibleNestBucket,
  listGenOwlRevShareEligibleNestBucketsForPeriod,
  countGenOwlRevShareEligibleNestsForPeriod,
} from '@/lib/db/gen-owl-rev-share-eligible-nests'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { classifyGen1OneOfOneMints } from '@/lib/nesting/gen1-one-of-one'
import { classifyGen2OneOfOneMints } from '@/lib/nesting/gen2-one-of-one'
import {
  resolveGen1PerNestAmounts,
  resolveGen2PerNestAmounts,
} from '@/lib/nesting/gen-owl-rev-share'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

export type RevShareClaimBucket = 'standard' | 'one-of-one'

/** Pure: demote 1/1 when finalized slots are already used. */
export function applyOneOfOneBudgetCap(params: {
  desired: RevShareClaimBucket
  budgetedOneOfOneCount: number
  paidOneOfOneCount: number
}): RevShareClaimBucket {
  if (params.desired !== 'one-of-one') return 'standard'
  const budget = Math.max(0, Math.floor(params.budgetedOneOfOneCount))
  if (budget <= 0) return 'standard'
  if (params.paidOneOfOneCount >= budget) return 'standard'
  return 'one-of-one'
}

export function budgetedOneOfOneCountForGroup(
  period: Pick<
    GenOwlRevSharePeriodRow,
    'gen1_one_of_one_eligible_count' | 'gen2_one_of_one_eligible_count'
  >,
  group: GenOwlStakingGroupKey
): number {
  if (group === 'gen1-owl') return Number(period.gen1_one_of_one_eligible_count) || 0
  return Number(period.gen2_one_of_one_eligible_count) || 0
}

/** True when a paid claim amount matches the finalized 1/1 rate (not standard). */
export function claimAmountLooksLikeOneOfOne(params: {
  amountSol: number
  amountUsdc: number
  standardSol: number
  standardUsdc: number
  oneOfOneSol: number
  oneOfOneUsdc: number
}): boolean {
  const oooSol = params.oneOfOneSol
  const oooUsdc = params.oneOfOneUsdc
  const stdSol = params.standardSol
  const stdUsdc = params.standardUsdc
  const hasOooBump =
    oooSol > stdSol + 1e-12 || oooUsdc > stdUsdc + 1e-9
  if (!hasOooBump) return false
  const solMatch = oooSol <= 0 || params.amountSol + 1e-9 >= oooSol
  const usdcMatch = oooUsdc <= 0 || params.amountUsdc + 1e-6 >= oooUsdc
  // Prefer matching the currency that actually differs; require at least one paid bump.
  if (oooSol > stdSol + 1e-12 && solMatch && params.amountSol > stdSol + 1e-12) return true
  if (oooUsdc > stdUsdc + 1e-9 && usdcMatch && params.amountUsdc > stdUsdc + 1e-9) return true
  return false
}

export function resolvePerNestAmountsForBucket(
  period: GenOwlRevSharePeriodRow,
  group: GenOwlStakingGroupKey,
  bucket: RevShareClaimBucket
): { sol: number; usdc: number } {
  if (group === 'gen2-owl') return resolveGen2PerNestAmounts(period, bucket)
  return resolveGen1PerNestAmounts(period, bucket)
}

export async function countPaidOneOfOneClaimsForGroup(params: {
  period: GenOwlRevSharePeriodRow
  group: GenOwlStakingGroupKey
}): Promise<number> {
  const standard = resolvePerNestAmountsForBucket(params.period, params.group, 'standard')
  const oneOfOne = resolvePerNestAmountsForBucket(params.period, params.group, 'one-of-one')
  if (
    oneOfOne.sol <= standard.sol + 1e-12 &&
    oneOfOne.usdc <= standard.usdc + 1e-9
  ) {
    return 0
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('gen_owl_rev_share_claims')
    .select('amount_sol, amount_usdc, sol_transaction_signature, usdc_transaction_signature')
    .eq('period_month', params.period.period_month.trim())
    .eq('group_key', params.group)
    .limit(50000)

  if (error || !data) {
    if (error) console.error('[gen-owl-rev-share] count paid 1/1:', error.message)
    return 0
  }

  let count = 0
  for (const row of data) {
    const hasSig =
      Boolean(row.sol_transaction_signature?.toString().trim()) ||
      Boolean(row.usdc_transaction_signature?.toString().trim())
    // Count reserved (inserted) 1/1 amounts too — prevents concurrent over-budget races.
    const amountSol = Number(row.amount_sol) || 0
    const amountUsdc = Number(row.amount_usdc) || 0
    if (
      claimAmountLooksLikeOneOfOne({
        amountSol,
        amountUsdc,
        standardSol: standard.sol,
        standardUsdc: standard.usdc,
        oneOfOneSol: oneOfOne.sol,
        oneOfOneUsdc: oneOfOne.usdc,
      })
    ) {
      count += 1
      continue
    }
    void hasSig
  }
  return count
}

async function liveClassifyBucket(
  group: GenOwlStakingGroupKey,
  mint: string | null
): Promise<RevShareClaimBucket> {
  const id = mint?.trim()
  if (!id) return 'standard'
  if (group === 'gen2-owl') {
    const classification = await classifyGen2OneOfOneMints([id])
    return classification.get(id) === 'one-of-one' ? 'one-of-one' : 'standard'
  }
  const classification = await classifyGen1OneOfOneMints([id])
  return classification.get(id) === 'one-of-one' ? 'one-of-one' : 'standard'
}

/**
 * Pick the payout bucket for one nest: prefer finalize snapshot, else live classify,
 * then enforce the finalized 1/1 slot budget so the pool cannot be overrun.
 *
 * When a finalize snapshot exists for this nest, use it as-is (rates were computed from
 * that exact set). Budget capping only applies to legacy months without a snapshot.
 *
 * Returns null when a period snapshot exists but this nest is not in it (do not pay).
 */
export async function resolveRevShareClaimBucket(params: {
  period: GenOwlRevSharePeriodRow
  group: GenOwlStakingGroupKey
  positionId: string
  mint: string | null
  /** When set, skip per-position snapshot fetch (Claim-all batch). Empty = no snapshot. */
  snapshotBuckets?: Map<string, RevShareClaimBucket>
  /** Optional cache for legacy budget checks (Claim-all / claimable list). */
  paidOneOfOneCount?: number
}): Promise<RevShareClaimBucket | null> {
  const positionId = params.positionId.trim()

  if (params.snapshotBuckets) {
    if (params.snapshotBuckets.size === 0) {
      // Legacy month: no finalize nest list — fall through to live + budget.
    } else {
      return params.snapshotBuckets.get(positionId) ?? null
    }
  } else {
    const fromSnapshot = await getGenOwlRevShareEligibleNestBucket({
      periodMonth: params.period.period_month,
      positionId,
    })
    if (fromSnapshot) return fromSnapshot

    const snapshotCount = await countGenOwlRevShareEligibleNestsForPeriod(params.period.period_month)
    if (snapshotCount > 0) {
      // Period was finalized with a nest list; this nest was not included.
      return null
    }
  }

  const desired = await liveClassifyBucket(params.group, params.mint)
  const budget = budgetedOneOfOneCountForGroup(params.period, params.group)
  if (desired !== 'one-of-one') return 'standard'

  const paid =
    typeof params.paidOneOfOneCount === 'number'
      ? params.paidOneOfOneCount
      : await countPaidOneOfOneClaimsForGroup({
          period: params.period,
          group: params.group,
        })
  return applyOneOfOneBudgetCap({
    desired,
    budgetedOneOfOneCount: budget,
    paidOneOfOneCount: paid,
  })
}

export async function resolveRevShareClaimAmounts(params: {
  period: GenOwlRevSharePeriodRow
  group: GenOwlStakingGroupKey
  positionId: string
  mint: string | null
  snapshotBuckets?: Map<string, RevShareClaimBucket>
  paidOneOfOneCount?: number
}): Promise<{ sol: number; usdc: number; bucket: RevShareClaimBucket } | null> {
  const bucket = await resolveRevShareClaimBucket(params)
  if (!bucket) return null
  const amounts = resolvePerNestAmountsForBucket(params.period, params.group, bucket)
  return { ...amounts, bucket }
}

/** Load snapshot map for a period (empty map if none — legacy months use live + budget). */
export async function loadRevShareSnapshotBuckets(
  periodMonth: string
): Promise<Map<string, RevShareClaimBucket>> {
  return listGenOwlRevShareEligibleNestBucketsForPeriod(periodMonth)
}
