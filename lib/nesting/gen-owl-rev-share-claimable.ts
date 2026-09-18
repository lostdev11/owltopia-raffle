import { getGenOwlRevShareClaimForPosition } from '@/lib/db/gen-owl-rev-share-claims'
import { listGenOwlRevSharePeriods, getGenOwlRevSharePeriod } from '@/lib/db/gen-owl-rev-share-periods'
import { areGenOwlRevShareClaimsEnabled } from '@/lib/db/rev-share-schedule'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import { isPositionEligibleForRevSharePeriod } from '@/lib/nesting/gen-owl-rev-share-eligibility'
import { ensureGenOwlRevSharePeriodFinalized } from '@/lib/nesting/gen-owl-rev-share-finalize'
import {
  loadRevShareSnapshotBuckets,
  resolveRevShareClaimAmounts,
  countPaidOneOfOneClaimsForGroup,
} from '@/lib/nesting/gen-owl-rev-share-claim-bucket'
import {
  claimsOpenForPeriod,
  formatPeriodMonthLabel,
  formatPeriodMonthUtc,
  groupKeyForPoolSlug,
  parsePeriodMonth,
} from '@/lib/nesting/gen-owl-rev-share-month'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import type { GenOwlRevSharePeriodRow } from '@/lib/db/gen-owl-rev-share-periods'

export type GenOwlRevShareClaimableRow = {
  period_month: string
  period_label: string
  position_id: string
  pool_name: string | null
  asset_identifier: string | null
  group: GenOwlStakingGroupKey
  amount_sol: number
  amount_usdc: number
  already_claimed: boolean
  sol_transaction_signature?: string | null
  usdc_transaction_signature?: string | null
}

function periodHasDepositTotals(period: GenOwlRevSharePeriodRow): boolean {
  return (
    (Number(period.gen1_total_sol) || 0) > 0 ||
    (Number(period.gen1_total_usdc) || 0) > 0 ||
    (Number(period.gen2_total_sol) || 0) > 0 ||
    (Number(period.gen2_total_usdc) || 0) > 0
  )
}

/** Recent calendar months (UTC), newest first — so unclaimed months can stack. */
function recentPeriodMonths(count: number, now = new Date()): string[] {
  const out: string[] = []
  const current = formatPeriodMonthUtc(now)
  const parsed = parsePeriodMonth(current)
  if (!parsed) return out
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(parsed.year, parsed.month - 1 - i, 1))
    out.push(formatPeriodMonthUtc(d))
  }
  return out
}

/**
 * Unclaimed rev share across every open month (stacks until claimed — same idea as OWL).
 * Returns [] when the admin claims kill switch is off (shares stay stacked).
 */
export async function listGenOwlRevShareClaimableForWallet(
  wallet: string
): Promise<GenOwlRevShareClaimableRow[]> {
  if (!(await areGenOwlRevShareClaimsEnabled())) {
    return []
  }

  const positions = await listStakingPositionsByWallet(wallet)
  if (positions.length === 0) return []

  const byMonth = new Map<string, GenOwlRevSharePeriodRow>()
  for (const row of await listGenOwlRevSharePeriods(36)) {
    byMonth.set(row.period_month, row)
  }

  // Include recent months even if missing from the first page, so older unclaimed
  // periods keep stacking after new months open.
  for (const month of recentPeriodMonths(18)) {
    if (byMonth.has(month)) continue
    if (!claimsOpenForPeriod(month)) continue
    const row = await getGenOwlRevSharePeriod(month)
    if (row) byMonth.set(month, row)
  }

  const openMonths = Array.from(byMonth.values())
    .filter((p) => claimsOpenForPeriod(p.period_month) && periodHasDepositTotals(p))
    .sort((a, b) => b.period_month.localeCompare(a.period_month))

  if (openMonths.length === 0) return []

  const rows: GenOwlRevShareClaimableRow[] = []
  const poolCache = new Map<string, Awaited<ReturnType<typeof getStakingPoolById>>>()

  for (const period of openMonths) {
    const finalized = period.finalized_at
      ? period
      : await ensureGenOwlRevSharePeriodFinalized(period.period_month)
    if (!finalized?.finalized_at) continue

    const snapshotBuckets = await loadRevShareSnapshotBuckets(finalized.period_month)
    const useSnapshot = snapshotBuckets.size > 0
    const paidOooByGroup = new Map<GenOwlStakingGroupKey, number>()
    if (!useSnapshot) {
      const [gen1Paid, gen2Paid] = await Promise.all([
        countPaidOneOfOneClaimsForGroup({ period: finalized, group: 'gen1-owl' }),
        countPaidOneOfOneClaimsForGroup({ period: finalized, group: 'gen2-owl' }),
      ])
      paidOooByGroup.set('gen1-owl', gen1Paid)
      paidOooByGroup.set('gen2-owl', gen2Paid)
    }

    for (const position of positions) {
      if (!isPositionEligibleForRevSharePeriod(position, period.period_month)) continue
      let pool = poolCache.get(position.pool_id)
      if (pool === undefined) {
        pool = await getStakingPoolById(position.pool_id)
        poolCache.set(position.pool_id, pool)
      }
      const group = groupKeyForPoolSlug(pool?.slug)
      if (!group) continue

      const amounts = await resolveRevShareClaimAmounts({
        period: finalized,
        group,
        positionId: position.id,
        mint: position.asset_identifier,
        snapshotBuckets: useSnapshot ? snapshotBuckets : undefined,
        paidOneOfOneCount: useSnapshot ? undefined : paidOooByGroup.get(group),
      })
      if (!amounts || (amounts.sol <= 0 && amounts.usdc <= 0)) continue

      const claimed = await getGenOwlRevShareClaimForPosition(period.period_month, position.id)

      rows.push({
        period_month: period.period_month,
        period_label: formatPeriodMonthLabel(period.period_month),
        position_id: position.id,
        pool_name: pool?.name ?? null,
        asset_identifier: position.asset_identifier,
        group,
        amount_sol: amounts.sol,
        amount_usdc: amounts.usdc,
        already_claimed: Boolean(claimed),
        sol_transaction_signature: claimed?.sol_transaction_signature ?? null,
        usdc_transaction_signature: claimed?.usdc_transaction_signature ?? null,
      })
    }
  }

  return rows.sort((a, b) => b.period_month.localeCompare(a.period_month))
}
