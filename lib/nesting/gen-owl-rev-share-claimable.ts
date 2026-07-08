import { getGenOwlRevShareClaimForPosition } from '@/lib/db/gen-owl-rev-share-claims'
import { listGenOwlRevSharePeriods } from '@/lib/db/gen-owl-rev-share-periods'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import { classifyGen1OneOfOneMints } from '@/lib/nesting/gen1-one-of-one'
import { isPositionEligibleForRevSharePeriod } from '@/lib/nesting/gen-owl-rev-share-eligibility'
import { ensureGenOwlRevSharePeriodFinalized } from '@/lib/nesting/gen-owl-rev-share-finalize'
import {
  claimsOpenForPeriod,
  formatPeriodMonthLabel,
  groupKeyForPoolSlug,
  latestOpenClaimPeriodMonth,
} from '@/lib/nesting/gen-owl-rev-share-month'
import { resolveGen1PerNestAmounts } from '@/lib/nesting/gen-owl-rev-share'
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
}

function perNestForGroup(
  period: GenOwlRevSharePeriodRow | null,
  group: GenOwlStakingGroupKey,
  gen1Bucket: 'standard' | 'one-of-one' | null
): { sol: number; usdc: number } {
  if (!period) return { sol: 0, usdc: 0 }
  if (group === 'gen1-owl') {
    return resolveGen1PerNestAmounts(period, gen1Bucket ?? 'standard')
  }
  return { sol: period.gen2_per_nest_sol ?? 0, usdc: period.gen2_per_nest_usdc ?? 0 }
}

export async function listGenOwlRevShareClaimableForWallet(
  wallet: string
): Promise<GenOwlRevShareClaimableRow[]> {
  const positions = await listStakingPositionsByWallet(wallet)
  if (positions.length === 0) return []

  let openPeriods = (await listGenOwlRevSharePeriods(36)).filter((p) =>
    claimsOpenForPeriod(p.period_month)
  )

  if (openPeriods.length === 0) {
    const latest = latestOpenClaimPeriodMonth()
    if (!latest) return []
    const finalized = await ensureGenOwlRevSharePeriodFinalized(latest)
    if (finalized) openPeriods = [finalized]
  }

  const gen1Mints = positions
    .map((p) => p.asset_identifier?.trim())
    .filter((m): m is string => Boolean(m))
  const gen1Classification = await classifyGen1OneOfOneMints(gen1Mints)

  const rows: GenOwlRevShareClaimableRow[] = []

  for (const period of openPeriods) {
    const finalized = period.finalized_at
      ? period
      : await ensureGenOwlRevSharePeriodFinalized(period.period_month)
    if (!finalized?.finalized_at) continue

    for (const position of positions) {
      if (!isPositionEligibleForRevSharePeriod(position, period.period_month)) continue
      const pool = await getStakingPoolById(position.pool_id)
      const group = groupKeyForPoolSlug(pool?.slug)
      if (!group) continue

      const mint = position.asset_identifier?.trim() ?? null
      const gen1Bucket =
        group === 'gen1-owl' && mint
          ? gen1Classification.get(mint) === 'one-of-one'
            ? 'one-of-one'
            : 'standard'
          : group === 'gen1-owl'
            ? 'standard'
            : null

      const amounts = perNestForGroup(finalized, group, gen1Bucket)
      if (amounts.sol <= 0 && amounts.usdc <= 0) continue

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
      })
    }
  }

  return rows.sort((a, b) => b.period_month.localeCompare(a.period_month))
}
